import assert from 'node:assert/strict'

import { feedArticleId } from '../src/lib/articleId'
import { articleFromSharePayload, buildShareUrl, parseShareUrl, sharePayloadFromArticle } from '../src/lib/shareLink'
import { toNewsArticle } from '../src/features/zhihu/content/bridge'
import { normalizeZhihuContentHtml } from '../src/features/zhihu/content/normalize'
import { parseZhihuLink } from '../src/features/zhihu/content/links'

assert.deepEqual(
  parseZhihuLink('https://www.zhihu.com/question/123/answer/456'),
  { kind: 'answer', id: '456' },
)
assert.deepEqual(parseZhihuLink('https://www.zhihu.com/question/123'), { kind: 'question', id: '123' })
assert.deepEqual(parseZhihuLink('https://zhuanlan.zhihu.com/p/789'), { kind: 'article', id: '789' })
assert.deepEqual(parseZhihuLink('https://www.zhihu.com/people/example-user'), { kind: 'people', id: 'example-user' })
assert.equal(parseZhihuLink('https://example.com/question/123'), null)

const dirty = '<p>正文<img src="https://pic.example/a.jpg" onerror="alert(1)"></p><script>alert(1)</script>'
const sanitized = normalizeZhihuContentHtml(dirty)
assert.ok(sanitized.includes('正文'))
assert.ok(!sanitized.includes('<script'))
assert.ok(!sanitized.includes('onerror'))

const article = toNewsArticle({
  ref: { kind: 'answer', id: '456' },
  title: '示例回答',
  excerpt: '摘要',
  contentHtml: dirty,
  createdAt: 1700000000,
  url: 'https://www.zhihu.com/question/123/answer/456',
})
assert.ok(article)
assert.equal(article?.sourceId, 'zhihu-community')
assert.equal(article?.id, feedArticleId('zhihu-community', 'https://www.zhihu.com/question/123/answer/456'))
assert.equal(article?.hasRealDate, true)
assert.ok(!article?.contentHtml?.includes('<script'))

const sharePayload = sharePayloadFromArticle(article!)
const shareUrl = buildShareUrl(sharePayload, { origin: 'https://news.aizeek.com', salt: 'fixture' })
const receivedPayload = parseShareUrl(shareUrl)
assert.ok(receivedPayload)
const receivedArticle = articleFromSharePayload(receivedPayload!)
assert.equal(receivedArticle.sourceId, 'zhihu-community')
assert.equal(receivedArticle.sourceName, '知乎')
assert.equal(receivedArticle.id, article?.id, '知乎公共正文分享发出/接收必须生成同一 Article.id')

assert.equal(toNewsArticle({
  ref: { kind: 'question', id: '123' },
  title: '问题', excerpt: '', contentHtml: '', url: 'https://www.zhihu.com/question/123',
}), null, '问题壳不应伪装成 NewsNook Article')

console.log('zhihu content/link/article bridge contract ok')
