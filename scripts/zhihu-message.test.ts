import assert from 'node:assert/strict'

import { ZhihuApiError } from '../src/features/zhihu/api/errors'
import { ZhihuNotificationService, type ZhihuNotificationApi } from '../src/features/zhihu/notification/service'
import {
  createMemoryZhihuMessageDraftDatabase,
  ZhihuMessageDraftStore,
} from '../src/features/zhihu/notification/draftStore'

class RecordingApi implements ZhihuNotificationApi {
  calls = 0

  async getJson(): Promise<unknown> {
    this.calls += 1
    throw new Error('unexpected GET')
  }

  async postJson(): Promise<unknown> {
    this.calls += 1
    throw new Error('unexpected POST JSON')
  }
}

const api = new RecordingApi()
const service = new ZhihuNotificationService(api)

await assert.rejects(
  service.sendMessage('peer-id', '测试 & 消息'),
  (error: unknown) => error instanceof ZhihuApiError && error.code === 'unsupported',
  '未 verified 的私信发送必须在构造/网络请求前明确拒绝',
)
assert.equal(api.calls, 0, '私信发送禁用时不得触达 API/transport')
await assert.rejects(service.sendMessage('', '内容'), /接收者不能为空/)
await assert.rejects(service.sendMessage('peer-id', '   '), /内容不能为空/)

const draftDb = createMemoryZhihuMessageDraftDatabase()
const draftStore = new ZhihuMessageDraftStore(draftDb)
await draftStore.save('account-a', 'peer-1', '未发送内容')
assert.equal(await new ZhihuMessageDraftStore(draftDb).load('account-a', 'peer-1'), '未发送内容')
assert.equal(await draftStore.load('account-b', 'peer-1'), '', '私信草稿不得跨知乎账号读取')
assert.equal(await draftStore.load('account-a', 'peer-2'), '', '私信草稿不得跨会话读取')
await draftStore.clear('account-a', 'peer-1')
assert.equal(await draftStore.load('account-a', 'peer-1'), '')

console.log('zhihu private-message read/draft/gate contract ok')
