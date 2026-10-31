import assert from 'node:assert/strict'

import {
  catalogHasMore,
  mergeHeadPage,
  mergeOlderPage,
  nextClientCatalogPage,
  openClientCatalog,
  placeUndatedPageAfterExisting,
  sliceCatalogPage,
  sortArticles,
  summarizePagination,
  trimLegacyCatalogCache,
} from '../src/lib/feedPagination'
import { neteasePageEntryCount, parseSourcePayload, zhihuEditionDate } from '../src/lib/parseFeed'
import type { Article } from '../src/lib/types'
import { findSource, pagingStrategyOf } from '../src/sources/registry'

function article(id: string, publishedAt: number, hasRealDate = true): Article {
  return {
    id,
    title: id,
    summary: '',
    publishedAt,
    hasRealDate,
    sourceId: 'source',
    sourceName: 'source',
    sourceLabel: 'source',
    sourceGroup: 'cn',
    originUrl: `https://example.com/${id}`,
  }
}

assert.deepEqual(
  mergeHeadPage([article('old', 10), article('same', 20)], [article('new', 30), article('same', 21)]).map(
    (item) => item.id,
  ),
  ['new', 'same', 'old'],
)
// A refresh must replace the misclassified old video metadata with the
// corrected article, not preserve the cached video flag for matching IDs.
const repaired = mergeHeadPage(
  [{ ...article('same-id', 20), contentType: 'video', videoUrl: 'https://cdn.example.com/embedded.mp4' }],
  [{ ...article('same-id', 21), contentType: 'article' }],
)
assert.equal(repaired.length, 1)
assert.equal(repaired[0].contentType, 'article')
assert.equal(repaired[0].videoUrl, undefined)

assert.deepEqual(mergeOlderPage([article('a', 30)], [article('a', 30), article('b', 20)]), {
  merged: [article('a', 30), article('b', 20)],
  added: 1,
})
assert.ok(placeUndatedPageAfterExisting([article('a', 30)], [article('b', 100, false)])[0].publishedAt < 30)

const now = 1_000_000
const sorted = sortArticles([
  article('undated-new', now, false),
  article('old-real', now - 86_400_000, true),
  article('undated-kept-order', now - 1, false),
  article('fresh-real', now - 3_600_000, true),
])
assert.deepEqual(
  sorted.map((item) => item.id),
  ['fresh-real', 'old-real', 'undated-new', 'undated-kept-order'],
)

assert.equal(summarizePagination([]), 'unsupported')
assert.equal(summarizePagination([{ phase: 'uninitialized' }]), 'available')
assert.equal(summarizePagination([{ phase: 'error', error: 'network' }]), 'error')
assert.equal(summarizePagination([{ phase: 'exhausted' }]), 'exhausted')

const zhihu = findSource('zhihu-daily')!
const zhihuPayload = JSON.stringify({
  date: '20260801',
  stories: [
    { id: 1, title: 'first', images: [] },
    { id: 2, title: 'second', images: [] },
  ],
})
const zhihuArticles = parseSourcePayload(zhihu, zhihuPayload)
assert.equal(zhihuEditionDate(zhihuPayload), '20260801')
assert.ok(zhihuArticles[0].publishedAt > zhihuArticles[1].publishedAt)
assert.equal(neteasePageEntryCount(JSON.stringify({ list: [{}, {}, {}] })), 3)

const catalog = [article('a', 30), article('b', 20), article('c', 10), article('d', 5)]
assert.deepEqual(
  sliceCatalogPage(catalog, 0, 2).map((item) => item.id),
  ['a', 'b'],
)
assert.deepEqual(
  sliceCatalogPage(catalog, 1, 2).map((item) => item.id),
  ['c', 'd'],
)
assert.deepEqual(sliceCatalogPage(catalog, 2, 2), [])
assert.equal(catalogHasMore(4, 0, 2), true)
assert.equal(catalogHasMore(4, 1, 2), false)

const opened = openClientCatalog(catalog, 2)
assert.deepEqual(
  opened.head.map((item) => item.id),
  ['a', 'b'],
)
assert.equal(opened.paging.phase, 'ready')
assert.equal(opened.paging.page, 0)
const page1 = nextClientCatalogPage(opened.catalog, 0, 2)
assert.deepEqual(
  page1.slice.map((item) => item.id),
  ['c', 'd'],
)
assert.equal(page1.paging.phase, 'exhausted')
assert.deepEqual(
  trimLegacyCatalogCache(catalog, 2).map((item) => item.id),
  ['a', 'b'],
)

assert.equal(pagingStrategyOf(findSource('netease')!), 'upstream-offset')
assert.equal(pagingStrategyOf(findSource('zhihu-daily')!), 'upstream-cursor')
assert.equal(pagingStrategyOf(findSource('openai-news')!), 'client-catalog')
assert.equal(pagingStrategyOf(findSource('anthropic')!), 'client-catalog')
assert.equal(pagingStrategyOf(findSource('arena')!), 'client-catalog')
assert.equal(pagingStrategyOf(findSource('qbitai')!), 'client-catalog')

console.log('feed-pagination: ok')
