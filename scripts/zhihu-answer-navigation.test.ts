import assert from 'node:assert/strict'

import { ZhihuAnswerNavigator } from '../src/features/zhihu/content/answerNavigation'
import type { Page, ZhihuContentSummary } from '../src/features/zhihu/types'

function answers(...ids: string[]): ZhihuContentSummary[] {
  return ids.map((id) => ({
    ref: { kind: 'answer', id },
    title: id,
    excerpt: '',
    url: `https://www.zhihu.com/answer/${id}`,
  }))
}

const answerPages = new Map<string, Page<ZhihuContentSummary>>([
  ['first', {
    items: answers('answer-1', 'answer-2'),
    nextCursor: 'page-2',
    hasMore: true,
  }],
  ['page-2', {
    items: answers('answer-3', 'answer-4'),
    hasMore: false,
  }],
])
const calls: Array<{ questionId: string; order: string; cursor?: string }> = []
const navigator = new ZhihuAnswerNavigator({
  async questionAnswers(questionId, order, cursor) {
    calls.push({ questionId, order, cursor })
    return answerPages.get(cursor ?? 'first')!
  },
})

const second = await navigator.neighbors('question-1', 'answer-2')
assert.deepEqual(second, {
  previous: { kind: 'answer', id: 'answer-1' },
  next: { kind: 'answer', id: 'answer-3' },
}, '默认排序分页边界上的回答必须连接成连续队列')

const third = await navigator.neighbors('question-1', 'answer-3')
assert.equal(second.next?.id, 'answer-3')
assert.equal(third.previous?.id, 'answer-2', '点击下一个后再点上一个必须回到刚才的回答')
assert.deepEqual(calls, [
  { questionId: 'question-1', order: 'default', cursor: undefined },
  { questionId: 'question-1', order: 'default', cursor: 'page-2' },
], '回答导航只能按问题回答列表的默认排序读取，且已读取顺序必须复用')

assert.deepEqual(await navigator.neighbors('question-1', 'answer-1'), {
  previous: undefined,
  next: { kind: 'answer', id: 'answer-2' },
}, '第一个回答必须禁用向上导航')
assert.deepEqual(await navigator.neighbors('question-1', 'answer-4'), {
  previous: { kind: 'answer', id: 'answer-3' },
  next: undefined,
}, '最后一个回答必须禁用向下导航')

console.log('zhihu ordered answer navigation ok')
