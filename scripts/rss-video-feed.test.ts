import assert from 'node:assert/strict'

import { parseSourcePayload } from '../src/lib/parseFeed'
import { resolveArticleBody } from '../src/lib/resolveBody'
import {
  extractEmbeddedVideoPageUrl,
  isLikelyEmbeddedVideoPageUrl,
  normalizeLegacyVideoArticle,
  trustedEmbeddedVideoFrameHtml,
} from '../src/lib/videoArticle'
import type { NewsSource } from '../src/sources/registry'

const source: NewsSource = {
  id: 'custom_rsshub_bilibili',
  name: 'B站视频',
  label: 'B站',
  group: 'custom',
  kind: 'feed',
  url: 'http://81.69.248.93:1200/bilibili/user/video/67079745',
  enabled: true,
  isCustom: true,
}

const bilibiliXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><item>
  <title><![CDATA[手机里有个偷听功能，记得一定要关闭掉！]]></title>
  <link>https://www.bilibili.com/video/BV1TEST123</link>
  <description><![CDATA[
    <iframe width="640" height="360" src="https://www.bilibili.com/blackboard/html5mobileplayer.html?aid=123&bvid=BV1TEST123" frameborder="0" allowfullscreen></iframe>
    <br>
    <img src="https://i0.hdslb.com/bfs/archive/example.jpg">
    <br>
    视频简介正文
  ]]></description>
  <enclosure url="https://www.bilibili.com/blackboard/newplayer.html?bvid=BV1TEST123" type="text/html" />
  <pubDate>Mon, 21 Sep 2026 12:00:00 GMT</pubDate>
</item></channel></rss>`

const [bilibiliArticle] = parseSourcePayload(source, bilibiliXml)
assert.ok(bilibiliArticle)
assert.equal(bilibiliArticle.contentType, 'video', 'Bilibili/RSSHub 视频条目必须识别为 video')
assert.equal(
  bilibiliArticle.videoUrl,
  undefined,
  'text/html 播放器页不能伪装成可直接交给 <video> 的媒体 URL',
)
assert.equal(
  bilibiliArticle.image,
  'https://i0.hdslb.com/bfs/archive/example.jpg',
  'text/html enclosure 不能抢占真正的封面图',
)
assert.match(bilibiliArticle.summary, /视频简介正文/)
assert.equal(
  extractEmbeddedVideoPageUrl(bilibiliArticle.contentHtml),
  'https://www.bilibili.com/blackboard/html5mobileplayer.html?aid=123&bvid=BV1TEST123',
  '应优先提取 Feed 已提供的轻量播放器页供原生可见表面使用',
)

const directVideoXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><item>
  <title>直接视频附件</title>
  <link>https://example.com/posts/1</link>
  <description><![CDATA[<p>直接视频</p>]]></description>
  <enclosure url="https://cdn.example.com/video/1.mp4" type="video/mp4" />
</item></channel></rss>`

const [directArticle] = parseSourcePayload(source, directVideoXml)
assert.ok(directArticle)
assert.equal(directArticle.contentType, 'video')
assert.equal(directArticle.videoUrl, 'https://cdn.example.com/video/1.mp4')

const jsonFeed = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'B站视频 JSON Feed',
  items: [
    {
      id: 'bili-2',
      title: 'JSON Feed 视频',
      url: 'https://www.bilibili.com/video/BV1JSON123',
      content_html:
        '<iframe src="https://www.bilibili.com/blackboard/html5mobileplayer.html?bvid=BV1JSON123"></iframe><img src="https://i0.hdslb.com/bfs/archive/json.jpg"><p>JSON 简介</p>',
      attachments: [
        {
          url: 'https://www.bilibili.com/blackboard/newplayer.html?bvid=BV1JSON123',
          mime_type: 'text/html',
        },
      ],
    },
  ],
})

const [jsonArticle] = parseSourcePayload(source, jsonFeed)
assert.ok(jsonArticle)
assert.equal(jsonArticle.contentType, 'video')
assert.equal(jsonArticle.videoUrl, undefined)
assert.equal(jsonArticle.image, 'https://i0.hdslb.com/bfs/archive/json.jpg')

const longForm = `<p>${'这是包含视频但仍应完整阅读的周刊正文。'.repeat(55)}</p><video controls><source src="https://cdn.example.com/demo.mp4" type="video/mp4"></video><p>更多图文内容</p>`
const mixedXml = `<rss version="2.0"><channel><item><title>带视频的长文章</title><link>https://example.com/posts/286/</link><description><![CDATA[${longForm}]]></description></item></channel></rss>`
const [mixedArticle] = parseSourcePayload(source, mixedXml)
assert.equal(mixedArticle.contentType, 'article', '长图文内嵌视频时不能把整个条目变成视频摘要')
assert.equal(mixedArticle.videoUrl, undefined)
assert.equal(normalizeLegacyVideoArticle(mixedArticle).contentType, 'article', '旧缓存升级不能再误判长图文')
assert.equal(normalizeLegacyVideoArticle({ ...mixedArticle, contentType: 'video', videoUrl: 'https://cdn.example.com/demo.mp4' }).contentType, 'article', '修复已经缓存的错误视频类型')
const mixedResolved = await resolveArticleBody(mixedArticle)
assert.equal(mixedResolved.bodySource, 'feed', '带视频的长文章必须保留 RSS 全文')
assert.match(mixedResolved.contentHtml, /更多图文内容/)

// An embedded player is not an article-level video declaration. Even compact
// editorials must not silently become a 220-character video teaser.
const briefEditorial = `<p>${'带视频的文章有多段简短的叙述，应该继续显示正文。'.repeat(8)}</p><video controls><source src="https://cdn.example.com/embedded.mp4"></video><p>文章收尾</p>`
const briefXml = `<rss version="2.0"><channel><item><title>含视频的短图文</title><link>https://example.com/posts/12/</link><description><![CDATA[${briefEditorial}]]></description></item></channel></rss>`
const [briefArticle] = parseSourcePayload(source, briefXml)
assert.equal(briefArticle.contentType, 'article', '短图文不能仅因为有 <video> 就被归为纯视频')
assert.equal(briefArticle.videoUrl, undefined)
assert.equal(normalizeLegacyVideoArticle({ ...briefArticle, contentType: 'video', videoUrl: 'https://cdn.example.com/embedded.mp4' }).contentType, 'article')

const briefJson = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: '混合内容 JSON Feed',
  items: [{ id: 'short-1', title: '短篇图文', url: 'https://example.com/posts/13/', content_html: briefEditorial }],
})
assert.equal(parseSourcePayload(source, briefJson)[0]?.contentType, 'article', 'JSON Feed 使用相同的正文优先规则')

// An explicit video enclosure must still win over editorial copy; a video-only
// entry without copy must also retain its existing playback behavior.
const explicitVideoXml = `<rss version="2.0"><channel><item><title>明确的视频附件</title><link>https://example.com/video/21</link><description><![CDATA[${briefEditorial}]]></description><enclosure url="https://cdn.example.com/video/21.mp4" type="video/mp4" /></item></channel></rss>`
assert.equal(parseSourcePayload(source, explicitVideoXml)[0]?.contentType, 'video')
const [explicitArticle] = parseSourcePayload(source, explicitVideoXml)
assert.equal(normalizeLegacyVideoArticle(explicitArticle).contentType, 'video', '真正的视频附件不能被缓存兼容逻辑误降级')
// Atom uses rel="enclosure" rather than RSS <enclosure>.
const enclosureAtom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom 视频附件</title><link rel="alternate" href="https://example.com/posts/15/"/><link rel="enclosure" href="https://cdn.example.com/atom.mp4" type="video/mp4"/><content type="html"><![CDATA[${briefEditorial}]]></content></entry></feed>`
assert.equal(parseSourcePayload(source, enclosureAtom)[0]?.contentType, 'video')

const videoOnlyXml = `<rss version="2.0"><channel><item><title>纯视频内容</title><link>https://example.com/posts/14/</link><description><![CDATA[<video controls src="https://cdn.example.com/only.mp4"></video>]]></description></item></channel></rss>`
assert.equal(parseSourcePayload(source, videoOnlyXml)[0]?.contentType, 'video')

const legacy = normalizeLegacyVideoArticle({
  ...bilibiliArticle,
  contentType: 'article',
  videoUrl: undefined,
})
assert.equal(legacy.contentType, 'video', '升级前缓存的 Bilibili 条目应在读缓存时自动迁移')
assert.equal(legacy.videoUrl, undefined)

assert.equal(
  isLikelyEmbeddedVideoPageUrl('https://player.bilibili.com/player.html?bvid=BV1TEST123'),
  true,
)
assert.equal(
  isLikelyEmbeddedVideoPageUrl('https://player.bilibili.com/not-a-player.html?bvid=BV1TEST123'),
  false,
  'Bilibili 白名单必须限定到官方播放器路径，不能放行整个 player 子域',
)
assert.match(
  trustedEmbeddedVideoFrameHtml(bilibiliArticle.contentHtml, bilibiliArticle.title) ?? '',
  /data-reader-role="trusted-video-embed"/,
)

{
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  try {
    globalThis.fetch = (async () => {
      fetchCalls += 1
      throw new Error('web trusted embed should not fetch the Bilibili article page first')
    }) as typeof fetch

    const resolved = await resolveArticleBody(bilibiliArticle)
    assert.equal(resolved.bodySource, 'video')
    assert.match(
      resolved.contentHtml,
      /src="https:\/\/www\.bilibili\.com\/blackboard\/html5mobileplayer\.html\?aid=123&bvid=BV1TEST123"/,
      'Web 必须直接保留 RSSHub 已提供的 Bilibili 官方播放器',
    )
    assert.match(resolved.contentHtml, /data-reader-role="trusted-video-embed"/)
    assert.doesNotMatch(resolved.contentHtml, /data-media-pending=/)
    assert.doesNotMatch(resolved.contentHtml, /width="640"|height="360"/)
    assert.equal(
      fetchCalls,
      0,
      '已有受信 embed 时 Web 不应先请求 /api/page，避免反爬/502 把可用播放器拖死',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
}

console.log('rss-video-feed: ok')
