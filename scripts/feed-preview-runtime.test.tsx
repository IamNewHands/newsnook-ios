import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'
import type { Article } from '../src/lib/types'
import type { NewsSource } from '../src/sources/registry'
import { feedArticleId } from '../src/lib/articleId'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
const data = new Map<string, string>()
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    key: (index: number) => [...data.keys()][index],
    get length() { return data.size },
  },
})
const { createRoot } = await import('react-dom/client')
const { useFeeds } = await import('../src/hooks/useFeeds')
const { ArticleRow } = await import('../src/components/ArticleItem')
const { loadCachedList } = await import('../src/lib/storage')
const { LIST_CACHE_PREFIX } = await import('../src/lib/storage')
const source: NewsSource = { id: 'preview_test', name: '测试', label: '测试', group: 'custom', kind: 'feed', url: 'https://example.org/rss', enabled: true }
const article: Article = { id: feedArticleId(source.id, 'https://example.org/news'), title: 'News', summary: '', publishedAt: Date.now(), hasRealDate: true, sourceId: source.id, sourceName: source.name, sourceLabel: source.label, sourceGroup: source.group, originUrl: 'https://example.org/news' }
const unread = { ...article, id: feedArticleId(source.id, 'https://example.org/unread'), originUrl: 'https://example.org/unread' }
const at = Date.now() - 60_000
const paging = { page: 2 }
data.set(`newsnook:${LIST_CACHE_PREFIX}${source.id}`, JSON.stringify({ at, items: [article, unread], paging }))
// A body saved by an older build has images but no article.image metadata.
data.set(`newsnook:body:v1:${article.id}`, JSON.stringify({ html: '<p>正文</p><img src="https://example.org/photo.jpg">', bodySource: 'readability', article, savedAt: at }))
const ids = [source.id]
const sources = [source]
const automaticIds: string[] = []
let result: ReturnType<typeof useFeeds>
function Harness() {
  result = useFeeds(ids, undefined, sources, undefined, automaticIds)
  return <ul>{result.articles.map((item) => <ArticleRow key={item.id} article={item} read={false} saved={false} variant="row" onOpen={() => {}} />)}</ul>
}
const root = createRoot(document.getElementById('root')!)
const originalFetch = globalThis.fetch
try {
  const { resolveAieraBody, resolveJiqizhixinBody } = await import('../src/lib/resolveBody/siteBodies')
  const bodyHtml = `<p>${'正文内容与图片。'.repeat(15)}</p><img src="/body-photo.jpg">`
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 123, content: { rendered: bodyHtml }, title: { rendered: 'News' } }))
  const aiera = await resolveAieraBody({ ...article, sourceId: 'aiera', originUrl: 'https://aiera.com.cn/asi-post.html?id=123' })
  assert.equal(aiera?.image, 'https://aiera.com.cn/body-photo.jpg', 'site bodies must expose the original preview before image hydration')
  globalThis.fetch = async () => new Response(JSON.stringify({ content: bodyHtml }))
  const jiqizhixin = await resolveJiqizhixinBody({ ...article, sourceId: 'jiqizhixin', originUrl: 'https://www.jiqizhixin.com/articles/test' })
  assert.equal(jiqizhixin?.image, 'https://www.jiqizhixin.com/body-photo.jpg', 'site API bodies must supply a body-image fallback when cover metadata is absent')
  const { extractWithReadability } = await import('../src/lib/resolveBody/extractors')
  const resolved = await extractWithReadability(`<html><body><article><h1>News</h1>${bodyHtml}</article></body></html>`, article.originUrl)
  assert.equal(resolved.image, 'https://example.org/body-photo.jpg')
  await act(async () => { root.render(<Harness />) })
  assert.equal(result!.articles[0]?.image, 'https://example.org/photo.jpg', 'cold start must recover a preview from the local body')
  assert.equal(document.querySelector('img')?.getAttribute('src'), 'https://example.org/photo.jpg', 'the actual feed row must render the recovered image')
  const incomingCover = 'https://example.org/new-cover.jpg'
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)) })
  await act(async () => { result!.updateArticlePreview({ ...result!.articles[0], image: incomingCover }) })
  assert.equal(result!.articles[0]?.image, 'https://example.org/photo.jpg', 'body enrichment must preserve an existing list cover')
  await act(async () => { result!.updateArticlePreview({ ...unread, image: 'blob:https://example.org/temporary' }) })
  assert.equal(result!.articles.find((item) => item.id === unread.id)?.image, undefined, 'temporary reader blob URLs must not enter list metadata')
  await act(async () => { result!.updateArticlePreview({ ...unread, image: incomingCover }) })
  assert.equal(result!.articles.find((item) => item.id === unread.id)?.image, incomingCover, 'reading must immediately update a previously unillustrated row')
  assert.ok(Array.from(document.querySelectorAll('img')).some((img) => img.getAttribute('src') === incomingCover))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)) })
  assert.equal(loadCachedList(source.id)?.items[0]?.image, 'https://example.org/photo.jpg', 'discovered images must remain in the compact durable list')
  assert.deepEqual(loadCachedList(source.id)?.paging, paging, 'preview enrichment must not change pagination')
  assert.equal(loadCachedList(source.id)?.cachedAt, at, 'preview enrichment must not make an old list appear freshly fetched')
  globalThis.fetch = async () => new Response(`<rss><channel><item><title>News</title><link>https://example.org/news</link><description>Text only</description></item><item><title>Unread</title><link>https://example.org/unread</link><description>Text only</description></item></channel></rss>`)
  await act(async () => { await result!.refresh(ids) })
  assert.equal(result!.articles.find((item) => item.id === article.id)?.image, 'https://example.org/photo.jpg', 'refresh must retain body-cache previews')
  assert.equal(result!.articles.find((item) => item.id === unread.id)?.image, incomingCover, 'refresh must retain previews even without a cached body')
} finally {
  globalThis.fetch = originalFetch
  await act(async () => { root.unmount() })
}
console.log('feed-preview-runtime: ok')
