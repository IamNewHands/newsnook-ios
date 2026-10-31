/* Real BrowserAddressBar + BrowserSheet visual regression in an isolated Chrome. */
const {spawn} = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const chrome = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome')
const port = 9259
const root = path.resolve('evidence/browser-media-discovery')
fs.mkdirSync(root,{recursive:true})
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'newsnook-browser-media-'))
const browser = spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--disable-extensions','--remote-allow-origins=*',`--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,'--window-size=1100,950','about:blank'],{stdio:'ignore'})
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms))
async function connect(){
  let target
  for(let i=0;i<50;i++){
    try {
      const response=await fetch(`http://127.0.0.1:${port}/json/list`)
      target=(await response.json()).find(item=>item.type==='page')
      if(target)break
    }catch{}
    await pause(200)
  }
  if(!target)throw new Error('Chrome CDP unavailable')
  const ws=new WebSocket(target.webSocketDebuggerUrl), requests=new Map()
  let id=0
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
  ws.onmessage=event=>{
    const value=JSON.parse(event.data)
    if(!value.id)return
    const pending=requests.get(value.id)
    if(!pending)return
    requests.delete(value.id)
    value.error?pending.reject(new Error(JSON.stringify(value.error))):pending.resolve(value.result)
  }
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const next=++id
    requests.set(next,{resolve,reject})
    ws.send(JSON.stringify({id:next,method,params}))
  })
  return {send,close:()=>ws.close()}
}
async function main(){
  const {send,close}=await connect()
  await send('Page.enable')
  await send('Runtime.enable')
  const evaluate=async expression=>{
    const output=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
    if(output.exceptionDetails)throw new Error(output.exceptionDetails.text)
    return output.result?.value
  }
  const navigate=async(width,height,query)=>{
    await send('Emulation.setDeviceMetricsOverride',{width,height,mobile:width<600,deviceScaleFactor:1})
    await send('Page.navigate',{url:'about:blank'})
    await pause(90)
    await send('Page.navigate',{url:`http://127.0.0.1:5184/scripts/fixtures/browser-media-discovery/preview.html?${query}`})
    for(let count=0;count<60;count++){
      const loaded=await evaluate('Boolean(document.querySelector("[data-browser-media-count]"))')
      if(loaded)return
      await pause(125)
    }
    throw new Error('Preview did not mount: '+query)
  }
  const screenshot=async name=>{
    const output=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true})
    fs.writeFileSync(path.join(root,name+'.png'),Buffer.from(output.data,'base64'))
  }
  const layout=async()=>JSON.parse(await evaluate(`JSON.stringify((()=>{
    const find=q=>document.querySelector(q)
    const rect=q=>{const r=find(q)?.getBoundingClientRect();return r&&{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}
    return {
      viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      count:find('.browser-address')?.dataset.browserMediaCount,
      prompt:Boolean(find('[data-browser-media-prompt]')),
      urlControl:rect('[aria-label="搜索或输入网址"]'),
      siteControl:rect('[aria-label="网站信息"]'),
      mediaControl:rect('.browser-media-indicator'),
      mediaVisible:!!find('.browser-media-indicator') && getComputedStyle(find('.browser-media-indicator')).display!=='none',
      strip:rect('.browser-media-strip'),
      stripVisible:!!find('.browser-media-strip') && getComputedStyle(find('.browser-media-strip')).display!=='none',
      address:rect('.browser-address'),
      next:rect('[aria-label="刷新"]'),
      compactHomeHidden:!!find('[aria-label="主页"]') && getComputedStyle(find('[aria-label="主页"]')).display==='none',
      compactAiHidden:!!find('[aria-label="AI 浏览助手"]') && getComputedStyle(find('[aria-label="AI 浏览助手"]')).display==='none',
      labels:[...document.querySelectorAll('.browser-address button')].map(b=>b.getAttribute('aria-label'))
    }
  })())`))
  try {
    await navigate(393,852,'count=3')
    let state=await layout()
    for(let i=0;i<20&&!state.prompt;i++){await pause(90);state=await layout()}
    console.log('mobile-prompt',JSON.stringify(state))
    if(state.count!=='3'||!state.prompt||!state.urlControl||!state.stripVisible||state.mediaVisible||state.scrollWidth>393||state.strip.right>393)
      throw new Error('Invalid mobile media discovery layout')
    await screenshot('393-discovery')
    await pause(2700)
    state=await layout()
    console.log('mobile-steady',JSON.stringify(state))
    if(state.prompt||state.count!=='3')throw new Error('Intro hint did not yield to stable count')
    await screenshot('393-badge')
    await evaluate('document.querySelector(".browser-media-strip").click()')
    if(!(await evaluate('Boolean(document.querySelector("[role=dialog][aria-label=媒体资源]"))')))
      throw new Error('Direct media badge must open the sheet')
    await pause(275) // sheet transition has settled before capturing the visual evidence
    await screenshot('393-media-sheet')
    await navigate(393,852,'count=2&theme=light')
    await screenshot('393-light-toolbar')
    await evaluate('document.querySelector(".browser-media-strip").click()')
    const buttonStyle=JSON.parse(await evaluate(`JSON.stringify((()=>{const b=document.querySelector('.browser-media-play');if(!b)return null;const s=getComputedStyle(b);return {height:b.getBoundingClientRect().height,color:s.color,background:s.backgroundColor,border:s.borderTopColor}})())`))
    console.log('light-media-play',JSON.stringify(buttonStyle))
    if(!buttonStyle||buttonStyle.height<44||buttonStyle.color===buttonStyle.background)throw new Error('Light media action has incorrect dimensions or styling')
    await pause(275)
    await screenshot('393-light-media-sheet')
    await navigate(320,740,'count=1')
    state=await layout()
    console.log('small-mobile',JSON.stringify(state))
    if(state.scrollWidth>320||!state.urlControl||state.urlControl.width<60||!state.stripVisible||state.mediaVisible||!state.compactHomeHidden||!state.compactAiHidden||state.strip.right>320)
      throw new Error('Toolbar overflow/overlap at 320px')
    await screenshot('320-discovery')
    await navigate(393,852,'count=0')
    state=await layout()
    if(state.count!=='0'||state.mediaVisible||state.stripVisible)throw new Error('Zero media must not show an indicator')
    await screenshot('393-empty')
    await navigate(393,852,'count=12&position=top&private=1')
    state=await layout()
    console.log('top-private',JSON.stringify(state))
    if(state.count!=='12'||!state.stripVisible||state.scrollWidth>393)throw new Error('Top/private media indicator lost')
    await screenshot('393-top-private')
    await navigate(700,852,'count=3')
    state=await layout()
    for(let i=0;i<20&&!state.prompt;i++){await pause(90);state=await layout()}
    console.log('wide-address',JSON.stringify(state))
    if(state.count!=='3'||!state.mediaVisible||state.stripVisible||!state.mediaControl||state.mediaControl.right>state.next.x+1)throw new Error('Wide address-bar indicator missing or overlapping')
    await screenshot('700-address-badge')
    console.log('browser-media-discovery-visual: PASS')
  }finally{close()}
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{
  browser.kill()
  try{fs.rmSync(profile,{recursive:true,force:true})}catch{}
})
