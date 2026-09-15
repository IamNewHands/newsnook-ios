import assert from 'node:assert/strict'

import { ZhihuFeedService } from '../src/features/zhihu/feed/service'
import {
  clearZhihuRecommendationProfile,
  loadZhihuRecommendationProfile,
  rankZhihuLocalRecommendations,
  recordZhihuRecommendationSignal,
  type ZhihuRecommendationStorage,
} from '../src/features/zhihu/feed/recommendation'
import type { ZhihuContentSummary } from '../src/features/zhihu/types'

function response(id: string, type: 'answer' | 'article', next?: string) {
  return {
    data: [{
      target: {
        type,
        id,
        title: `${id} title`,
        excerpt: `${id} excerpt`,
        voteup_count: id.includes('popular') ? 5000 : 20,
        created_time: 1_786_000_000,
        author: { id: `${id}-author`, url_token: `${id}-token`, name: `${id} author` },
      },
    }],
    paging: { is_end: !next, next },
  }
}

const calls: Array<{
  operation: string
  url: string
  headers?: Record<string, string>
  signing?: string
}> = []
const api = {
  async getJson(operation: string, url: string) {
    calls.push({ operation, url })
    if (operation === 'feed.recommended-web') {
      return response(
        url.includes('after=web-next') ? 'web-page-2' : 'web-page-1',
        'article',
        url.includes('after=web-next') ? undefined : 'https://www.zhihu.com/api/v3/feed/topstory/recommend?after=web-next',
      )
    }
    throw new Error(`unexpected ${operation}`)
  },
  async getJsonWithHeaders(
    operation: string,
    url: string,
    headers: Record<string, string>,
    _signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ) {
    calls.push({ operation, url, headers, signing: options?.signing })
    return response(
      url.includes('after=android-next') ? 'android-page-2' : 'android-page-1',
      'answer',
      url.includes('after=android-next') ? undefined : 'https://api.zhihu.com/topstory/recommend?after=android-next',
    )
  },
}

const service = new ZhihuFeedService(api)
const android = await service.listFeed('recommended', undefined, undefined, 'android')
assert.equal(android.items[0]?.recommendationSource, 'android')
assert.equal(calls[0]?.operation, 'feed.recommended')
assert.equal(calls[0]?.headers?.['x-api-version'], '3.1.8')
assert.equal(calls[0]?.signing, 'none', 'Android 推荐客户端不能误套 Web ZSE96')

calls.length = 0
const web = await service.listFeed('recommended', undefined, undefined, 'web')
assert.equal(web.items[0]?.recommendationSource, 'web')
assert.equal(calls[0]?.operation, 'feed.recommended-web')
assert.match(calls[0]?.url ?? '', /desktop=true/)

calls.length = 0
const mixedFirst = await service.listFeed('recommended', undefined, undefined, 'mixed')
assert.deepEqual(mixedFirst.items.map((item) => item.ref.id), ['android-page-1', 'web-page-1'])
assert.ok(mixedFirst.nextCursor?.startsWith('mixed:'), '混合推荐必须保存两路独立游标')
const mixedSecond = await service.listFeed('recommended', mixedFirst.nextCursor, undefined, 'mixed')
assert.deepEqual(mixedSecond.items.map((item) => item.ref.id), ['android-page-2', 'web-page-2'])
assert.equal(mixedSecond.hasMore, false)
assert.ok(calls.some((call) => call.url.includes('after=android-next')))
assert.ok(calls.some((call) => call.url.includes('after=web-next')))

function memoryStorage(): ZhihuRecommendationStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

const storage = memoryStorage()
const preferred: ZhihuContentSummary = {
  ref: { kind: 'article', id: 'preferred' },
  title: '偏好文章',
  excerpt: '',
  url: 'https://zhuanlan.zhihu.com/p/preferred',
  author: { id: 'writer', token: 'writer-token', name: '常读作者' },
  voteupCount: 10,
  createdAt: 1_786_000_000,
}
const other: ZhihuContentSummary = {
  ref: { kind: 'answer', id: 'other' },
  title: '其它回答',
  excerpt: '',
  url: 'https://www.zhihu.com/answer/other',
  author: { id: 'other-writer', name: '其他作者' },
  voteupCount: 100,
  createdAt: 1_786_000_000,
}
recordZhihuRecommendationSignal('account-a', preferred, 'collect', storage, 1_786_100_000_000)
recordZhihuRecommendationSignal('account-a', preferred, 'follow-author', storage, 1_786_100_001_000)
const ranked = rankZhihuLocalRecommendations(
  [other, preferred],
  'account-a',
  storage,
  1_786_100_100_000,
)
assert.equal(ranked[0]?.ref.id, 'preferred')
assert.match(ranked[0]?.recommendationReason ?? '', /常读作者/)
assert.equal(ranked[0]?.recommendationSource, 'local')
assert.equal(loadZhihuRecommendationProfile('account-b', storage).totalSignals, 0, '画像必须按知乎账号隔离')
clearZhihuRecommendationProfile('account-a', storage)
assert.equal(loadZhihuRecommendationProfile('account-a', storage).totalSignals, 0, '用户必须能彻底清空本地画像')

console.log('zhihu recommendation modes contract ok')
