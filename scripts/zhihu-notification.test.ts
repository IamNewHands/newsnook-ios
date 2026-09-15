import assert from 'node:assert/strict'

import { ZhihuApiClient } from '../src/features/zhihu/api/client'
import { ZhihuApiError } from '../src/features/zhihu/api/errors'
import {
  mergeZhihuNotificationItems,
  type ZhihuNotificationApi,
  ZhihuNotificationService,
} from '../src/features/zhihu/notification/service'
import { ZhihuSessionService } from '../src/features/zhihu/session/service'
import type { ZhihuRequest, ZhihuResponse, ZhihuTransport } from '../src/features/zhihu/transport/types'

class NotificationTransport implements ZhihuTransport {
  calls: ZhihuRequest[] = []

  async request(input: ZhihuRequest): Promise<ZhihuResponse> {
    this.calls.push(input)
    if (input.operation === 'notification.list') {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          head: [
            { detail_title: '评论转发@', unread_count: 3 },
            { detail_title: '赞同喜欢', unread_count: 2 },
          ],
          unread: { message: { count: 4 } },
          data: [{
            unique_id: 'overview-1',
            created: 1785743000,
            is_read: false,
            content: { title: '有人评论了你', text: '测试通知' },
          }],
          paging: {
            is_end: false,
            next: 'https://api.zhihu.com/notifications/v3/message/v3?limit=20&offset=20',
          },
        }),
      }
    }
    if (input.operation === 'notification.timeline') {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          data: [{
            unique_id: 'comment-1',
            created: 1785743001,
            is_read: false,
            content: { title: '评论', text: '分类通知' },
          }],
          paging: { is_end: true, next: '' },
        }),
      }
    }
    if (input.operation === 'notification.readall') {
      return { status: 200, headers: {}, body: '{}' }
    }
    throw new Error(`unexpected operation: ${input.operation}`)
  }
}

const session = new ZhihuSessionService()
session.switchAccount({ id: 'me', name: '我' }, 'authenticated')
const transport = new NotificationTransport()
const service = new ZhihuNotificationService(new ZhihuApiClient(transport, session))

const overview = await service.overview()
assert.equal(overview.items[0]?.id, 'overview-1')
assert.equal(overview.unread.comment, 3)
assert.equal(overview.unread.like, 2)
assert.equal(overview.unread.favlist_me, 0)
assert.equal(overview.messageUnread, 4)
assert.match(overview.nextCursor ?? '', /offset=20/)
assert.equal(transport.calls.at(-1)?.url, 'https://api.zhihu.com/notifications/v3/message/v3?limit=20')

const timeline = await service.timeline('comment')
assert.equal(timeline.items[0]?.id, 'comment-1')
assert.equal(timeline.items[0]?.unread, true)
assert.equal(
  transport.calls.at(-1)?.url,
  'https://api.zhihu.com/notifications/v3/timeline/entry/comment?limit=20',
)

await assert.rejects(
  service.timeline('comment', 'https://evil.example/notifications'),
  /请求目标不在允许域内/,
  '分类通知 next URL 必须拒绝非知乎域',
)

const callsBeforeMark = transport.calls.length
await service.markCategoryRead('comment')
assert.equal(transport.calls.length, callsBeforeMark + 1, '已有明确 endpoint 的通知已读操作应触达 transport')
assert.equal(transport.calls.at(-1)?.operation, 'notification.readall')
assert.equal(
  transport.calls.at(-1)?.url,
  'https://api.zhihu.com/notifications/v3/timeline/entry/comment/actions/readall',
)

class ReadAllApi implements ZhihuNotificationApi {
  calls: Array<{ operation: string; url: string }> = []
  async getJson(): Promise<unknown> { throw new Error('unexpected GET') }
  async postJson(operation: string, url: string): Promise<unknown> {
    this.calls.push({ operation, url })
    return {}
  }
  async requestRawJson(): Promise<unknown> { throw new Error('unexpected raw write') }
}
const readAllApi = new ReadAllApi()
await new ZhihuNotificationService(readAllApi).markCategoryRead('comment')
assert.deepEqual(readAllApi.calls, [{
  operation: 'notification.readall',
  url: 'https://api.zhihu.com/notifications/v3/timeline/entry/comment/actions/readall',
}])

const merged = mergeZhihuNotificationItems(
  [{ id: 'same', title: '旧', text: '', unread: true }],
  [
    { id: 'same', title: '重复', text: '', unread: false },
    { id: 'new', title: '新', text: '', unread: true },
  ],
)
assert.deepEqual(merged.map((item) => item.id), ['same', 'new'])

const guest = new ZhihuSessionService()
const guestService = new ZhihuNotificationService(new ZhihuApiClient(new NotificationTransport(), guest))
await assert.rejects(
  guestService.overview(),
  (error: unknown) => error instanceof ZhihuApiError && error.code === 'auth-expired',
)

console.log('zhihu notification contract ok')
