import { parseHTML } from 'linkedom'

import { sanitizeArticleHtml } from '../../../lib/sanitize'

const ZHIHU_HOSTS = new Set(['zhihu.com', 'www.zhihu.com', 'zhuanlan.zhihu.com'])
const VIDEO_HOST_PATTERN = /(?:^|\.)(?:bilibili\.com|b23\.tv|youtube\.com|youtu\.be|vimeo\.com|douyin\.com|ixigua\.com)$/i
const CARD_CLASS_PATTERN = /(?:video-box|link-card|link-box|external-link|content-link)/i

function isOnlyMeaningfulChild(parent: Element, anchor: Element): boolean {
  for (const node of [...parent.childNodes]) {
    if (node === anchor) continue
    if (node.nodeType === 3 && !(node.nodeValue || '').trim()) continue
    if (node.nodeType === 1 && (node as Element).tagName === 'BR') continue
    return false
  }
  return true
}

function resolveLinkUrl(href: string): URL | null {
  try {
    const raw = new URL(href)
    if (raw.protocol !== 'https:' && raw.protocol !== 'http:') return null
    if (raw.hostname === 'link.zhihu.com') {
      const target = raw.searchParams.get('target')
      if (target) {
        try {
          const decoded = new URL(target)
          if (decoded.protocol === 'https:' || decoded.protocol === 'http:') return decoded
        } catch {
          // Keep the safe Zhihu redirect when the target is malformed.
        }
      }
    }
    return raw
  } catch {
    return null
  }
}

function hasBlockLinkSemantics(anchor: Element): boolean {
  return CARD_CLASS_PATTERN.test(anchor.getAttribute('class') || '')
    || CARD_CLASS_PATTERN.test(anchor.getAttribute('data-draft-type') || '')
    || CARD_CLASS_PATTERN.test(anchor.getAttribute('data-type') || '')
    || anchor.querySelector('img') != null
}

function bestLinkTitle(anchor: Element, url: URL): string {
  const explicit = [
    anchor.getAttribute('data-title'),
    anchor.getAttribute('aria-label'),
    anchor.querySelector('[data-title]')?.getAttribute('data-title'),
    anchor.querySelector('[class*=title]')?.textContent,
    anchor.textContent,
  ].find((value) => value?.replace(/\s+/g, ' ').trim())
  const title = explicit?.replace(/\s+/g, ' ').trim()
  return title && title !== anchor.getAttribute('href') ? title : url.hostname.replace(/^www\./, '')
}

function createExternalCard(document: Document, source: Element, url: URL): Element {
  const label = VIDEO_HOST_PATTERN.test(url.hostname) || /video/i.test(source.getAttribute('class') || '') ? '视频' : '外链'
  const title = bestLinkTitle(source, url)
  const card = document.createElement('a')
  card.setAttribute('href', url.href)
  card.setAttribute('data-reader-role', 'zhihu-link-card')
  card.setAttribute('data-related-title', title)

  const image = source.querySelector('img[src]')
  if (image) {
    const preview = document.createElement('img')
    const src = image.getAttribute('src')
    if (src) preview.setAttribute('src', src)
    const alt = image.getAttribute('alt') || title
    preview.setAttribute('alt', alt)
    preview.setAttribute('data-reader-role', 'zhihu-link-image')
    card.append(preview)
  }

  const kind = document.createElement('span')
  kind.setAttribute('data-reader-role', 'zhihu-link-kind')
  kind.textContent = label

  const body = document.createElement('span')
  body.setAttribute('data-reader-role', 'zhihu-link-body')
  const titleNode = document.createElement('span')
  titleNode.setAttribute('data-reader-role', 'zhihu-link-title')
  titleNode.textContent = title
  const host = document.createElement('span')
  host.setAttribute('data-reader-role', 'zhihu-link-host')
  host.textContent = url.hostname.replace(/^www\./, '')
  body.append(titleNode, host)
  card.append(kind, body)
  return card
}

/**
 * 知乎正文里站外视频/链接既有“整段一个 a”，也有 video-box / link-card 等块级结构。
 * NewsNook 在清洗前把它们统一成自己的语义卡片，然后仍交给 sanitizeArticleHtml 做最终安全过滤。
 */
function promoteStandaloneExternalLinks(rawHtml: string): string {
  if (!/<a\b/i.test(rawHtml)) return rawHtml
  try {
    const { document } = parseHTML(`<!doctype html><html><body>${rawHtml}</body></html>`)
    const anchors = [...document.body.querySelectorAll('a[href]')]
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href')?.trim()
      if (!href) continue
      const url = resolveLinkUrl(href)
      if (!url || ZHIHU_HOSTS.has(url.hostname)) continue

      const parent = anchor.parentElement
      const standalone = Boolean(parent && /^(P|DIV|FIGURE)$/i.test(parent.tagName) && isOnlyMeaningfulChild(parent, anchor))
      const blockLink = hasBlockLinkSemantics(anchor)
      if (!standalone && !blockLink) continue

      const card = createExternalCard(document, anchor, url)
      if (standalone && parent) parent.replaceWith(card)
      else anchor.replaceWith(card)
    }
    return document.body.innerHTML
  } catch {
    return rawHtml
  }
}

/** 展示层清洗；编辑原始正文不得调用此函数覆盖源数据。 */
export function normalizeZhihuContentHtml(rawHtml: string): string {
  if (!rawHtml.trim()) return ''
  return sanitizeArticleHtml(promoteStandaloneExternalLinks(rawHtml))
}
