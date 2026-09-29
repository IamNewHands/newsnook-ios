import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'

import { normalizeTranslationPrefs } from '../src/features/translation/config'
import { DeepLXProvider, GoogleProvider, planBatches } from '../src/features/translation/providers'
import { MAX_GROUP_CHARS, splitLongText, TranslationService } from '../src/features/translation/service'
import type { TranslationProvider } from '../src/features/translation/types'

const window = parseHTML('<html><body></body></html>')
Object.assign(globalThis, {
  DOMParser: window.DOMParser,
  NodeFilter: { SHOW_TEXT: 4 },
  document: window.document,
})

const provider: TranslationProvider = {
  id: 'mlkit',
  async translate(request) {
    return request.texts.map((text) => `译:${text}`)
  },
}

const service = new TranslationService(provider)
const translated = await service.translateArticle(
  'A useful title',
  '<p>Hello <strong>world</strong>.</p><pre><span>const hello = 1</span></pre><img src="cover.jpg" alt="Cover">',
  { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'replace' },
)

assert.equal(translated.title, '译:A useful title')
assert.match(translated.html, /译:Hello/)
assert.match(translated.html, /<strong[^>]*>译:world<\/strong>/)
assert.match(translated.html, /const hello = 1/)
assert.doesNotMatch(translated.html, /译:const hello/)
assert.match(translated.html, /src="cover.jpg"/)

const compared = await service.translateArticle(
  'A useful title',
  '<p>Hello <strong>world</strong>.</p><blockquote><p>Quoted text</p></blockquote><pre><span>const hello = 1</span></pre>',
  { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'compare' },
)
assert.equal(compared.title, '译:A useful title')
assert.match(compared.html, /Hello <strong>world<\/strong>\./)
assert.match(compared.html, /class="reader-translation"/)
assert.match(compared.html, /译:Hello world\./)
assert.match(compared.html, /译:Quoted text/)
assert.doesNotMatch(compared.html, /译:const hello/)

const normalized = normalizeTranslationPrefs({
  provider: 'unknown',
  sourceLanguage: 'en',
  targetLanguage: 'en',
  cloud: { google: { apiKey: 'local-key', endpoint: 'https://example.com' } },
})
assert.equal(normalized.provider, 'mlkit')
assert.equal(normalized.displayMode, 'replace')
assert.notEqual(normalized.sourceLanguage, normalized.targetLanguage)
assert.equal(normalized.cloud.google.apiKey, 'local-key')

const normalizedAuto = normalizeTranslationPrefs({})
assert.equal(normalizedAuto.sourceLanguage, 'auto')
assert.equal(normalizedAuto.targetLanguage, 'zh-Hans')

const autoKeepsTarget = normalizeTranslationPrefs({
  sourceLanguage: 'auto',
  targetLanguage: 'zh-Hans',
})
assert.equal(autoKeepsTarget.sourceLanguage, 'auto')
assert.equal(autoKeepsTarget.targetLanguage, 'zh-Hans')

const invalidSource = normalizeTranslationPrefs({ sourceLanguage: 'xx' })
assert.equal(invalidSource.sourceLanguage, 'auto')

const mlkitAuto = await service.translateArticle(
  'A useful title',
  '<p>Hello <strong>world</strong> and more english sentences for detection.</p>',
  { sourceLanguage: 'auto', targetLanguage: 'zh-Hans', displayMode: 'replace' },
)
assert.equal(mlkitAuto.usedFallback, false)
assert.equal(mlkitAuto.resolvedSourceLanguage, 'en')
assert.equal(mlkitAuto.title, '译:A useful title')

const mlkitFallback = await service.translateArticle(
  'Hi',
  '<p>ok</p>',
  { sourceLanguage: 'auto', targetLanguage: 'zh-Hans', displayMode: 'replace' },
)
assert.equal(mlkitFallback.usedFallback, true)
assert.equal(mlkitFallback.resolvedSourceLanguage, 'en')

const identityProvider: TranslationProvider = {
  id: 'mlkit',
  async translate(request) {
    return request.texts
  },
}
const identityService = new TranslationService(identityProvider)
const tradToSimp = await identityService.translateArticle(
  '今日國際新聞',
  '<p>關注世界經濟與科技發展，多家媒體報導了相關進展。</p>',
  { sourceLanguage: 'auto', targetLanguage: 'zh-Hans', displayMode: 'replace' },
)
assert.equal(tradToSimp.resolvedSourceLanguage, 'zh-Hant')
assert.equal(tradToSimp.title, '今日国际新闻')
assert.match(tradToSimp.html, /关注世界经济与科技发展/)
assert.match(tradToSimp.html, /媒体/)
assert.doesNotMatch(tradToSimp.html, /國際|關注|經濟/)

const originalFetch = globalThis.fetch
const requests: { url: string; body: unknown; authorization: string | null }[] = []
globalThis.fetch = async (input, init) => {
  const headers = new Headers(init?.headers)
  const body = JSON.parse(String(init?.body)) as { text?: string | string[] }
  requests.push({
    url: String(input),
    body,
    authorization: headers.get('Authorization'),
  })
  const text = typeof body.text === 'string' ? body.text : body.text?.[0] ?? ''
  return Response.json({ code: 200, data: `LX:${text}` })
}

const deepLx = new DeepLXProvider({
  apiKey: '',
  endpoint: 'https://deeplx.example/path-token/translate',
})
const deepLxResult = await deepLx.translate({
  texts: ['Hello', 'World'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.deepEqual(deepLxResult, ['LX:Hello', 'LX:World'])
assert.equal(requests.length, 2)
assert.equal(requests[0].url, 'https://deeplx.example/path-token/translate')
assert.equal(requests[0].authorization, null)
assert.deepEqual(requests[0].body, {
  text: 'Hello',
  source_lang: 'EN',
  target_lang: 'ZH',
})

globalThis.fetch = originalFetch

// Test streaming onPartial progressive updates
const streamingPartials: string[] = []
const progressiveProvider: TranslationProvider = {
  id: 'deeplx',
  async translate(request) {
    const results: string[] = []
    for (let i = 0; i < request.texts.length; i++) {
      const translated = `流:${request.texts[i]}`
      results.push(translated)
      request.onBatch?.([translated], i)
    }
    return results
  },
}

const progressiveService = new TranslationService(progressiveProvider)
await progressiveService.translateArticle(
  'Stream Title',
  '<p>First paragraph.</p><p>Second paragraph.</p>',
  { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'compare' },
  {
    onPartial: (partial) => {
      streamingPartials.push(partial.html)
    },
  },
)

assert.ok(streamingPartials.length >= 2) // 中间 batch 会被节流合并，首末必达
assert.match(streamingPartials[0], /First paragraph\./)
assert.doesNotMatch(streamingPartials[0], /流:Second paragraph\./)
assert.match(
  streamingPartials[streamingPartials.length - 1],
  /流:Second paragraph\./,
)

// 长文部分失败时，异常抛出前必须强制 flush 最新成功段，不能被 120ms 节流吞掉。
const retainedPartials: { title: string; html: string }[] = []
const partialFailureProvider: TranslationProvider = {
  id: 'openai',
  async translate(request) {
    request.onBatch?.(['译:Partial Title'], 0)
    request.onBatch?.(['译:First paragraph.'], 1)
    request.onBatch?.(['译:Third paragraph.'], 3)
    throw new Error('one paragraph failed')
  },
}
const partialFailureService = new TranslationService(partialFailureProvider)
await assert.rejects(
  () =>
    partialFailureService.translateArticle(
      'Partial Title',
      '<p>First paragraph.</p><p>Second paragraph.</p><p>Third paragraph.</p>',
      { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'replace' },
      {
        onPartial: (partial) => retainedPartials.push(partial),
      },
    ),
  /one paragraph failed/,
)
const retainedLatest = retainedPartials[retainedPartials.length - 1]
assert.ok(retainedLatest)
assert.equal(retainedLatest.title, '译:Partial Title')
assert.match(retainedLatest.html, /译:First paragraph\./)
assert.match(retainedLatest.html, />Second paragraph\.</)
assert.match(retainedLatest.html, /译:Third paragraph\./)

// Test Google batching limits (10 items per batch)
const batchSizes: number[] = []
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as { q?: string[] }
  if (body.q) batchSizes.push(body.q.length)
  return Response.json({
    data: {
      translations: (body.q ?? []).map((t) => ({ translatedText: `G:${t}` })),
    },
  })
}

const google = new GoogleProvider({ apiKey: 'key', endpoint: 'https://translation.googleapis.com' })
const twentyFiveTexts = Array.from({ length: 25 }, (_, i) => `Paragraph ${i + 1}`)
const googleResults = await google.translate({
  texts: twentyFiveTexts,
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.equal(googleResults.length, 25)
assert.deepEqual(batchSizes, [10, 10, 5]) // 10 paragraphs per batch rolling!

// Google auto: omit source field
let googleAutoBody: Record<string, unknown> | null = null
globalThis.fetch = async (_input, init) => {
  googleAutoBody = JSON.parse(String(init?.body)) as Record<string, unknown>
  return Response.json({
    data: { translations: [{ translatedText: 'G:auto' }] },
  })
}
await google.translate({
  texts: ['Hello world for auto detect'],
  sourceLanguage: 'auto',
  targetLanguage: 'zh-Hans',
})
assert.ok(googleAutoBody)
assert.equal('source' in googleAutoBody, false)
assert.equal(googleAutoBody.target, 'zh-CN')

// Test DeepLX concurrency limit (max 3 concurrent requests)
let activeConcurrent = 0
let maxConcurrentObserved = 0
globalThis.fetch = async (_input, init) => {
  activeConcurrent++
  if (activeConcurrent > maxConcurrentObserved) {
    maxConcurrentObserved = activeConcurrent
  }
  const body = JSON.parse(String(init?.body)) as { text?: string }
  await new Promise((r) => setTimeout(r, 10))
  activeConcurrent--
  return Response.json({ code: 200, data: `LX:${body.text}` })
}

const deepLxConcurrency = new DeepLXProvider({ apiKey: '', endpoint: 'https://deeplx.example/translate' })
await deepLxConcurrency.translate({
  texts: twentyFiveTexts,
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.ok(maxConcurrentObserved <= 3, `Max concurrent requests was ${maxConcurrentObserved}, expected <= 3`)

globalThis.fetch = originalFetch

const kindsLog: (
  | import('../src/features/translation/types').TranslationTextKind[]
  | undefined
)[] = []
const kindProbe: TranslationProvider = {
  id: 'mlkit',
  async translate(request) {
    kindsLog.push(request.textKinds)
    return request.texts.map((text) => `译:${text}`)
  },
}
const kindService = new TranslationService(kindProbe)
await kindService.translateArticle(
  'Title One',
  '<p>Body A</p><p>Body B</p>',
  { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'replace' },
)
{
  const last = kindsLog[kindsLog.length - 1]
  assert.equal(last, undefined)
}

kindsLog.length = 0
await kindService.translateArticle(
  'Title Two',
  '<p>Only body</p>',
  { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'compare' },
)
{
  const last = kindsLog[kindsLog.length - 1]
  assert.equal(last, undefined)
}

// ---- 批次切分：一个段落永远不能被切开 ----

// 没有分组信息时按 maxItems / maxChars 平切（保持旧行为）
assert.deepEqual(planBatches([1, 1, 1, 1, 1], 2, 1000), [
  { start: 0, end: 2 },
  { start: 2, end: 4 },
  { start: 4, end: 5 },
])
assert.deepEqual(planBatches([1, 1, 1], 10, 2), [
  { start: 0, end: 2 },
  { start: 2, end: 3 },
])
assert.deepEqual(planBatches([], 10, 100), [])

// 有分组时只在组边界切批：组内的 3 项即使超过 maxItems 也不拆开
assert.deepEqual(planBatches([1, 1, 1, 1, 1], 2, 1000, [0, 1, 1, 1, 2]), [
  { start: 0, end: 4 },
  { start: 4, end: 5 },
])
// 字符上限同样不能切开一个组
assert.deepEqual(planBatches([1, 1, 1], 10, 2, [0, 1, 1]), [{ start: 0, end: 3 }])
// 分组长度对不上时退回平切，不猜
assert.deepEqual(planBatches([1, 1, 1], 2, 1000, [0, 1]), [
  { start: 0, end: 2 },
  { start: 2, end: 3 },
])

// 服务层要如实给出分组：标题一组，同一个段落里的多个文本节点同组
const groupLog: (readonly number[] | undefined)[] = []
const groupProbe: TranslationProvider = {
  id: 'mlkit',
  async translate(request) {
    groupLog.push(request.groupIds)
    return request.texts.map((text) => `译:${text}`)
  },
}
await new TranslationService(groupProbe).translateArticle(
  'Title',
  '<p>Hello <strong>world</strong> tail</p><p>Next paragraph</p>',
  { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'replace' },
)
{
  const groups = groupLog[groupLog.length - 1]
  assert.ok(groups, '正文翻译必须给出段落分组')
  assert.deepEqual(groups, [0, 1, 1, 1, 2])
}

// 端到端：内联标签把段落拆成 4 个文本节点，它们必须落在同一个请求里。
// 8 个单节点段落 + 1 个 4 节点段落 = 13 项；没有分组时第 10 项会切断段落。
const paragraph = '<p>Alpha <strong>Beta</strong> Gamma <em>Delta</em></p>'
const batchLog: string[][] = []
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as { q: string[] }
  batchLog.push(body.q)
  return Response.json({
    data: { translations: body.q.map((text) => ({ translatedText: `译:${text}` })) },
  })
}) as typeof fetch

await new TranslationService(
  new GoogleProvider({
    apiKey: 'test-key',
    endpoint: 'https://translation.googleapis.com/language/translate/v2',
  }),
).translateArticle(
  'Title',
  `${Array.from({ length: 8 }, (_, i) => `<p>Body ${i}</p>`).join('')}${paragraph}`,
  { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'replace' },
)
assert.equal(
  batchLog.length,
  1,
  `段落被批次切开了，实际批次：${JSON.stringify(batchLog)}`,
)
assert.deepEqual(batchLog[0], [
  'Title',
  'Body 0',
  'Body 1',
  'Body 2',
  'Body 3',
  'Body 4',
  'Body 5',
  'Body 6',
  'Body 7',
  'Alpha',
  'Beta',
  'Gamma',
  'Delta',
])

globalThis.fetch = originalFetch

// ---- 单次请求的体积必须有上界 ----
// 免费端点（Edge translatetext）的耗时随请求体积上涨，脚本转换更明显：
// 实测繁→简在 ~20k 字符时要 15 秒、~28k 直接 500，而英译中同体积只要 ~7 秒。
// 批次本来有字符上限，但它只在段落边界切——段落本身无上界时，
// 「整篇正文塞在一个 div 里」就会变成一次几十 KB 的请求，于是超时。

// 句末切分：优先切在句末标点后，每片不超过上限，拼回来一字不差
const longSentences = Array.from(
  { length: 40 },
  (_, i) => `第${i}句测试文本，用来验证超长段落的切分位置。`,
).join('')
const pieces = splitLongText(longSentences, 200)
assert.ok(pieces.length > 1, '超长文本必须被切开')
assert.ok(
  pieces.every((piece) => piece.length <= 200),
  `切分后仍有超长片段：${pieces.map((piece) => piece.length).join(',')}`,
)
assert.ok(
  pieces.every((piece) => piece.endsWith('。')),
  '应当切在句末标点之后，而不是把句子劈开',
)
assert.equal(pieces.join(''), longSentences)
assert.deepEqual(splitLongText('短文本', 200), ['短文本'])
// 没有句末标点的长串按长度硬切
assert.deepEqual(
  splitLongText('x'.repeat(500), 200).map((piece) => piece.length),
  [200, 200, 100],
)

// 服务层：整篇正文就是一个文本节点时也要切成多个条目
const wallOfText = Array.from(
  { length: 450 },
  (_, i) => `第${i}句正文内容，用来把单个文本节点撑到超过一个请求该有的体积。`,
).join('')
const wallTexts: string[][] = []
const wallProbe: TranslationProvider = {
  id: 'mlkit',
  async translate(request) {
    wallTexts.push([...request.texts])
    return request.texts.map((text) => `译:${text}`)
  },
}
const wallResult = await new TranslationService(wallProbe).translateArticle(
  'Title',
  `<div>${wallOfText}</div>`,
  { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'replace' },
)
{
  const bodyTexts = (wallTexts[0] ?? []).slice(1)
  assert.ok(
    bodyTexts.length > 1,
    `超长正文被当成一个条目发出去了：${bodyTexts.map((text) => text.length).join(',')}`,
  )
  assert.ok(
    Math.max(...bodyTexts.map((text) => text.length)) <= MAX_GROUP_CHARS,
    `单个条目仍有 ${Math.max(...bodyTexts.map((text) => text.length))} 字符`,
  )
  // 切开再拼回来不能丢字、也不能重复
  const bodyText = wallResult.html
    .replace(/<div[^>]*>/g, '')
    .replace(/<\/div>/g, '')
    .split('译:')
    .join('')
  assert.equal(bodyText, wallOfText)
}

// 对比模式：一个语义块装下整篇时同样要切分，译文按块拼回同一个 span
const compareTexts: string[][] = []
const compareProbe: TranslationProvider = {
  id: 'mlkit',
  async translate(request) {
    compareTexts.push([...request.texts])
    return request.texts.map((text) => `译:${text}`)
  },
}
const compareResult = await new TranslationService(compareProbe).translateArticle(
  'Title',
  `<div>${wallOfText}</div>`,
  { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'compare' },
)
{
  const bodyTexts = (compareTexts[0] ?? []).slice(1)
  assert.ok(
    bodyTexts.length > 1,
    `对比模式的超长语义块没有切分：${bodyTexts.map((text) => text.length).join(',')}`,
  )
  assert.ok(Math.max(...bodyTexts.map((text) => text.length)) <= MAX_GROUP_CHARS)
  const span = /<span[^>]*class="reader-translation"[^>]*>([\s\S]*?)<\/span>/.exec(
    compareResult.html,
  )
  assert.ok(span, '对比模式必须产出译文 span')
  assert.equal(span[1].split('译:').join(''), wallOfText)
}

// 端到端：真正发出的每个请求都要在批次字符上限之内
const wallBatches: string[][] = []
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as { q: string[] }
  wallBatches.push(body.q)
  return Response.json({
    data: { translations: body.q.map((text) => ({ translatedText: `译:${text}` })) },
  })
}) as typeof fetch

const wallRequest = await new TranslationService(
  new GoogleProvider({
    apiKey: 'test-key',
    endpoint: 'https://translation.googleapis.com/language/translate/v2',
  }),
).translateArticle('Title', `<div>${wallOfText}</div>`, {
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
  displayMode: 'replace',
})

globalThis.fetch = originalFetch
assert.ok(wallBatches.length > 1, `超长正文只发了一次请求：${wallBatches.length}`)
for (const batch of wallBatches) {
  // DEFAULT_BATCH_CHARS = 6000
  const chars = batch.reduce((sum, text) => sum + text.length, 0)
  assert.ok(chars <= 6000, `单个请求 ${chars} 字符，超过批次上限`)
}
assert.equal(
  wallRequest.html
    .replace(/<div[^>]*>/g, '')
    .replace(/<\/div>/g, '')
    .split('译:')
    .join(''),
  wallOfText,
)

console.log('translation-service: ok')


