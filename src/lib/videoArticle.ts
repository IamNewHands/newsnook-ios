import type { Article } from './types'

/**
 * 通用视频条目标识。
 *
 * Feed 里的“视频”不一定直接给 mp4/m3u8：
 * RSSHub / YouTube / Vimeo 等常把播放器页放在 iframe 或 attachment(text/html) 中。
 * 这里仅识别明确的视频页面/媒体信号，避免把普通文章中的任意 iframe 误判为视频。
 */

const DIRECT_VIDEO_EXT = /\.(?:mp4|m4v|webm|mov|m3u8|mpd)(?:$|[?#])/i

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}

export function isDirectVideoMediaUrl(url?: string, mimeType = ''): boolean {
  if (!url) return false
  return /^video\//i.test(mimeType.trim()) || DIRECT_VIDEO_EXT.test(url)
}

export function isLikelyEmbeddedVideoPageUrl(url?: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(decodeHtmlAttribute(url.trim()))
    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname.toLowerCase()

    if (
      (host === 'player.bilibili.com' && path === '/player.html') ||
      ((host === 'www.bilibili.com' || host === 'bilibili.com') &&
        /^\/blackboard\/(?:html5mobileplayer|newplayer)\.html$/i.test(path))
    ) {
      return true
    }

    if (
      (host === 'www.youtube.com' || host === 'youtube.com' || host === 'www.youtube-nocookie.com') &&
      path.startsWith('/embed/')
    ) {
      return true
    }

    if (host === 'player.vimeo.com' && path.startsWith('/video/')) return true

    return false
  } catch {
    return false
  }
}

export function isLikelyVideoArticleUrl(url?: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname

    if (
      (host === 'www.bilibili.com' || host === 'bilibili.com' || host.endsWith('.bilibili.com')) &&
      /^\/video\/(?:BV[\w-]+|av\d+)/i.test(path)
    ) {
      return true
    }

    if (host === 'youtu.be' && path.length > 1) return true
    if (
      (host === 'www.youtube.com' || host === 'youtube.com') &&
      (path === '/watch' || path.startsWith('/shorts/') || path.startsWith('/live/'))
    ) {
      return true
    }

    if ((host === 'vimeo.com' || host === 'www.vimeo.com') && /^\/\d+(?:\/|$)/.test(path)) {
      return true
    }

    return false
  } catch {
    return false
  }
}

export function extractEmbeddedVideoPageUrl(html?: string): string | undefined {
  if (!html) return undefined
  const iframePattern = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = iframePattern.exec(html))) {
    const candidate = decodeHtmlAttribute(match[1])
    if (isLikelyEmbeddedVideoPageUrl(candidate)) return candidate
  }
  return undefined
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 将 Feed 已明确给出的受信播放器页重建成最小 iframe。
 * 不复用上游任意 iframe 属性，避免把 allow/style/event handler 等一起带进阅读器。
 */
export function trustedEmbeddedVideoFrameHtml(
  html: string | undefined,
  title = '视频',
): string | undefined {
  const src = extractEmbeddedVideoPageUrl(html)
  if (!src) return undefined
  return [
    '<iframe',
    ` src="${escapeHtmlAttribute(src)}"`,
    ` title="${escapeHtmlAttribute(title)}"`,
    ' loading="lazy"',
    ' referrerpolicy="strict-origin-when-cross-origin"',
    ' allow="autoplay; fullscreen; picture-in-picture"',
    ' allowfullscreen',
    ' frameborder="0"',
    ' data-reader-role="trusted-video-embed"',
    '></iframe>',
  ].join('')
}

export function extractDirectVideoUrlFromHtml(html?: string): string | undefined {
  if (!html) return undefined
  const patterns = [
    /<video\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi,
    /<source\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
  ]
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(html))) {
      const candidate = decodeHtmlAttribute(match[1])
      if (isDirectVideoMediaUrl(candidate)) return candidate
    }
  }
  return undefined
}

function firstImageUrl(html?: string): string | undefined {
  const raw = html?.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]
  if (!raw) return undefined
  const candidate = decodeHtmlAttribute(raw)
  return /^https?:\/\//i.test(candidate) ? candidate : undefined
}

/**
 * 兼容升级前已经落盘的自定义 Feed：旧版本把 RSSHub/Bilibili 视频当文章缓存。
 * 只在存在强视频信号时升级类型，不改普通文章。
 */
export function normalizeLegacyVideoArticle(article: Article): Article {
  if (article.contentType === 'video') return article

  const playerPageUrl = extractEmbeddedVideoPageUrl(article.contentHtml)
  const directVideoUrl = article.videoUrl || extractDirectVideoUrlFromHtml(article.contentHtml)
  if (!playerPageUrl && !directVideoUrl && !isLikelyVideoArticleUrl(article.originUrl)) {
    return article
  }

  const image = isLikelyEmbeddedVideoPageUrl(article.image)
    ? firstImageUrl(article.contentHtml) || article.image
    : article.image

  return {
    ...article,
    contentType: 'video',
    image,
    videoUrl: directVideoUrl,
  }
}
