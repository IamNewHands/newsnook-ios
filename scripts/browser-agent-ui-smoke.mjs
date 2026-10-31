/** Real Android end-to-end smoke: BYOK form -> mock Chat Completions -> native WebView actions. */
import assert from 'node:assert/strict'
import http from 'node:http'
import {execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import path from 'node:path'
if(process.env.AGENT_QA_DISPOSABLE_DEVICE!=='1')throw new Error('仅在独立测试模拟器上运行；确认无个人数据后设置 AGENT_QA_DISPOSABLE_DEVICE=1')
const adb=process.env.ADB||'adb'
const device=process.env.AGENT_EMULATOR
if(!device)throw new Error('请用 AGENT_EMULATOR 指定独立测试模拟器序列号')
const snapshotDirectory=process.env.AGENT_QA_DIR
function capture(name){
  if(!snapshotDirectory)return
  mkdirSync(snapshotDirectory,{recursive:true})
  writeFileSync(path.join(snapshotDirectory,name+'.png'),execFileSync(adb,[
    '-s',device,'exec-out','screencap','-p',
  ]))
}
const port=Number(process.env.CDP_PORT||9231)
const fixturePort=Number(process.env.AGENT_FIXTURE_PORT||8765)
let calls=0
let delayedStopResponseRequested=false
const requests=[]
const server=http.createServer(async(req,res)=>{
  if(req.url==='/v1/chat/completions' && req.method==='POST'){
    let raw='';for await(const part of req)raw+=part
    const data=JSON.parse(raw)
    requests.push(data)
    assert.equal(data.tool_choice,'auto')
    assert(data.tools?.some(t=>t.function.name==='browser_open_url'))
    assert(data.tools?.some(t=>t.function.name==='browser_search'))
    const {task}=JSON.parse(data.messages[1].content)
    const toolMessages=data.messages.filter(item=>item.role==='tool')
    const last=toolMessages.at(-1)
    const previous=data.messages.filter(item=>item.role==='assistant'&&item.tool_calls?.length).at(-1)
    const lastName=previous?.tool_calls?.[0]?.function?.name
    const lastResult=last?JSON.parse(last.content):null
    function pageFrom(result){
      if(!result||typeof result!=='object')return null
      if(Array.isArray(result.elements))return result
      return pageFrom(result.browser)||pageFrom(result.context)||pageFrom(result.data)
        ||pageFrom(result.observation)||pageFrom(result.page)||pageFrom(result.initialBrowser)
    }
    // Resuming can append a fresh user context after the last tool response.
    const pageMessages=data.messages.flatMap((message,index)=>{
      if(!['tool','user'].includes(message.role)||typeof message.content!=='string')return []
      try{const page=pageFrom(JSON.parse(message.content));return page?[{page,index}]:[]}catch{return []}
    })
    const latest=pageMessages.at(-1),latestPage=latest?.page,page=latestPage
    const contextAfterLastTool=latest&&latest.index>data.messages.lastIndexOf(last)
    const elements=page?.elements||[]
    const has=(text)=>Boolean(page?.text?.includes(text))
    let action=null,answer=null
    if(task==='Markdown 格式验证')answer='## 查阅结果\n\n- **重点**：浏览器已完成阅读。\n- [来源](https://example.org/source)\n\n| 模型 | 特点 |\n| --- | --- |\n| Qwen | 本地部署 |\n\n```ts\nconst total = 3\n```'
    else if(task==='搜索 Qwen3.8'){
      if(!lastName)action=['browser_open_url',{url:`http://10.0.2.2:${fixturePort}/`}]
      else if(has('Search:Qwen3.8'))answer='已在真实网页中搜索 Qwen3.8'
      else if(!page)action=['browser_observe',{}]
      else if(elements.find(x=>x.tag==='input')?.value!=='Qwen3.8')action=['browser_type',{id:elements.find(x=>x.tag==='input')?.id,text:'Qwen3.8'}]
      else action=['browser_click',{id:elements.find(x=>x.text==='搜索')?.id}]
    }else if(task==='打开新标签页'){
      if(!lastName)action=['browser_new_tab',{url:`http://10.0.2.2:${fixturePort}/next`}]
      else answer='新标签页已打开'
    }else if(task==='切换到首标签'){
      if(!lastName)action=['browser_switch_tab',{index:0}]
      else answer='已切换到首标签'
    }else if(task==='选择类别'){
      if(!lastName)action=['browser_observe',{}]
      else if(has('Selected:Beta'))answer='选项已更改'
      else action=['browser_choose',{id:elements.find(x=>x.tag==='select')?.id,text:'Beta'}]
    }else if(task==='删除条目'){
      if(!lastName)action=['browser_observe',{}]
      else if(lastResult?.ok===false && /拒绝/.test(lastResult.error))answer='操作已拒绝，未执行删除'
      else if(has('Deleted'))answer='删除动作已完成'
      else action=['browser_click',{id:elements.find(x=>x.text==='删除条目')?.id}]
    }else if(task==='视觉点击'){
      if(!lastName)action=['browser_observe',{}]
      else if(has('VisualTapped'))answer='视觉点击已完成'
      else if(lastName!=='browser_screenshot'||contextAfterLastTool)action=['browser_screenshot',{}]
      else {
        const image=lastResult.data
        const element=latestPage.elements.find(x=>x.text==='截图点我')
        action=['browser_tap',{x:Math.round(element.x*image.width/latestPage.viewport.width),
          y:Math.round(element.y*image.height/latestPage.viewport.height)}]
      }
    }else if(task==='停止测试'){
      if(!lastName)action=['browser_observe',{}]
      else {
        delayedStopResponseRequested=true
        await new Promise(resolve=>setTimeout(resolve,1800))
        action=['browser_click',{id:elements.find(x=>x.text==='自动更改')?.id}]
      }
    }else throw new Error('unexpected test goal:'+task)
    calls++
    const message=answer!==null?{role:'assistant',content:answer}:{
      role:'assistant',content:null,
      tool_calls:[{id:`mock-call-${calls}`,type:'function',function:{name:action[0],arguments:JSON.stringify(action[1])}}],
    }
    res.writeHead(200,{'Content-Type':'application/json'})
    res.end(JSON.stringify({id:'mock-response',object:'chat.completion',choices:[{index:0,message,finish_reason:answer!==null?'stop':'tool_calls'}]}))
    return
  }
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'})
  if(req.url==='/next'){res.end('<!doctype html><title>Second Tab</title><h1>New tab loaded</h1>');return}
  res.end(`<!doctype html><title>Agent Fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><h1>AI browser test</h1><input id="query" placeholder="搜索资料"><button id="go" onclick="document.getElementById('result').textContent='Search:'+document.getElementById('query').value">搜索</button><p id="result">Idle</p>
    <select id="category" onchange="document.getElementById('selected').textContent='Selected:'+this.options[this.selectedIndex].text"><option value="a">Alpha</option><option value="b">Beta</option></select><p id="selected">None</p>
    <button id="delete" onclick="document.getElementById('deleted').textContent='Deleted'">删除条目</button><p id="deleted">Keep</p>
    <button id="visual" onclick="document.getElementById('visual-result').textContent='VisualTapped'">截图点我</button><p id="visual-result">VisualIdle</p>
    <button id="stop-target" onclick="document.getElementById('stop-result').textContent='Altered'">自动更改</button><p id="stop-result">Safe</p>`)
})
await new Promise(resolve=>server.listen(fixturePort,'0.0.0.0',resolve))
let socket
try{
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target=targets.find(t=>t.url==='https://localhost/'&&t.type==='page')
  assert(target,'main WebView target missing')
  socket=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  let id=0;const pending=new Map()
  socket.addEventListener('message',evt=>{const data=JSON.parse(evt.data),item=pending.get(data.id);if(!item)return;pending.delete(data.id);if(data.error)item.reject(new Error(JSON.stringify(data.error)));else item.resolve(data.result)})
  function call(method,params){return new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});socket.send(JSON.stringify({id:requestId,method,params}))})}
  async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result?.value}
  const nativeObservation=()=>evaluate(`(async()=>{const plugin=window.Capacitor.Plugins.NewsNookBrowser;const state=await plugin.state();const runId='smoke-'+Date.now();await plugin.agentSession({action:'start',runId,tabId:state.tabId});try{const response=await plugin.agentAction({action:'observe',tabId:state.tabId,runId,requestId:runId+'-observe'});if(response.result.error)throw new Error(response.result.error);return response.result}finally{const stopped=await plugin.agentSession({action:'stop',runId});if(stopped.state!=='stopped')throw new Error('Native stop was not acknowledged')}})()`)
  const nativeViewport=async()=>(await nativeObservation()).viewport.height
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  async function waitUntil(expression,{tries=60,interval=300}={}){
    for(let i=0;i<tries;i++){const answer=await evaluate(expression);if(answer)return answer;await wait(interval)}
    const body=await evaluate(`document.body?.innerText?.slice(-1500)`)
    throw new Error(`Timed out waiting for ${expression}; UI=${body}`)
  }
  function click(label){return evaluate(`(()=>{const element=[...document.querySelectorAll('button')].find(node=>!node.disabled&&!node.closest('[hidden],[inert]')&&node.getClientRects().length&&(node.textContent.trim()==${JSON.stringify(label)}||node.getAttribute('aria-label')===${JSON.stringify(label)}));if(!element)return false;element.click();return true})()`)}
  async function fill(selector,value){return evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled||el.closest('[hidden],[inert]'))return false;const setter=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)}
  function waitCompleted(answer,options){return waitUntil(`(()=>{const sheet=document.querySelector('[data-agent-sheet]'),turn=[...document.querySelectorAll('[data-agent-turn]')].at(-1);return sheet&&!sheet.hidden&&document.querySelector('[data-agent-composer] [role="status"]')?.textContent==='已完成'&&turn?.dataset.agentTurnStatus==='completed'&&turn.textContent.includes(${JSON.stringify(answer)})})()`,options)}
  async function restorePanel(){
    if(await evaluate(`document.querySelector('[data-agent-sheet]')?.hidden===true`)){
      assert(await evaluate(`(()=>{const button=[...document.querySelectorAll('button[aria-label]')].find(node=>node.getAttribute('aria-label').startsWith('AI 浏览助手')&&!node.closest('[hidden]'));if(!button)return false;button.click();return true})()`),'the task toolbar remains available while the page is exposed')
      await waitUntil(`document.querySelector('[data-agent-sheet]')?.hidden===false`)
    }
  }
  try{
    await wait(850)
    await evaluate(`(()=>{const popover=document.querySelector('.driver-popover-close-btn');if(popover){popover.click();return true}const skip=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='稍后再说');if(skip){skip.click();return true}return false})()`)
    await waitUntil(`!document.querySelector('.driver-popover.newsnook-tour')`,{tries:20,interval:160})
    await wait(750)
    console.log('Open UI:',await evaluate(`window.dispatchEvent(new CustomEvent('newsnook:open-browser',{detail:{}}))`))
    await waitUntil(`!!document.querySelector('[aria-label="NewsNook 网页浏览器"]')`)
    await waitUntil(`document.querySelector('[aria-label="AI 浏览助手"]')!==null`)
    await evaluate(`document.querySelector('button[aria-label="AI 浏览助手"]').click()`)
    await waitUntil(`!!document.querySelector('section[aria-label="AI 浏览助手"]')`)
    await waitUntil(`!document.querySelector('button[aria-label="API 设置"]')?.disabled`)
    const original=await evaluate(`(()=>{const sheet=document.querySelector('[data-agent-sheet]');return {height:sheet.getBoundingClientRect().height,top:sheet.getBoundingClientRect().top,screen:window.innerHeight}})()`)
    assert(original.height>original.screen*.3&&original.height<original.screen*.75,`initial half-screen size: ${JSON.stringify(original)}`)
    capture('01-half-idle')
    const beforeKeyboard=await evaluate(`({innerHeight:window.innerHeight,visualHeight:window.visualViewport?.height,composerBottom:document.querySelector('[data-agent-composer]').getBoundingClientRect().bottom})`)
    const composeRect=await evaluate(`(()=>{const r=document.querySelector('textarea[aria-label="AI 浏览任务"]').getBoundingClientRect();return {x:r.left+Math.min(30,r.width/2),y:r.top+r.height/2}})()`)
    const scale=await evaluate(`window.devicePixelRatio`)
    execFileSync(adb,['-s',device,'shell','input','tap',String(Math.round(composeRect.x*scale)),String(Math.round(composeRect.y*scale))])
    await wait(1200)
    const keyboardOpen=await evaluate(`({innerHeight:window.innerHeight,visualHeight:window.visualViewport?.height,composerBottom:document.querySelector('[data-agent-composer]').getBoundingClientRect().bottom})`)
    console.log('Keyboard geometry',beforeKeyboard,keyboardOpen)
    if(keyboardOpen.visualHeight<beforeKeyboard.visualHeight-80)
      assert(keyboardOpen.composerBottom<=keyboardOpen.visualHeight+6,'composer must remain visible above keyboard')
    await evaluate(`document.activeElement?.blur()`)
    await wait(500)
    const handle=await evaluate(`(()=>{const rect=document.querySelector('.agent-grip-area').getBoundingClientRect();return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)}})()`)
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:handle.x,y:handle.y}]})
    for(let step=1;step<=6;step++){
      await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:handle.x,y:handle.y-step*15}]})
      await wait(38)
    }
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await wait(320)
    const afterDrag=await evaluate(`document.querySelector('[data-agent-sheet]').getBoundingClientRect().height`)
    assert(afterDrag>original.height+40,`drag should resize continuously: ${original.height}->${afterDrag}`)
    capture('01b-dragged')
    assert(await click('展开全屏'))
    await waitUntil(`document.querySelector('[data-agent-sheet]')?.dataset.fullscreen==='true'`)
    await wait(290)
    const full=await evaluate(`document.querySelector('[data-agent-sheet]').getBoundingClientRect().height`)
    const fullscreenGeometry=await evaluate(`(()=>{const s=document.querySelector('[data-agent-sheet]');const w=document.querySelector('[aria-label="NewsNook 网页浏览器"]');return {sheetTop:s.getBoundingClientRect().top,sheetHeight:s.getBoundingClientRect().height,windowHeight:window.innerHeight,paddingTop:parseFloat(getComputedStyle(w).paddingTop)}})()`)
    assert(Math.abs(fullscreenGeometry.sheetTop-fullscreenGeometry.paddingTop)<4,'fullscreen should reach the safe-area top')
    assert(full>original.height*1.3,'maximize should expand the sheet')
    capture('02-fullscreen')
    assert(await click('恢复半屏'))
    await waitUntil(`document.querySelector('[data-agent-sheet]')?.dataset.fullscreen==='false'`)
    await wait(290)
    assert(await click('API 设置'),'API settings button absent')
    await waitUntil(`!!document.querySelector('input[aria-label="Agent Base URL"]')`)
    assert(await fill('input[aria-label="Agent Base URL"]',`http://localhost:${fixturePort}/v1`))
    assert(await fill('input[aria-label="Agent Model"]','mock-agent'))
    assert(await fill('input[aria-label="Agent API Key"]','test-only-key'))
    assert(await click('保存配置'))
    await waitUntil(`document.querySelector('section[aria-label="AI 浏览助手"] [role="status"]')?.textContent?.includes('配置已保存')`)
    const secure=await evaluate(`window.Capacitor.Plugins.SecureStore.get({key:'browser.agent.apiKey'})`)
    assert.equal(secure.value,'test-only-key')
    const persisted=await evaluate(`JSON.parse(localStorage.getItem('newsnook.browser.agent.config.v1'))`)
    assert.equal(persisted.endpoint,`http://localhost:${fixturePort}/v1`)
    assert.equal(persisted.model,'mock-agent')
    assert(await fill('textarea[aria-label="AI 浏览任务"]','搜索 Qwen3.8'))
    await waitUntil(`!!document.querySelector('button[aria-label="开始任务"]')`)
    assert(await click('开始任务'))
    await waitCompleted('真实网页中搜索 Qwen3.8',{tries:95,interval:350})
    const result=await evaluate(`document.querySelector('section[aria-label="AI 浏览助手"]')?.textContent?.slice(-250)`)
    assert.match(result,/真实网页中搜索 Qwen3\.8/)
    assert(calls>=4)
    const frameBefore=await nativeViewport()
    assert(frameBefore>100,'native WebView should have meaningful viewport before maximizing')
    assert(await click('展开全屏'))
    await waitUntil(`document.querySelector('[data-agent-sheet]')?.dataset.fullscreen==='true'`)
    await wait(350)
    const frameFull=await nativeViewport()
    assert(Math.abs(frameBefore-frameFull)<8,`WebView layout must not change with sheet: ${frameBefore} -> ${frameFull}`)
    assert(await click('恢复半屏'))
    await waitUntil(`document.querySelector('[data-agent-sheet]')?.dataset.fullscreen==='false'`)
    await wait(350)
    assert(await fill('textarea[aria-label="AI 浏览任务"]','打开新标签页'))
    assert(await click('开始任务'))
    await waitCompleted('新标签页已打开',{tries:110,interval:350})
    const tabState=await evaluate(`window.Capacitor.Plugins.NewsNookBrowser.tabs()`)
    assert.equal(tabState.tabs.length,2)
    assert.match(tabState.tabs.find(t=>t.active).url,/\/next$/)
    assert(await fill('textarea[aria-label="AI 浏览任务"]','切换到首标签'))
    assert(await click('开始任务'))
    await waitCompleted('已切换到首标签',{tries:100,interval:350})
    const switched=await evaluate(`window.Capacitor.Plugins.NewsNookBrowser.tabs()`)
    assert.equal(switched.tabs.find(t=>t.active).index,0)
    assert(calls>=8)
    assert(await fill('textarea[aria-label="AI 浏览任务"]','选择类别'))
    assert(await click('开始任务'))
    await waitCompleted('选项已更改',{tries:75,interval:350})
    assert(await fill('textarea[aria-label="AI 浏览任务"]','删除条目'))
    assert(await click('开始任务'))
    if(await evaluate(`document.querySelector('[data-agent-sheet]')?.hidden===false`))assert(await click('收起 AI 面板'))
    await waitUntil(`document.querySelector('[role="alertdialog"] #agent-confirm-title')?.textContent==='确认网页操作'`,{tries:65,interval:300})
    assert.equal(await evaluate(`document.querySelector('[data-agent-sheet]')?.hidden`),false,'approval must reopen the minimized sheet')
    assert(await click('拒绝'))
    await waitCompleted('操作已拒绝，未执行删除',{tries:75,interval:350})
    assert(await fill('textarea[aria-label="AI 浏览任务"]','删除条目'))
    assert(await click('开始任务'))
    await waitUntil(`document.querySelector('[role="alertdialog"] #agent-confirm-title')?.textContent==='确认网页操作'`,{tries:65,interval:300})
    assert(await click('允许这一步'))
    await waitCompleted('删除动作已完成',{tries:75,interval:350})
    assert(await fill('textarea[aria-label="AI 浏览任务"]','视觉点击'))
    assert(await click('开始任务'))
    await waitUntil(`document.querySelector('[role="alertdialog"] #agent-confirm-title')?.textContent==='确认网页操作'`,{tries:75,interval:350})
    assert(await click('允许这一步'))
    await waitCompleted('视觉点击已完成',{tries:75,interval:350})
    assert(await fill('textarea[aria-label="AI 浏览任务"]','Markdown 格式验证'))
    assert(await click('开始任务'))
    await waitCompleted('查阅结果',{tries:75,interval:350})
    assert(await evaluate(`document.querySelector('[data-agent-transcript]')?.querySelector('.agent-markdown table')!==null`))
    const rendered=await evaluate(`(()=>{const md=[...document.querySelectorAll('.agent-markdown')].at(-1);return {heading:md?.querySelector('h2')?.textContent,rows:md?.querySelectorAll('tr').length,code:md?.querySelector('pre code')?.textContent,link:md?.querySelector('a')?.getAttribute('href')}})()`)
    assert.equal(rendered.heading,'查阅结果')
    assert.equal(rendered.rows,2)
    assert.match(rendered.code,/const total/)
    assert.equal(rendered.link,'https://example.org/source')
    await wait(350)
    const visibleResult=await evaluate(`(()=>{const transcript=document.querySelector('[data-agent-transcript]');const result=[...transcript.querySelectorAll('.agent-markdown h2')].at(-1);if(!result)return false;const pane=transcript.getBoundingClientRect(),heading=result.getBoundingClientRect();return heading.top>=pane.top-2&&heading.top<pane.bottom-20})()`)
    assert(visibleResult,'latest Markdown result heading must be visible without manual scrolling')
    capture('03-markdown-result')
    assert(await click('收起 AI 面板'))
    await waitUntil(`document.querySelector('[data-agent-sheet]')?.hidden===true`)
    assert(await click('AI 浏览助手'))
    await waitUntil(`document.querySelector('[data-agent-sheet]')?.hidden===false`)
    assert.equal((await evaluate(`document.querySelectorAll('.agent-markdown table').length`)),1,'collapse should preserve content')
    execFileSync(adb,['-s',device,'shell','input','keyevent','4'])
    await waitUntil(`document.querySelector('[data-agent-sheet]')?.hidden===true`,{tries:25,interval:150})
    assert(await click('AI 浏览助手'))
    await waitUntil(`document.querySelector('[data-agent-sheet]')?.hidden===false`)
    assert(await fill('textarea[aria-label="AI 浏览任务"]','停止测试'))
    assert(await click('开始任务'))
    await waitUntil(`!!document.querySelector('button[aria-label="停止任务"]')`,{tries:30,interval:200})
    for(let attempt=0;attempt<60&&!delayedStopResponseRequested;attempt++)await wait(100)
    assert(delayedStopResponseRequested,'stop must interrupt an actual pending model response')
    await restorePanel()
    assert(await click('关闭 AI 浏览助手'))
    await waitUntil(`document.querySelector('[role="alertdialog"] #agent-confirm-title')?.textContent==='停止当前任务？'`)
    assert(await click('返回任务'))
    await waitUntil(`!document.querySelector('[role="alertdialog"]')`)
    assert(await click('停止任务'))
    await waitUntil(`document.querySelector('[data-agent-composer] [role="status"]')?.textContent==='已停止'`)
    await wait(2200)
    const stopped=await evaluate(`document.querySelector('[data-agent-composer] [role="status"]')?.textContent`)
    assert.equal(stopped,'已停止')
    assert(await evaluate(`(()=>{const turn=[...document.querySelectorAll('[data-agent-turn]')].at(-1);return turn?.dataset.agentTurnStatus==='stopped'&&turn.textContent.includes('停止测试')&&!turn.querySelector('.agent-markdown')})()`),'the stopped task retains a partial turn without a fabricated final answer')
    const afterStop=await nativeObservation()
    assert.match(afterStop.text,/Safe/)
    assert(!afterStop.text.includes('Altered'),'the delayed model response cannot mutate the page after stop')
    assert(requests.every(req=>req.model==='mock-agent'))
  }finally{
    await restorePanel()
    const dialog=await evaluate(`document.querySelector('[role="alertdialog"] #agent-confirm-title')?.textContent`)
    if(dialog==='确认网页操作')assert(await click('拒绝'))
    else if(dialog==='停止当前任务？')assert(await click('返回任务'))
    if(dialog)await waitUntil(`!document.querySelector('[role="alertdialog"]')`)
    if(await evaluate(`!!document.querySelector('[data-agent-controls]')`)){
      if(await evaluate(`!document.querySelector('button[aria-label="停止任务"]')?.disabled`))assert(await click('停止任务'))
      await waitUntil(`!document.querySelector('[data-agent-controls]')`,{tries:80,interval:300})
    }
    try{await evaluate(`window.Capacitor.Plugins.SecureStore.remove({key:'browser.agent.apiKey'})`)}catch{}
    try{await evaluate(`localStorage.removeItem('newsnook.browser.agent.config.v1')`)}catch{}
    try{await evaluate(`document.querySelector('button[aria-label="关闭 AI 浏览助手"]')?.click()`)}catch{}
    try{await evaluate(`document.querySelector('button[aria-label="返回有所闻"]')?.click()`)}catch{}
  }
  console.log('PASS: half/full layout, BYOK, Keystore, ReAct, Markdown tables/code/links, native DOM/visual tools, tabs, approvals, collapse and stop')
}finally{socket?.close();await new Promise(resolve=>server.close(resolve))}
