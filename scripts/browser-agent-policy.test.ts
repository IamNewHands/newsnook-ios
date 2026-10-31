import assert from 'node:assert/strict'
import {agentApprovalReason,AGENT_TOOLS,assertAgentEndpoint,type AgentObservation} from '../src/features/browser/agent/browserAgent'

const page:AgentObservation={snapshot:'test',url:'https://example.org/',title:'Example',text:'',viewport:{width:400,height:800},elements:[
  {id:0,tag:'button',text:'搜索',href:'',role:'',type:'',x:20,y:20},
  {id:1,tag:'button',text:'删除内容',href:'',role:'',type:'',x:20,y:50},
  {id:2,tag:'input',text:'查询',href:'',role:'',type:'text',x:20,y:80},
  {id:3,tag:'button',text:'',href:'',role:'',type:'',x:20,y:110},
]}
assert.equal(agentApprovalReason({action:'click',id:0},page),null)
assert.match(agentApprovalReason({action:'click',id:1},page)??'',/更改网站数据/)
assert.match(agentApprovalReason({action:'click',id:3},page)??'',/未标注/)
assert.equal(agentApprovalReason({action:'submit',id:2},page),null)
assert.match(agentApprovalReason({action:'tap',x:1,y:1},page)??'',/确认/)
assert.match(agentApprovalReason({action:'close_tab',index:0},page)??'',/丢失/)
assert.equal(assertAgentEndpoint({endpoint:'https://example.com/v1',model:'mock',apiKey:'foo'}),'https://example.com/v1')
assert.equal(assertAgentEndpoint({endpoint:'http://localhost:8765/v1',model:'mock',apiKey:'foo'}),'http://localhost:8765/v1')
assert.throws(()=>assertAgentEndpoint({endpoint:'http://192.168.1.20:8000/v1',model:'local',apiKey:'foo'}))
assert.equal(assertAgentEndpoint({endpoint:'http://192.168.1.20:8000/v1',model:'local',apiKey:'foo',allowLanHttp:true}),'http://192.168.1.20:8000/v1')
assert.throws(()=>assertAgentEndpoint({endpoint:'http://example.com/v1',model:'bad',apiKey:'foo',allowLanHttp:true}))
assert.throws(()=>assertAgentEndpoint({endpoint:'https://api.example.com/v1?token=secret',model:'bad',apiKey:'foo'}))
assert(AGENT_TOOLS.some(t=>t.name==='browser_search'))
assert(AGENT_TOOLS.some(t=>t.name==='browser_open_url'))
console.log('Agent approval, endpoint policy and ReAct tool catalog: PASS')

assert.equal(assertAgentEndpoint({endpoint:'http://remote-gateway.example.com:8080/v1',model:'mock',apiKey:'foo',allowInsecureHttp:true}),'http://remote-gateway.example.com:8080/v1')
assert.throws(()=>assertAgentEndpoint({endpoint:'javascript:alert(1)',model:'bad',apiKey:'foo',allowInsecureHttp:true}))
