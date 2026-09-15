import assert from 'node:assert/strict'

import { ZhihuPeopleService, decodeZhihuPeopleProfile } from '../src/features/zhihu/people/service'
import { ZhihuTopicService, decodeZhihuTopicDetail } from '../src/features/zhihu/topic/service'

const profile = decodeZhihuPeopleProfile({
  id: 'person-1',
  url_token: 'person-token',
  name: '示例用户',
  headline: '示例签名',
  follower_count: 42,
  answer_count: 7,
  articles_count: 3,
})
assert.equal(profile.token, 'person-token')
assert.equal(profile.followerCount, 42)

const topic = decodeZhihuTopicDetail({
  id: 'topic-1',
  name: '示例话题',
  excerpt: '话题简介',
  followers_count: 88,
  questions_count: 12,
})
assert.equal(topic.name, '示例话题')
assert.equal(topic.questionsCount, 12)

const calls: Array<{ operation: string; url: string }> = []
const api = {
  async getJson(operation: string, url: string) {
    calls.push({ operation, url })
    if (operation === 'people.read') return { id: 'person-1', url_token: 'person-token', name: '示例用户' }
    if (operation === 'topic.read') return { id: 'topic-1', name: '示例话题' }
    return {
      data: [{ id: 'answer-1', type: 'answer', content: '<p>正文</p>', question: { id: 'q-1', title: '问题' } }],
      paging: { is_end: false, next: 'https://www.zhihu.com/api/v4/next' },
    }
  },
}

const peopleService = new ZhihuPeopleService(api)
await peopleService.read('person-token')
const peoplePage = await peopleService.listContent('person-token', 'answers', 40)
assert.equal(peoplePage.nextCursor, '60')
assert.equal(calls.at(-1)?.operation, 'people.content')
assert.ok(calls.at(-1)?.url.includes('/members/person-token/answers'))
assert.ok(calls.at(-1)?.url.includes('offset=40'))

const topicService = new ZhihuTopicService(api)
await topicService.read('topic-1')
const topicPage = await topicService.listHot('topic-1', 20)
assert.equal(topicPage.nextCursor, '40')
assert.equal(calls.at(-1)?.operation, 'topic.feed')
assert.ok(calls.at(-1)?.url.includes('/topics/topic-1/feeds/essence/v2'))

console.log('zhihu people/topic service contract ok')
