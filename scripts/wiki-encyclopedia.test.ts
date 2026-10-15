import assert from 'node:assert/strict'
import {
  DEFAULT_WIKI_SETTINGS, encyclopediaProviders, getEncyclopediaProvider,
  lookupEncyclopedia, registerEncyclopediaProvider, WikiNotFoundError, isRelevantWikiTitle,
  loadWikiSettings, WIKI_SETTINGS_KEY,
} from '../src/features/wiki/encyclopedia'

const nativeFetch = globalThis.fetch
const requests: string[] = []
try {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const input = String(url)
    requests.push(input)
    if (input.includes('page/summary/')) {
      if (input.includes('CacheFallback')) {
        if (input.includes('zh.wikipedia.org')) return new Response('{}', { status: 404 })
        return Response.json({ title: 'CacheFallback', extract: 'English-only entry', description: 'Test article' })
      }
      if (input.includes('Missing') || input.includes(encodeURIComponent('已严肃升'))) return new Response('{}', { status: 404 })
      return Response.json({
        title: '量子纠缠', extract: '真实百科摘要', description: '物理学术语',
        content_urls: { mobile: { page: 'https://zh.m.wikipedia.org/wiki/量子纠缠' } },
      })
    }
    if (input.includes('list=search')) return Response.json({ query: { search: input.includes(encodeURIComponent('已严肃升')) ? [{ title: '馬文升' }] : [] } })
    if (input.includes('prop=extracts')) return Response.json({ query: { pages: { 1: { extract: '真实百科全文。\n第二段。' } } } })
    return Response.json({ search: [] })
  }) as typeof fetch
  assert.deepEqual(encyclopediaProviders().map(provider => provider.id), ['wikipedia-zh', 'wikipedia-en'], '普通网页只展示可用的百科源')
  let storedSettings = JSON.stringify({ ...DEFAULT_WIKI_SETTINGS, providerId: 'baidu-baike', directLookup: true })
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => key === WIKI_SETTINGS_KEY ? storedSettings : null,
    setItem: (key: string, value: string) => { if (key === WIKI_SETTINGS_KEY) storedSettings = value },
  } })
  try {
    assert.equal(loadWikiSettings().providerId, 'wikipedia-zh', 'Web 不再使用开发期间的百度偏好')
    assert.equal(JSON.parse(storedSettings).providerId, 'wikipedia-zh', '直接保存可用来源，不保留开发期百度偏好')
    assert.equal(loadWikiSettings().directLookup, true, '保留其他划词设置')
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
  await assert.rejects(lookupEncyclopedia('WebUnsupported', DEFAULT_WIKI_SETTINGS, new AbortController().signal, 'baidu-baike'), /当前平台.*百度百科/)
  assert.equal(requests.length, 0, '旧收藏或历史查询不应再发送必然失败的百度请求')
  assert.ok(isRelevantWikiTitle('国庆节的','中华人民共和国国庆节'))
  assert.ok(isRelevantWikiTitle('Albert Einstein','Albert Einstein'))
  assert.equal(isRelevantWikiTitle('已严肃升','馬文升'), false)
  const settings = { ...DEFAULT_WIKI_SETTINGS, fallbackEnglish: false }
  const controller = new AbortController()
  const result = await lookupEncyclopedia('量子纠缠', settings, controller.signal)
  assert.equal(result.title, '量子纠缠')
  assert.equal(result.summary, '真实百科摘要')
  assert.equal(result.providerId, 'wikipedia-zh')
  assert.equal((await getEncyclopediaProvider('wikipedia-zh').fullText!(result, controller.signal)).includes('第二段'), true)
  const count = requests.length
  const hit = await lookupEncyclopedia('量子纠缠', settings, controller.signal)
  assert.equal(hit, result, 'repeated query should reuse cached entry')
  assert.equal(requests.length, count)
  await assert.rejects(
    lookupEncyclopedia('Missing', settings, controller.signal),
    error => error instanceof WikiNotFoundError,
  )
  await assert.rejects(
    lookupEncyclopedia('已严肃升', settings, controller.signal),
    error => error instanceof WikiNotFoundError,
  )
  // Switching the fallback policy must invalidate previously cached English substitutions.
  const withFallback = { ...settings, fallbackEnglish: true }
  const fallbackResult = await lookupEncyclopedia('CacheFallback', withFallback, controller.signal)
  assert.equal(fallbackResult.providerId, 'wikipedia-en')
  const zhFetchCountBefore = requests.filter(url => url.includes('zh.wikipedia.org')).length
  await assert.rejects(lookupEncyclopedia('CacheFallback', settings, controller.signal), WikiNotFoundError)
  assert.ok(requests.filter(url => url.includes('zh.wikipedia.org')).length > zhFetchCountBefore)
  assert.throws(() => registerEncyclopediaProvider(getEncyclopediaProvider('wikipedia-zh')), /重复/)

  // Test structured sections parser with Wiki Markup
  const wikiMarkupInput = `嗅探犬是工作犬的一类。\n主要透过气味来搜索目标物。\n\n== 种类 ==\n臭虫嗅探犬\n缉毒犬\n\n== 参考资料 ==\n`
  const parsedFromMarkup = (await import('../src/features/wiki/encyclopedia')).parseWikiSections(wikiMarkupInput, '备用摘要')
  assert.equal(parsedFromMarkup.length, 2)
  assert.equal(parsedFromMarkup[0].title, '词条导言与核心定义')
  assert.equal(parsedFromMarkup[0].paragraphs.length, 2)
  assert.equal(parsedFromMarkup[1].title, '种类')
  assert.equal(parsedFromMarkup[1].paragraphs.length, 2)

  // Test structured sections parser with HTML
  const htmlInput = `<div><h2>导言</h2><p>第一段核心内容</p><h2>历史发展</h2><p>第二段历史</p></div>`
  const parsedFromHtml = (await import('../src/features/wiki/encyclopedia')).parseWikiSections(htmlInput, '')
  assert.equal(parsedFromHtml.length, 2)
  assert.equal(parsedFromHtml[0].title, '导言')
  assert.ok(parsedFromHtml[0].paragraphs[0].includes('第一段核心内容'))
  assert.equal(parsedFromHtml[1].title, '历史发展')
  assert.ok(parsedFromHtml[1].paragraphs[0].includes('第二段历史'))

  // Test MediaWiki real rich HTML with MathML, sub/sup, and ensure annotation is removed
  const realWikiHtml = `<p><b>摩尔</b>（英语：mole）是物质的量的国际单位。1摩尔是所含基本微粒个数与12克的碳-12(<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mstyle displaystyle="true"><msubsup><mrow></mrow><mrow><mn>6</mn></mrow><mrow><mn>12</mn></mrow></msubsup><mtext>C</mtext></mstyle></mrow><annotation encoding="application/x-tex">{\\displaystyle {}_{6}^{12}\\!{\\mbox{C}}}</annotation></semantics></math>)中所含原子个数相等。数值是6.0214129×10<sup>23</sup>。</p>`
  const parsedRealHtml = (await import('../src/features/wiki/encyclopedia')).parseWikiSections(realWikiHtml, '')
  assert.equal(parsedRealHtml.length, 1)
  assert.ok(parsedRealHtml[0].paragraphs[0].includes('10<sup>23</sup>'))
  assert.ok(parsedRealHtml[0].paragraphs[0].includes('<math'))
  assert.ok(!parsedRealHtml[0].paragraphs[0].includes('<annotation'))
  assert.ok(!parsedRealHtml[0].paragraphs[0].includes('\\displaystyle'))

  // Test plaintext scientific & chemical notation auto-completion
  const { formatScientificAndLatex, sanitizeWikiHtml } = await import('../src/features/wiki/encyclopedia')
  const plainMoleText = '碳-12({}_{6}^{12}{\\mbox{C}}) 数值是6.0214129×1023，常取6.02×1023'
  const formattedMole = formatScientificAndLatex(plainMoleText)
  assert.ok(formattedMole.includes('<sub>6</sub><sup>12</sup>C'))
  assert.ok(formattedMole.includes('10<sup>23</sup>'))

  // Test sanitizeWikiHtml removes dangerous scripts and annotations but preserves math and typography
  const dirty = `<p>测试<script>alert(1)</script><math><mrow><mn>42</mn></mrow></math><sup>2</sup><annotation>leak</annotation></p>`
  const clean = sanitizeWikiHtml(dirty)
  assert.ok(!clean.includes('<script>'))
  assert.ok(!clean.includes('<annotation>'))
  assert.ok(!clean.includes('leak'))
  assert.ok(clean.includes('<math>'))
  assert.ok(clean.includes('<sup>2</sup>'))

  // Test math formula cleanup from MediaWiki plaintext extracts
  const mathExtractInput = `数学上精确的定义之前，这是一个简短的例子。映射\n\n  \n    \n      \n        C\n        =\n        {\n        a\n        ↦\n        0\n        ,\n        b\n        ↦\n        01\n        ,\n        c\n        ↦\n        011\n        }\n      \n    \n    {\\displaystyle C=\\{a\\mapsto 0,b\\mapsto 01,c\\mapsto 011\\}}\n  \n\n是一个代码，其源字母表是集合 \n  \n    \n      \n        {\n        a\n        ,\n        b\n        ,\n        c\n        }\n      \n    \n    {\\displaystyle \\{a,b,c\\}}\n  \n，其目标字母表是集合`
  const parsedMath = (await import('../src/features/wiki/encyclopedia')).parseWikiSections(mathExtractInput, '')
  assert.equal(parsedMath.length, 1)
  assert.ok(parsedMath[0].paragraphs[0].includes('C = {a ↦ 0, b ↦ 01, c ↦ 011}'))
  assert.ok(parsedMath[0].paragraphs[0].includes('其源字母表是集合 {a, b, c}，其目标字母表是集合'))
  assert.ok(!parsedMath[0].paragraphs[0].includes('\\displaystyle'))

  console.log('wiki encyclopedia tests passed')
} finally {
  globalThis.fetch = nativeFetch
}
