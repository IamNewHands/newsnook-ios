import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const requests: Array<{ id: string; url: string }> = []
const cancelled: string[] = []
const httpRequests: string[] = []
let proxyMode: 'off' | 'always' = 'off'
let failBrowserRead = false
const nativePreferences = new Map<string, string>()
const localValues = new Map<string, string>()
let pending: ((value: { html: string; url: string }) => void) | undefined
const html = '<html><head><title>星星_百度百科</title></head><body><main class="main-content"><h1>星星</h1><div class="lemma-summary"><p class="para">夜空中的天体。</p></div><div class="para-title"><h2>简介</h2></div><p class="para">星星正文。</p></main></body></html>'
const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => localValues.get(key) ?? null, setItem: (key: string, value: string) => localValues.set(key, value) } })
Object.assign(globalThis, { __baikeBrowser: {
  async read(options: { id: string; url: string }) {
    requests.push(options)
    if (failBrowserRead) throw new Error('unexpected second navigation')
    if (options.url.includes('pending')) return new Promise(resolve => { pending = resolve })
    return { html, url: options.url + '/5683398' }
  },
  async cancel(options: { id: string }) { cancelled.push(options.id) },
}, __baikeHttp: {
  getRuntimeProxyPrefs: () => ({ mode: proxyMode, proxyUrl: 'socks5://127.0.0.1:1080', customBypassDomains: [], customProxyDomains: [] }),
  async fetchAbsoluteText(url: string) { httpRequests.push(url); return html },
}, __baikePreferences: {
  async get({ key }: { key: string }) { return { value: nativePreferences.get(key) ?? null } },
  async set({ key, value }: { key: string; value: string }) { nativePreferences.set(key, value) },
  async keys() { return { keys: [...nativePreferences.keys()] } },
} })
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@capacitor/core') return { url: 'file:///baike-browser-capacitor.mjs', shortCircuit: true }
    if (specifier === '@capacitor/preferences') return { url: 'file:///baike-browser-preferences.mjs', shortCircuit: true }
    if (specifier === '../../lib/http') return { url: 'file:///baike-browser-http.mjs', shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url === 'file:///baike-browser-capacitor.mjs') return { format: 'module', shortCircuit: true, source: 'export const Capacitor={isNativePlatform:()=>true,getPlatform:()=>"android"}; export function registerPlugin(name){ if(name==="Preferences")return globalThis.__baikePreferences; if(name!=="EncyclopediaPage") throw new Error("unexpected plugin: "+name); return globalThis.__baikeBrowser }' }
    if (url === 'file:///baike-browser-http.mjs') return { format: 'module', shortCircuit: true, source: 'export const {getRuntimeProxyPrefs,fetchAbsoluteText}=globalThis.__baikeHttp' }
    if (url === 'file:///baike-browser-preferences.mjs') return { format: 'module', shortCircuit: true, source: 'export const Preferences=globalThis.__baikePreferences' }
    return next(url, context)
  },
})
try {
  const { readBaiduBrowserPage } = await import('../src/features/wiki/baiduBrowser')
  const controller = new AbortController()
  const url = 'https://baike.baidu.com/item/' + encodeURIComponent('星星')
  const page = await readBaiduBrowserPage(url, controller.signal)
  assert.equal(page.html, html)
  assert.equal(page.url, url + '/5683398')
  assert.equal(requests[0].url, url)
  assert.ok(requests[0].id)
  const waiting = new AbortController()
  const reading = readBaiduBrowserPage('https://baike.baidu.com/item/pending', waiting.signal)
  await new Promise(resolve => setTimeout(resolve, 0))
  waiting.abort()
  await assert.rejects(reading, { name: 'AbortError' })
  assert.equal(cancelled.at(-1), requests.at(-1)!.id, '取消查询必须销毁对应浏览器任务')
  pending?.({ html, url })
  const count = requests.length
  await assert.rejects(readBaiduBrowserPage(url, waiting.signal), { name: 'AbortError' })
  assert.equal(requests.length, count, '已取消请求不得创建 WebView')
  await assert.rejects(readBaiduBrowserPage('https://evil.test/item/x', controller.signal), /词条地址/)
  const { getEncyclopediaProvider, encyclopediaProviders, saveWikiSettings, loadWikiSettings, WIKI_SETTINGS_KEY, DEFAULT_WIKI_SETTINGS } = await import('../src/features/wiki/encyclopedia')
  assert.ok(encyclopediaProviders().some(provider => provider.id === 'baidu-baike'), 'Android 继续提供百度百科')
  saveWikiSettings({ ...DEFAULT_WIKI_SETTINGS, providerId: 'baidu-baike' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(JSON.parse(nativePreferences.get(WIKI_SETTINGS_KEY)!).providerId, 'baidu-baike', '百科选择写入原生持久化存储')
  localValues.clear()
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { requestIdleCallback: (fn: () => void) => fn() } })
  try {
    const { hydrateNativeStorage } = await import('../src/lib/storage')
    await hydrateNativeStorage()
    assert.equal(loadWikiSettings().providerId, 'baidu-baike', '丢失 WebView 镜像后，冷启动仍恢复原生保存的提供商')
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
  const provider = getEncyclopediaProvider('baidu-baike')
  const entry = await provider.lookup('星星', controller.signal)
  assert.equal(entry.title, '星星')
  assert.ok(entry.summary.includes('夜空中的天体'))
  assert.ok(entry.url.endsWith('/5683398'))
  const lookupCount = requests.length
  failBrowserRead = true
  assert.ok((await provider.fullText!(entry, controller.signal)).includes('星星正文'))
  assert.equal(requests.length, lookupCount, '展开全文必须复用同次查询提取的正文，不再导航')
  await assert.rejects(provider.fullText!(entry, waiting.signal), { name: 'AbortError' })
  failBrowserRead = false
  assert.equal(httpRequests.length, 0, 'Android 直连词条通过浏览器加载，不再走失败的 HTTP 抓取')
  proxyMode = 'always'
  const browserCount = requests.length
  await provider.lookup('星星', controller.signal)
  assert.equal(requests.length, browserCount, '不能通过 WebView 静默绕过用户代理')
  assert.equal(httpRequests.length, 1)
  console.log('baidu browser transport tests passed')
} finally {
  if (storage) Object.defineProperty(globalThis, 'localStorage', storage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
}
