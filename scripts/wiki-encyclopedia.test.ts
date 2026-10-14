import assert from 'node:assert/strict'
import {
  DEFAULT_WIKI_SETTINGS, encyclopediaProviders, getEncyclopediaProvider,
  lookupEncyclopedia, registerEncyclopediaProvider, WikiNotFoundError, isRelevantWikiTitle,
} from '../src/features/wiki/encyclopedia'

const nativeFetch = globalThis.fetch
const requests: string[] = []
try {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const input = String(url)
    requests.push(input)
    if (input.includes('page/summary/')) {
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
  assert.deepEqual(encyclopediaProviders().map(provider => provider.id), ['wikipedia-zh', 'wikipedia-en'])
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
  assert.throws(() => registerEncyclopediaProvider(getEncyclopediaProvider('wikipedia-zh')), /重复/)
  console.log('wiki encyclopedia tests passed')
} finally {
  globalThis.fetch = nativeFetch
}
