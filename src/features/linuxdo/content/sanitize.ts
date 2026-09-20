import { parseHTML } from 'linkedom'

import { sanitizeArticleHtml } from '../../../lib/sanitize'

const LINUX_DO_ORIGIN = 'https://linux.do'

function absoluteLinuxDoUrl(value: string | null): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    const parsed = new URL(trimmed, LINUX_DO_ORIGIN)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
    return parsed.toString()
  } catch {
    return undefined
  }
}

function numericDimension(element: Element, name: 'width' | 'height'): number | undefined {
  const value = Number(element.getAttribute(name) ?? '')
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function normalizeDiscourseMarkup(html: string): string {
  if (!html.trim()) return ''

  try {
    const { document } = parseHTML('<!doctype html><html><body></body></html>')
    document.body.innerHTML = html

    // Discourse lightbox metadata (filename / dimensions / filesize) is UI chrome,
    // not post content. Once source classes are stripped by our generic sanitizer
    // it would otherwise become visible body text and create large layout gaps.
    document.body
      .querySelectorAll('.lightbox-wrapper .meta, a.lightbox .meta, .lightbox-wrapper .informations, .lightbox-wrapper .filename')
      .forEach((element) => element.remove())

    document.body.querySelectorAll('.lightbox-wrapper').forEach((element) => {
      element.setAttribute('data-linuxdo-role', 'image-block')
    })
    document.body.querySelectorAll('a.lightbox').forEach((element) => {
      element.setAttribute('data-linuxdo-role', 'image-link')
    })

    document.body.querySelectorAll('aside.onebox, .onebox').forEach((element) => {
      element.setAttribute('data-linuxdo-role', 'onebox')
    })

    document.body.querySelectorAll('a[href]').forEach((element) => {
      const href = absoluteLinuxDoUrl(element.getAttribute('href'))
      if (href) element.setAttribute('href', href)
      else element.removeAttribute('href')
    })

    document.body.querySelectorAll('img').forEach((element) => {
      const src = absoluteLinuxDoUrl(element.getAttribute('src'))
      if (src) {
        element.setAttribute('src', src)
        element.setAttribute('data-linuxdo-original-src', src)
      } else element.removeAttribute('src')

      // Source responsive candidates are generated for the Discourse layout and
      // can point at relative/CDN-specific variants. The canonical src is enough
      // here and avoids WebView choosing an unexpected candidate.
      element.removeAttribute('srcset')
      element.removeAttribute('sizes')

      const className = element.getAttribute('class') ?? ''
      const width = numericDimension(element, 'width')
      const height = numericDimension(element, 'height')
      const srcValue = (element.getAttribute('src') ?? '').toLowerCase()
      const isEmoji =
        /(?:^|\s)emoji(?:\s|$)/i.test(className) ||
        srcValue.includes('/images/emoji/') ||
        srcValue.includes('/emoji/') && width !== undefined && width <= 32 && height !== undefined && height <= 32

      const onebox = element.closest('aside.onebox, .onebox')
      if (isEmoji) {
        element.setAttribute('data-linuxdo-role', 'emoji')
        element.setAttribute('data-reader-role', 'badge')
        element.setAttribute('width', '20')
        element.setAttribute('height', '20')
      } else if (onebox) {
        element.setAttribute('data-linuxdo-role', 'onebox-image')
      } else {
        element.setAttribute('data-linuxdo-role', 'content-image')
      }

      element.setAttribute('loading', 'lazy')
      element.setAttribute('decoding', 'async')
    })

    document.body.querySelectorAll('p').forEach((element) => {
      const contentImage = element.querySelector('img[data-linuxdo-role="content-image"]')
      if (contentImage && !(element.textContent || '').trim()) {
        element.setAttribute('data-linuxdo-role', 'image-paragraph')
      }
    })

    document.body.querySelectorAll('video, source').forEach((element) => {
      const src = absoluteLinuxDoUrl(element.getAttribute('src'))
      if (src) element.setAttribute('src', src)
      else if (element.hasAttribute('src')) element.removeAttribute('src')
    })

    document.body.querySelectorAll('video[poster]').forEach((element) => {
      const poster = absoluteLinuxDoUrl(element.getAttribute('poster'))
      if (poster) element.setAttribute('poster', poster)
      else element.removeAttribute('poster')
    })

    return document.body.innerHTML
  } catch {
    return html
  }
}

export function sanitizeLinuxDoCooked(html: string): string {
  return sanitizeArticleHtml(normalizeDiscourseMarkup(html))
}
