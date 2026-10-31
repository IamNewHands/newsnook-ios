import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act, useEffect } from 'react'
import { flushSync } from 'react-dom'
import type { NewsSource } from '../src/sources/registry'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
const storage = new Map<string,string>()
Object.assign(globalThis, { window, document:window.document, Node:window.Node, Element:window.Element,
  HTMLElement:window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT:true,
  localStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k),key:(i:number)=>[...storage.keys()][i],get length(){return storage.size}},
})
const { createRoot } = await import('react-dom/client')
const { useFeeds } = await import('../src/hooks/useFeeds')
const originalFetch=globalThis.fetch
const requests:Array<{url:string;signal?:AbortSignal;resolve:(value:Response)=>void}>=[]
globalThis.fetch=async(input,init)=>new Promise<Response>((resolve,reject)=>{
  const signal=init?.signal??undefined
  if(signal?.aborted){reject(signal.reason);return}
  requests.push({url:String(input),signal,resolve})
  signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})
})
function source(id:string):NewsSource{return {id,name:id,label:id,group:'custom',kind:'feed',url:`https://example.test/${id}.xml`,enabled:true}}
let result:ReturnType<typeof useFeeds>
function Harness({sources,ownerRefresh=false}:{sources:NewsSource[];ownerRefresh?:boolean}){
  const ids=React.useMemo(()=>sources.map(s=>s.id),[sources])
  result=useFeeds(ids,undefined,sources,'startup-fetch-test',ids)
  useEffect(()=>{if(ownerRefresh)void result.refresh(ids)},[ids,ownerRefresh])
  return <div>{result.articles.length}</div>
}
let sequence=0
async function scenario(name:string,body:(root:ReturnType<typeof createRoot>)=>Promise<void>){
  requests.length=0;const node=document.createElement('div');document.body.append(node);const root=createRoot(node)
  try{await body(root);console.log('PASS '+name)}finally{await act(async()=>root.unmount());node.remove()}
}
try{
 await scenario('one production mount dispatches one source request, not prefetch plus aborted refresh',async root=>{
  const sources=[source('owned_'+(++sequence))]
  await act(async()=>{root.render(<Harness sources={sources} ownerRefresh />)})
  assert.equal(requests.length,1,'The owning App refresh must prevent the hook from dispatching a duplicate request first')
  assert.equal(requests[0].signal?.aborted,false)
 })
 await scenario('standalone hook still automatically loads an uncached source',async root=>{
  const sources=[source('standalone_'+(++sequence))]
  await act(async()=>{root.render(<Harness sources={sources} />)})
  assert.equal(requests.length,1)
  await act(async()=>{requests[0].resolve(new Response('<rss><channel><item><title>Local test</title><link>https://example.test/article</link><description>Text</description></item></channel></rss>'));await new Promise(resolve=>setTimeout(resolve,150))})
  assert.equal(result!.articles.length,1,'A deferred prefetch must still deliver the real article')
 })
 await scenario('unmount before the microtask never starts a request',async root=>{
  const sources=[source('unmounted_'+(++sequence))]
  act(()=>{flushSync(()=>root.render(<Harness sources={sources} />));flushSync(()=>root.render(null))})
  await act(async()=>{await Promise.resolve()})
  assert.equal(requests.length,0)
 })
 await scenario('a replaced source scope does not dispatch the stale queued prefetch',async root=>{
  const old=[source('old_'+(++sequence))],current=[source('new_'+sequence)]
  act(()=>{flushSync(()=>root.render(<Harness sources={old} />));flushSync(()=>root.render(<Harness sources={current} />))})
  await act(async()=>{await Promise.resolve()})
  assert.equal(requests.length,1)
  assert.ok(requests[0].url.includes(current[0].id))
 })
 await scenario('StrictMode replay leaves an active owning refresh and suppresses stale completions',async root=>{
  const sources=[source('strict_'+(++sequence))]
  await act(async()=>{root.render(<React.StrictMode><Harness sources={sources} ownerRefresh /></React.StrictMode>)})
  const active=requests.filter(r=>!r.signal?.aborted)
  assert.equal(active.length,1,'Cleanup must clear the canceled owner before StrictMode replays effects')
  await act(async()=>{active[0].resolve(new Response('<rss><channel><item><title>Strict current</title><link>https://example.test/strict</link></item></channel></rss>'));await new Promise(resolve=>setTimeout(resolve,150))})
  assert.equal(result!.articles[0]?.title,'Strict current')
 })
}finally{globalThis.fetch=originalFetch}
console.log('feed-startup-fetch: all 5 behavior scenarios passed')
