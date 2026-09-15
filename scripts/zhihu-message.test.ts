import assert from 'node:assert/strict'

import { ZhihuApiError } from '../src/features/zhihu/api/errors'
import { ZhihuNotificationService, type ZhihuNotificationApi } from '../src/features/zhihu/notification/service'
import {
  createMemoryZhihuMessageDraftDatabase,
  ZhihuMessageDraftStore,
} from '../src/features/zhihu/notification/draftStore'

class RecordingApi implements ZhihuNotificationApi {
  calls: Array<{ operation: string; url: string; body?: unknown }> = []

  async getJson(operation: string, url: string): Promise<unknown> {
    this.calls.push({ operation, url })
    if (operation !== 'message.list') throw new Error(`unexpected GET: ${operation}`)
    return {
      data: [{
        id: 'message-1',
        content: '测试 & 消息',
        created_time: Math.floor(Date.now() / 1000),
        sender: { id: 'me', name: '我' },
        receiver: { id: 'peer-id', name: '对方' },
      }],
      paging: { is_end: true },
    }
  }

  async postJson(operation: string, url: string, body?: unknown): Promise<unknown> {
    this.calls.push({ operation, url, body })
    if (operation !== 'message.send') throw new Error(`unexpected POST: ${operation}`)
    return { msg: 'success' }
  }
}

const api = new RecordingApi()
const service = new ZhihuNotificationService(api)
const sent = await service.sendMessage('peer-id', ' 测试 & 消息 ')
assert.equal(sent.id, 'message-1')
assert.deepEqual(api.calls, [
  {
    operation: 'message.send',
    url: 'https://www.zhihu.com/api/v4/messages',
    body: { type: 'common', content: '测试 & 消息', receiver_hash: 'peer-id' },
  },
  {
    operation: 'message.list',
    url: 'https://api.zhihu.com/messages?limit=20&sender_id=peer-id',
  },
], '私信 POST 只发送一次；无实体响应时只能 GET 读回确认')

const callsBeforeInvalid = api.calls.length
await assert.rejects(service.sendMessage('', '内容'), /接收者不能为空/)
await assert.rejects(service.sendMessage('peer-id', '   '), /内容不能为空/)
assert.equal(api.calls.length, callsBeforeInvalid, '非法输入不得触达 API')

class UnconfirmedApi implements ZhihuNotificationApi {
  posts = 0
  reads = 0
  async getJson(): Promise<unknown> {
    this.reads += 1
    return { data: [], paging: { is_end: true } }
  }
  async postJson(): Promise<unknown> {
    this.posts += 1
    return { msg: 'success' }
  }
}
const unconfirmedApi = new UnconfirmedApi()
await assert.rejects(
  new ZhihuNotificationService(unconfirmedApi).sendMessage('peer-id', '只发一次'),
  (error: unknown) => error instanceof ZhihuApiError && error.code === 'conflict',
  '发送请求得到 ACK 但无法读回时必须进入未知结果，不能冒充成功',
)
assert.equal(unconfirmedApi.posts, 1, '非幂等私信发送不能自动重试 POST')
assert.equal(unconfirmedApi.reads, 2, '允许安全读回确认，但不能重复发送')

const draftDb = createMemoryZhihuMessageDraftDatabase()
const draftStore = new ZhihuMessageDraftStore(draftDb)
await draftStore.save('account-a', 'peer-1', '未发送内容')
assert.equal(await new ZhihuMessageDraftStore(draftDb).load('account-a', 'peer-1'), '未发送内容')
assert.equal(await draftStore.load('account-b', 'peer-1'), '', '私信草稿不得跨知乎账号读取')
assert.equal(await draftStore.load('account-a', 'peer-2'), '', '私信草稿不得跨会话读取')
await draftStore.clear('account-a', 'peer-1')
assert.equal(await draftStore.load('account-a', 'peer-1'), '')

console.log('zhihu private-message send/read/draft contract ok')
