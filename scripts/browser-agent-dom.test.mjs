import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {parseHTML} from 'linkedom'

const source = readFileSync(new URL('../android/app/src/main/assets/browser-agent.js', import.meta.url), 'utf8')
function fixture(html = '<input id="query" placeholder="搜索"><button id="go">搜索</button>') {
  const {window:dom} = parseHTML('<html><head><title>任务</title></head><body>' + html + '</body></html>')
  const {document} = dom
  const window={document,HTMLElement:dom.HTMLElement,Element:dom.Element,Event:dom.Event,
    HTMLInputElement:dom.HTMLInputElement,HTMLTextAreaElement:dom.HTMLTextAreaElement,MutationObserver:dom.MutationObserver}
  const rect = {x:10,y:20,left:10,top:20,right:110,bottom:50,width:100,height:30}
  window.HTMLElement.prototype.getBoundingClientRect = function () { return this._rect || rect }
  window.HTMLElement.prototype.scrollIntoView = function () {}
  window.HTMLElement.prototype.focus = function () {}
  window.HTMLElement.prototype.getClientRects = function () { return [this.getBoundingClientRect()] }
  document.elementFromPoint = () => null
  const createRange=document.createRange.bind(document)
  document.createRange=()=>{const range=createRange();range.getBoundingClientRect=()=>rect;return range}
  const context = {
    window, document, location:{href:'https://example.org/task'}, innerWidth:400,innerHeight:800,
    scrollX:0,scrollY:0, Date,JSON,Math,Array,String,Number,Object,Map,Set,WeakMap,Promise,
    getComputedStyle: el => ({display:'block',visibility:'visible',opacity:'1',overflowY:el.style.overflowY||'visible',overflowX:'visible',pointerEvents:el.style.pointerEvents||'auto'}),
    Event:window.Event, InputEvent:window.Event, KeyboardEvent:window.Event,
    HTMLInputElement:window.HTMLInputElement, HTMLTextAreaElement:window.HTMLTextAreaElement,
    Element:window.Element, NodeFilter:{SHOW_TEXT:4}, MutationObserver:window.MutationObserver,
    setTimeout,clearTimeout,console,
  }
  window.window=window; window.top=window; window.scrollBy=()=>{}
  const run = args => {
    const result=JSON.parse(vm.runInNewContext(source.replace('__ARGS__',JSON.stringify(args)), context))
    if(args.action==='observe') assert.equal(result.error,undefined, result.error)
    return result
  }
  return {window,document,run,context}
}

{
  const {document,run} = fixture('<div id="host"></div>')
  document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<button>影子搜索</button>'
  const page=run({action:'observe'})
  assert(page.elements.some(e=>e.text==='影子搜索'), 'open shadow button must be observable')
}
{
  const {document,run}=fixture()
  const page=run({action:'observe'})
  const button=page.elements.find(e=>e.text==='搜索'&&e.tag==='button')
  document.querySelector('#go').textContent='确认付款'
  assert.match(run({action:'click',id:button.id,snapshot:page.snapshot}).error,/变化|重新观察/, 'same node changing meaning expires approval target')
}
{
  const {run}=fixture('<button disabled>提交</button>')
  const page=run({action:'observe'})
  const result=run({action:'click',id:page.elements[0].id,snapshot:page.snapshot})
  assert.equal(result.ok,undefined)
  assert.match(result.error,/禁用|不可操作/)
}
{
  const {document,run}=fixture()
  const page=run({action:'observe'}), id=page.elements.find(e=>e.tag==='input').id
  assert.equal(run({action:'type',id,text:'  keep spaces  ',snapshot:page.snapshot}).ok,true)
  assert.equal(document.querySelector('#query').value,'  keep spaces  ')
  const next=run({action:'observe'})
  assert.equal(run({action:'type',id,text:'',snapshot:next.snapshot}).ok,true)
  assert.equal(document.querySelector('#query').value,'')
}
{
  const {run}=fixture('<input type="file" id="upload"><input autocomplete="one-time-code">')
  const page=run({action:'observe'})
  for(const element of page.elements){
    const result=run({action:'type',id:element.id,text:'1234',snapshot:page.snapshot})
    assert.match(result.error,/文件|手动|受保护/)
  }
}
{
  const {window,document,run}=fixture('<div id="closed"></div>')
  const sent=[]
  window.__newsNookAgentBridge={postMessage:value=>sent.push(JSON.parse(value))}
  run({action:'bootstrap'})
  document.querySelector('#closed').attachShadow({mode:'closed'}).innerHTML='<button>封闭组件</button>'
  assert(run({action:'observe'}).elements.some(e=>e.text==='封闭组件'))
  assert.equal(sent[0].type,'ready')
  const bridge=window.__newsNookAgentBridge
  bridge.onmessage({data:JSON.stringify({type:'cancel',runId:'run-1',requestId:'barrier'})})
  assert.equal(sent.at(-1).type,'cancel_ack')
  bridge.onmessage({data:JSON.stringify({type:'command',runId:'run-1',requestId:'old',args:{action:'observe'}})})
  await Promise.resolve()
  assert.match(sent.at(-1).result.error,/停止|暂停|cancel/i)
  bridge.onmessage({data:JSON.stringify({type:'resume',runId:'run-1'})})
}
console.log('Browser agent shadow DOM, target identity, input policy and frame cancellation: PASS')
