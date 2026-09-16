import assert from 'node:assert/strict'

import { feedArticleId } from '../src/lib/articleId'
import { articleFromSharePayload, buildShareUrl, parseShareUrl, sharePayloadFromArticle } from '../src/lib/shareLink'
import { decodeZhihuContentDetail } from '../src/features/zhihu/api/decode'
import { zhihuEntityUrl } from '../src/features/zhihu/api/endpoints'
import { parseZhihuJson } from '../src/features/zhihu/api/json'
import { toNewsArticle } from '../src/features/zhihu/content/bridge'
import { normalizeZhihuContentHtml } from '../src/features/zhihu/content/normalize'
import { parseZhihuLink, parseZhihuVideoId } from '../src/features/zhihu/content/links'

assert.deepEqual(
  parseZhihuLink('https://www.zhihu.com/question/123/answer/456'),
  { kind: 'answer', id: '456' },
)
assert.deepEqual(parseZhihuLink('https://www.zhihu.com/question/123'), { kind: 'question', id: '123' })
assert.deepEqual(parseZhihuLink('https://zhuanlan.zhihu.com/p/789'), { kind: 'article', id: '789' })
assert.deepEqual(parseZhihuLink('https://www.zhihu.com/people/example-user'), { kind: 'people', id: 'example-user' })
assert.equal(parseZhihuLink('https://example.com/question/123'), null)
assert.equal(parseZhihuVideoId('https://www.zhihu.com/video/2081068623192224666'), '2081068623192224666')
assert.equal(parseZhihuVideoId('https://www.zhihu.com/question/123'), null)

const answerUrl = zhihuEntityUrl({ kind: 'answer', id: '2027676063409484209' })
assert.match(answerUrl ?? '', /include=/)
assert.match(decodeURIComponent(answerUrl ?? ''), /pagination_info/, '回答详情必须请求 pagination_info 才能直接得到上下回答')
const pagedDetail = decodeZhihuContentDetail(parseZhihuJson(`{
  "id": 2027676063409484209,
  "type": "answer",
  "content": "<p>正文</p>",
  "editable_content": "<p data-pid='editable'>可编辑正文</p>",
  "question": { "id": 423780782, "title": "问题" },
  "pagination_info": {
    "index": 12,
    "prev_answer_ids": [2027000000000000001],
    "next_answer_ids": [2028000000000000002, 2028000000000000003]
  }
}`))
assert.equal(pagedDetail?.ref.id, '2027676063409484209')
assert.equal(pagedDetail?.editableContentHtml, "<p data-pid='editable'>可编辑正文</p>", '编辑已有回答必须保留 editable_content，而不是把阅读 HTML 回写')
assert.deepEqual(pagedDetail?.previousAnswerIds, ['2027000000000000001'])
assert.deepEqual(pagedDetail?.nextAnswerIds, ['2028000000000000002', '2028000000000000003'])

const dirty = '<p>正文<img src="https://pic.example/a.jpg" onerror="alert(1)"></p><script>alert(1)</script>'
const sanitized = normalizeZhihuContentHtml(dirty)
assert.ok(sanitized.includes('正文'))
assert.ok(!sanitized.includes('<script'))
assert.ok(!sanitized.includes('onerror'))
assert.ok(sanitized.includes('data-reader-role="zhihu-image-host"'), '知乎正文图片必须有稳定加载占位容器')
assert.ok(sanitized.includes('图片加载中'), '知乎正文图片加载完成前必须显示加载中占位')
assert.ok(sanitized.includes('图片加载失败'), '知乎正文图片失败时必须有明确占位而不是空白洞')

const fallbackImage = normalizeZhihuContentHtml('<p><img src="https://pic1.zhimg.com/50/fallback_b.jpg" data-actualsrc="https://pic1.zhimg.com/80/preferred_b.jpg" data-original="https://pic1.zhimg.com/100/original_r.jpg"></p>')
assert.ok(fallbackImage.includes('https://pic1.zhimg.com/80/preferred_b.jpg'), '知乎图片应优先保留正文实际图源')
assert.ok(fallbackImage.includes('data-reader-image-fallbacks='), '知乎图片应保留备用源供失败自动重试')
assert.ok(fallbackImage.includes('https://pic1.zhimg.com/100/original_r.jpg'), '原图 URL 应进入安全备用源列表')

const videoCard = normalizeZhihuContentHtml('<p><a class="video-box" href="https://link.zhihu.com/?target=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1test"><img src="https://pic.example/video.jpg">DeepSeek 唱歌测试</a></p>')
assert.ok(videoCard.includes('data-reader-role="zhihu-link-card"'), '知乎视频/站外卡片不能退化成一行裸链接')
assert.ok(videoCard.includes('bilibili.com/video/BV1test'), '知乎 link.zhihu.com 跳转必须恢复真实站外目标')
assert.ok(videoCard.includes('data-reader-role="zhihu-link-image"'), '有封面的知乎视频卡片应保留安全缩略图')
assert.ok(videoCard.includes('data-media-format="video-page"'), '站外视频卡片必须标记为可交给 NewsNook 媒体嗅探/InkVideoPlayer 的视频页')
assert.ok(videoCard.includes('data-source-page='), '站外视频卡片必须保留真实视频页面供媒体嗅探')
assert.ok(videoCard.includes('DeepSeek 唱歌测试'))

const nativeZhihuVideoCard = normalizeZhihuContentHtml('<p><a class="video-box" data-lens-id="2081068623192224666" href="https://www.zhihu.com/video/2081068623192224666"><img src="https://pic.example/zhihu-video.jpg">https://www.zhihu.com/video/2081068623192224666</a></p>')
assert.ok(nativeZhihuVideoCard.includes('data-reader-role="zhihu-link-card"'), '知乎自身 /video/:id 不能被当成普通站内链接留下截图 + 裸 URL')
assert.ok(nativeZhihuVideoCard.includes('data-media-format="video-page"'), '知乎自身视频也必须进入 NewsNook 视频页播放器管线')
assert.ok(nativeZhihuVideoCard.includes('data-source-page="https://www.zhihu.com/video/2081068623192224666"'), '知乎视频卡片必须保留原始视频页供原生嗅探')
assert.ok(nativeZhihuVideoCard.includes('data-reader-role="zhihu-link-image"'), '知乎视频封面必须作为视频卡片封面保留')

const lensOnlyZhihuVideoCard = normalizeZhihuContentHtml('<p><a class="video-box" data-lens-id="2081068623192224666"><img src="https://pic.example/zhihu-video.jpg"></a></p>')
assert.ok(lensOnlyZhihuVideoCard.includes('href="https://www.zhihu.com/video/2081068623192224666"'), '只有 data-lens-id 的知乎视频也必须恢复成可播放视频页')

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
