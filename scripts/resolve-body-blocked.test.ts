import assert from 'node:assert/strict'

import { buildBlockedPublisherFallbackForTest } from '../src/lib/resolveBody'
import type { Article } from '../src/lib/types'

console.log('Testing blocked publisher bodySource...')

const article = {
  id: 'blocked-1',
  title: 'Paywalled',
  summary: 'This is a long enough summary text for the blocked publisher fallback path to render.',
  sourceId: 'custom_x',
  sourceName: 'Custom',
  originUrl: 'https://example.com/paywall',
} as Article

const resolved = buildBlockedPublisherFallbackForTest(article, 'https://example.com/paywall')
assert.equal(resolved.bodySource, 'blocked')
assert.ok(resolved.contentHtml.includes('原站正文暂不可读取'))
assert.ok(!resolved.contentHtml.includes('付费墙'), 'unknown HTTP failures cannot be diagnosed as paywalls')

console.log('resolve-body-blocked tests passed')
