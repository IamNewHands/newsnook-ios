import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {chromium} from 'playwright'

// Real DOM geometry/event behavior. Set BROWSER_AGENT_CHROMIUM for an installed Chrome binary.
// Native port authorization, MotionEvent pacing and cancellation are exercised by Android tests.
const script=await readFile(new URL('../android/app/src/main/assets/browser-agent.js',import.meta.url),'utf8')
const servers=[]
async function serve(render){
  const server=createServer((request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end(render(request.url))})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server)
  return 'http://127.0.0.1:'+server.address().port
}
let mainUrl
const frameUrl=await serve(()=>`<!doctype html><style>body{margin:8px}button{min-height:44px}</style><button onclick="window.clicked=true">跨域框架按钮</button><iframe src="${mainUrl}/inner"></iframe>`)
mainUrl=await serve(path=>path==='/inner'?'<button onclick="window.clicked=true">嵌套框架按钮</button>':`<!doctype html><meta charset="utf-8">
<style>body{margin:16px;font:16px sans-serif}button,input,select{min-height:44px;margin:4px}#scroll{width:220px;height:80px;overflow:auto}#wide{width:800px;height:150px}#editor{min-height:44px;border:1px solid}#host,#closed{display:block}</style>
<button id="go" onclick="window.clicked=(window.clicked||0)+1">搜索</button><input id="query" aria-label="检索词">
<input id="secret" type="password" value="never-observe-this"><input id="otp" autocomplete="one-time-code" value="123456">
<input id="files" type="file" accept="image/*,.pdf" multiple><button disabled>不可用</button>
<div id="host"></div><div id="closed"></div><div id="editor" contenteditable role="textbox" aria-label="富文本"></div>
<select aria-label="顺序"><option value="a">第一项</option><option value="b">第二项</option></select>
<div id="scroll" aria-label="滚动区域"><div id="wide">容器内容</div></div>
<canvas id="canvas" width="160" height="60" style="border:1px solid"></canvas>
<iframe title="跨域" src="${frameUrl}"></iframe>
<script>
document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<span id="label">影子搜索</span><button aria-labelledby="label" onclick="window.shadowClicked=true">图标</button>';
const closed=document.querySelector('#closed').attachShadow({mode:'closed'});closed.innerHTML='<button onclick="window.closedClicked=true">封闭组件</button>';
document.querySelector('#canvas').addEventListener('pointerdown',event=>window.canvasTrusted=event.isTrusted);
document.querySelector('#query').addEventListener('input',event=>window.lastInput=document.querySelector('#query').value);
</script>`)
let browser
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_AGENT_CHROMIUM||undefined,args:['--no-sandbox']})
  const context=await browser.newContext({viewport:{width:1000,height:1000}})
  await context.addInitScript({content:`window.__agentMessages=[];window.__newsNookAgentBridge={postMessage(value){window.__agentMessages.push(JSON.parse(value))}};`+script.replace('__ARGS__',JSON.stringify({action:'bootstrap'}))})
  const page=await context.newPage()
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(mainUrl)
  const execute=(frame,args)=>frame.evaluate(args=>window.__newsNookAgentExecute(args),args)
  const observe=()=>execute(page,{action:'observe'})
  const target=(observation,label)=>{
    const found=observation.elements.find(item=>item.text===label)
    assert(found,'Missing visible target: '+label);return {snapshot:observation.snapshot,id:found.id}
  }
  let observation=await observe()
  assert(observation.elements.some(item=>item.text==='影子搜索'),'shadow-local aria-labelledby resolves')
  assert(observation.elements.some(item=>item.text==='封闭组件'),'document-start hook captures closed roots')
  assert(!JSON.stringify(observation).includes('never-observe-this'))
  assert(!JSON.stringify(observation).includes('123456'))
  const file=observation.elements.find(item=>item.type==='file')
  assert.equal(file.multiple,true);assert.equal(file.accept,'image/*,.pdf')

  for(const label of ['影子搜索','封闭组件']){
    observation=await observe()
    const prepared=await execute(page,{action:'prepare_click',...target(observation,label)})
    assert.equal(prepared.ok,true,prepared.error)
    await page.mouse.click(prepared.x,prepared.y)
  }
  assert.equal(await page.evaluate(()=>window.shadowClicked&&window.closedClicked),true)

  observation=await observe()
  const input=target(observation,'检索词')
  assert.equal((await execute(page,{action:'type',...input,text:'  保留空格  '})).ok,true)
  assert.equal(await page.locator('#query').inputValue(),'  保留空格  ')
  assert.equal(await page.evaluate(()=>window.lastInput),'  保留空格  ')
  observation=await observe()
  assert.equal(observation.elements.find(item=>item.text==='检索词').value,'  保留空格  ')
  await execute(page,{action:'type',...target(observation,'检索词'),text:''})
  assert.equal(await page.locator('#query').inputValue(),'')
  await page.locator('#query').evaluate(input=>input.addEventListener('beforeinput',event=>event.preventDefault(),{once:true}))
  observation=await observe()
  assert.equal((await execute(page,{action:'type',...target(observation,'检索词'),text:'被网页拒绝'})).dispatched,false)
  assert.equal(await page.locator('#query').inputValue(),'')

  observation=await observe()
  const previous=target(observation,'搜索')
  await page.locator('#go').evaluate(button=>button.textContent='确认付款')
  assert.equal((await execute(page,{action:'click',...previous})).code,'TARGET_CHANGED')
  assert.equal(await page.evaluate(()=>window.clicked||0),0)
  observation=await observe()
  const covered=target(observation,'确认付款')
  await page.locator('#go').evaluate(button=>{
    const r=button.getBoundingClientRect(),cover=document.createElement('div')
    cover.id='cover';cover.style=`position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:9999;background:white`;document.body.append(cover)
  })
  assert.equal((await execute(page,{action:'click',...covered})).code,'OBSCURED')
  await page.locator('#cover').evaluate(element=>element.remove())
  observation=await observe()
  assert.equal((await execute(page,{action:'click',...target(observation,'不可用')})).code,'DISABLED')

  observation=await observe()
  await execute(page,{action:'choose',...target(observation,'顺序'),text:'b'})
  assert.equal(await page.locator('select').inputValue(),'b')
  observation=await observe()
  await execute(page,{action:'scroll',...target(observation,'滚动区域'),direction:'right'})
  assert((await page.locator('#scroll').evaluate(element=>element.scrollLeft))>0)
  observation=await observe()
  await page.locator('#query').evaluate(input=>input.setAttribute('placeholder','变更'))
  assert.equal((await execute(page,{action:'validate_snapshot',snapshot:observation.snapshot})).code,'STALE_SCREENSHOT')

  const child=page.frames().find(frame=>frame.url().startsWith(frameUrl))
  const nested=page.frames().find(frame=>frame.url()===mainUrl+'/inner')
  assert(child&&nested,'cross-origin nested frames load')
  const ids=new Set([observation.frameId])
  for(const [frame,label] of [[child,'跨域框架按钮'],[nested,'嵌套框架按钮']]){
    const inner=await execute(frame,{action:'observe'})
    ids.add(inner.frameId)
    assert.equal((await execute(frame,{action:'click',...target(inner,label)})).ok,true)
    assert.equal(await frame.evaluate(()=>window.clicked),true)
  }
  assert.equal(ids.size,3,'each real frame has its own document identity')
  await child.evaluate(()=>window.__newsNookAgentBridge.onmessage({data:JSON.stringify({type:'cancel',runId:'old-run',requestId:'barrier'})}))
  await child.evaluate(()=>window.__newsNookAgentBridge.onmessage({data:JSON.stringify({type:'command',runId:'old-run',requestId:'stale',args:{action:'observe'}})}))
  const reply=await child.evaluate(()=>window.__agentMessages.at(-1))
  assert.equal(reply.result.dispatched,false)
  assert.match(reply.result.error,/停止|暂停/)

  const canvas=await page.locator('#canvas').boundingBox()
  await page.mouse.click(canvas.x+20,canvas.y+20)
  assert.equal(await page.evaluate(()=>window.canvasTrusted),true)
  assert.deepEqual(errors,[])
  console.log('Chromium: real shadow/frame geometry, trusted clicks, input events, values, stale/covered targets and cancellation PASS')
}finally{
  if(browser)await browser.close()
  for(const server of servers)await new Promise(resolve=>server.close(resolve))
}
