import { parseHTML } from 'linkedom'

import { inferImageDisplayRole } from './normalizeImages'
import type { Article } from './types'

const PLACEHOLDER_RE = /(?:\/images\/v2\/t\.png|spacer\.gif|lazy\.png|placeholder|1x1)\b/i

/** Only durable upstream image URLs belong in article metadata. */
export function previewImageUrl(value: unknown, baseUrl?: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const raw = value.trim().replace(/&amp;/gi, '&')
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw, baseUrl)
    if (!/^https?:$/.test(url.protocol)) return undefined
    // Reader HTML can contain a local Web image proxy; list images choose their own transport.
    if (url.pathname === '/api/image' && url.searchParams.has('url')) {
      const original = new URL(url.searchParams.get('url')!)
      if (!/^https?:$/.test(original.protocol)) return undefined
      return previewImageUrl(original.href)
    }
    if (PLACEHOLDER_RE.test(url.href)) return undefined
    if (/\.(?:pdf|zip|docx?|xlsx?|mp[34]|m4[av]|webm|ogg|wav)(?:$|[?#])/i.test(url.href)) return undefined
    return url.href
  } catch { return undefined }
}

export function firstImageIn(html: string, baseUrl?: string): string | undefined {
  if (!/<img\b/i.test(html)) return undefined
  const { document } = parseHTML(html)
  for (const img of Array.from(document.querySelectorAll('img'))) {
    if (img.getAttribute('data-reader-role') === 'badge' || inferImageDisplayRole(img) !== 'content') continue
    for (const name of ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc', 'data-url', 'data-preview', 'src', 'data-srcset', 'srcset']) {
      const raw = img.getAttribute(name)
      const candidates = name.endsWith('srcset') ? (raw ?? '').split(',').map((part) => part.trim().split(/\s+/)[0]) : [raw]
      for (const candidate of candidates) {
        const url = previewImageUrl(candidate, baseUrl)
        if (url) return url
      }
    }
    const advance = img.getAttribute('data-advance')
    if (advance) {
      try {
        const entries = JSON.parse(atob(advance)) as Array<{ Url?: string; url?: string }>
        for (const entry of entries) {
          const url = previewImageUrl(entry.Url || entry.url, baseUrl)
          if (url) return url
        }
      } catch { /* Ignore malformed lazy image payloads. */ }
    }
  }
  return undefined
}

/** Enrich missing covers without mutating the article or replacing an upstream cover. */
export function withArticlePreviewImage(article: Article, html: string, image?: string): Article {
  if (article.image) return article
  const cover = previewImageUrl(image, article.originUrl) ?? firstImageIn(html, article.originUrl)
  return cover ? { ...article, image: cover } : article
}
