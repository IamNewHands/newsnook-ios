import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { feedArticleId } from '../src/lib/articleId'
import { articleFromSharePayload, buildShareUrl, parseShareUrl, sharePayloadFromArticle } from '../src/lib/shareLink'
import { decodeZhihuContentDetail } from '../src/features/zhihu/api/decode'
import { zhihuEntityUrl } from '../src/features/zhihu/api/endpoints'
import { parseZhihuJson } from '../src/features/zhihu/api/json'
import { toNewsArticle } from '../src/features/zhihu/content/bridge'
import { normalizeZhihuContentHtml } from '../src/features/zhihu/content/normalize'
import { parseZhihuCommentDeepLink, parseZhihuLink, parseZhihuVideoId } from '../src/features/zhihu/content/links'
import { ZhihuContentService } from '../src/features/zhihu/content/service'
import { ZhihuAnswerMeta } from '../src/features/zhihu/ui/ZhihuUi'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

assert.deepEqual(
  parseZhihuLink('https://www.zhihu.com/question/123/answer/456'),
  { kind: 'answer', id: '456' },
)
assert.deepEqual(parseZhihuLink('https://www.zhihu.com/question/123'), { kind: 'question', id: '123' })
assert.deepEqual(parseZhihuLink('https://zhuanlan.zhihu.com/p/789'), { kind: 'article', id: '789' })
assert.deepEqual(parseZhihuLink('https://www.zhihu.com/people/example-user'), { kind: 'people', id: 'example-user' })
assert.equal(parseZhihuLink('https://example.com/question/123'), null)
assert.deepEqual(
  parseZhihuCommentDeepLink('zhihu://comment/list/answer/2?anchor_comment_id=3'),
  { ref: { kind: 'answer', id: '2' }, commentId: '3' },
  '评论通知的 zhihu:// deep link 必须在应用内解析，不能交给外部 Browser',
)
assert.equal(parseZhihuCommentDeepLink('zhihu://comment/list/answer/2'), null, '缺少 anchor_comment_id 的评论 deep link 不得伪造目标')
assert.equal(parseZhihuVideoId('https://www.zhihu.com/video/2081068623192224666'), '2081068623192224666')
assert.equal(parseZhihuVideoId('https://www.zhihu.com/question/123'), null)

const answerUrl = zhihuEntityUrl({ kind: 'answer', id: '2027676063409484209' })
assert.match(answerUrl ?? '', /include=/)
assert.doesNotMatch(decodeURIComponent(answerUrl ?? ''), /pagination_info/, '回答详情不得请求不保证默认排序的上下回答 ID')
const pagedDetail = decodeZhihuContentDetail(parseZhihuJson(`{
  "id": 2027676063409484209,
  "type": "answer",
  "content": "<p>正文</p>",
  "editable_content": "<p data-pid='editable'>可编辑正文</p>",
  "created_time": 1700000000,
  "updated_time": 1700003600,
  "ip_info": "上海",
  "question": { "id": 423780782, "title": "问题" },
  "pagination_info": {
    "index": 12,
    "prev_answer_ids": [2027000000000000001],
    "next_answer_ids": [2028000000000000002, 2028000000000000003]
  }
}`))
assert.equal(pagedDetail?.ref.id, '2027676063409484209')
assert.equal(pagedDetail?.editableContentHtml, "<p data-pid='editable'>可编辑正文</p>", '编辑已有回答必须保留 editable_content，而不是把阅读 HTML 回写')
// 解码器继续兼容偶尔随详情返回的字段，但回答导航不会消费它们。
assert.deepEqual(pagedDetail?.previousAnswerIds, ['2027000000000000001'])
assert.deepEqual(pagedDetail?.nextAnswerIds, ['2028000000000000002', '2028000000000000003'])
assert.equal(pagedDetail?.createdAt, 1700000000)
assert.equal(pagedDetail?.updatedAt, 1700003600)
assert.equal(pagedDetail?.ipLocation, '上海')

const answerMeta = renderToStaticMarkup(React.createElement(ZhihuAnswerMeta, {
  createdAt: pagedDetail.createdAt,
  updatedAt: pagedDetail.updatedAt,
  ipLocation: pagedDetail.ipLocation,
}))
assert.match(answerMeta, /发布于/)
assert.match(answerMeta, /编辑于/)
assert.match(answerMeta, /IP 属地/)
assert.match(answerMeta, /上海/)

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

const videoCalls: Array<{ operation: string; url: string; body: unknown }> = []
const videoService = new ZhihuContentService({
  async getJson() {
    throw new Error('not used')
  },
  async postJsonWithHeaders(operation, url, _headers, body) {
    videoCalls.push({ operation, url, body })
    return {
      video_play: {
        playlist: {
          mp4: [
            { bitrate: 480, url: ['https://video.example/480.mp4'] },
            { bitrate: 1080, url: ['https://video.example/1080.mp4'] },
            { bitrate: 720, url: ['https://video.example/720.mp4'] },
          ],
        },
      },
    }
  },
})
const playback = await videoService.readVideo('2080667445237319967', { kind: 'answer', id: 'answer-1' })
assert.equal(playback?.url, 'https://video.example/1080.mp4', '知乎视频应优先使用 play_info 返回的最高 bitrate MP4')
assert.equal(videoCalls[0]?.operation, 'video.play-info')
assert.match(videoCalls[0]?.url ?? '', /\/api\/v4\/video\/play_info\?r=2080667445237319967$/)
assert.deepEqual(videoCalls[0]?.body, {
  content_id: 'answer-1',
  content_type_str: 'answer',
  video_id: '2080667445237319967',
  scene_code: 'answer_detail_web',
  is_only_video: true,
})

const zhihuContentScreenSource = readFileSync(new URL('../src/features/zhihu/ui/ZhihuContentScreen.tsx', import.meta.url), 'utf8')
const zhihuWorkspaceSource = readFileSync(new URL('../src/features/zhihu/ui/ZhihuWorkspace.tsx', import.meta.url), 'utf8')
const inlineVideoPagesSource = readFileSync(new URL('../src/components/InlineVideoPages.tsx', import.meta.url), 'utf8')
assert.match(zhihuContentScreenSource, /<InlineVideoPages/, '知乎回答正文必须原地挂载 video-page 播放器')
assert.doesNotMatch(zhihuContentScreenSource, /videoPage &&/, '知乎视频不能再通过二级全屏视频页播放')
assert.match(zhihuContentScreenSource, /useSpeedRead/, '知乎正文必须复用统一 AI 速读生命周期')
assert.match(zhihuContentScreenSource, /\['answer', 'article', 'pin'\]/, '速读范围只能覆盖回答、文章与想法，不把问题壳当正文')
assert.match(zhihuContentScreenSource, /zhihu-answer/, '知乎回答必须使用独立的回答速读提示词档案')
assert.match(zhihuContentScreenSource, /zhihu:\$\{refValue\.kind\}:\$\{refValue\.id\}/, '每个知乎实体必须拥有独立本地速读缓存身份')
assert.match(zhihuContentScreenSource, /onSpeedReadHeaderActionChange/, '正文速读状态必须上送工作区顶部栏')
assert.match(zhihuWorkspaceSource, /<span>AI 速读<\/span>/, '知乎速读入口必须常驻工作区顶部栏')
assert.doesNotMatch(zhihuContentScreenSource, /<span>AI 速读<\/span>/, '正文头部不应重复显示速读入口')
assert.match(inlineVideoPagesSource, /<OriginPlayerSurface[\s\S]*embedded/, '通用嗅探失败时也必须在正文原位显示原站播放表面')
assert.match(inlineVideoPagesSource, /resolveDirect/, '知乎已知视频协议应优先直取播放源，避免先展示原站页面')

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
