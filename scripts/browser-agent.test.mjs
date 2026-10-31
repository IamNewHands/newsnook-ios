import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../android/app/src/main/assets/browser-agent.js',import.meta.url),'utf8')
let value=''
const fields={
  input:{tagName:'INPUT',isConnected:true,value:'',disabled:false,readOnly:false,getAttribute(k){return k==='placeholder'?'搜索':null},matches(){return false},getBoundingClientRect(){return {width:100,height:30,x:0,y:0}},focus(){},scrollIntoView(){},dispatchEvent(){return true},innerText:'',isContentEditable:false},
  button:{tagName:'BUTTON',isConnected:true,innerText:'执行搜索',value:'',getAttribute(){return null},matches(){return false},getBoundingClientRect(){return {width:80,height:30,x:10,y:10}},scrollIntoView(){},click(){value='clicked'},dispatchEvent(){}}
}
const list=Object.values(fields)
for(const element of list)element.hasAttribute=function(name){return this.getAttribute(name)!=null}
const doc={title:'测试网页',body:{innerText:'搜索页面'},documentElement:{scrollHeight:1200},querySelectorAll(){return list}}
const ctx={document:doc,location:{href:'https://example.com'},innerWidth:400,innerHeight:800,scrollY:0,Date,
    getComputedStyle(){return {visibility:'visible',display:'block',opacity:'1'}},window:{scrollBy(){value='scrolled'}},
    Event:class {constructor(){}},KeyboardEvent:class {},HTMLInputElement:class {},HTMLTextAreaElement:class {},JSON,Array,String,Math}
Object.defineProperty(ctx.HTMLInputElement.prototype,'value',{set(v){this._value=v}})
Object.setPrototypeOf(fields.input,ctx.HTMLInputElement.prototype)
function run(args){
  const code=source.replace('__ARGS__',JSON.stringify(args))
  return JSON.parse(vm.runInNewContext(code,ctx))
}
const initial=run({action:'observe'})
assert.equal(initial.elements.length,2)
assert(initial.snapshot)
assert.equal(run({action:'click',id:1,snapshot:initial.snapshot}).ok,true)
assert.equal(value,'clicked')
assert.equal(run({action:'type',id:0,text:'Qwen',snapshot:initial.snapshot}).ok,true)
assert.equal(fields.input._value,'Qwen')
assert.equal(run({action:'scroll',direction:'down',snapshot:initial.snapshot}).ok,true)
assert.equal(value,'scrolled')
assert.match(run({action:'click',id:80,snapshot:initial.snapshot}).error,/元素已经失效/)
assert.match(run({action:'click',id:1,snapshot:'incorrect'}).error,/重新观察/)
const next=run({action:'observe'})
assert.notEqual(initial.snapshot,next.snapshot)
assert.match(run({action:'click',id:1,snapshot:initial.snapshot}).error,/重新观察/)
fields.button.isConnected=false
assert.match(run({action:'click',id:1,snapshot:next.snapshot}).error,/元素已经失效/)
console.log('Browser agent DOM observe/click/type/scroll with snapshot expiry: PASS')
