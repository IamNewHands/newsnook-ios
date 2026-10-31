import {
  normalizeBrowserPreferences, toggleBrowserDesktopMode, validateBrowserUserAgent,
  type BrowserPreferences,
} from '../browserPreferences'
import { BROWSER_SEARCH_PROVIDERS } from '../browserSearchCatalog'
import { matchesUserScript, prepareUserScriptInstall, type UserScript } from '../scripts'

/** All Browser Agent configuration operations pass through the same persistence/runtime boundaries as the UI. */
export interface BrowserConfigEnvironment {
  getPreferences: () => BrowserPreferences
  setPreferences: (next: BrowserPreferences) => Promise<boolean>
  getSearch: () => string
  setSearch: (next: string) => boolean
  getAddressPosition: () => 'top' | 'bottom'
  setAddressPosition: (next: 'top' | 'bottom') => boolean
  getScripts: () => UserScript[]
  saveScripts: (next: UserScript[]) => void
  syncScripts: () => Promise<boolean>
  getHistoryCount: () => number
  clearHistory: () => boolean
  clearSiteData: (url: string) => Promise<boolean>
  currentUrl: () => string
  reload: () => Promise<boolean>
  approve: (reason: string) => Promise<boolean>
  download: (url: string, signal?: AbortSignal) => Promise<string>
}

type ScriptAction = 'install' | 'update' | 'enable' | 'disable' | 'delete'
interface ScriptChange {action: ScriptAction; id?: string; source?: string; url?: string}
export interface BrowserConfigRequest {
  action: 'inspect' | 'apply'
  settings?: Record<string, unknown>
  desktopMode?: boolean
  searchEngine?: string
  addressPosition?: 'top' | 'bottom'
  scripts?: ScriptChange[]
  clearData?: 'history' | 'site'
  scriptId?: string
  includeSource?: boolean
  sourceOffset?: number
  sourceLimit?: number
  offset?: number
  limit?: number
  reload?: boolean
}
interface ScriptSummary {
  id: string; name: string; version: string; enabled: boolean; matchedOnPage: boolean;
  matches: string[]; grants: string[]; connects: string[]; requires: string[]
}
export interface BrowserConfigResult {
  ok: boolean
  action: string
  settings?: BrowserPreferences
  searchEngine?: string
  addressPosition?: string
  scriptCount?: number
  scripts?: ScriptSummary[]
  source?: string
  sourceTotalChars?: number
  sourceNextOffset?: number | null
  offset?: number
  nextOffset?: number | null
  historyCount?: number
  applied?: string[]
  needsReload?: boolean
  message?: string
}

const SETTINGS = new Set<keyof BrowserPreferences>([
  'privateMode', 'userAgentMode', 'lastNonDesktopUserAgentMode', 'customUserAgent', 'textZoom',
  'javaScriptEnabled', 'loadsImagesAutomatically', 'thirdPartyCookiesEnabled',
  'mediaPlaybackRequiresUserGesture', 'confirmExternalApps',
])
const BOOLEAN_SETTINGS = new Set<keyof BrowserPreferences>([
  'privateMode', 'javaScriptEnabled', 'loadsImagesAutomatically', 'thirdPartyCookiesEnabled',
  'mediaPlaybackRequiresUserGesture', 'confirmExternalApps',
])
const USER_AGENT_MODES = new Set(['system', 'android', 'ios', 'desktop', 'custom'])
const MOBILE_MODES = new Set(['system', 'android', 'ios', 'custom'])
const ACTIONS = new Set(['install', 'update', 'enable', 'disable', 'delete'])
const PARAMS = new Set(['action', 'settings', 'desktopMode', 'searchEngine', 'addressPosition',
  'scripts', 'clearData', 'scriptId', 'includeSource', 'sourceOffset', 'sourceLimit', 'offset', 'limit', 'reload'])

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('浏览器配置参数必须是对象')
  return value as Record<string, unknown>
}
function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + '不能为空')
  return value.trim()
}
function validateSettings(input: Record<string, unknown>): Partial<BrowserPreferences> {
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!SETTINGS.has(key as keyof BrowserPreferences)) throw new Error('不支持的浏览器设置：' + key)
    if (BOOLEAN_SETTINGS.has(key as keyof BrowserPreferences)) {
      if (typeof value !== 'boolean') throw new Error('设置 ' + key + ' 只能是真或假')
    } else if (key === 'textZoom') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 75 || value > 200)
        throw new Error('网页文字大小只能在 75% 到 200% 范围内')
    } else if (key === 'userAgentMode') {
      if (!USER_AGENT_MODES.has(value as string)) throw new Error('浏览器 UA 模式无效')
    } else if (key === 'lastNonDesktopUserAgentMode') {
      if (!MOBILE_MODES.has(value as string)) throw new Error('浏览器备用 UA 模式无效')
    } else if (key === 'customUserAgent') {
      if (typeof value !== 'string' || value.length > 512 || /[^\x20-\x7e]/.test(value))
        throw new Error('浏览器标识只能包含英文字符，且不能超过 512 字符')
    }
    patch[key] = value
  }
  return patch as Partial<BrowserPreferences>
}
function parseRequest(input: unknown): BrowserConfigRequest {
  const data = record(input)
  for (const key of Object.keys(data)) if (!PARAMS.has(key)) throw new Error('不支持的配置参数：' + key)
  if (data.action !== 'inspect' && data.action !== 'apply') throw new Error('浏览器配置操作只能是 inspect 或 apply')
  if (data.settings !== undefined) validateSettings(record(data.settings))
  if (data.searchEngine !== undefined) {
    if (typeof data.searchEngine !== 'string' || !BROWSER_SEARCH_PROVIDERS.some(p => p.id === data.searchEngine))
      throw new Error('无效的搜索引擎')
  }
  if (data.addressPosition !== undefined && data.addressPosition !== 'top' && data.addressPosition !== 'bottom')
    throw new Error('地址栏位置只能是 top 或 bottom')
  if (data.desktopMode !== undefined && typeof data.desktopMode !== 'boolean') throw new Error('桌面模式只能是真或假')
  if (data.reload !== undefined && typeof data.reload !== 'boolean') throw new Error('reload 只能是真或假')
  if (data.includeSource !== undefined && typeof data.includeSource !== 'boolean') throw new Error('includeSource 只能是真或假')
  if (data.scriptId !== undefined) requiredString(data.scriptId, '脚本 ID')
  if (data.sourceOffset !== undefined && (!Number.isInteger(data.sourceOffset) || (data.sourceOffset as number) < 0))
    throw new Error('脚本源码起始位置超出范围')
  if (data.sourceLimit !== undefined && (!Number.isInteger(data.sourceLimit) || (data.sourceLimit as number) < 1 || (data.sourceLimit as number) > 24000))
    throw new Error('脚本源码单次最多读取 24000 字符')
  if ((data.sourceOffset !== undefined || data.sourceLimit !== undefined) && data.includeSource !== true)
    throw new Error('读取脚本源码片段需要 includeSource=true')
  if (data.clearData !== undefined && data.clearData !== 'history' && data.clearData !== 'site') throw new Error('不支持的清理范围')
  if (data.offset !== undefined && (!Number.isInteger(data.offset) || (data.offset as number) < 0)) throw new Error('offset 超出范围')
  if (data.limit !== undefined && (!Number.isInteger(data.limit) || (data.limit as number) < 1 || (data.limit as number) > 30))
    throw new Error('limit 范围为 1 到 30')
  if (data.scripts !== undefined) {
    if (!Array.isArray(data.scripts) || data.scripts.length < 1 || data.scripts.length > 12)
      throw new Error('一次只能执行 1 到 12 条脚本操作')
    for (const raw of data.scripts) {
      const op = record(raw)
      if (!ACTIONS.has(op.action as string)) throw new Error('无效的脚本操作')
      if (Object.keys(op).some(k => !['action', 'id', 'source', 'url'].includes(k))) throw new Error('脚本操作包含不支持的字段')
      if (op.action === 'install') {
        if (op.id !== undefined) throw new Error('安装脚本不能指定 ID')
        if ((op.source === undefined) === (op.url === undefined)) throw new Error('安装脚本必须只提供源码或 HTTPS 地址')
      } else {
        requiredString(op.id, '脚本 ID')
        if (op.action === 'update') {
          if ((op.source === undefined) === (op.url === undefined)) throw new Error('更新脚本必须只提供源码或 HTTPS 地址')
        } else if (op.source !== undefined || op.url !== undefined) throw new Error('此脚本操作不能提供源码或网址')
      }
      if (op.source !== undefined && (typeof op.source !== 'string' || op.source.length > 400_000))
        throw new Error('脚本源码无效或过长')
      if (op.url !== undefined) {
        const parsed = new URL(requiredString(op.url, '脚本 URL'))
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
          throw new Error('脚本下载仅支持不含凭据的 HTTPS 地址')
      }
    }
  }
  if (data.action === 'inspect' &&
    ['settings', 'searchEngine', 'addressPosition', 'desktopMode', 'scripts', 'clearData', 'reload'].some(key => data[key] !== undefined))
    throw new Error('inspect 不能修改配置')
  if (data.action === 'apply' &&
    ['scriptId', 'includeSource', 'sourceOffset', 'sourceLimit', 'offset', 'limit'].some(key => data[key] !== undefined))
    throw new Error('apply 不接受脚本读取参数')
  if (data.clearData && ['settings','searchEngine','addressPosition','desktopMode','scripts'].some(key => data[key] !== undefined))
    throw new Error('清理浏览数据必须单独执行')
  return data as unknown as BrowserConfigRequest
}
export const validateBrowserConfigRequest = parseRequest

function summary(item: UserScript, currentUrl: string): ScriptSummary {
  return {
    id: item.id, name: item.name, version: item.version, enabled: item.enabled,
    matchedOnPage: item.enabled && matchesUserScript(item, currentUrl),
    matches: [...item.matches, ...item.includes].slice(0, 8),
    grants: item.grants.slice(0, 16), connects: item.connects.slice(0, 8),
    requires: item.requires.slice(0, 8),
  }
}
function configSummary(env: BrowserConfigEnvironment): Omit<BrowserConfigResult, 'ok' | 'action'> {
  return {settings: {...env.getPreferences()}, searchEngine: env.getSearch(),
    addressPosition: env.getAddressPosition(), scriptCount: env.getScripts().length,
    historyCount: env.getHistoryCount()}
}
function description(item: UserScript, action: string): string {
  return action + '「' + item.name + '」 v' + item.version
    + '\n适用站点：' + [...item.matches, ...item.includes].slice(0, 8).join('、')
    + '\nGM 权限：' + (item.grants.join('、') || '无')
    + '\n跨域访问：' + (item.connects.join('、') || '无')
    + '\n依赖：' + (item.requires.join('、') || '无')
}

export function createBrowserConfigController(env: BrowserConfigEnvironment) {
  // This queue is independent of the model action loop: another UI update may still win.
  let tail: Promise<unknown> = Promise.resolve()
  const executeRequest = async (request: BrowserConfigRequest, signal?: AbortSignal): Promise<BrowserConfigResult> => {
    const ensureActive = () => {if (signal?.aborted) throw new DOMException('任务已停止','AbortError')}
    ensureActive()
    if (request.action === 'inspect') {
      const all = env.getScripts()
      const selected = request.scriptId ? all.filter(s => s.id === request.scriptId) : all
      if (request.scriptId && !selected.length) throw new Error('脚本不存在，请先读取列表')
      if (request.includeSource) {
        if (!request.scriptId) throw new Error('读取脚本源码必须指定 scriptId')
        if (!await env.approve('将用户脚本源码片段提供给当前 AI 模型。脚本可能包含敏感信息。允许读取「' + selected[0].name + '」？'))
          throw new Error('用户拒绝读取脚本源码')
      }
      const offset = request.offset ?? 0
      const limit = request.limit ?? 12
      const slice = selected.slice(offset, offset + limit)
      const originalSource = request.includeSource ? selected[0].source : undefined
      const sourceOffset = request.sourceOffset ?? 0
      const sourceLimit = request.sourceLimit ?? 16000
      return {ok:true,action:'inspect',...configSummary(env),scripts:slice.map(s => summary(s,env.currentUrl())),
        ...(originalSource !== undefined ? {
          source:originalSource.slice(sourceOffset,sourceOffset+sourceLimit),sourceTotalChars:originalSource.length,
          sourceNextOffset:sourceOffset+sourceLimit<originalSource.length?sourceOffset+sourceLimit:null,
        } : {}),
        offset,nextOffset: offset + slice.length < selected.length ? offset + slice.length : null}
    }
    if (request.clearData) {
      const count=env.getHistoryCount(),page=env.currentUrl()
      if (request.clearData==='site' && !/^https?:\/\//i.test(page)) throw new Error('当前没有可以清理的网站')
      const detail=request.clearData==='history' ? '清除全部浏览历史（' + count + ' 条）' : '清除当前站点 ' + new URL(page).host + ' 的 Cookie 与存储，可能使相关站点退出登录'
      if (!await env.approve(detail)) throw new Error('用户拒绝清理浏览数据')
      ensureActive()
      if (request.clearData==='site' && env.currentUrl()!==page)
        throw new Error('网页已变化，请重新确认需要清理的站点')
      const ok=request.clearData==='history' ? env.clearHistory() : await env.clearSiteData(page)
      if (!ok) throw new Error('清理浏览数据失败')
      return {ok:true,action:'apply',applied:[detail],...configSummary(env),needsReload:request.clearData==='site'}
    }

    // Prepare everything without writing anything; validation and downloads must finish first.
    const current=env.getPreferences()
    const rawPatch=validateSettings(request.settings ?? {})
    if (request.desktopMode !== undefined && rawPatch.userAgentMode !== undefined)
      throw new Error('桌面模式和 UA 模式不可同时设置')
    if (request.desktopMode !== undefined) {
      const desktop=current.userAgentMode==='desktop'
      if (desktop !== request.desktopMode) {
        const toggled=toggleBrowserDesktopMode(current)
        rawPatch.userAgentMode=toggled.userAgentMode
        rawPatch.lastNonDesktopUserAgentMode=toggled.lastNonDesktopUserAgentMode
      }
    }
    const proposed={...current,...rawPatch}
    if (proposed.userAgentMode==='custom') {
      const error=validateBrowserUserAgent(proposed.customUserAgent)
      if (error) throw new Error(error)
    }
    const next=normalizeBrowserPreferences(proposed)
    if (next.lastNonDesktopUserAgentMode==='custom' && !next.customUserAgent)
      throw new Error('自定义 UA 不能为空')
    const beforeScripts=env.getScripts()
    let afterScripts=beforeScripts.slice()
    const changes:string[]=[]
    const risks:string[]=[]
    for (const op of request.scripts ?? []) {
      ensureActive()
      const idx=op.id===undefined ? -1 : afterScripts.findIndex(item=>item.id===op.id)
      if (op.action!=='install' && idx<0) throw new Error('脚本不存在：' + op.id)
      if (op.action==='delete') {
        const existing=afterScripts[idx]
        risks.push(description(existing,'删除'))
        changes.push('删除脚本：'+existing.name)
        afterScripts.splice(idx,1)
      } else if (op.action==='enable' || op.action==='disable') {
        const currentScript=afterScripts[idx]
        const enabled=op.action==='enable'
        risks.push(description(currentScript,enabled?'启用':'停用'))
        if (currentScript.enabled!==enabled) {
          afterScripts[idx]={...currentScript,enabled}
          changes.push((enabled?'启用':'停用')+'脚本：'+currentScript.name)
        }
      } else {
        const source=op.url?await env.download(op.url,signal):requiredString(op.source,'脚本源码')
        ensureActive()
        const installed=op.action==='update'?afterScripts[idx]:undefined
        const candidate=prepareUserScriptInstall(source,afterScripts,installed)
        const oldIndex=afterScripts.findIndex(item=>item.id===candidate.id)
        risks.push(description(candidate,oldIndex>=0?'更新':'安装'))
        if (oldIndex>=0) afterScripts[oldIndex]=candidate
        else {
          if (afterScripts.length>=128) throw new Error('最多安装 128 个脚本')
          afterScripts.push(candidate)
        }
        changes.push((oldIndex>=0?'更新脚本：':'安装脚本：')+candidate.name)
      }
    }
    if (next.privateMode!==current.privateMode)
      risks.push(next.privateMode?'开启隐私模式，不再记录后续网页访问':'关闭隐私模式，后续访问将保存历史记录')
    if (next.thirdPartyCookiesEnabled && !current.thirdPartyCookiesEnabled)
      risks.push('允许第三方 Cookie，可能增加跨站跟踪')
    if (current.confirmExternalApps && !next.confirmExternalApps)
      risks.push('关闭外部应用跳转前确认')
    if (current.mediaPlaybackRequiresUserGesture && !next.mediaPlaybackRequiresUserGesture)
      risks.push('允许网站未经点按自动播放媒体')
    if (next.javaScriptEnabled && !current.javaScriptEnabled)
      risks.push('重新启用网页 JavaScript')
    if (!changes.length && Object.keys(rawPatch).length===0 && request.searchEngine===undefined
      && request.addressPosition===undefined && request.reload!==true)
      return {ok:true,action:'apply',applied:[],needsReload:false,message:'配置无需更改'}

    if (risks.length) {
      const reason='Agent 请求修改浏览器安全设置或用户脚本：\n\n'
        +risks.join('\n\n').slice(0,4200)+'\n\n请确认上述变更。'
      if (!await env.approve(reason)) throw new Error('用户拒绝修改浏览器配置')
    }
    ensureActive()
    // Reject stale plans after authorization (another browser UI may have edited settings).
    if (JSON.stringify(env.getPreferences())!==JSON.stringify(current) ||
      JSON.stringify(env.getScripts())!==JSON.stringify(beforeScripts))
      throw new Error('浏览器设置或脚本已被其他操作更改，请重新检查配置')
    const applyPrefs=JSON.stringify(current)!==JSON.stringify(next)
    const scriptsChanged=JSON.stringify(beforeScripts)!==JSON.stringify(afterScripts)
    let wrotePrefs=false,wroteScripts=false
    const originalSearch=env.getSearch(),originalPosition=env.getAddressPosition()
    let wroteSearch=false,wrotePosition=false
    try {
      if (applyPrefs) {
        if (!await env.setPreferences(next)) throw new Error('浏览器设置保存失败')
        wrotePrefs=true
      }
      ensureActive()
      if (scriptsChanged) {
        env.saveScripts(afterScripts);wroteScripts=true
        if (!await env.syncScripts()) throw new Error('浏览器脚本同步失败')
      }
      ensureActive()
      if (request.searchEngine && request.searchEngine!==originalSearch) {
        wroteSearch=true
        if (!env.setSearch(request.searchEngine)) throw new Error('搜索引擎保存失败')
      }
      if (request.addressPosition && request.addressPosition!==originalPosition) {
        wrotePosition=true
        if (!env.setAddressPosition(request.addressPosition)) throw new Error('地址栏位置保存失败')
      }
    } catch (failure) {
      const recoveries:Promise<unknown>[]=[]
      let localRestored=true
      try {if(wrotePosition && !env.setAddressPosition(originalPosition))localRestored=false} catch {localRestored=false}
      try {if(wroteSearch && !env.setSearch(originalSearch))localRestored=false} catch {localRestored=false}
      if (wroteScripts) {
        try {env.saveScripts(beforeScripts);recoveries.push(env.syncScripts())}
        catch {recoveries.push(Promise.resolve(false))}
      }
      if (wrotePrefs) recoveries.push(env.setPreferences(current))
      const restored=await Promise.allSettled(recoveries)
      const safe=localRestored&&restored.every(item=>item.status==='fulfilled'&&item.value!==false)
      const message=failure instanceof Error?failure.message:String(failure)
      throw new Error(message+(safe?'；已恢复之前的配置':'；恢复结果未确认，请重新检查浏览器配置'))
    }
    const applied=[...changes]
    if (applyPrefs) applied.push('浏览器偏好已更新')
    if (request.searchEngine!==undefined && request.searchEngine!==originalSearch) applied.push('搜索引擎已更新')
    if (request.addressPosition!==undefined && request.addressPosition!==originalPosition) applied.push('地址栏位置已更新')
    const needsReload=scriptsChanged || request.reload===true
    let reloadPending=false
    if (needsReload && /^https?:\/\//i.test(env.currentUrl())) {
      try {reloadPending=!(await env.reload())}
      catch {reloadPending=true}
    } else if (needsReload) reloadPending=true
    return {ok:true,action:'apply',applied,needsReload:reloadPending,
      message: reloadPending?'配置已保存，但当前网页未刷新；下次加载生效':'配置已保存并同步'}
  }
  return {
    execute(input:unknown,signal?:AbortSignal):Promise<BrowserConfigResult> {
      const job=tail.then(()=>executeRequest(parseRequest(input),signal))
      tail=job.catch(()=>undefined)
      return job
    },
  }
}
