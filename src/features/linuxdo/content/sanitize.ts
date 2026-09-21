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

function copySemanticAttribute(element: Element, source: string, target: string): void {
  const value = element.getAttribute(source)?.trim()
  if (value) element.setAttribute(target, value)
}

function markDiscourseSemantics(root: Element): void {
  root.querySelectorAll('aside.quote').forEach((quote) => {
    quote.setAttribute('data-linuxdo-role', 'quote')
    copySemanticAttribute(quote, 'data-topic', 'data-linuxdo-topic-id')
    copySemanticAttribute(quote, 'data-post', 'data-linuxdo-post-number')
    copySemanticAttribute(quote, 'data-username', 'data-linuxdo-username')
    quote.removeAttribute('data-topic')
    quote.removeAttribute('data-post')
    quote.removeAttribute('data-username')
    quote.querySelectorAll('.title').forEach((element, index) => {
      if (index === 0) element.setAttribute('data-linuxdo-role', 'quote-header')
    })
    quote.querySelectorAll('.quote-controls').forEach((element) => element.setAttribute('data-linuxdo-role', 'quote-controls'))
    const body = quote.querySelector('blockquote')
    if (body) body.setAttribute('data-linuxdo-role', 'quote-body')
  })

  root.querySelectorAll('aside.onebox, .onebox').forEach((onebox) => {
    const className = onebox.getAttribute('class') ?? ''
    const target = onebox.querySelector('a[href]')
    const href = absoluteLinuxDoUrl(onebox.getAttribute('data-onebox-src') ?? target?.getAttribute('href') ?? null)
    const hrefUrl = href ? new URL(href) : undefined
    const localTopic =
      /(?:^|\s)discourse(?:topic|local-date)?(?:\s|$)/i.test(className) ||
      /(?:^|\s)discourse-topic(?:\s|$)/i.test(className) ||
      Boolean(hrefUrl?.hostname === 'linux.do' && /^\/t\//.test(hrefUrl.pathname))
    onebox.setAttribute('data-linuxdo-role', localTopic ? 'onebox-topic' : 'onebox')
    onebox.setAttribute('data-linuxdo-onebox-kind', localTopic ? 'topic' : 'external')
    if (href) onebox.setAttribute('data-linuxdo-href', href)
    onebox.removeAttribute('data-onebox-src')
    onebox.querySelectorAll('header, .source').forEach((element) => element.setAttribute('data-linuxdo-role', 'onebox-source'))
    onebox.querySelectorAll('.onebox-body, article').forEach((element) => element.setAttribute('data-linuxdo-role', 'onebox-body'))
    onebox.querySelectorAll('h3, h4').forEach((element) => element.setAttribute('data-linuxdo-role', 'onebox-title'))
    onebox.querySelectorAll('p').forEach((element) => element.setAttribute('data-linuxdo-role', 'onebox-description'))
    onebox.querySelectorAll('.category, .topic-category').forEach((element) => element.setAttribute('data-linuxdo-role', 'onebox-category'))
    onebox.querySelectorAll('.discourse-tags, .topic-tags').forEach((element) => element.setAttribute('data-linuxdo-role', 'onebox-tags'))
  })

  root.querySelectorAll('a.mention').forEach((element) => element.setAttribute('data-linuxdo-role', 'mention'))
  root.querySelectorAll('a.mention-group').forEach((element) => element.setAttribute('data-linuxdo-role', 'mention-group'))
  root.querySelectorAll('.spoiler, .spoiled, [data-spoiler-state]').forEach((element) => element.setAttribute('data-linuxdo-role', 'spoiler'))
  root.querySelectorAll('details').forEach((element) => element.setAttribute('data-linuxdo-role', 'details'))
  root.querySelectorAll('.poll').forEach((element) => element.setAttribute('data-linuxdo-role', 'poll'))
  root.querySelectorAll('table').forEach((element) => element.setAttribute('data-linuxdo-role', 'table'))
  root.querySelectorAll('pre').forEach((element) => element.setAttribute('data-linuxdo-role', 'code-block'))
  root.querySelectorAll('a.attachment').forEach((element) => element.setAttribute('data-linuxdo-role', 'attachment'))
}

function normalizeDiscourseMarkup(html: string): string {
  if (!html.trim()) return ''

  try {
    const { document } = parseHTML('<!doctype html><html><body></body></html>')
    document.body.innerHTML = html
    markDiscourseSemantics(document.body)

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
      const fullSize = absoluteLinuxDoUrl(element.getAttribute('href'))
      const image = element.querySelector('img')
      if (fullSize && image) image.setAttribute('data-linuxdo-original-src', fullSize)
      // Discourse uses this anchor only to launch its own lightbox. NewsNook owns
      // image preview, so leaving href here risks opening the browser as a second action.
      element.removeAttribute('href')
      element.setAttribute('data-linuxdo-role', 'image-link')
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
        if (!element.getAttribute('data-linuxdo-original-src')) element.setAttribute('data-linuxdo-original-src', src)
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

      const onebox = element.closest('[data-linuxdo-role="onebox"], [data-linuxdo-role="onebox-topic"]')
      const quoteHeader = element.closest('[data-linuxdo-role="quote-header"]')
      if (isEmoji) {
        element.setAttribute('data-linuxdo-role', 'emoji')
        element.setAttribute('data-reader-role', 'badge')
        element.setAttribute('width', '20')
        element.setAttribute('height', '20')
      } else if (quoteHeader) {
        element.setAttribute('data-linuxdo-role', 'quote-avatar')
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
