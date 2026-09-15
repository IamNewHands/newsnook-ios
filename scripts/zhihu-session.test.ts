import assert from 'node:assert/strict'

import { ZhihuApiClient } from '../src/features/zhihu/api/client'
import { ZhihuApiError } from '../src/features/zhihu/api/errors'
import { ZhihuSessionService } from '../src/features/zhihu/session/service'
import { zhihuSecureKey } from '../src/features/zhihu/session/store'
import { assertZhihuUrl } from '../src/features/zhihu/transport/safeRead'
import type { ZhihuRequest, ZhihuResponse, ZhihuTransport } from '../src/features/zhihu/transport/types'

class DelayedTransport implements ZhihuTransport {
  calls: ZhihuRequest[] = []
  resolvers: Array<(response: ZhihuResponse) => void> = []

  request(input: ZhihuRequest): Promise<ZhihuResponse> {
    this.calls.push(input)
    return new Promise((resolve) => this.resolvers.push(resolve))
  }
}

const session = new ZhihuSessionService()
const delayed = new DelayedTransport()
const client = new ZhihuApiClient(delayed, session)

const oldRequest = client.getJson('answer.read', 'https://www.zhihu.com/api/v4/answers/1')
assert.equal(delayed.calls.length, 1)
assert.equal(delayed.calls[0]?.generation, 1)
session.switchAccount({ id: 'account-b' })
delayed.resolvers[0]?.({ status: 200, headers: {}, body: '{"id":"1","type":"answer"}' })
await assert.rejects(oldRequest, (error: unknown) => {
  assert.ok(error instanceof ZhihuApiError)
  assert.equal(error.code, 'stale-generation')
  return true
})

class FlakyTransport implements ZhihuTransport {
  calls = 0
  async request(): Promise<ZhihuResponse> {
    this.calls += 1
    if (this.calls === 1) throw new Error('temporary network error')
    return { status: 200, headers: {}, body: '{"id":"1","type":"answer"}' }
  }
}

const guestSession = new ZhihuSessionService()
const flaky = new FlakyTransport()
const retryClient = new ZhihuApiClient(flaky, guestSession)
const result = await retryClient.getJson('answer.read', 'https://www.zhihu.com/api/v4/answers/1') as { id?: string }
assert.equal(result.id, '1')
assert.equal(flaky.calls, 2, 'safe-read 最多重试一次')

await assert.rejects(
  retryClient.getJson('message.list', 'https://api.zhihu.com/messages'),
  (error: unknown) => error instanceof ZhihuApiError && error.code === 'unsupported',
  '需要认证的私有数据不能在 guest transport 上请求',
)

assert.equal(zhihuSecureKey('account/a', 'cookie jar'), 'site.zhihu.account_a.cookie_jar')
assert.equal(assertZhihuUrl('https://www.zhihu.com/api/v4/questions/1').hostname, 'www.zhihu.com')
assert.throws(() => assertZhihuUrl('https://example.com/api/v4/questions/1'))
assert.throws(() => assertZhihuUrl('http://www.zhihu.com/api/v4/questions/1'))

console.log('zhihu session/transport contract ok')
