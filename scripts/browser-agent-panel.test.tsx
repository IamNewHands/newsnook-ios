import assert from 'node:assert/strict'
import {mock} from 'node:test'
import React,{act} from 'react'
import {parseHTML} from 'linkedom'
import type {BrowserAgentRuntime,BrowserAgentRuntimeOptions,AgentHandoff} from '../src/features/browser/agent/agentRuntime'

const {window}=parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(window,{innerHeight:800,innerWidth:390})
Object.assign(globalThis,{
  window,document:window.document,Node:window.Node,Element:window.Element,HTMLElement:window.HTMLElement,
  React,IS_REACT_ACT_ENVIRONMENT:true,
  getComputedStyle:()=>({paddingTop:'0',getPropertyValue:()=>''}),
  requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(0),0),
  cancelAnimationFrame:clearTimeout,
})
window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,right:390,bottom:800,width:390,height:440}) as DOMRect
window.HTMLElement.prototype.hasPointerCapture=()=>false
window.HTMLElement.prototype.releasePointerCapture=()=>{}
window.HTMLElement.prototype.setPointerCapture=()=>{}

function deferred<T=void>(){
  let resolve!:(value:T)=>void,reject!:(error:Error)=>void
  const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail})
  return {promise,resolve,reject}
}
interface Fixture {
  options:BrowserAgentRuntimeOptions
  runtime:BrowserAgentRuntime
  answer:ReturnType<typeof deferred<string>>
  stopGate:ReturnType<typeof deferred>|null
  pauseGate:ReturnType<typeof deferred>|null
  stopCalls:number
  pauseCalls:number
  resumeCalls:number
  initialContext?:unknown
}
const fixtures:Fixture[]=[]
const config={endpoint:'https://example.org/v1',model:'test-model',apiKey:'test-only-key'}
mock.module('../src/features/browser/agent/browserAgent.ts',{namedExports:{
  loadAgentConfig:async()=>config,
  saveAgentConfig:async()=>{},
  runReActAgent:async(_config:unknown,_goal:unknown,initial:unknown,runtime:BrowserAgentRuntime,signal:AbortSignal)=>{
    const fixture=fixtures.find(item=>item.runtime===runtime)!
    fixture.initialContext=initial
    return new Promise<string>((resolve,reject)=>{
      const abort=()=>reject(new DOMException('任务已停止','AbortError'))
      if(signal.aborted){abort();return}
      signal.addEventListener('abort',abort,{once:true})
      fixture.answer.promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
    })
  },
}})
mock.module('../src/features/browser/agent/agentRuntime.ts',{namedExports:{
  createBrowserAgentRuntime:(options:BrowserAgentRuntimeOptions)=>{
    const fixture={options,answer:deferred<string>(),stopGate:null,pauseGate:null,stopCalls:0,pauseCalls:0,resumeCalls:0} as Fixture
    fixture.runtime={
      start:async()=>({state:{tabId:7},tabs:[]}),
      performTool:async()=>({result:{}}),
      waitUntilReady:async()=>{},
      pause:async()=>{
        fixture.pauseCalls++;options.onPhase?.('pausing')
        if(fixture.pauseGate)await fixture.pauseGate.promise
        if(options.signal.aborted)throw new DOMException('任务已停止','AbortError')
        options.onPhase?.('paused')
      },
      resume:async()=>{fixture.resumeCalls++;options.onPhase?.('resuming');options.onPhase?.('running')},
      stop:async()=>{
        fixture.stopCalls++;options.onPhase?.('stopping')
        if(fixture.stopGate)await fixture.stopGate.promise
        options.onPhase?.('stopped')
      },
    }
    fixtures.push(fixture)
    return fixture.runtime
  },
}})
const {createRoot}=await import('react-dom/client')
const {BrowserAgentPanel}=await import('../src/features/browser/agent/BrowserAgentPanel')
const root=createRoot(document.getElementById('root')!)
let closes=0,attentions=0,minimizes=0
const busyChanges:boolean[]=[]
const operatingChanges:boolean[]=[]
const sheetRef=React.createRef<HTMLElement>()
const props={
  tabId:7,tabs:[{id:7,index:0,title:'阅读资料',url:'https://example.org/article',active:true}],
  sheetRef,minimized:false,onMinimize:()=>{minimizes++},onNeedAttention:()=>{attentions++},
  onBusyChange:(value:boolean)=>{busyChanges.push(value)},
  onOperatingChange:(value:boolean)=>{operatingChanges.push(value)},
  onSearch:async()=>true,searchUrl:(query:string)=>'https://example.org/search?q='+encodeURIComponent(query),
  onNavigate:async()=>true,onBack:async()=>true,onForward:async()=>true,onNewTab:async()=>true,
  onSwitchTab:async()=>true,onCloseTab:async()=>true,onClose:()=>{closes++},
}
function button(label:string){
  const found=[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.getAttribute('aria-label')===label||item.textContent?.trim()===label)
  assert.ok(found,'缺少按钮：'+label)
  return found
}
async function click(label:string){await act(async()=>{button(label).dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}))})}
async function flush(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))})}
function currentPhase(){return document.querySelector('[data-agent-controls]')?.getAttribute('data-phase')}
function previousTurns(fixture:Fixture){return (fixture.initialContext as {previousTurns:Array<{status:string;answer?:string;detail?:string;steps:Array<{tool:string;status:string;outcome?:string}>;files:Array<{fileId:string}>}>}).previousTurns}
async function begin(){await click('总结当前网页');await click('开始任务');await flush();return fixtures.at(-1)!}

try{
  await act(async()=>root.render(<BrowserAgentPanel {...props}/>))
  await flush()
  const header=document.querySelector<HTMLElement>('.agent-header')!
  const pointer=(target:Element,type:string,y:number)=>{
    const event=new window.Event(type,{bubbles:true,cancelable:true})
    Object.assign(event,{button:0,pointerId:1,clientY:y})
    target.dispatchEvent(event)
  }
  const originalHeight=sheetRef.current!.style.height
  await act(async()=>pointer(header.querySelector('.agent-close svg')!,'pointerdown',300))
  assert.equal(sheetRef.current?.getAttribute('data-dragging'),'false','toolbar buttons must not start header dragging')
  assert.equal(sheetRef.current?.style.height,originalHeight)
  await act(async()=>pointer(header.querySelector('h2')!,'pointerdown',300))
  assert.equal(sheetRef.current?.getAttribute('data-dragging'),'true','the compact title area remains a usable drag target')
  await act(async()=>{pointer(header,'pointermove',220);pointer(header,'pointerup',220)})
  assert.equal(sheetRef.current?.style.height,'520px','dragging the title adjusts the same sheet height as the grip')
  assert.equal(sheetRef.current?.getAttribute('data-dragging'),'false')
  const first=await begin()
  assert.equal(fixtures.length,1)
  assert.equal(busyChanges.at(-1),true)
  assert.equal(operatingChanges.at(-1),true,'a running task shows the webpage operation indicator')
  let exposed=false,exposure!:Promise<void>
  await act(async()=>{
    exposure=first.options.onExposePage!()
    void exposure.then(()=>{exposed=true})
  })
  assert.equal(minimizes,1,'native input first asks the panel to expose the whole webpage')
  assert.equal(exposed,false,'the callback cannot acknowledge a React state request before it commits')
  await act(async()=>root.render(<BrowserAgentPanel {...props} minimized/>))
  await exposure
  assert.equal(exposed,true)
  assert.equal(sheetRef.current?.hidden,true)
  assert.equal(operatingChanges.at(-1),true,'minimizing the panel keeps the operation indicator visible')
  await first.options.onExposePage!()
  assert.equal(minimizes,1,'already exposed pages do not repeat the minimize request')
  await act(async()=>root.render(<BrowserAgentPanel {...props}/>))
  assert.equal(document.querySelector('[data-agent-artifacts]'),null,'files appear only after an actual artifact event')
  await act(async()=>first.options.onStep?.({id:'read-1',tool:'browser_observe',label:'读取网页',status:'running'}))
  assert.equal(document.querySelector('[data-agent-step="read-1"]')?.getAttribute('data-state'),'running')
  assert.equal(document.querySelector('[data-agent-step][data-state="succeeded"]'),null,'starting an operation is not a success')
  await act(async()=>first.options.onStep?.({id:'read-1',tool:'browser_observe',label:'读取网页',status:'failed',outcome:'unknown',detail:'结果尚未确认'}))
  assert.match(document.querySelector('[data-agent-step="read-1"]')?.getAttribute('aria-label')||'',/结果待核实/)
  assert.equal(document.querySelector('[data-agent-step][data-state="succeeded"]'),null,'unknown results must not render a success check')
  const failedDetails=document.querySelector('[data-agent-step="read-1"] details')
  assert.ok(failedDetails,'each failed step has its own disclosure')
  assert.equal(failedDetails.hasAttribute('open'),false,'step details start collapsed')
  assert.ok(failedDetails.querySelector('summary'),'a native summary supports touch and keyboard expansion')
  assert.match(failedDetails.textContent||'',/结果尚未确认/)
  await act(async()=>first.options.onStep?.({id:'success-detail',tool:'browser_search',label:'搜索网页',status:'succeeded',input:'{"query":"最新资讯"}',result:'{"url":"https://example.org/results","title":"搜索结果"}'}))
  const successDetails=document.querySelector('[data-agent-step="success-detail"] details')
  assert.ok(successDetails,'successful calls are inspectable too')
  assert.match(successDetails.textContent||'',/最新资讯/)
  assert.match(successDetails.textContent||'',/搜索结果/)
  successDetails.setAttribute('open','')
  await act(async()=>first.options.onStep?.({id:'success-detail',tool:'browser_search',label:'搜索网页',status:'succeeded',input:'{"query":"最新资讯"}',result:'搜索结果已更新'}))
  assert.ok(document.querySelector('[data-agent-step="success-detail"] details')?.hasAttribute('open'),'updates preserve expansion')
  await act(async()=>first.options.onArtifacts?.([{fileId:'file-1',name:'资料.pdf',mime:'application/pdf',size:20480,status:'downloading'}]))
  assert.match(document.querySelector('[data-agent-file="file-1"]')?.textContent||'',/下载中/)

  const beforeControlError=attentions
  await act(async()=>{
    first.options.onPhase?.('pausing')
    first.options.onControlError?.('网页未确认暂停，请关闭当前标签页后重试')
  })
  assert.equal(currentPhase(),'pausing','a failed native barrier must never display a confirmed pause')
  assert.match(document.querySelector('[role="alert"]')?.textContent||'',/未确认暂停/)
  assert.equal(attentions,beforeControlError+1,'an unconfirmed control state brings back the controls for review')
  assert.equal([...document.querySelectorAll('button')].some(item=>item.textContent?.trim()==='继续任务'),false)
  await act(async()=>first.options.onPhase?.('running'))

  first.pauseGate=deferred()
  await click('暂停')
  assert.equal(currentPhase(),'pausing','pause waits for the native acknowledgment')
  assert.equal(operatingChanges.at(-1),false,'pausing hides the operation indicator before acknowledgment')
  assert.equal(button('停止任务').disabled,false,'stop remains reachable while pausing')
  await act(async()=>first.pauseGate!.resolve())
  await flush()
  assert.equal(currentPhase(),'paused')
  assert.match(document.querySelector('[data-agent-active-task]')?.textContent||'',/总结当前网页/)
  assert.ok(document.querySelector('[data-agent-step="read-1"]'),'pause keeps the task steps')
  assert.equal(document.querySelector('textarea[aria-label="AI 浏览任务"]'),null,'an active task uses its control bar instead of an inert composer')
  await click('继续任务')
  await flush()
  assert.equal(currentPhase(),'running')
  assert.equal(operatingChanges.at(-1),true,'resuming restores the operation indicator')
  assert.equal(first.resumeCalls,1)
  await click('接管')
  await flush()
  assert.equal(currentPhase(),'handoff')
  assert.equal(operatingChanges.at(-1),false,'human takeover hides the operation indicator')
  assert.match(document.querySelector('[data-agent-handoff]')?.textContent||'',/由你操作网页/)
  await click('继续任务')
  await flush()
  assert.equal(first.resumeCalls,2)
  assert.equal(fixtures.length,1,'resuming never starts a replacement model run')

  const request:AgentHandoff={id:'login-1',kind:'login',reason:'请在网页中登录后继续。',url:'https://example.org/login',tabId:7}
  let handoffResult!:Promise<'continue'|'stop'>
  await act(async()=>{handoffResult=first.options.onHandoff(request,first.options.signal)})
  assert.ok(attentions>0)
  assert.match(document.querySelector('[data-agent-handoff]')?.textContent||'',/请先完成登录/)
  await click('继续任务')
  assert.equal(await handoffResult,'continue')
  assert.equal(first.resumeCalls,2,'model handoff lets the runtime own resume and fresh observation')
  await act(async()=>first.options.onPhase?.('running'))
  assert.equal(document.querySelector('[data-agent-handoff]'),null)

  first.stopGate=deferred()
  await click('停止任务')
  await flush()
  assert.equal(currentPhase(),'stopping')
  assert.equal(operatingChanges.at(-1),false,'stopping hides the operation indicator while the task remains busy')
  assert.equal(first.stopCalls,1,'explicit stop and runner cleanup share one native stop request')
  assert.equal(busyChanges.at(-1),true,'ownership remains busy until native stop is acknowledged')
  assert.equal(document.querySelector('button[aria-label="开始任务"]'),null,'a second task cannot start while stop is pending')
  assert.equal(button('停止任务').disabled,true)
  await act(async()=>first.options.onStep?.({id:'submit-1',tool:'browser_submit',label:'提交网页表单',status:'cancelled',outcome:'unknown',detail:'网页尚未返回提交结果'}))
  assert.match(document.querySelector('[data-agent-step="submit-1"]')?.textContent||'',/已停止，结果待确认/)
  await act(async()=>first.stopGate!.resolve())
  await flush()
  assert.equal(busyChanges.at(-1),false)
  assert.equal(first.stopCalls,1)
  assert.ok(document.querySelector('[data-agent-step="read-1"]'),'stopping retains the visible record')
  const stoppedTurn=document.querySelector('[data-agent-turn-status="stopped"]')
  assert.ok(stoppedTurn,'a stopped task is retained as a real conversation turn')
  assert.match(stoppedTurn.textContent||'',/已停止，结果待确认/)
  assert.equal(stoppedTurn.querySelector('.agent-markdown'),null,'a stopped task has no invented final answer')
  assert.equal(stoppedTurn.querySelector('[aria-label="复制 AI 回答"]'),null)
  assert.ok(stoppedTurn.querySelector('[data-agent-file="file-1"]'))

  await click('开始任务')
  await flush()
  const second=fixtures[1]
  assert.ok(second)
  assert.equal(previousTurns(second)[0].status,'stopped')
  assert.equal(previousTurns(second)[0].answer,undefined)
  assert.equal(previousTurns(second)[0].steps.find(step=>step.tool==='browser_submit')?.outcome,'unknown','the next run receives the unresolved side-effect history')
  assert.equal(previousTurns(second)[0].files[0].fileId,'file-1')
  await act(async()=>{
    second.options.onStep?.({id:'read-2',tool:'browser_observe',label:'读取新的网页',status:'running'})
    first.options.onStep?.({id:'late-old',tool:'browser_click',label:'迟到的旧任务',status:'succeeded'})
    first.options.onPhase?.('paused')
    first.options.onControlError?.('旧任务的暂停错误')
    first.options.onArtifacts?.([{fileId:'late-file',name:'旧文件.txt',mime:'text/plain',size:3,status:'ready'}])
  })
  assert.equal(currentPhase(),'running','late phases from an old run cannot pause a new run')
  assert.equal(document.querySelector('[data-agent-step="late-old"]'),null)
  assert.equal(document.querySelector('[data-agent-file="late-file"]'),null)
  assert.equal(document.querySelector('[role="alert"]'),null,'old control failures cannot overwrite a new run')
  assert.equal(await first.options.onHandoff(request,first.options.signal),'stop','a cancelled handoff cannot reopen a prompt')
  const beforeOldExposure=minimizes
  await assert.rejects(first.options.onExposePage!(),{name:'AbortError'})
  assert.equal(minimizes,beforeOldExposure,'an old run cannot minimize a new task')
  assert.equal(document.querySelector('[data-agent-handoff]'),null)

  second.stopGate=deferred()
  const attentionsBeforeFinish=attentions
  await act(async()=>{
    second.options.onStep?.({id:'read-2',tool:'browser_observe',label:'读取新的网页',status:'succeeded'})
    second.answer.resolve('资料已整理。')
  })
  await flush()
  assert.match(document.querySelector('[data-agent-turn-status="completed"]')?.textContent||'',/资料已整理/)
  assert.equal(busyChanges.at(-1),true,'normal completion also keeps ownership until stop acknowledgment')
  assert.equal(attentions,attentionsBeforeFinish,'the result panel stays clear until native stop is acknowledged')
  await act(async()=>second.options.onArtifacts?.([{fileId:'final-file',name:'整理结果.txt',mime:'text/plain',size:48,status:'ready'}]))
  assert.ok(document.querySelector('[data-agent-turn-status="completed"] [data-agent-file="final-file"]'),'late final artifact metadata updates the same completed turn')
  await act(async()=>second.stopGate!.resolve())
  await flush()
  assert.equal(busyChanges.at(-1),false)
  assert.equal(attentions,attentionsBeforeFinish+1,'the completed result reopens only after the final native acknowledgment')
  assert.match(document.querySelector('[data-agent-composer]')?.textContent||'',/已完成/)

  await act(async()=>root.render(<BrowserAgentPanel key="close-test" {...props}/>))
  await flush()
  const third=await begin()
  third.stopGate=deferred()
  await click('关闭 AI 浏览助手')
  assert.equal(operatingChanges.at(-1),false,'a confirmation prompt hides the operation indicator')
  assert.ok(document.querySelector('[role="alertdialog"][aria-modal="true"]'))
  assert.equal(closes,0)
  await click('停止并关闭')
  await flush()
  assert.equal(closes,0,'closing cannot discard the panel before stop acknowledgment')
  await act(async()=>third.stopGate!.reject(new Error('native stop unavailable')))
  await flush()
  assert.equal(closes,0)
  assert.equal(busyChanges.at(-1),true,'a failed stop acknowledgment keeps the execution lease visible')
  assert.match(document.querySelector('[role="alertdialog"]')?.textContent||'',/尚未确认任务停止/)
  third.stopGate=deferred()
  await click('停止并关闭')
  await flush()
  assert.equal(third.stopCalls,2,'a failed stop can be retried without starting another task')
  await act(async()=>third.stopGate!.resolve())
  await flush()
  assert.equal(closes,1)
  assert.equal(busyChanges.at(-1),false)

  await act(async()=>root.render(<BrowserAgentPanel key="failed-history" {...props}/>))
  await flush()
  const failed=await begin()
  await act(async()=>{
    failed.options.onStep?.({id:'read-failure',tool:'browser_observe',label:'读取网页',status:'succeeded'})
    failed.answer.reject(new Error('模型响应中断'))
  })
  await flush()
  const failedTurn=document.querySelector('[data-agent-turn-status="failed"]')
  assert.ok(failedTurn)
  assert.match(failedTurn.textContent||'',/任务未完成.*模型响应中断/)
  assert.equal(failedTurn.querySelector('.agent-markdown'),null)
  await click('开始任务');await flush()
  const continuation=fixtures.at(-1)!
  assert.equal(previousTurns(continuation)[0].status,'failed')
  assert.equal(previousTurns(continuation)[0].detail,'模型响应中断')
  assert.equal(previousTurns(continuation)[0].steps[0].status,'succeeded')
  const cancelledExposure=assert.rejects(continuation.options.onExposePage!(),{name:'AbortError'})
  await click('停止任务');await flush()
  await cancelledExposure

  await act(async()=>root.render(<BrowserAgentPanel key="unmount-exposure" {...props}/>))
  await flush()
  const unmounting=await begin()
  const unmountedExposure=assert.rejects(unmounting.options.onExposePage!(),{name:'AbortError'})
  await act(async()=>root.render(<div/>))
  await unmountedExposure
  console.log('Agent panel: real outcomes, pause/handoff, stop acknowledgment, late events, artifacts, partial history, page exposure and safe close PASS')
}finally{await act(async()=>root.unmount())}
