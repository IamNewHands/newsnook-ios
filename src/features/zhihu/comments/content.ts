import { parseHTML } from 'linkedom'

import { normalizeZhihuContentHtml } from '../content/normalize'
import type { ZhihuCommentMedia, ZhihuCommentMediaKind } from './types'

const SPECIAL_MEDIA_SELECTOR = 'a.comment_img, a.comment_gif, a.comment_sticker'

function mediaKindFromClass(value: string): ZhihuCommentMediaKind {
  if (value.includes('comment_gif')) return 'gif'
  if (value.includes('comment_sticker')) return 'sticker'
  return 'image'
}

function safeMediaUrl(raw: string | null | undefined): string | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  if (value.startsWith('//')) return `https:${value}`
  try {
    const url = new URL(value, 'https://www.zhihu.com/')
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    return url.href
  } catch {
    return undefined
  }
}

function imageCandidate(image: Element | null): string | undefined {
  if (!image) return undefined
  return (
    safeMediaUrl(image.getAttribute('data-actualsrc'))
    ?? safeMediaUrl(image.getAttribute('src'))
    ?? safeMediaUrl(image.getAttribute('data-original-src'))
    ?? safeMediaUrl(image.getAttribute('data-original'))
  )
}

function meaningfulAlt(value: string | null | undefined): string | undefined {
  const text = value?.trim()
  if (!text || text === '<图片>' || text === '图片' || text === '[图片]') return undefined
  return text
}

function removeEmptyMediaParent(element: Element): void {
  const parent = element.parentElement
  element.remove()
  if (!parent || !/^(P|DIV)$/i.test(parent.tagName)) return
  const text = (parent.textContent ?? '').replace(/\u00a0/g, ' ').trim()
  if (!text && parent.children.length === 0) parent.remove()
}

/**
 * 知乎评论把图片/GIF/贴纸编码成特殊 <a class="comment_*"> 链接，锚文本通常就是
 * “<图片>”。通用正文清洗会丢掉 class，导致 UI 最终只剩这个占位文字。
 *
 * 评论需要在清洗前先把这些媒体从正文结构中抽离，再由 React 组件独立渲染：
 * - 避免 “<图片>” 泄漏到正文；
 * - 图片/GIF/贴纸可以拥有稳定的加载、失败与看大图交互；
 * - 普通文字和链接仍继续走统一的知乎 HTML 安全清洗。
 */
export function normalizeZhihuCommentContent(rawHtml: string): {
  contentHtml: string
  media: ZhihuCommentMedia[]
} {
  if (!rawHtml.trim()) return { contentHtml: '', media: [] }

  try {
    const { document } = parseHTML(`<!doctype html><html><body>${rawHtml}</body></html>`)
    const media: ZhihuCommentMedia[] = []
    const seen = new Set<string>()

    for (const anchor of [...document.body.querySelectorAll(SPECIAL_MEDIA_SELECTOR)]) {
      const className = anchor.getAttribute('class') ?? ''
      const nestedImage = anchor.querySelector('img')
      const url = (
        safeMediaUrl(anchor.getAttribute('href'))
        ?? imageCandidate(nestedImage)
        ?? safeMediaUrl(anchor.getAttribute('data-original'))
      )
      if (url && !seen.has(url)) {
        seen.add(url)
        media.push({
          kind: mediaKindFromClass(className),
          url,
          alt: (
            meaningfulAlt(nestedImage?.getAttribute('alt'))
            ?? meaningfulAlt(anchor.textContent)
            ?? (className.includes('comment_sticker') ? '评论贴纸' : className.includes('comment_gif') ? '评论动图' : '评论图片')
          ),
        })
      }
      removeEmptyMediaParent(anchor)
    }

    // 少量评论直接内嵌 <img> 而不经过 comment_img/comment_gif/comment_sticker。
    // 同样抽离为媒体，避免正文图片在评论区走 Reader 专用占位逻辑。
    for (const image of [...document.body.querySelectorAll('img')]) {
      const url = imageCandidate(image)
      if (url && !seen.has(url)) {
        seen.add(url)
        const className = image.getAttribute('class') ?? ''
        media.push({
          kind: /gif/i.test(url) || className.includes('gif') ? 'gif' : /sticker|emoji|emoticon/i.test(className) ? 'sticker' : 'image',
          url,
          alt: meaningfulAlt(image.getAttribute('alt')) ?? '评论图片',
        })
      }
      removeEmptyMediaParent(image)
    }

    return {
      contentHtml: normalizeZhihuContentHtml(document.body.innerHTML),
      media,
    }
  } catch {
    return {
      contentHtml: normalizeZhihuContentHtml(rawHtml),
      media: [],
    }
  }
}
