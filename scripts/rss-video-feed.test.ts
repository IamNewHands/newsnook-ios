import assert from 'node:assert/strict'

import { parseSourcePayload } from '../src/lib/parseFeed'
import {
  extractEmbeddedVideoPageUrl,
  normalizeLegacyVideoArticle,
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

const legacy = normalizeLegacyVideoArticle({
  ...bilibiliArticle,
  contentType: 'article',
  videoUrl: undefined,
})
assert.equal(legacy.contentType, 'video', '升级前缓存的 Bilibili 条目应在读缓存时自动迁移')
assert.equal(legacy.videoUrl, undefined)

console.log('rss-video-feed: ok')
