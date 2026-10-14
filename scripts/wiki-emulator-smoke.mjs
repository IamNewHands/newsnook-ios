// Smoke test for the installed NewsNook Android debug WebView over ADB DevTools.
// Run after: adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
// node scripts/wiki-emulator-smoke.mjs
const port = process.env.WIKI_CDP_PORT || '9222'
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = targets.find(t => t.url === 'https://localhost/' && t.type === 'page')
if (!target) throw new Error('NewsNook WebView CDP target unavailable')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve,reject) => {
  socket.addEventListener('open', resolve, {once:true})
  socket.addEventListener('error', reject, {once:true})
})
const pending = new Map()
let seq = 0
socket.addEventListener('message', evt => {
  const data = JSON.parse(evt.data)
  const item = pending.get(data.id)
  if (!item) return
  pending.delete(data.id)
  if (data.error) item.reject(new Error(JSON.stringify(data.error)))
  else item.resolve(data.result)
})
function call(method, params) {
  return new Promise((resolve,reject) => {
    const id = ++seq
    pending.set(id,{resolve,reject})
    socket.send(JSON.stringify({id,method,params}))
  })
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true})
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result?.value
}
const wait = ms => new Promise(resolve => setTimeout(resolve,ms))
console.log('WebView:', await evaluate('({title:document.title, width:innerWidth, body:document.body?.className})'))
const selectionExpression = `(() => {
  const candidates = [...document.querySelectorAll('.reader-prose, .linuxdo-post-prose, .zhihu-prose')].filter(e=>e.getBoundingClientRect().height>0)
  const root = candidates.find(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.top<innerHeight}) || candidates[0]
  if (!root) return {ok:false, reason:'no readable article in active view'}
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT)
  let textNode
  while((textNode=walker.nextNode()) && (!textNode.textContent?.trim() || textNode.textContent.trim().length<4)) {}
  if(!textNode)return {ok:false,reason:'no text nodes in article'}
  const r=document.createRange(), text=textNode.textContent
  let i=0;while(i<text.length&&text[i].trim()==='')i++
  r.setStart(textNode,i);r.setEnd(textNode,Math.min(i+4,text.length))
  const s=window.getSelection();s.removeAllRanges();s.addRange(r)
  document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))
  return {ok:true,text:s.toString(),className:root.className,rect:{top:r.getBoundingClientRect().top, left:r.getBoundingClientRect().left}}
})()`
const selected = await evaluate(selectionExpression)
console.log('Selection:', selected)
if (!selected.ok) throw new Error('No article to select')
await wait(500)
const peek = await evaluate(`({visible:!!document.querySelector('.wiki-selection-popover'),text:document.querySelector('.wiki-popover-item')?.textContent?.trim()})`)
console.log('Peek:', peek)
if (!peek.visible || peek.text !== '百科') throw new Error('Wiki selection popover did not appear')
await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
await wait(150)
if (await evaluate(`!!document.querySelector('.wiki-selection-popover')`)) throw new Error('Outside click must dismiss the toolbar')
await evaluate(selectionExpression)
await wait(150)
await evaluate("document.querySelector('.wiki-popover-item')?.click()")
await wait(7500)
const detail = await evaluate(`({title:document.querySelector('.wiki-sheet h2')?.textContent?.trim(),hasBody:!!document.querySelector('.wiki-entry-summary'),loading:!!document.querySelector('.wiki-status'),error:document.querySelector('.wiki-error')?.textContent?.trim(),provider:document.querySelector('.wiki-provider-name')?.textContent?.trim()})`)
console.log('Detail:',detail)
if (!detail.title || (!detail.hasBody && !detail.error && !detail.loading)) throw new Error('Wiki detail UI invalid')
await evaluate(`document.querySelector('.wiki-sheet-header button[aria-label="设置"]')?.click()`)
await evaluate(`document.querySelector('.wiki-settings-picker-trigger')?.click()`)
const settings = await evaluate(`({label:document.querySelector('.wiki-settings')?.textContent?.slice(0,100),options:[...document.querySelectorAll('.wiki-settings [role=option]')].map(e=>e.textContent.trim()),labelFits:(()=>{const s=document.querySelector('.wiki-settings-picker-trigger span');return !!s&&s.scrollWidth<=s.clientWidth})()})`)
console.log('Settings:',settings)
if (!settings.options.includes('中文维基百科') || !settings.options.includes('Wikipedia (English)')) throw new Error('Provider options unavailable')
if (!settings.labelFits) throw new Error('Provider picker label must not collapse')
await evaluate(`document.querySelector('.wiki-sheet-header button[aria-label="关闭百科"]')?.click()`)
console.log('PASS: text selection, outside dismissal, lookup UI, provider picker')
socket.close()
