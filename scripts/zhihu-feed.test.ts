import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { decodeZhihuContentDetail, decodeZhihuPage } from '../src/features/zhihu/api/decode'
import { zhihuSearchUrl } from '../src/features/zhihu/api/endpoints'
import { mergeZhihuPages, ZhihuFeedService } from '../src/features/zhihu/feed/service'

const recommended = JSON.parse(readFileSync('scripts/fixtures/zhihu/feed.recommended.source.json', 'utf8')) as unknown
const decoded = decodeZhihuPage(recommended)
assert.equal(decoded.items.length, 1)
assert.equal(decoded.items[0]?.ref.kind, 'answer')
assert.equal(decoded.items[0]?.ref.id, 'answer-fixture-1')
assert.equal(decoded.items[0]?.title, '用于回归测试的推荐问题')
assert.equal(decoded.hasMore, true)

const merged = mergeZhihuPages(
  { items: decoded.items, nextCursor: 'cursor-a', hasMore: true },
  { items: decoded.items, nextCursor: 'cursor-a', hasMore: true },
)
assert.equal(merged.items.length, 1, '重叠分页实体必须去重')
assert.equal(merged.hasMore, false, '重复游标必须停止，避免无限加载循环')

const answer = JSON.parse(readFileSync('scripts/fixtures/zhihu/answer.read.source.json', 'utf8')) as unknown
const detail = decodeZhihuContentDetail(answer)
assert.equal(detail.ref.kind, 'answer')
assert.equal(detail.author?.name, '示例用户')
assert.ok(detail.url.includes('/question/question-fixture-1/answer/answer-fixture-1'))

const calls: Array<{ operation: string; url: string }> = []
const service = new ZhihuFeedService({
  async getJson(operation, url) {
    calls.push({ operation, url })
    return recommended
  },
})
const page = await service.listFeed('recommended')
assert.equal(page.items.length, 1)
assert.equal(calls[0]?.operation, 'feed.recommended')
assert.equal(calls[0]?.url, 'https://api.zhihu.com/topstory/recommend')

const filteredSearchUrl = new URL(zhihuSearchUrl('储能 系统', 40, 20, {
  tab: 'general',
  sort: 'most-voted',
  contentType: 'answer',
  timeRange: 'month',
}))
assert.equal(filteredSearchUrl.searchParams.get('t'), 'general')
assert.equal(filteredSearchUrl.searchParams.get('offset'), '40')
assert.equal(filteredSearchUrl.searchParams.get('sort'), 'upvoted_count')
assert.equal(filteredSearchUrl.searchParams.get('vertical'), 'answer')
assert.equal(filteredSearchUrl.searchParams.get('time_interval'), 'a_month')
assert.equal(filteredSearchUrl.searchParams.get('search_source'), 'Filter')

const peopleSearchUrl = new URL(zhihuSearchUrl('示例用户', 0, 20, {
  tab: 'people',
  sort: 'latest',
  contentType: 'article',
  timeRange: 'year',
}))
assert.equal(peopleSearchUrl.searchParams.get('t'), 'people')
assert.equal(peopleSearchUrl.searchParams.get('sort'), null, '用户搜索不应错误继承内容排序过滤器')
assert.equal(peopleSearchUrl.searchParams.get('vertical'), null)
assert.equal(peopleSearchUrl.searchParams.get('time_interval'), null)

const topicSearchUrl = new URL(zhihuSearchUrl('电池', 0, 20, { tab: 'topic' }))
assert.equal(topicSearchUrl.searchParams.get('show_all_topics'), '1')

console.log('zhihu feed decoder/service contract ok')
