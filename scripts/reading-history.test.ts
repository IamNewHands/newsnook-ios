import assert from 'node:assert/strict'
import { clearReadingHistory, listReadingHistory, migrateCachedReadingHistory, recordArticleRead, recordLinuxDoRead, recordZhihuRead, removeReadingHistory, removeReadingHistories, restoreReadingHistories } from '../src/features/readingHistory/store'
import type { Article } from '../src/lib/types'
const map = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => map.get(key) ?? null,
  setItem: (key: string, value: string) => { map.set(key, value) },
  removeItem: (key: string) => { map.delete(key) },
  key: (i: number) => [...map.keys()][i] ?? null,
  get length() { return map.size },
}})
const article: Article = {
  id: 'rss-id', title: '测试标题', summary: '详情摘要', publishedAt: 1000, hasRealDate: true,
  sourceId: 'rss', sourceName: '站点', sourceLabel: 'RSS', sourceGroup: 'custom',
  originUrl: 'https://example.org/a', contentHtml: '<b>must not store</b>',
}
assert.equal(recordArticleRead(article, 'feed', 10_000).length, 1)
assert.equal(recordArticleRead(article, 'feed', 20_000)[0].visits, 1)
assert.equal(recordArticleRead(article, 'feed', 40_000)[0].visits, 2)
assert.equal(listReadingHistory()[0].kind, 'article')
assert.ok(!map.get('newsnook:reading-history:v1')?.includes('must not store'))
recordZhihuRead({ ref: { kind: 'answer', id: '27' }, title: '知乎回答', excerpt: '正文', url: 'https://zhihu.com/answer/27' }, 50_000)
recordLinuxDoRead({ id: 7, slug: 'topic', title: 'Linux.do 主题', postsCount: 1, views: 0,
  likeCount: 0, createdAt: '', lastPostedAt: '', tags: [], postStream: { stream: [], posts: [] } }, 60_000)
assert.deepEqual(listReadingHistory().map((item) => item.origin), ['linuxdo', 'zhihu', 'feed'])
recordLinuxDoRead({ id: 8, slug: 'private', title: 'private', archetype: 'private_message',
  postsCount: 1, views: 0, likeCount: 0, createdAt: '', lastPostedAt: '',
  tags: [], postStream: { stream: [], posts: [] } }, 70_000)
assert.equal(listReadingHistory().length, 3)
removeReadingHistory('linuxdo:7')
assert.equal(listReadingHistory().length, 2)
const popped = listReadingHistory()
removeReadingHistories(['zhihu:answer:27', 'article:rss:rss-id'])
assert.equal(listReadingHistory().length, 0)
restoreReadingHistories(popped)
assert.equal(listReadingHistory().length, 2)
clearReadingHistory()
assert.equal(listReadingHistory().length, 0)
migrateCachedReadingHistory([{ article, savedAt: 1000, usedAt: 80000, pinned: false, bytes: 123 }], new Set(['rss-id']))
assert.equal(listReadingHistory().length, 1)
clearReadingHistory()
migrateCachedReadingHistory([{ article, savedAt: 1000, usedAt: 80000, pinned: false, bytes: 123 }], new Set(['rss-id']))
assert.equal(listReadingHistory().length, 0)
console.log('reading-history: ok')
