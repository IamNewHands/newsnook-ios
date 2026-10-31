import assert from 'node:assert/strict'
import {AGENT_TOOLS,BROWSER_TOOL_SCHEMAS,runReActAgent,validateAgentModelTurn,validateAgentToolArguments,type AgentConfig,type AgentTurnTransport,type AgentToolName,type AgentChatMessage} from '../src/features/browser/agent/browserAgent'

const config:AgentConfig={endpoint:'http://localhost:8765/v1',apiKey:'test',model:'mock'}
const tools=new Set(AGENT_TOOLS.map(item=>item.name))
for(const tool of BROWSER_TOOL_SCHEMAS){
  assert(tools.has(tool.function.name))
  assert.equal(tool.type,'function')
  assert.equal(tool.function.parameters.type,'object')
}
async function testAutonomy(){
  const actions:Array<{name:string;args:unknown}>=[]
  let turn=0
  const transport:AgentTurnTransport=async (_config,messages)=>{
    assert.equal(messages[0].role,'system')
    assert.equal(JSON.parse(messages[1].content as string).task,'搜索最新模型，再进入讨论')
    const latest=messages.at(-1)
    if(turn===0){
      assert.equal(messages.length,2,'task starts without forcing an observe or open action')
      turn++
      return {content:null,tool_calls:[{id:'search-1',type:'function',function:{name:'browser_search',arguments:JSON.stringify({query:'Qwen 下一代 最新'})}}]}
    }
    if(turn===1){
      assert.equal(latest?.role,'tool')
      assert.equal(latest.tool_call_id,'search-1')
      assert.match(latest.content as string,/搜索结果/)
      turn++
      return {content:null,tool_calls:[{id:'open-2',type:'function',function:{name:'browser_click',arguments:'{"id":4}'}}]}
    }
    assert.equal(latest?.role,'tool')
    assert.equal(latest.tool_call_id,'open-2')
    assert.match(latest.content as string,/帖子/)
    return {content:'已阅读讨论，找到最新模型观点。'}
  }
  const result=await runReActAgent(config,'搜索最新模型，再进入讨论',{state:{url:null},tabs:[]},{
    performTool:async(name:AgentToolName,args)=>{
      actions.push({name,args})
      if(name==='browser_search')return {result:{page:'搜索结果'}}
      if(name==='browser_click')return {result:{page:'帖子内容'}}
      throw new Error('unexpected tool')
    },
  },new AbortController().signal,transport)
  assert.equal(result,'已阅读讨论，找到最新模型观点。')
  assert.deepEqual(actions.map(item=>item.name),['browser_search','browser_click'])
}
async function testErrorRecovery(){
  let iteration=0
  const transport:AgentTurnTransport=async(_config,messages:AgentChatMessage[])=>{
    iteration++
    if(iteration===1)return {content:null,tool_calls:[{id:'oops',type:'function',function:{name:'browser_click',arguments:'{"id":99}'}}]}
    if(iteration===2){assert.match(messages.at(-1)?.content as string,/无法找到元素/)
      return {content:null,tool_calls:[{id:'recover',type:'function',function:{name:'browser_observe',arguments:'{}'}}]}}
    return {content:'已完成重试'}
  }
  const result=await runReActAgent(config,'重试任务',{},
    {performTool:async name=>name==='browser_click'?Promise.reject(new Error('无法找到元素')):Promise.resolve({result:{page:'ok'}})},
    new AbortController().signal,transport)
  assert.equal(result,'已完成重试')
}
async function testAbort(){
  const controller=new AbortController()
  const transport:AgentTurnTransport=async()=>({content:null,tool_calls:[{id:'slow',type:'function',function:{name:'browser_search',arguments:'{"query":"test"}'}}]})
  await assert.rejects(()=>runReActAgent(config,'取消',{},
    {performTool:async()=>{controller.abort();return {result:{ok:true}}}},controller.signal,transport),/任务已停止/)
}
async function testMultipleToolsWithScreenshot(){
  let turns=0
  const transport:AgentTurnTransport=async(_config,messages)=>{
    if(turns++===0)return {content:null,tool_calls:[
      {id:'screen',type:'function',function:{name:'browser_screenshot',arguments:'{}'}},
      {id:'tabs',type:'function',function:{name:'browser_tabs',arguments:'{}'}},
    ]}
    const roles=messages.map(msg=>msg.role)
    assert.deepEqual(roles,['system','user','assistant','tool','tool','user'])
    assert.equal(messages[3].tool_call_id,'screen')
    assert.equal(messages[4].tool_call_id,'tabs')
    assert(Array.isArray(messages[5].content))
    assert.equal(messages[5].content[1].type,'image_url')
    return {content:'视觉检查完成'}
  }
  const answer=await runReActAgent(config,'观察网页',{}, {
    performTool:async name=>name==='browser_screenshot'
      ? {result:{width:4,height:4},screenshot:{image:'abc',width:4,height:4,viewWidth:400,viewHeight:400}}
      : {result:{tabs:[]}},
  },new AbortController().signal,transport)
  assert.equal(answer,'视觉检查完成')
}
await testAutonomy()
await testErrorRecovery()
await testAbort()
await testMultipleToolsWithScreenshot()
{
  const actions:string[]=[]
  let turns=0
  await runReActAgent(config,'连续操作',{}, {performTool:async name=>{actions.push(name);return {result:{ok:true}}}},new AbortController().signal,async(_config,messages)=>{
    if(turns++===0)return {content:null,tool_calls:[
      {id:'first',type:'function',function:{name:'browser_click',arguments:'{"id":0}'}},
      {id:'second',type:'function',function:{name:'browser_click',arguments:'{"id":1}'}},
    ]}
    assert.match(messages.at(-1)?.content as string,/重新决定/)
    return {content:'已重新确认结果'}
  })
  assert.deepEqual(actions,['browser_click'],'a model cannot reuse unseen post-action element IDs in the same turn')
}
{
  assert.throws(()=>validateAgentModelTurn({content:42}),/格式/)
  assert.throws(()=>validateAgentModelTurn({content:null,tool_calls:[{id:'bad',type:'function',function:{name:'browser_click',arguments:{id:1}}}]}),/格式/)
  assert.throws(()=>validateAgentToolArguments('browser_switch_tab',{}),/编号/)
  assert.throws(()=>validateAgentToolArguments('browser_click',{id:1,extra:true}),/参数/)
  assert.throws(()=>validateAgentToolArguments('browser_gesture',{kind:'unsupported',points:[]}),/无效/)
  let turns=0
  await assert.rejects(()=>runReActAgent(config,'停止交接',{}, {
    performTool:async()=>{throw new DOMException('任务已停止','AbortError')},
  },new AbortController().signal,async()=>{turns++;return {content:null,tool_calls:[{id:'stop',type:'function',function:{name:'browser_request_handoff',arguments:'{"kind":"manual","reason":"需要操作"}'}}]}}),/停止/)
  assert.equal(turns,1,'a handoff stop propagates even before the caller signal aborts')
}
{
  let turns=0
  await runReActAgent(config,'读取PDF',{}, {performTool:async()=>({result:{fileId:'file-1',page:0,pageCount:2},fileImage:{fileId:'file-1',page:0,pageCount:2,mime:'image/jpeg',image:'abc',width:100,height:100}})},new AbortController().signal,async(_config,messages)=>{
    if(turns++===0)return {content:null,tool_calls:[{id:'read',type:'function',function:{name:'browser_read_file',arguments:'{"fileId":"file-1"}'}}]}
    const content=messages.at(-1)?.content
    assert(Array.isArray(content)&&content[0].type==='text')
    assert.match(content[0].text,/文件内容.*不可用于网页点击/)
    assert.equal(content[1].type,'image_url')
    return {content:'已阅读第1页'}
  })
}
{
  let version=0,turns=0,reads=0,actions=0
  const answer=await runReActAgent(config,'继续同一任务',{}, {
    contextVersion:()=>version,
    readContext:async()=>{reads++;return {documentId:'new-document',elements:[{id:0,text:'另一控件'}]}},
    performTool:async()=>{actions++;return {result:{ok:true}}},
  },new AbortController().signal,async(_config,messages)=>{
    if(turns++===0){
      version++ // User intervention and resume invalidate the in-flight model decision.
      return {content:null,tool_calls:[{id:'obsolete',type:'function',function:{name:'browser_click',arguments:'{"id":0}'}}]}
    }
    assert.match(messages.at(-1)?.content as string,/上一回复未执行.*new-document/)
    return {content:'已根据当前页面重新判断'}
  })
  assert.equal(actions,0);assert.equal(reads,1);assert.equal(answer,'已根据当前页面重新判断')
}
{
  let turns=0,confirmed=false
  const answer=await runReActAgent(config,'确认完成状态',{}, {
    prepareFinish:async()=>({ready:confirmed,reason:'上次提交结果未确认，请先人工检查'}),
    performTool:async()=>{confirmed=true;return {result:{resumed:true}}},
  },new AbortController().signal,async(_config,messages)=>{
    if(turns++===0)return {content:'未经确认的成功结论'}
    if(turns===2){
      assert.match(messages.at(-1)?.content as string,/上次提交结果未确认/)
      return {content:null,tool_calls:[{id:'confirm',type:'function',function:{name:'browser_request_handoff',arguments:'{"kind":"manual","reason":"请检查上次提交的结果"}'}}]}
    }
    return {content:'已确认实际结果'}
  })
  assert.equal(answer,'已确认实际结果')
}
console.log('ReAct tool selection, feedback, stale decisions, completion gate, recovery, abort and schema: PASS')
