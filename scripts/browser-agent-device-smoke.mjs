/** Real Android WebView + Capacitor bridge integration smoke test. Run against an isolated debug emulator. */
import assert from 'node:assert/strict'
import http from 'node:http'
import {randomUUID} from 'node:crypto'
if(process.env.AGENT_QA_DISPOSABLE_DEVICE!=='1')throw new Error('仅在独立测试模拟器上运行；确认无个人数据后设置 AGENT_QA_DISPOSABLE_DEVICE=1')
const device=process.env.AGENT_EMULATOR
if(!device)throw new Error('请用 AGENT_EMULATOR 指定独立测试模拟器序列号')
const port=process.env.CDP_PORT||'9231'
const fixturePort=Number(process.env.AGENT_FIXTURE_PORT||8765)
const hostname='10.0.2.2'
const url=`http://${hostname}:${fixturePort}/`
const server=http.createServer((request,response)=>{
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'})
  if(request.url==='/long') {
    const paragraphs=Array.from({length:30},(_,i)=>`<p>section-${i} content</p>`).join('')
    response.end(`<html><title>Long Page</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="article" role="region" aria-label="Article scroll area" style="height:180px;width:100%;overflow:auto" onscroll="document.getElementById('scroll-state').textContent=this.scrollTop+this.clientHeight>=this.scrollHeight-1?'Container end reached':'Container scrolling'">${paragraphs}<p>Agent bottom marker</p></div><p id="scroll-state">Container start</p></html>`)
    return
  }
  if(request.url==='/next') { response.end('<!doctype html><title>Next Page</title><h1>Destination reached</h1><button id="success" onclick="document.title=\'Clicked Target\'">Confirm</button>');return }
  response.end(`<!doctype html><title>Agent Fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><h1>AI browser test</h1>
  <label>Search <input placeholder="搜索资料" id="search"></label>
  <button id="go" onclick="document.getElementById('result').textContent='Search:'+document.getElementById('search').value">搜索</button>
  <p id="result">Idle</p><a href="/next">Next page</a>`)
})
await new Promise(resolve=>server.listen(fixturePort,'0.0.0.0',resolve))
let socket
try{
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target=targets.find(t=>t.type==='page'&&t.url==='https://localhost/')
  if(!target)throw new Error('NewsNook main WebView target unavailable')
  socket=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  let id=0;const pending=new Map()
  socket.addEventListener('message',event=>{const obj=JSON.parse(event.data);const p=pending.get(obj.id);if(!p)return;pending.delete(obj.id);if(obj.error)p.reject(new Error(JSON.stringify(obj.error)));else p.resolve(obj.result)})
  async function cdp(method,params){return new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method,params}))})}
  async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result?.value}
  async function plugin(method,opts={}){return evaluate(`window.Capacitor.Plugins.NewsNookBrowser.${method}(${JSON.stringify(opts)})`)}
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  const runId='agent-device-'+randomUUID()
  let sequence=0,sessionRequested=false,opened=false,tabId
  async function action(name,args={}){
    const response=await plugin('agentAction',{...args,action:name,runId,requestId:runId+'-'+(++sequence)})
    const result=response?.result
    assert(result&&typeof result==='object','agentAction must return a result')
    if(result.error||result.ok===false)throw new Error(`${name}: ${result.error||'operation rejected'}; dispatched=${result.dispatched===true}`)
    return result
  }
  function bound(observation,target){
    assert.equal(observation.tabId,tabId)
    for(const key of ['documentId','frameId','frameDocumentId','snapshot'])assert(observation[key],`observation lacks ${key}`)
    return {tabId,documentId:observation.documentId,frameId:observation.frameId,
      frameDocumentId:observation.frameDocumentId,snapshot:observation.snapshot,...(target?{id:target.id}:{})}
  }
  async function observeUntil(matches=()=>true){
    let lastError
    for(let attempt=0;attempt<60;attempt++){
      const state=await plugin('state')
      assert.equal(state.tabId,tabId,'the isolated smoke stays in one native tab')
      if(state.error)throw new Error(state.error)
      if(!state.loading){
        try{
          const observation=await action('observe',{tabId})
          bound(observation)
          if(matches(observation))return observation
        }catch(error){lastError=error}
      }
      await wait(250)
    }
    throw new Error('Timed out waiting for a fresh observation'+(lastError?': '+lastError.message:''))
  }
  async function fullViewport(){
    for(let attempt=0;attempt<50;attempt++){
      const state=await plugin('state'),view=state.agentViewport,rect=view?.visibleRect
      assert.equal(state.tabId,tabId)
      assert.equal(state.agentState,'running','input requires the acknowledged native run')
      if(view?.visible&&!view.occluded&&!view.layoutPending&&view.width>0&&view.height>0&&rect?.left===0&&rect.top===0&&rect.right===view.width&&rect.bottom===view.height)return
      await wait(100)
    }
    throw new Error('Native WebView did not acknowledge its full visible bounds')
  }
  async function input(name,observation,target,args={}){
    await fullViewport()
    const result=await action(name,{...bound(observation,target),...args})
    assert.equal(result.ok,true,`${name} must report its actual result`)
    return result
  }
  async function screenshot(observation){
    await fullViewport()
    const image=await action('screenshot',bound(observation))
    assert(image.image?.length>1000&&image.viewWidth>0&&image.viewHeight>0&&image.width>0&&image.height>0)
    assert(image.shotId,'native screenshots need a capture identity')
    assert.equal(image.documentId,observation.documentId)
    assert.equal(image.snapshot,observation.snapshot)
    return image
  }
  try {
    await plugin('open',{url,embedded:true,visible:true,top:0,bottom:0,occludedBottom:0,palette:{},scripts:[],settings:{userAgentMode:'system',javaScriptEnabled:true,loadsImagesAutomatically:true}})
    opened=true
    const tab=await plugin('state')
    tabId=tab.tabId
    console.log('Open:',tab)
    assert.equal(tab.url,url)
    assert(Number.isInteger(tabId)&&tabId>0)
    sessionRequested=true
    const started=await plugin('agentSession',{action:'start',runId,tabId})
    assert.equal(started.runId,runId)
    assert.equal(started.state,'running')
    let observation=await observeUntil(page=>page.title==='Agent Fixture')
    console.log('Ready:',{title:observation.title,url:observation.url,body:observation.text.slice(0,100),state:await plugin('state')})
    assert.equal(observation.title,'Agent Fixture')
    const searchInput=observation.elements.find(x=>x.tag==='input')
    assert(searchInput)
    await input('type',observation,searchInput,{text:'Qwen3.8'})
    observation=await observeUntil()
    const button=observation.elements.find(x=>x.tag==='button'&&x.text==='搜索')
    assert(button)
    await input('click',observation,button)
    observation=await observeUntil(page=>page.text.includes('Search:Qwen3.8'))
    assert.match(observation.text,/Search:Qwen3\.8/)
    await screenshot(observation)
    const link=observation.elements.find(x=>x.href==='/next')
    assert(link)
    await input('click',observation,link)
    observation=await observeUntil(page=>page.title==='Next Page'&&page.url.endsWith('/next'))
    assert.match(observation.url,/\/next$/)
    assert.equal(observation.title,'Next Page')
    const imageForNext=await screenshot(observation)
    const targetButton=observation.elements.find(x=>x.text==='Confirm')
    assert(targetButton)
    // Native tap uses WebView pixels, and must consume this shot before a new observation.
    await input('tap',observation,undefined,{shotId:imageForNext.shotId,
      x:Math.round(targetButton.x*imageForNext.viewWidth/observation.viewport.width),
      y:Math.round(targetButton.y*imageForNext.viewHeight/observation.viewport.height)})
    observation=await observeUntil(page=>page.title==='Clicked Target')
    assert.equal(observation.title,'Clicked Target')
    assert.equal((await action('navigate',{...bound(observation),url:url+'long'})).ok,true)
    let longView=await observeUntil(page=>page.title==='Long Page')
    assert.equal(longView.title,'Long Page')
    assert(!longView.text.includes('Agent bottom marker') || longView.text.indexOf('Agent bottom marker')>500)
    let found=false
    for(let step=0;step<15;step++){
      const container=longView.elements.find(element=>element.scrollable&&element.text==='Article scroll area')
      assert(container,'scrolling must target the observed article container')
      await input('scroll',longView,container,{direction:'down'})
      await wait(80)
      longView=await observeUntil()
      if(longView.text.includes('Agent bottom marker')&&longView.text.includes('Container end reached')){found=true;break}
    }
    assert(found,'reading visible text after scrolling must reach article bottom')
  }finally{
    if(sessionRequested){
      const stopped=await plugin('agentSession',{action:'stop',runId})
      assert.equal(stopped.runId,runId)
      assert.equal(stopped.state,'stopped','the native stop acknowledgment must precede browser close')
    }
    if(opened)await plugin('close')
  }
  console.log('PASS: real WebView observe, type, click, follow link, screenshot, native tap, long-page scroll, stop acknowledgment')
}finally{socket?.close();await new Promise(resolve=>server.close(resolve))}
