import assert from 'node:assert/strict'

import { createMemoryZhihuCommentDraftDatabase, ZhihuCommentDraftStore } from '../src/features/zhihu/comments/draftStore'
import { ZhihuCommentsService, decodeZhihuComment } from '../src/features/zhihu/comments/service'
import { isZhihuOperationEnabled, zhihuOperation } from '../src/features/zhihu/protocol'

const decoded = decodeZhihuComment({
  id: 'comment-1',
  content: '<p>示例评论</p>',
  created_time: 1700000000,
  like_count: 4,
  liked: false,
  child_comment_count: 1,
  author: { id: 'person-1', url_token: 'person-token', name: '示例用户' },
  child_comments: [{
    id: 'comment-2',
    content: '<p>示例回复</p>',
    author: { id: 'person-2', url_token: 'person-token-2', name: '回复用户' },
  }],
})
assert.ok(decoded)
assert.equal(decoded?.author.token, 'person-token')
assert.equal(decoded?.childCount, 1)
assert.equal(decoded?.children[0]?.id, 'comment-2')

const calls: Array<{ operation: string; url: string }> = []
const service = new ZhihuCommentsService({
  async getJson(operation, url) {
    calls.push({ operation, url })
    return {
      data: [{
        id: 'comment-1',
        content: '<p>示例评论</p>',
        author: { id: 'person-1', url_token: 'person-token', name: '示例用户' },
      }],
      paging: {
        is_end: false,
        next: 'https://www.zhihu.com/api/v4/comment_v5/answers/answer-1/root_comment?offset=20',
      },
    }
  },
})

const root = await service.listRoot({ kind: 'answer', id: 'answer-1' })
assert.equal(root.items.length, 1)
assert.equal(root.hasMore, true)
assert.equal(service.cachedRoot({ kind: 'answer', id: 'answer-1' })?.items[0]?.id, 'comment-1')
assert.equal(calls[0]?.operation, 'comment.list-root')
assert.ok(calls[0]?.url.includes('/comment_v5/answers/answer-1/root_comment'))
assert.ok(calls[0]?.url.includes('order_by=score'))

await service.listRoot({ kind: 'answer', id: 'answer-1' }, undefined, undefined, 'time')
assert.ok(calls[1]?.url.includes('order_by=ts'))
assert.equal(service.cachedRoot({ kind: 'answer', id: 'answer-1' }, 'time')?.items[0]?.id, 'comment-1')

await service.listChildren('comment-1')
assert.equal(calls[2]?.operation, 'comment.list-child')
assert.ok(calls[2]?.url.includes('/comment_v5/comment/comment-1/child_comment'))
assert.equal(service.cachedChildren('comment-1')?.items[0]?.id, 'comment-1')

await assert.rejects(
  service.listRoot({ kind: 'answer', id: 'answer-1' }, 'https://example.com/comments'),
  /非法分页地址/,
)

assert.equal(zhihuOperation('comment.create')?.retry, 'never')
assert.equal(zhihuOperation('comment.create')?.status, 'source-only')
assert.equal(isZhihuOperationEnabled('comment.create'), false)
assert.equal(isZhihuOperationEnabled('vote.set'), false)

const draftDb = createMemoryZhihuCommentDraftDatabase()
const draftStore = new ZhihuCommentDraftStore(draftDb)
const answerRef = { kind: 'answer' as const, id: 'answer-1' }
await draftStore.save('account-a', answerRef, undefined, '根评论草稿')
await draftStore.save('account-a', answerRef, 'comment-1', '回复草稿')
assert.equal(await new ZhihuCommentDraftStore(draftDb).load('account-a', answerRef), '根评论草稿')
assert.equal(await draftStore.load('account-a', answerRef, 'comment-1'), '回复草稿')
assert.equal(await draftStore.load('account-b', answerRef), '', '评论草稿不得跨账号读取')
assert.equal(await draftStore.load('account-a', { kind: 'answer', id: 'answer-2' }), '', '评论草稿不得跨内容读取')
await draftStore.clear('account-a', answerRef, 'comment-1')
assert.equal(await draftStore.load('account-a', answerRef, 'comment-1'), '')

console.log('zhihu comments/drafts contract ok')
