import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'

import { parseGoogleFreeResponse } from '../src/features/translation/freeProviders'
import { AzureProvider, GoogleProvider } from '../src/features/translation/providers'

// 官方 Google 通道用 document 解 HTML 实体（与 translation-service.test.ts 同一套 shim）
const window = parseHTML('<html><body></body></html>')
Object.assign(globalThis, {
  DOMParser: window.DOMParser,
  NodeFilter: { SHOW_TEXT: 4 },
  document: window.document,
})

/*
 * 免费通道（不填 API Key）的行为锁：
 * 目标是「装完就能翻译」——没配 Key 也必须发出请求并拿到译文，
 * 而不是弹一句「请先填写 API Key」。
 */

// ---- 纯解析 ----

assert.equal(
  parseGoogleFreeResponse(JSON.stringify([[['你好世界', 'Hello world', null, null, 10]], null, 'en'])),
  '你好世界',
)

// 长句会被切成多段，必须按顺序拼回
assert.equal(
  parseGoogleFreeResponse(
    JSON.stringify([
      [
        ['第一段', 'First', null, null, 10],
        ['第二段', 'Second', null, null, 10],
      ],
      null,
      'en',
    ]),
  ),
  '第一段第二段',
)

// 非数组项（音译 / 词典）跳过，不能把 undefined 拼进去
assert.equal(
  parseGoogleFreeResponse(
    JSON.stringify([[['译文', 'Source', null, null, 10], 'junk', [null, 'x']], null, 'en']),
  ),
  '译文',
)

assert.throws(() => parseGoogleFreeResponse('<html>429</html>'), /无法解析/)
assert.throws(() => parseGoogleFreeResponse('{"nope":1}'), /格式异常/)
assert.throws(() => parseGoogleFreeResponse(JSON.stringify([[[]], null, 'en'])), /没有返回译文/)

// ---- 路由：未填 Key 走免费通道，填了 Key 走官方 ----

const calls: string[] = []
type Responder = (url: string) => Response
let respond: Responder = () => new Response('{}', { status: 200 })

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const decoded = decodeURIComponent(url)
  calls.push(decoded)
  return respond(decoded)
}) as typeof fetch

const GOOGLE_OFFICIAL = 'https://translation.googleapis.com/language/translate/v2'
const AZURE_OFFICIAL = 'https://api.cognitive.microsofttranslator.com/translate'

// Google：空 Key + 空 endpoint 也必须能用（用户什么都不用配）
calls.length = 0
respond = () =>
  new Response(JSON.stringify([[['你好世界', 'Hello world', null, null, 10]], null, 'en']), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  })
const googleFree = new GoogleProvider({ apiKey: '', endpoint: '' })
assert.deepEqual(
  await googleFree.translate({
    texts: ['Hello world'],
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
  }),
  ['你好世界'],
)
assert.ok(
  calls.some((url) => url.includes('translate.googleapis.com/translate_a/single')),
  '未填 Key 应走 gtx 免费端点',
)
assert.ok(calls.some((url) => url.includes('client=gtx')))
assert.ok(calls.some((url) => url.includes('tl=zh-CN')), 'zh-Hans 要映射成 zh-CN')
assert.ok(!calls.some((url) => url.includes('/language/translate/v2')), '免费通道不应调官方端点')

// Google：填了 Key 就走官方端点，不再碰免费通道
calls.length = 0
respond = () =>
  new Response(JSON.stringify({ data: { translations: [{ translatedText: '你好世界' }] } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  })
const googleKeyed = new GoogleProvider({ apiKey: 'test-key', endpoint: GOOGLE_OFFICIAL })
assert.deepEqual(
  await googleKeyed.translate({
    texts: ['Hello world'],
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
  }),
  ['你好世界'],
)
assert.ok(calls.some((url) => url.includes('/language/translate/v2')))
assert.ok(!calls.some((url) => url.includes('client=gtx')), '填了 Key 不应再走免费通道')

// Microsoft：空 Key → 直接调 Edge 的无鉴权 translatetext，不需要任何令牌
calls.length = 0
let edgeBody: unknown = null
let edgeHeaders: Record<string, string> = {}
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  calls.push(decodeURIComponent(url))
  edgeBody = init?.body ? JSON.parse(String(init.body)) : null
  edgeHeaders = (init?.headers ?? {}) as Record<string, string>
  // translatetext 逐条对应返回，条数与请求体一致
  const echoed = ((edgeBody as string[] | null) ?? ['']).map((text) => ({
    detectedLanguage: { language: 'en', score: 1 },
    translations: [{ text: `译:${text}`, to: 'zh-Hans' }],
  }))
  return new Response(JSON.stringify(echoed), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  })
}) as typeof fetch

const azureFree = new AzureProvider({ apiKey: '', endpoint: '', region: '' })
assert.deepEqual(
  await azureFree.translate({
    texts: ['Hello world'],
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
  }),
  ['译:Hello world'],
)
assert.ok(
  calls.some((url) => url.includes('edge.microsoft.com/translate/translatetext')),
  '应调 Edge 的无鉴权 translatetext 端点',
)
assert.ok(calls.some((url) => url.includes('to=zh-Hans')))
assert.ok(calls.some((url) => url.includes('from=en')))
assert.ok(calls.some((url) => url.includes('isEnterpriseClient=false')))
assert.deepEqual(edgeBody, ['Hello world'], 'translatetext 的请求体是字符串数组')
assert.ok(edgeHeaders['User-Agent']?.includes('Edg/'), '要带 Edge 的 UA')
assert.ok(
  !calls.some((url) => url.includes('/translate/auth')),
  '旧的 auth 令牌端点已被微软下线，不应再请求',
)
assert.ok(
  !calls.some((url) => url.includes('api-edge.cognitive.microsofttranslator.com')),
  '免费通道不应再走 api-edge 网关',
)
assert.ok(
  !calls.some((url) => url.includes('api.cognitive.microsofttranslator.com')),
  '免费通道不应调官方 Azure 端点',
)

// 自动检测：不带 from，交给 Edge 自己识别
calls.length = 0
await azureFree.translate({
  texts: ['Bonjour'],
  sourceLanguage: 'auto',
  targetLanguage: 'zh-Hans',
})
assert.ok(!calls.some((url) => url.includes('from=')), 'auto 不应带 from 参数')

// 一次请求送多段：多段共用一个请求体，不拆成多次往返
calls.length = 0
await azureFree.translate({
  texts: ['One', 'Two', 'Three'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.equal(calls.length, 1, '同一批的多段应合并成一次请求')
assert.deepEqual(edgeBody, ['One', 'Two', 'Three'])

// Microsoft：填了 Key → 官方端点 + 订阅密钥头，不再取令牌
calls.length = 0
const seenHeaders: Record<string, string>[] = []
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const decoded = decodeURIComponent(url)
  calls.push(decoded)
  seenHeaders.push((init?.headers ?? {}) as Record<string, string>)
  return new Response(JSON.stringify([{ translations: [{ text: '你好世界' }] }]), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  })
}) as typeof fetch

const azureKeyed = new AzureProvider({
  apiKey: 'azure-key',
  endpoint: AZURE_OFFICIAL,
  region: 'eastasia',
})
assert.deepEqual(
  await azureKeyed.translate({
    texts: ['Hello world'],
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
  }),
  ['你好世界'],
)
assert.ok(calls.some((url) => url.includes('api.cognitive.microsofttranslator.com')))
assert.ok(!calls.some((url) => url.includes('edge.microsoft.com')))
assert.ok(
  seenHeaders.some((headers) => headers['Ocp-Apim-Subscription-Key'] === 'azure-key'),
  '官方 Azure 通道要带订阅密钥头',
)
assert.ok(
  seenHeaders.some((headers) => headers['Ocp-Apim-Subscription-Region'] === 'eastasia'),
  '填了 region 就要带 region 头',
)

// ---- 失败时的提示必须指向「可填 Key 走官方」 ----

globalThis.fetch = (async () =>
  new Response('{"error":"nope"}', { status: 429 })) as typeof fetch
await assert.rejects(
  () =>
    new GoogleProvider({ apiKey: '', endpoint: '' }).translate({
      texts: ['Hello world'],
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hans',
    }),
  (error: Error) => {
    assert.match(error.message, /限速/)
    assert.match(error.message, /API Key/)
    return true
  },
)

console.log('free translation providers: ok')
