import assert from 'node:assert/strict'
import { getEncyclopediaProvider, lookupEncyclopedia, DEFAULT_WIKI_SETTINGS, WikiNotFoundError, parseWikiSections } from '../src/features/wiki/encyclopedia'

// Representative legacy and CSS-module layouts; these fixtures contain no upstream scripts.
const page = (modern = false) => `<!doctype html><html><head><title>量子纠缠_百度百科</title>
<link rel="canonical" href="https://baike.baidu.com/item/量子纠缠/1714985">
<meta property="og:image" content="https://example.test/quantum.png"></head><body>
<nav>站点导航</nav><main class="${modern ? 'mainContent_ab12' : 'main-content'}">
<h1>量子纠缠</h1><h2>物理学术语</h2>
<div class="${modern ? 'lemmaSummary_xy12' : 'lemma-summary'}"><div class="${modern ? 'para_xy12' : 'para'}">两个粒子的关联。<sup>[1]</sup><a href="javascript:alert(1)">定义</a><img src=x onerror=alert(1)></div></div>
<div class="basic-info"><dl><dt class="basicInfo-item name">中文名</dt><dd class="basicInfo-item value">量子纠缠</dd></dl></div>
<div class="${modern ? 'paraTitle_ab12' : 'para-title'}"><h2>基本原理</h2><a>编辑</a></div>
<div class="${modern ? 'para_xy12' : 'para'}">正文保留 H<sub>2</sub> 和 x<sup>2</sup>。<script>alert(1)</script></div>
<div class="reference-list"><div class="para">参考广告</div></div></main><footer>页脚</footer></body></html>`

const originalFetch = globalThis.fetch
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } })
let html = page()
let status = 200
let calls = 0
let requested = ''
let receivedSignal: AbortSignal | null | undefined
globalThis.fetch = (async (input, init) => {
  calls++
  requested = String(input)
  receivedSignal = init?.signal
  return new Response(html, { status })
}) as typeof fetch
try {
  const provider = getEncyclopediaProvider('baidu-baike')
  assert.equal(provider.id, 'baidu-baike', '注册独立百度百科提供商')
  // Exercise the parser and lookup cache with synthetic HTTP responses on the test host.
  provider.isAvailable = () => true
  const controller = new AbortController()
  const intro = '量子纠缠是量子力学中的一种现象，描述多个粒子之间的关联状态，这些粒子的状态不能独立描述，测量结果之间存在相关性，具有重要的科学研究价值。'
  html = `<html><head><title>量子纠缠_百度百科</title></head><body><main class="main-content"><nav><p>${intro}导航广告</p></nav><h1>量子纠缠</h1><section class="new-introduction"><p>${intro}</p></section><h2>基本原理</h2><p>真实章节正文</p></main></body></html>`
  const changedLayoutEntry = await provider.lookup('量子纠缠', controller.signal)
  assert.ok(changedLayoutEntry.summary.includes(intro))
  assert.ok(!changedLayoutEntry.summary.includes('导航广告'))
  assert.ok(parseWikiSections(await provider.fullText!(changedLayoutEntry, controller.signal)).some(section => section.title === '基本原理'))
  html = page()
  html = page().replace('<main class="main-content">\n<h1>量子纠缠</h1>', '<header><h1>量子纠缠</h1></header><main class="main-content">')
  assert.equal((await provider.lookup('量子纠缠', controller.signal)).title, '量子纠缠', '标题可位于正文容器外')
  html = page()
  const settings = { ...DEFAULT_WIKI_SETTINGS, providerId: provider.id }
  const entry = await lookupEncyclopedia('量子纠缠', settings, controller.signal)
  assert.equal(entry.title, '量子纠缠')
  assert.equal(entry.providerId, 'baidu-baike')
  assert.equal(entry.isLiveApi, false)
  assert.ok(entry.summary.includes('两个粒子的关联'))
  assert.ok(!/javascript:|onerror|<script|<img/.test(entry.summary))
  assert.ok(entry.url.endsWith('/1714985'))
  assert.equal(entry.thumbnail, 'https://example.test/quantum.png')
  assert.ok(entry.structuredFacts?.some(fact => fact.label === '中文名' && fact.value === '量子纠缠'))
  assert.ok(requested.startsWith('/api/page?'), '使用已有跨平台页面传输')
  assert.ok(new URL(requested, 'https://local.test').searchParams.get('url')?.startsWith('https://baike.baidu.com/item/'))
  assert.equal(receivedSignal, controller.signal)
  const before = calls
  assert.equal(await lookupEncyclopedia('量子纠缠', settings, controller.signal), entry)
  assert.equal(calls, before, '同源查询复用现有缓存')
  const full = await provider.fullText!(entry, controller.signal)
  assert.ok(full.includes('<sub>2</sub>') && full.includes('<sup>2</sup>'))
  assert.ok(!/站点导航|页脚|参考广告|alert|编辑/.test(full))
  assert.ok(parseWikiSections(full).some(section => section.title === '基本原理'))
  html = page(true)
  assert.ok((await provider.lookup('量子纠缠', controller.signal)).summary.includes('两个粒子的关联'))
  html = '<html><head><title>百度安全验证</title></head><body></body></html>'
  await assert.rejects(provider.lookup('验证测试', controller.signal), /安全验证/)
  html = '<html><head><title>百度百科</title></head><body><h1>您所访问的页面不存在</h1></body></html>'
  await assert.rejects(provider.lookup('不存在', controller.signal), WikiNotFoundError)
  html = '<html><body><h1>量子纠缠</h1><p>未知结构</p></body></html>'
  await assert.rejects(provider.lookup('量子纠缠', controller.signal), /页面结构/)
  html = page().replace('<h1>量子纠缠</h1>', '<h1>其他词条</h1>')
  await assert.rejects(provider.lookup('量子纠缠', controller.signal), WikiNotFoundError)
  status = 403
  await assert.rejects(provider.lookup('受限', controller.signal), /访问受限/)
  status = 404
  await assert.rejects(provider.lookup('缺失', controller.signal), WikiNotFoundError)
  status = 500
  await assert.rejects(provider.lookup('服务故障', controller.signal), /HTTP 500/)
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(provider.lookup('取消', aborted.signal), { name: 'AbortError' })
  await assert.rejects(provider.fullText!({ ...entry, url: 'https://evil.test/item/x' }, controller.signal), /词条地址/)
  console.log('baidu encyclopedia tests passed')
} finally {
  globalThis.fetch = originalFetch
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
}
