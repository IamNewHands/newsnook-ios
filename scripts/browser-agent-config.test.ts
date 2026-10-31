import assert from 'node:assert/strict'
import { createBrowserConfigController, type BrowserConfigEnvironment } from '../src/features/browser/agent/browserConfig'
import { DEFAULT_BROWSER_PREFERENCES, type BrowserPreferences } from '../src/features/browser/browserPreferences'
import { installUserScript, type UserScript } from '../src/features/browser/scripts'
import { createBrowserAgentRuntime } from '../src/features/browser/agent/agentRuntime'
import {AGENT_TOOLS,validateAgentToolArguments} from '../src/features/browser/agent/browserAgent'

const sampleSource = (name: string, grant = 'GM_getValue') =>
  `// ==UserScript==\n// @name ${name}\n// @version 1.2\n// @match https://example.org/*\n// @grant ${grant}\n// ==/UserScript==\nconsole.log('loaded')`

function fixture() {
  let preferences: BrowserPreferences = {...DEFAULT_BROWSER_PREFERENCES}
  let search: string = 'bing'
  let position: 'top' | 'bottom' = 'bottom'
  let scripts: UserScript[] = [installUserScript(sampleSource('已安装'))]
  let history = 14
  let address = 'https://example.org/start'
  let approved = true
  let failSync = false
  let failSettings = false
  let reloads = 0
  let nativeSyncs = 0
  const approvals: string[] = []
  const env: BrowserConfigEnvironment = {
    getPreferences: () => preferences,
    setPreferences: async next => {if (failSettings) return false; preferences = next; return true},
    getSearch: () => search,
    setSearch: next => {search = next; return true},
    getAddressPosition: () => position,
    setAddressPosition: next => {position = next; return true},
    getScripts: () => scripts,
    saveScripts: next => {scripts = next},
    syncScripts: async () => {nativeSyncs++; return !failSync},
    getHistoryCount: () => history,
    clearHistory: () => {history = 0; return true},
    clearSiteData: async url => url === address,
    currentUrl: () => address,
    reload: async () => {reloads++; return true},
    approve: async reason => {approvals.push(reason); return approved},
    download: async url => {
      assert.equal(url, 'https://scripts.example.org/reader.user.js')
      return sampleSource('远端脚本', 'GM_xmlhttpRequest')
    },
  }
  return {
    controller: createBrowserConfigController(env),
    get state() {return {preferences,search,position,scripts,history,address,approvals,reloads,nativeSyncs}},
    set approved(value:boolean){approved=value},
    set failSync(value:boolean){failSync=value},
    set failSettings(value:boolean){failSettings=value},
    set address(value:string){address=value},
    externalChange(next:Partial<BrowserPreferences>){preferences={...preferences,...next}},
  }
}

{
  const app=fixture()
  const result=await app.controller.execute({action:'inspect'})
  assert.equal(result.settings?.userAgentMode, 'system')
  assert.equal(result.searchEngine, 'bing')
  assert.equal(result.scriptCount,1)
  assert.equal(result.scripts?.[0]?.matchedOnPage,true)
  assert(!JSON.stringify(result).includes('console.log'), 'inspection must not send script source to the model')
  assert.equal(app.state.approvals.length,0)
}
{
  const app=fixture()
  const result=await app.controller.execute({action:'apply',settings:{userAgentMode:'desktop',textZoom:110},searchEngine:'google',addressPosition:'top'})
  assert.equal(result.ok,true)
  assert.equal(app.state.preferences.userAgentMode,'desktop')
  assert.equal(app.state.preferences.textZoom,110)
  assert.equal(app.state.search,'google')
  assert.equal(app.state.position,'top')
  assert.equal(app.state.approvals.length,0,'low-risk browser display settings do not need approval')
}
{
  const app=fixture()
  await assert.rejects(()=>app.controller.execute({action:'apply',settings:{customUserAgent:'bad\nua'}}),/浏览器标识|UA/)
  await assert.rejects(()=>app.controller.execute({action:'apply',settings:{textZoom:900}}),/范围|文字/)
  await assert.rejects(()=>app.controller.execute({action:'apply',settings:{unrecognized:true} as never}),/设置|不支持/)
  await assert.rejects(()=>app.controller.execute({action:'apply',searchEngine:'invented'}),/搜索引擎/)
  assert.equal(app.state.preferences.textZoom,100)
}
{
  const app=fixture()
  const id=app.state.scripts[0].id
  app.approved=false
  await assert.rejects(()=>app.controller.execute({action:'apply',scripts:[{action:'disable',id}]}),/拒绝/)
  assert.equal(app.state.scripts[0].enabled,true)
  assert.equal(app.state.nativeSyncs,0)
  app.approved=true
  const result=await app.controller.execute({action:'apply',scripts:[{action:'disable',id}]})
  assert.equal(result.ok,true)
  assert.equal(app.state.scripts[0].enabled,false)
  assert.equal(app.state.nativeSyncs,1)
  assert.equal(app.state.reloads,1,'scripts take effect in the current page with one reload')
  assert.equal(result.needsReload,false)
}
{
  const app=fixture()
  const result=await app.controller.execute({action:'apply',desktopMode:true,settings:{textZoom:120,javaScriptEnabled:false}})
  assert.equal(result.ok,true)
  assert.equal(app.state.preferences.userAgentMode,'desktop')
  assert.equal(app.state.preferences.textZoom,120,'desktop mode must not overwrite unrelated settings in the batch')
  assert.equal(app.state.preferences.javaScriptEnabled,false,'desktop mode must not overwrite WebView permissions')
  await assert.rejects(()=>app.controller.execute({action:'apply',settings:{userAgentMode:'custom'}}),/自定义|标识|UA/)
  assert.equal(app.state.preferences.userAgentMode,'desktop','invalid custom UA must not silently coerce to another mode')
}
{
  const app=fixture()
  const existing=app.state.scripts[0].id
  const result=await app.controller.execute({action:'apply',scripts:[
    {action:'install',url:'https://scripts.example.org/reader.user.js'},
    {action:'delete',id:existing},
  ]})
  assert.equal(result.ok,true)
  assert.equal(app.state.approvals.length,1,'batch mutations require only one informed approval')
  assert.match(app.state.approvals[0],/GM_xmlhttpRequest/)
  assert.equal(app.state.scripts.length,1)
  assert.equal(app.state.scripts[0].name,'远端脚本')
  assert(!JSON.stringify(result).includes('console.log'),'tool results should be compact')
}
{
  const app=fixture()
  const id=app.state.scripts[0].id
  await app.controller.execute({action:'apply',settings:{privateMode:true,thirdPartyCookiesEnabled:true,confirmExternalApps:false},scripts:[{action:'disable',id}]})
  assert.equal(app.state.approvals.length,1,'all high-impact changes must use a single approval')
  assert.match(app.state.approvals[0],/隐私/)
  assert.match(app.state.approvals[0],/Cookie/)
  assert.match(app.state.approvals[0],/外部应用/)
  assert.match(app.state.approvals[0],/停用/)
}
{
  const app=fixture()
  const id=app.state.scripts[0].id
  app.failSync=true
  await assert.rejects(()=>app.controller.execute({action:'apply',scripts:[{action:'delete',id}]}),/同步|失败|恢复/)
  assert.equal(app.state.scripts.length,1,'script local storage must roll back when native sync fails')
  assert.equal(app.state.scripts[0].id,id)
}
{
  const app=fixture()
  const id=app.state.scripts[0].id
  app.failSettings=true
  await assert.rejects(()=>app.controller.execute({action:'apply',settings:{textZoom:120},scripts:[{action:'disable',id}]}),/设置|保存|失败/)
  assert.equal(app.state.scripts[0].enabled,true,'settings failure must not leave a partially applied script set')
}
{
  const app=fixture()
  app.approved=false
  await assert.rejects(()=>app.controller.execute({action:'inspect',scriptId:app.state.scripts[0].id,includeSource:true}),/拒绝/)
  app.approved=true
  const result=await app.controller.execute({action:'inspect',scriptId:app.state.scripts[0].id,includeSource:true})
  assert.match(result.source??'',/==UserScript==/)
  assert.equal(result.scripts?.length,1)
}
{
  const app=fixture()
  const source=app.state.scripts[0].source+'\n'+'x'.repeat(29000)
  app.state.scripts[0].source=source
  const first=await app.controller.execute({action:'inspect',scriptId:app.state.scripts[0].id,includeSource:true})
  assert.equal(first.source?.length,16000,'source reads must be bounded for model context')
  assert.equal(first.sourceNextOffset,16000)
  assert.equal(first.sourceTotalChars,source.length)
  const second=await app.controller.execute({action:'inspect',scriptId:app.state.scripts[0].id,includeSource:true,sourceOffset:16000,sourceLimit:18000})
  assert.equal(second.source,source.slice(16000))
  assert.equal(second.sourceNextOffset,null)
}
{
  const app=fixture()
  const before=app.state.scripts[0].id
  await assert.rejects(()=>app.controller.execute({action:'apply',clearData:'history',settings:{textZoom:110}}),/清理|单独/)
  await app.controller.execute({action:'apply',clearData:'history'})
  assert.equal(app.state.history,0)
  assert.equal(app.state.scripts[0].id,before)
}
{
  const app=fixture()
  const id=app.state.scripts[0].id
  const failing=app.controller.execute({action:'apply',scripts:[{action:'enable',id}]})
  await failing
  const check=await app.controller.execute({action:'inspect',limit:1,offset:0})
  assert.equal(check.scripts?.length,1)
  await assert.rejects(()=>app.controller.execute({action:'inspect',offset:-1}),/范围/)
  await assert.rejects(()=>app.controller.execute({action:'apply',scripts:[{action:'delete',id:'not-found'}]}),/不存在/)
}
console.log('Browser Agent configuration transaction, inspect and permissions: PASS')
assert.equal(AGENT_TOOLS.filter(item=>item.name==='browser_config').length,1)
assert.doesNotThrow(()=>validateAgentToolArguments('browser_config',{action:'apply',settings:{textZoom:120},scripts:[{action:'disable',id:'known'}]}))
assert.throws(()=>validateAgentToolArguments('browser_config',{action:'apply',settings:{textZoom:500}}),/文字|范围/)
{
  const app=fixture()
  const controller=new AbortController()
  let startedNative=false
  const runtime=createBrowserAgentRuntime({
    signal:controller.signal,
    bridge:{
      state:async()=>({state:{url:null,loading:false},tabs:[]}),
      session:async (_action,runId)=>{startedNative=true;return {runId,state:'running'}},
      action:async()=>{throw new Error('Configuration must not dispatch DOM actions')},
    },
    searchUrl:q=>'https://example.org/search?q='+q,
    onSearch:async()=>true,onNavigate:async()=>true,
    onApproval:async()=>true,onHandoff:async()=> 'continue',
    onBrowserConfig:(request,signal)=>app.controller.execute(request,signal),
  })
  await runtime.start()
  const result=await runtime.performTool('browser_config',{action:'apply',settings:{textZoom:120,javaScriptEnabled:false}},controller.signal)
  assert.equal((result.result as {ok:boolean}).ok,true)
  assert.equal(app.state.preferences.textZoom,120)
  assert.equal(app.state.preferences.javaScriptEnabled,false)
  assert.equal(startedNative,false,'configuration must work without an open WebView or native run')
  const read=await runtime.performTool('browser_config',{action:'inspect'},controller.signal)
  assert.equal((read.result as {settings:BrowserPreferences}).settings.textZoom,120)
  await runtime.stop()
}
console.log('Browser Agent config schema and page-free runtime bridge: PASS')
