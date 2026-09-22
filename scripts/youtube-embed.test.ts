/**
 * 验证：YouTube iframe 白名单 + Arena 文页不再被误判成纯视频。
 * npx tsx scripts/youtube-embed.test.ts [path/to/arena-article.html]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

import { sanitizeArticleHtml } from '../src/lib/sanitize'
import { hotlinkFallbackReferer, needsMediaHotlinkBypass } from '../src/lib/mediaFetch'
import {
  describeYoutubeEmbed,
  isYoutubeCustomPlayable,
  stageYoutubeEmbedsInHtml,
  YOUTUBE_STAGED_SRC_ATTR,
} from '../src/lib/youtubeEmbeds'
import type { MediaDescriptor } from '../src/features/mediaSniffer/types'
import { parseHTML } from 'linkedom'

const withIframe =
  '<p>Hello world content about fullstack arena that is long enough for a paragraph.</p>' +
  '<iframe src="https://www.youtube.com/embed/Eu-gcfuxGn8" title="t" width="560" height="315"></iframe>' +
  '<iframe referrerpolicy="no-referrer" src="https://www.youtube-nocookie.com/embed/fEudbAjschs?start=0&amp;wmode=transparent"></iframe>' +
  '<iframe src="https://evil.example/embed/x" title="x"></iframe>'

const cleaned = sanitizeArticleHtml(withIframe)
if (!cleaned.includes('youtube.com/embed/Eu-gcfuxGn8')) {
  throw new Error('youtube embed was stripped')
}
if (cleaned.includes('evil.example')) {
  throw new Error('non-youtube iframe was kept')
}
const youtubeIframes = cleaned.match(/<iframe\b[^>]*youtube[^>]*>/gi) || []
if (youtubeIframes.length !== 2) {
  throw new Error(`expected two youtube embeds, got ${youtubeIframes.length}`)
}
if (
  youtubeIframes.some(
    (iframe) => !/referrerpolicy="strict-origin-when-cross-origin"/i.test(iframe),
  )
) {
  throw new Error('youtube embed referrer policy was not normalized')
}
if (/referrerpolicy="no-referrer"/i.test(cleaned)) {
  throw new Error('publisher no-referrer policy was kept on youtube embed')
}
console.log('sanitize youtube whitelist: ok')

{
  const bilibili = sanitizeArticleHtml(
    '<iframe width="640" height="360" allow="camera; microphone; autoplay" ' +
      'src="https://www.bilibili.com/blackboard/html5mobileplayer.html?bvid=BV1TEST123"></iframe>' +
      '<iframe src="https://player.bilibili.com/not-a-player.html?bvid=BV1TEST123"></iframe>' +
      '<iframe src="https://evil.example/embed/x"></iframe>',
  )
  assert.match(bilibili, /bilibili\.com\/blackboard\/html5mobileplayer\.html/)
  assert.match(bilibili, /data-reader-role="trusted-video-embed"/)
  assert.match(bilibili, /allow="autoplay; fullscreen; picture-in-picture"/)
  assert.doesNotMatch(bilibili, /camera|microphone/)
  assert.doesNotMatch(bilibili, /not-a-player|evil\.example/)
  assert.doesNotMatch(bilibili, /width="640"|height="360"/)
}
console.log('sanitize trusted video embed whitelist: ok')

const staged = stageYoutubeEmbedsInHtml(cleaned)
const { document } = parseHTML(`<article>${staged}</article>`)
const stagedIframes = Array.from(document.querySelectorAll('iframe'))
if (stagedIframes.length !== 2) {
  throw new Error(`expected two staged youtube embeds, got ${stagedIframes.length}`)
}
for (const iframe of stagedIframes) {
  if (iframe.getAttribute('src')) throw new Error('staged youtube iframe loaded too early')
  if (!iframe.getAttribute(YOUTUBE_STAGED_SRC_ATTR)) {
    throw new Error('staged youtube iframe lost its source')
  }
  const descriptor = describeYoutubeEmbed(iframe, 'Fallback title', 'https://localhost/')
  if (!descriptor?.thumbnail.includes(`/vi/${descriptor.videoId}/hqdefault.jpg`)) {
    throw new Error('youtube loading thumbnail was not derived')
  }
}
console.log('youtube loading stage: ok')

function youtubeDescriptor(partial: Partial<MediaDescriptor> & Pick<MediaDescriptor, 'type' | 'url'>): MediaDescriptor {
  return {
    pageUrl: 'https://www.youtube.com/embed/Eu-gcfuxGn8',
    score: 1,
    videoTracks: [],
    audioTracks: [],
    subtitles: [],
    drm: false,
    drmKeySystems: [],
    ...partial,
  }
}

{
  assert.equal(
    isYoutubeCustomPlayable(
      youtubeDescriptor({
        type: 'progressive',
        url: 'https://rr1---sn-abc.googlevideo.com/videoplayback?id=video-only&mime=video%2Fmp4',
      }),
    ),
    false,
    '无 hasAudio 的 googlevideo 不得交给自定义播放器',
  )
  assert.equal(
    isYoutubeCustomPlayable(
      youtubeDescriptor({
        type: 'progressive',
        url: 'https://rr1---sn-abc.googlevideo.com/videoplayback?id=video-only&mime=video%2Fmp4',
        hasAudio: false,
      }),
    ),
    false,
    'video-only 自适应轨必须保留原站 iframe',
  )
  assert.equal(
    isYoutubeCustomPlayable(
      youtubeDescriptor({
        type: 'progressive',
        url: 'https://rr1---sn-abc.googlevideo.com/videoplayback?id=muxed&mime=video%2Fmp4',
        hasAudio: true,
      }),
    ),
    true,
    '明确的 muxed 资源可以进自定义播放器',
  )
  assert.equal(
    isYoutubeCustomPlayable(
      youtubeDescriptor({
        type: 'progressive',
        url: 'https://rr1---sn-abc.googlevideo.com/videoplayback?id=drm',
        hasAudio: true,
        drm: true,
      }),
    ),
    false,
  )
}

{
  const googlevideo = 'https://rr5---sn-i3b7knld.googlevideo.com/videoplayback?expire=1'
  assert.equal(needsMediaHotlinkBypass(googlevideo), true, 'googlevideo 必须走原生请求桥，避免 localhost Origin 403')
  assert.equal(hotlinkFallbackReferer(googlevideo), 'https://www.youtube.com/')
  assert.equal(needsMediaHotlinkBypass('https://cdn.example/video.mp4'), false)
}

const fixture = process.argv[2]
if (!fixture) {
  console.log('youtube-embed: ok (sanitize only)')
  process.exit(0)
}

const html = readFileSync(fixture, 'utf8')
const { resolveArticleBody } = await import('../src/lib/resolveBody')

const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('/api/page') || url.includes('arena.ai/blog')) {
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }
  return originalFetch(input)
}) as typeof fetch

try {
  const body = await resolveArticleBody({
    id: 'arena:test',
    title: 'Build, Deploy, and Evaluate with Fullstack Code Arena',
    summary: '',
    publishedAt: Date.now(),
    hasRealDate: true,
    sourceId: 'arena',
    sourceName: 'Arena Blog',
    sourceLabel: 'Arena',
    sourceGroup: 'ai',
    originUrl: 'https://arena.ai/blog/fullstack-code-arena',
  })

  const text = body.contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (/站内无法嵌入\s*YouTube|无法嵌入 YouTube/i.test(body.contentHtml)) {
    throw new Error('still showing youtube fallback placeholder')
  }
  if (text.length < 400) {
    throw new Error(`extracted body too short: ${text.length}`)
  }
  if (!/youtube\.com\/embed\/Eu-gcfuxGn8/i.test(body.contentHtml)) {
    throw new Error('youtube embed missing from extracted body')
  }
  if (!/Database Integration|fullstack/i.test(text)) {
    throw new Error('article prose missing from extracted body')
  }
  console.log(`arena article extract: ok (text=${text.length})`)
} finally {
  globalThis.fetch = originalFetch
}
