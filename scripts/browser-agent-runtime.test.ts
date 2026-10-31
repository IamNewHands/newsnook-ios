import assert from 'node:assert/strict'
import {createBrowserAgentRuntime, normalizeAgentObservation, type AgentBridge, type BrowserAgentRuntimeOptions} from '../src/features/browser/agent/agentRuntime'
import {runReActAgent,type AgentObservation,type AgentOperation,type AgentEventHandlers} from '../src/features/browser/agent/browserAgent'
import type {AgentStep} from '../src/features/browser/agent/agentRuntime'

const page:AgentObservation={snapshot:'snapshot',url:'https://example.org',title:'页面',text:'完成',viewport:{width:400,height:800},tabId:7,documentId:'doc',frameId:'main',elements:[{id:0,tag:'button',role:'',text:'搜索',type:'',href:'',x:30,y:30}]}
function fixture(overrides:Partial<AgentBridge>={},callbacks:Partial<BrowserAgentRuntimeOptions>={}){
  const calls:AgentOperation[]=[]
  const bridge:AgentBridge={state:async()=>({state:{tabId:7,url:page.url,loading:false,progress:100},tabs:[{id:7,index:0,url:page.url,title:'页面',active:true}]}),
    session:async(action,runId)=>({runId,state:action==='pause'?'paused':action==='stop'?'stopped':'running',tabId:7,documentId:'doc'}),
    action:async op=>{calls.push(op);return op.action==='observe'?structuredClone(page) as unknown as Record<string,unknown>:{ok:true,dispatched:true}},...overrides}
  const controller=new AbortController()
  const runtime=createBrowserAgentRuntime({signal:controller.signal,bridge,searchUrl:q=>'https://example.org/?q='+q,onSearch:async()=>true,onNavigate:async()=>true,onApproval:async()=>true,onHandoff:async()=> 'continue',...callbacks})
  return {runtime,calls,controller}
}
{
  const steps:AgentStep[]=[]
  const {runtime,controller}=fixture({state:async()=>({state:{loading:false,progress:0},tabs:[]})},
    {onStep:step=>steps.push(step),onSearch:async()=>{throw Object.assign(new Error('无法连接搜索站点'),{code:'ERR_CONNECTION_RESET'})}})
  await assert.rejects(()=>runtime.performTool('browser_search',{query:'测试检索'},controller.signal),/无法连接搜索站点/)
  assert.match(steps.at(-1)?.detail||'',/ERR_CONNECTION_RESET/)
  assert.match(steps.at(-1)?.input||'',/测试检索/)
  await runtime.stop()
}
{
  const steps:AgentStep[]=[]
  const {runtime,controller}=fixture({}, {onStep:step=>steps.push(step)})
  await runtime.start()
  await runtime.performTool('browser_observe',{},controller.signal)
  assert.match(steps.at(-1)?.result||'',/页面/,'successful steps retain inspectable results')
  await runtime.performTool('browser_wait',{text:'未出现的文字',timeoutMs:0},controller.signal)
  assert.equal(steps.at(-1)?.status,'failed','an unmet wait condition is not displayed as success')
  assert.match(steps.at(-1)?.input||'',/未出现的文字/)
  assert.match(steps.at(-1)?.detail||'',/条件|等待/)
  await runtime.stop()
}
{
  const steps:AgentStep[]=[]
  const {runtime,controller}=fixture({action:async()=>{throw Object.assign(new Error('网页连接已断开'),{code:'WEBVIEW_GONE'})}}, {onStep:step=>steps.push(step)})
  await runtime.start()
  await runtime.performTool('browser_wait',{text:'完成',timeoutMs:0},controller.signal)
  assert.match(steps.at(-1)?.detail||'',/网页连接已断开/,'wait preserves the actual observation failure')
  assert.match(steps.at(-1)?.detail||'',/WEBVIEW_GONE/)
  await runtime.stop()
}
{
  const steps:AgentStep[]=[]
  const {runtime,controller}=fixture({}, {onStep:step=>steps.push(step),onBrowserConfig:async()=>({apiKey:'hidden-secret',image:'hidden-image',text:'x'.repeat(20000),url:'https://example.org/?token=hidden-token'})})
  await runtime.start()
  await runtime.performTool('browser_config',{action:'inspect'},controller.signal)
  const result=steps.at(-1)?.result||''
  assert.ok(result.length>0&&result.length<=8000)
  assert.doesNotMatch(result,/hidden-secret|hidden-image|hidden-token/)
  await runtime.stop()
}
{
  const flat=normalizeAgentObservation({...page,frames:[{...page,frameId:'child',documentId:'child-document',snapshot:'child-shot',elements:[{...page.elements[0],id:0,text:'内部操作'}]}]})
  assert.equal(flat.elements.length,2)
  assert.notEqual(flat.elements[0].id,flat.elements[1].id)
  assert.equal(flat.elements[1].frameDocumentId,'child-document')
  assert.equal(flat.elements[1].localId,0)
  const nativeEnvelope=normalizeAgentObservation({...page,documentId:'native-epoch',frameDocumentId:'main-js-document',frames:[{...page,documentId:'main-js-document'}]})
  assert.equal(nativeEnvelope.documentId,'native-epoch')
  assert.equal(nativeEnvelope.elements[0].frameDocumentId,'main-js-document')
  assert.equal(nativeEnvelope.elements.length,1)
}
{
  const {runtime,calls,controller}=fixture()
  await runtime.start()
  await runtime.performTool('browser_observe',{},controller.signal)
  await runtime.performTool('browser_type',{id:0,text:''},controller.signal)
  assert.equal(calls.find(c=>c.action==='type')?.text,'')
  assert(calls.every(c=>c.runId&&c.requestId))
  await runtime.stop()
  await assert.rejects(()=>runtime.performTool('browser_click',{id:0},controller.signal),/停止/)
}
{
  const {runtime,calls,controller}=fixture()
  await runtime.start();await runtime.pause()
  let done=false
  const task=runtime.performTool('browser_observe',{},controller.signal).then(()=>{done=true})
  await Promise.resolve(); assert.equal(done,false)
  assert.equal(calls.length,0)
  await runtime.resume();await task
  assert(calls.filter(c=>c.action==='observe').length>=1)
  await runtime.stop()
}
{
  let acknowledge:()=>void=()=>{}
  let stopEntered:()=>void=()=>{}
  const entered=new Promise<void>(resolve=>{stopEntered=resolve})
  const {runtime}=fixture({session:async(action,runId)=>{if(action==='stop')await new Promise<void>(r=>{acknowledge=r;stopEntered()});return {runId,state:action==='stop'?'stopped':'running'}}})
  await runtime.start()
  let stopped=false
  const stop=runtime.stop().then(()=>{stopped=true})
  await entered;assert.equal(stopped,false)
  acknowledge();await stop;assert.equal(stopped,true)
}
{
  let observes=0
  const {runtime,calls,controller}=fixture({action:async op=>{calls.push(op);if(op.action==='observe'){if(++observes>1)throw new Error('断网');return structuredClone(page) as unknown as Record<string,unknown>}return {ok:true,dispatched:true}}})
  await runtime.start();await runtime.performTool('browser_observe',{},controller.signal)
  const result=await runtime.performTool('browser_click',{id:0},controller.signal)
  assert.equal((result.result as {outcome:string}).outcome,'unknown')
  await assert.rejects(()=>runtime.performTool('browser_click',{id:0},controller.signal),/结果|观察/)
  assert.equal(calls.filter(c=>c.action==='click').length,1)
  await runtime.stop()
}
{
  const {runtime,calls,controller}=fixture()
  await runtime.start()
  await runtime.performTool('browser_open_url',{url:'https://example.org/next'},controller.signal)
  assert.equal(calls.find(call=>call.action==='navigate')?.documentId,'doc','navigation keeps native document ownership')
  await runtime.stop()
}
{
  let nativeStart:()=>void=()=>{},releaseStart:()=>void=()=>{}
  const entered=new Promise<void>(resolve=>{nativeStart=resolve})
  const phases:string[]=[],sessions:string[]=[]
  const {runtime,calls,controller}=fixture({session:async(action,runId)=>{
    sessions.push(action)
    if(action==='start')await new Promise<void>(resolve=>{releaseStart=resolve;nativeStart()})
    return {runId,state:action==='pause'?'paused':action==='stop'?'stopped':'running'}
  }},{onPhase:phase=>phases.push(phase)})
  const starting=runtime.start();await entered
  const pausing=runtime.pause();releaseStart()
  await Promise.all([starting,pausing])
  assert.equal(phases.at(-1),'paused','delayed start must not overwrite the requested pause')
  let executed=false
  const waiting=runtime.performTool('browser_observe',{},controller.signal).then(()=>{executed=true})
  await Promise.resolve();assert.equal(executed,false);assert.equal(calls.length,0)
  await runtime.resume();await waiting;await runtime.stop()
  assert(sessions.indexOf('stop')>sessions.indexOf('start'))
}
{
  let stops=0
  const {runtime}=fixture({session:async(action,runId)=>{
    if(action==='stop'&&++stops===1)throw new Error('停止未确认')
    return {runId,state:action==='stop'?'stopped':'running'}
  }})
  await runtime.start()
  await assert.rejects(runtime.stop,/停止未确认/)
  await runtime.stop();assert.equal(stops,2,'a failed ACK can be retried')
}
{
  let handlers:AgentEventHandlers|undefined,runId='',removed=false
  const phases:string[]=[],files:string[]=[]
  const {runtime,controller}=fixture({
    session:async(action,id)=>{runId=id;return {runId:id,state:action==='stop'?'stopped':action==='pause'?'paused':'running'}},
    subscribe:async value=>{handlers=value;return async()=>{removed=true}},
  },{onPhase:phase=>phases.push(phase),onArtifacts:items=>files.push(items.map(item=>item.status).join(','))})
  await runtime.start();assert(handlers)
  handlers.session({runId:'another-run',state:'paused'})
  assert.equal(phases.at(-1),'running')
  handlers.session({runId,state:'paused',reason:'user_touch'})
  assert.equal(phases.at(-1),'paused')
  let done=false
  const waiting=runtime.performTool('browser_observe',{},controller.signal).then(()=>{done=true})
  await Promise.resolve();assert.equal(done,false)
  await runtime.resume();await waiting
  handlers.file({runId,type:'file',event:'download_started',file:{fileId:'actual',name:'a.csv',mime:'text/csv',size:40,status:'downloading'}})
  handlers.file({runId:'old-run',type:'file',event:'download_completed',file:{fileId:'unrelated',name:'b.csv',mime:'text/csv',size:40,status:'ready'}})
  handlers.file({runId,type:'file',event:'download_completed',file:{fileId:'actual',name:'a.csv',mime:'text/csv',size:40,status:'ready'}})
  assert.deepEqual(files,['downloading','ready'])
  await runtime.stop();assert.equal(removed,true)
  handlers.file({runId,type:'file',event:'download_failed',file:{fileId:'actual',name:'a.csv',mime:'text/csv',size:40,status:'failed'}})
  assert.equal(files.at(-1),'ready')
}
{
  const {runtime,calls,controller}=fixture({action:async op=>{
    calls.push(op)
    if(op.action==='observe')return structuredClone(page) as unknown as Record<string,unknown>
    throw Object.assign(new Error('输入发出后页面开始导航'),{dispatched:true})
  }})
  await runtime.start();await runtime.performTool('browser_observe',{},controller.signal)
  const result=await runtime.performTool('browser_click',{id:0},controller.signal)
  assert.equal((result.result as {outcome:string}).outcome,'unknown')
  await runtime.performTool('browser_observe',{},controller.signal)
  await assert.rejects(()=>runtime.performTool('browser_click',{id:0},controller.signal),/结果未确认/)
  assert.equal(calls.filter(call=>call.action==='click').length,1)
  await runtime.stop()
}
{
  const {runtime,calls,controller}=fixture({action:async op=>{
    calls.push(op)
    if(op.action==='observe')return structuredClone(page) as unknown as Record<string,unknown>
    if(op.action==='screenshot')return {image:'data',width:200,height:400,viewWidth:400,viewHeight:800,shotId:'shot',documentId:'doc'}
    return {ok:true,dispatched:true}
  }})
  await runtime.start();await runtime.performTool('browser_screenshot',{},controller.signal)
  await runtime.performTool('browser_touch',{contacts:[{id:4,points:[{x:20,y:20,timeMs:0},{x:40,y:30,timeMs:300}]},{id:1,points:[{x:100,y:100,timeMs:0},{x:90,y:80,timeMs:300}]}]},controller.signal)
  const gesture=calls.find(call=>call.action==='gesture')?.gesture as {contacts:Array<{id:number;points:Array<{x:number;y:number}>}>}
  assert.equal(gesture.contacts[0].id,4)
  assert.deepEqual(gesture.contacts[0].points[1],{x:80,y:60,timeMs:300})
  await assert.rejects(()=>runtime.performTool('browser_tap',{x:20,y:20},controller.signal),/先获取/)
  await runtime.stop()
}
{
  let full=false,exposed=false
  const order:string[]=[]
  const {runtime,calls,controller}=fixture({
    state:async()=>({state:{tabId:7,url:page.url,loading:false,agentViewport:{width:400,height:800,visible:full,occluded:!full,visibleRect:{left:0,top:0,right:400,bottom:full?800:400}}},tabs:[]}),
    action:async op=>{
      calls.push(op)
      if(op.action==='observe')return structuredClone(page) as unknown as Record<string,unknown>
      assert(full,'coordinates must wait for the actual native visible region')
      order.push(op.action)
      if(op.action==='screenshot')return {image:'data',width:200,height:400,viewWidth:400,viewHeight:800,shotId:'shot',documentId:'doc'}
      return {ok:true,dispatched:true}
    },
  },{onExposePage:async()=>{order.push('expose');exposed=true},onApproval:async()=>{order.push('approval');full=false;return true}})
  await runtime.start()
  const capture=runtime.performTool('browser_screenshot',{},controller.signal)
  await new Promise(resolve=>setTimeout(resolve,5))
  assert(exposed);assert.equal(calls.filter(call=>call.action==='screenshot').length,0)
  full=true;await capture
  const tapping=runtime.performTool('browser_tap',{x:20,y:20},controller.signal)
  await new Promise(resolve=>setTimeout(resolve,5))
  assert.equal(calls.filter(call=>call.action==='gesture').length,0,'the approval sheet must be exposed again before input')
  full=true;await tapping
  assert.deepEqual(order,['expose','screenshot','approval','expose','gesture'])
  await runtime.stop()
}
{
  let handlers:AgentEventHandlers|undefined,runId=''
  const {runtime,calls,controller}=fixture({
    session:async(action,id)=>{runId=id;return {runId:id,state:action==='stop'?'stopped':'running'}},
    subscribe:async value=>{handlers=value;return async()=>{}},
    state:async()=>({state:{tabId:7,url:page.url,loading:false,agentViewport:{width:400,height:800,visible:true,occluded:false,visibleRect:{left:0,top:0,right:400,bottom:800}}},tabs:[]}),
  },{onExposePage:async()=>{handlers!.session({runId,state:'paused',reason:'user_touch'})}})
  await runtime.start();await runtime.performTool('browser_observe',{},controller.signal)
  await assert.rejects(()=>runtime.performTool('browser_click',{id:0},controller.signal),/控制状态已变化/)
  assert.equal(calls.filter(call=>call.action==='click').length,0,'manual intervention during exposure invalidates the old decision')
  await runtime.stop()
}
{
  const {runtime,calls,controller}=fixture({action:async op=>{
    calls.push(op)
    if(op.action==='observe')return {...structuredClone(page),elements:[{...page.elements[0],type:'file',multiple:true,accept:'image/png'}]} as unknown as Record<string,unknown>
    if(op.action==='choose_files')return {cancelled:true,files:[]}
    return {ok:true,dispatched:true}
  }})
  await runtime.start();await runtime.performTool('browser_observe',{},controller.signal)
  await assert.rejects(()=>runtime.performTool('browser_upload_files',{id:0},controller.signal),/选择已取消/)
  assert.equal(calls.filter(call=>call.action==='click').length,0,'a canceled picker cannot reopen the input or upload')
  assert.equal(calls.find(call=>call.action==='choose_files')?.multiple,true)
  assert.deepEqual(calls.find(call=>call.action==='choose_files')?.acceptTypes,['image/png'])
  await runtime.stop()
}
{
  let handlers:AgentEventHandlers|undefined,runId='',documentId='doc'
  const {runtime,calls,controller}=fixture({
    session:async(action,id)=>{runId=id;return {runId:id,state:action==='stop'?'stopped':'running'}},
    subscribe:async value=>{handlers=value;return async()=>{}},
    action:async op=>{
      calls.push(op)
      if(op.action==='observe')return {...structuredClone(page),documentId} as unknown as Record<string,unknown>
      if(op.action==='click'){
        handlers!.session({runId,state:'paused',reason:'user_touch'})
        throw Object.assign(new Error('页面变化时操作已经发出'),{dispatched:true})
      }
      return {ok:true,dispatched:true}
    },
  })
  await runtime.start();await runtime.performTool('browser_observe',{},controller.signal)
  const attempted=await runtime.performTool('browser_click',{id:0},controller.signal)
  assert.equal((attempted.result as {outcome:string}).outcome,'unknown')
  documentId='new-document';await runtime.resume()
  await assert.rejects(()=>runtime.performTool('browser_type',{id:0,text:'replacement'},controller.signal),/结果未确认/)
  assert.equal(calls.filter(call=>call.action==='type').length,0,'another tool and a new document cannot bypass an uncertain operation')
  assert.equal((await runtime.prepareFinish!()).ready,false,'a model answer cannot mark an uncertain task complete')
  await runtime.performTool('browser_request_handoff',{kind:'manual',reason:'请检查上次操作的结果'},controller.signal)
  await runtime.performTool('browser_type',{id:0,text:'confirmed'},controller.signal)
  assert.equal((await runtime.prepareFinish!()).ready,true)
  await runtime.stop()
}
{
  let handlers:AgentEventHandlers|undefined,runId='',status='downloading'
  const file=()=>({fileId:'download',name:'report.csv',mime:'text/csv',size:40,status})
  const {runtime}=fixture({
    session:async(action,id)=>{runId=id;return {runId:id,state:action==='stop'?'stopped':'running'}},
    subscribe:async value=>{handlers=value;return async()=>{}},
    action:async op=>op.action==='observe'?structuredClone(page) as unknown as Record<string,unknown>:{files:[file()]},
  })
  await runtime.start()
  handlers!.file({runId,type:'file',event:'download_started',file:file()})
  assert.equal((await runtime.prepareFinish!()).ready,false)
  status='ready';assert.equal((await runtime.prepareFinish!()).ready,true)
  await runtime.stop()
}
{
  const {runtime,calls,controller}=fixture()
  await runtime.start()
  const waiting=runtime.performTool('browser_wait',{timeoutMs:10000},controller.signal)
  await Promise.resolve();assert.equal(calls.length,0,'an unconditional wait must not resolve immediately')
  controller.abort();await assert.rejects(waiting,{name:'AbortError'})
  await runtime.stop()
}
{
  const {runtime,calls,controller}=fixture()
  await runtime.start()
  await assert.rejects(()=>runtime.performTool('browser_click',{id:0},controller.signal),/先观察网页/)
  assert.equal(calls.length,0,'a guessed element ID cannot cause an implicit observation and then a click')
  await runtime.stop()
}
const model={endpoint:'http://localhost:8765/v1',apiKey:'fixture',model:'fixture'}
{
  const {runtime,calls,controller}=fixture()
  await runtime.start();await runtime.performTool('browser_observe',{},controller.signal)
  const decisionVersion=runtime.contextVersion!()
  await runtime.pause()
  const rejected=assert.rejects(()=>runtime.performTool('browser_click',{id:0},controller.signal,decisionVersion),/模型依据.*已变化/)
  await runtime.resume();await rejected
  assert.equal(calls.filter(call=>call.action==='click').length,0,'a pause at the tool boundary cannot rebind old model IDs after resume')
  await runtime.stop()
}
for(const change of ['finish','event']){
  let handlers:AgentEventHandlers|undefined,runId='',turns=0
  const file=(status:string)=>({fileId:'download',name:'report.csv',mime:'text/csv',size:40,status})
  const {runtime,controller}=fixture({
    session:async(action,id)=>{runId=id;return {runId:id,state:action==='stop'?'stopped':'running'}},
    subscribe:async value=>{handlers=value;return async()=>{}},
    action:async op=>op.action==='observe'?structuredClone(page) as unknown as Record<string,unknown>:{files:[file('failed')]},
  })
  const initial=await runtime.start();await runtime.performTool('browser_observe',{},controller.signal)
  handlers!.file({runId,type:'file',event:'download_started',file:file('downloading')})
  const answer=await runReActAgent(model,'下载报告',initial,runtime,controller.signal,async(_config,messages)=>{
    if(turns++===0){
      if(change==='event')handlers!.file({runId,type:'file',event:'download_failed',file:file('failed')})
      return {content:'报告已下载完成'}
    }
    assert.match(messages.at(-1)?.content as string,/failed/,'terminal failure must reach a new model decision')
    return {content:'下载失败，未获得报告文件'}
  })
  assert.equal(answer,'下载失败，未获得报告文件');assert.equal(turns,2)
  await runtime.stop()
}
{
  let handlers:AgentEventHandlers|undefined,runId='',turns=0,done=false,reportPaused:()=>void=()=>{}
  const paused=new Promise<void>(resolve=>{reportPaused=resolve})
  const file=(status:string)=>({fileId:'download',name:'report.csv',mime:'text/csv',size:40,status})
  const {runtime,controller}=fixture({
    session:async(action,id)=>{runId=id;return {runId:id,state:action==='stop'?'stopped':'running'}},
    subscribe:async value=>{handlers=value;return async()=>{}},
    action:async op=>{
      if(op.action==='observe')return structuredClone(page) as unknown as Record<string,unknown>
      handlers!.session({runId,state:'paused',reason:'user_touch'});reportPaused()
      return {files:[file('ready')]}
    },
  })
  const initial=await runtime.start();await runtime.performTool('browser_observe',{},controller.signal)
  handlers!.file({runId,type:'file',event:'download_started',file:file('downloading')})
  const running=runReActAgent(model,'下载报告',initial,runtime,controller.signal,async()=>({content:++turns===1?'原先的完成结论':'恢复后已确认文件'})).then(answer=>{done=true;return answer})
  await paused;await Promise.resolve();assert.equal(done,false,'pause during final verification retains task ownership')
  await runtime.resume();assert.equal(await running,'恢复后已确认文件');assert.equal(turns,2)
  await runtime.stop()
}
{
  let handlers:AgentEventHandlers|undefined,runId='',changed=false,intervened=false,turns=0
  const observed=()=>({...structuredClone(page),documentId:changed?'new-doc':'old-doc',snapshot:changed?'new-snapshot':'old-snapshot',elements:[{...page.elements[0],text:changed?'切换另一份资料':'阅读当前报告'}]})
  const {runtime,calls,controller}=fixture({
    session:async(action,id)=>{runId=id;return {runId:id,state:action==='stop'?'stopped':'running'}},
    subscribe:async value=>{handlers=value;return async()=>{}},
    action:async op=>{calls.push(op);return op.action==='observe'?observed() as unknown as Record<string,unknown>:{ok:true,dispatched:true}},
  },{onStep:step=>{
    if(step.tool==='browser_observe'&&step.status==='succeeded'&&!intervened){
      intervened=true;handlers!.session({runId,state:'paused',reason:'user_touch'});changed=true;void runtime.resume()
    }
  }})
  const initial=await runtime.start()
  await runReActAgent(model,'阅读当前报告',initial,runtime,controller.signal,async(_config,messages)=>{
    if(turns++===0)return {content:null,tool_calls:[{id:'observe',type:'function',function:{name:'browser_observe',arguments:'{}'}}]}
    if(turns===2){
      assert.match(messages.at(-1)?.content as string,/切换另一份资料/,'resume between model turns must be disclosed before the next decision')
      return {content:null,tool_calls:[{id:'click',type:'function',function:{name:'browser_click',arguments:'{"id":0}'}}]}
    }
    return {content:'已根据新页面完成'}
  })
  assert.equal(calls.find(call=>call.action==='click')?.documentId,'new-doc')
  await runtime.stop()
}
{
  let turns=0
  const {runtime,calls,controller}=fixture({action:async op=>{
    calls.push(op)
    if(op.action==='observe')return structuredClone(page) as unknown as Record<string,unknown>
    if(op.action==='screenshot')return {image:'abc',width:200,height:400,viewWidth:400,viewHeight:800,shotId:'shot',documentId:'doc'}
    return {ok:true,dispatched:true}
  }})
  const initial=await runtime.start()
  await runReActAgent(model,'点击画面',initial,runtime,controller.signal,async()=>{
    if(turns++===0)return {content:null,tool_calls:[{id:'screen',type:'function',function:{name:'browser_screenshot',arguments:'{}'}}]}
    if(turns===2)return {content:null,tool_calls:[{id:'tap',type:'function',function:{name:'browser_tap',arguments:'{"x":20,"y":20}'}}]}
    return {content:'已检查点击结果'}
  })
  assert.equal(calls.filter(call=>call.action==='gesture').length,1,'disclosing an implicit screenshot observation must preserve its screenshot lease')
  await runtime.stop()
}
console.log('Agent runtime frame references, exposure ACK, cancellation, files, model context, completion and uncertain outcome: PASS')
