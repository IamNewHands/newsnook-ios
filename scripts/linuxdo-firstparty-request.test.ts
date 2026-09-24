import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import vm from 'node:vm'
const asset = new URL('../android/app/src/main/assets/linuxdo-session-request.js', import.meta.url)
assert.ok(existsSync(asset), 'recovered timings must execute in the real first-party document, not discard that document and return to a synthetic one')
const code = readFileSync(asset, 'utf8')
const flush = async () => { for (let n=0;n<20;n++) await Promise.resolve() }
async function run(overrides: Record<string, unknown> = {}) {
 const requests: any[]=[]
 const request={id:'test-request',url:'https://linux.do/topics/timings',method:'POST',headers:{'X-CSRF-Token':'test-secret','Content-Type':'application/x-www-form-urlencoded'},body:'timings%5B1%5D=5000&topic_id=100&topic_time=5000',...overrides}
 const sandbox:any={location:{origin:'https://linux.do'},window:{},AbortController,setTimeout,clearTimeout,URL,fetch:async(url:string,options:any)=>{requests.push({url,options});return {status:200,url:'https://linux.do/topics/timings',headers:{forEach:(callback:any)=>{callback('text/html','content-type');callback('DO-NOT-EXPORT','set-cookie')}},text:async()=>''}}}
 vm.runInNewContext(code+'\nwindow.__newsnookFirstPartyRequest('+JSON.stringify(request)+');',sandbox)
 await flush()
 return {requests,result:sandbox.window.__newsnookFirstPartyResults?.[request.id]}
}
let count=0
{
 const {requests,result}=await run()
 assert.equal(requests.length,1);assert.equal(requests[0].options.credentials,'include')
 assert.equal(requests[0].options.redirect,'error','do not forward CSRF through a redirect')
 assert.equal(requests[0].options.headers['X-CSRF-Token'],'test-secret')
 assert.equal(result.status,200);assert.equal(result.data,'');assert.equal(result.headers['set-cookie'],undefined)
 count++
}
for (const url of ['https://evil.example/topics/timings','https://linux.do.evil.example/topics/timings','http://linux.do/topics/timings','https://linux.do/posts.json']) {
 const {requests,result}=await run({url})
 assert.equal(requests.length,0,'first-party timing transport must not fetch '+url)
 assert.ok(result.error);count++
}
{
 const {requests,result}=await run({url:'https://linux.do/session/csrf.json',method:'GET',body:undefined})
 assert.equal(requests.length,1);assert.equal(result.status,200);count++
}
console.log(`linuxdo-firstparty-request: ${count} passed`)
