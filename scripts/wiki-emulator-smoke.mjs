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
  data.error ? item.reject(new Error(JSON.stringify(data.error))) : item.resolve(data.result)
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
const android = await evaluate('/Android/i.test(navigator.userAgent)')
const selected = await evaluate(`(() => {
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
})()`)
console.log('Selection:', selected)
if (!selected.ok) throw new Error('No article to select')
await wait(500)
const peek = await evaluate(`({visible:!!document.querySelector('.wiki-selection-popover'),text:document.querySelector('.wiki-selection-word')?.textContent?.trim(),preview:document.querySelector('.wiki-peek-definition')?.textContent?.trim()})`)
console.log('Peek:', peek)
if (android) {
  if (peek.visible) throw new Error('Android native mode must not draw a competing Web popover')
  await evaluate(`window.dispatchEvent(new CustomEvent('newsnook:wiki-native-lookup',{detail:{text:window.getSelection().toString()}}))`)
} else {
  if (!peek.visible || !peek.text) throw new Error('Wiki selection popover did not appear')
  await evaluate("document.querySelector('.wiki-selection-word')?.click()")
}
await wait(7500)
const detail = await evaluate(`({title:document.querySelector('.wiki-sheet h2')?.textContent?.trim(),hasBody:!!document.querySelector('.wiki-entry-summary'),loading:!!document.querySelector('.wiki-status'),error:document.querySelector('.wiki-error')?.textContent?.trim(),provider:document.querySelector('.wiki-provider-name')?.textContent?.trim()})`)
console.log('Detail:',detail)
if (!detail.title || (!detail.hasBody && !detail.error && !detail.loading)) throw new Error('Wiki detail UI invalid')
await evaluate(`document.querySelector('.wiki-sheet-header button[aria-label="设置"]')?.click()`)
const settings = await evaluate(`({label:document.querySelector('.wiki-settings')?.textContent?.slice(0,100),options:[...document.querySelectorAll('.wiki-settings select option')].map(e=>e.value),checkboxes:document.querySelectorAll('.wiki-settings input[type=checkbox]').length})`)
console.log('Settings:',settings)
if (!settings.options.includes('wikipedia-zh') || !settings.options.includes('wikipedia-en')) throw new Error('Provider options unavailable')
await evaluate(`document.querySelector('.wiki-sheet-header button[aria-label="关闭百科"]')?.click()`)
console.log('PASS: text selection, preview, lookup UI, preferences')
socket.close()
