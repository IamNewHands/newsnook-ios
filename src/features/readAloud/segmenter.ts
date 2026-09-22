import type {
  ReadAloudDocument,
  ReadAloudSegment,
  ReadAloudSegmentKind,
} from './types'

const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,blockquote,figcaption,li'
const SKIP_SELECTOR =
  'script,style,noscript,svg,pre,code,button,input,textarea,select,video,audio,canvas'

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function kindFor(element: Element): ReadAloudSegmentKind {
  const tag = element.tagName.toLowerCase()
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'blockquote') return 'quote'
  if (tag === 'figcaption') return 'caption'
  if (tag === 'li') return 'list-item'
  return 'paragraph'
}

function segmentId(articleId: string, index: number, kind: ReadAloudSegmentKind): string {
  return `${articleId}:${kind}:${index}`
}

export function segmentArticle(
  articleId: string,
  title: string,
  html: string,
  metadata?: { sourceName?: string; artwork?: string },
): ReadAloudDocument {
  const segments: ReadAloudSegment[] = []
  const cleanTitle = normalizeText(title)

  if (cleanTitle) {
    segments.push({
      id: segmentId(articleId, 0, 'title'),
      index: 0,
      kind: 'title',
      text: cleanTitle,
    })
  }

  if (typeof DOMParser !== 'undefined' && html.trim()) {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><body>${html}</body></html>`,
      'text/html',
    )

    const blocks = Array.from(document.body.querySelectorAll(BLOCK_SELECTOR)).filter(
      (element) => {
        if (element.closest(SKIP_SELECTOR)) return false
        return !element.querySelector(BLOCK_SELECTOR)
      },
    )

    for (const element of blocks) {
      const text = normalizeText(element.textContent ?? '')
      if (!text || !/[\p{L}\p{N}]/u.test(text)) continue

      const kind = kindFor(element)
      const index = segments.length
      segments.push({
        id: segmentId(articleId, index, kind),
        index,
        kind,
        text,
        lang:
          element.getAttribute('lang') ||
          element.closest('[lang]')?.getAttribute('lang') ||
          undefined,
      })
    }
  }

  return {
    articleId,
    title: cleanTitle || title,
    sourceName: metadata?.sourceName,
    artwork: metadata?.artwork,
    segments,
  }
}
