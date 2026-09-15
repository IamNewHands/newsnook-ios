import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

import {
  ZHIHU_OPERATIONS,
  canAttemptZhihuRead,
  isZhihuOperationEnabled,
  zhihuOperation,
} from '../src/features/zhihu/protocol'

const expectedZIds = Array.from({ length: 18 }, (_, index) => `Z${String(index + 1).padStart(2, '0')}`)
const covered = new Set(ZHIHU_OPERATIONS.flatMap((item) => item.zIds))

assert.deepEqual(
  expectedZIds.filter((id) => !covered.has(id)),
  [],
  'Z01-Z18 每项都必须至少映射到一个 operation，不能通过删除未知能力缩小范围',
)

const names = new Set<string>()
for (const operation of ZHIHU_OPERATIONS) {
  assert.ok(!names.has(operation.operation), `operation 名称重复：${operation.operation}`)
  names.add(operation.operation)

  if (operation.status === 'verified') {
    assert.ok(
      operation.evidence.some((evidence) => evidence.kind === 'live'),
      `${operation.operation} 标记 verified 但没有 live 实网证据`,
    )
    assert.ok(operation.fixture, `${operation.operation} 标记 verified 但没有脱敏 fixture`)
  }

  for (const evidence of operation.evidence) {
    if (evidence.kind === 'source' || evidence.kind === 'corpus' || evidence.kind === 'local-test') {
      assert.ok(existsSync(evidence.path), `${operation.operation} 的证据路径不存在：${evidence.path}`)
    }
  }

  if (operation.method !== 'GET') {
    assert.equal(
      canAttemptZhihuRead(operation.operation),
      false,
      `${operation.operation} 不是 GET，不能从“实验性只读”通道放行`,
    )
  }

  if (operation.status !== 'verified') {
    assert.equal(
      isZhihuOperationEnabled(operation.operation),
      false,
      `${operation.operation} 未 verified，运行时 mutation 能力必须保持关闭`,
    )
  }

  if (operation.fixture) {
    const fixture = JSON.parse(readFileSync(operation.fixture, 'utf8')) as {
      _meta?: { evidenceStatus?: unknown; syntheticValues?: unknown; operation?: unknown }
    }
    assert.equal(fixture._meta?.operation, operation.operation)
    assert.equal(fixture._meta?.syntheticValues, true)
    if (operation.status === 'source-only') {
      assert.equal(fixture._meta?.evidenceStatus, 'source-only')
    }
  }
}

const answerFixture = JSON.parse(
  readFileSync('scripts/fixtures/zhihu/answer.read.source.json', 'utf8'),
) as { id?: unknown; content?: unknown }
assert.equal(typeof answerFixture.id, 'string')
assert.equal(typeof answerFixture.content, 'string')
assert.ok((answerFixture.content as string).length > 0)

const recommendedFixture = JSON.parse(
  readFileSync('scripts/fixtures/zhihu/feed.recommended.source.json', 'utf8'),
) as { data?: unknown[]; paging?: { is_end?: unknown; next?: unknown } }
assert.ok(Array.isArray(recommendedFixture.data) && recommendedFixture.data.length > 0)
assert.equal(typeof recommendedFixture.paging?.is_end, 'boolean')
assert.equal(typeof recommendedFixture.paging?.next, 'string')

const searchFixture = JSON.parse(
  readFileSync('scripts/fixtures/zhihu/search.query.source.json', 'utf8'),
) as { data?: unknown[]; paging?: { is_end?: unknown } }
assert.ok(Array.isArray(searchFixture.data) && searchFixture.data.length > 0)
assert.equal(typeof searchFixture.paging?.is_end, 'boolean')

assert.equal(zhihuOperation('answer.publish')?.retry, 'never')
assert.equal(zhihuOperation('comment.create')?.retry, 'never')
assert.equal(zhihuOperation('message.send')?.retry, 'never')
assert.equal(zhihuOperation('comment.update')?.status, 'blocked')
assert.equal(zhihuOperation('draft.remote.list')?.endpoint, null)

console.log(`zhihu protocol contract ok (${ZHIHU_OPERATIONS.length} operations, 0 fabricated verified capabilities)`)
