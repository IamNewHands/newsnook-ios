import type {
  ReadAloudDocument,
  ReadAloudSegment,
  ReadAloudSegmentKind,
} from './types'

const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,blockquote,figcaption,li'
const SKIP_SELECTOR =
  'script,style,noscript,svg,pre,code,button,input,textarea,select,video,audio,canvas,template,iframe,[hidden],[aria-hidden="true"]'

/** 远低于 Android TextToSpeech.getMaxSpeechInputLength，兼顾 Web Speech 与 AI TTS 延迟。 */
export const MAX_READ_ALOUD_SEGMENT_CHARS = 1200

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** 只识别脚本特征明确的语言；无法可靠判断时交给系统默认 Voice。 */
function inferLanguage(value: string): string | undefined {
  if (/[\u3040-\u30ff]/u.test(value)) return 'ja-JP'
  if (/[\uac00-\ud7af]/u.test(value)) return 'ko-KR'
  if (/[\u4e00-\u9fff]/u.test(value)) return 'zh-CN'
  if (/[\u0600-\u06ff]/u.test(value)) return 'ar'
  if (/[\u0400-\u04ff]/u.test(value)) return 'ru-RU'
  return undefined
}

function safeCutIndex(value: string, index: number): number {
  if (index <= 0 || index >= value.length) return index
  const code = value.charCodeAt(index)
  return code >= 0xdc00 && code <= 0xdfff ? index - 1 : index
}

export function splitReadAloudText(
  value: string,
  maxChars = MAX_READ_ALOUD_SEGMENT_CHARS,
): string[] {
  const text = normalizeText(value)
  if (!text) return []
  if (text.length <= maxChars) return [text]

  const chunks: string[] = []
  let remaining = text
  while (remaining.length > maxChars) {
    const minimum = Math.floor(maxChars * 0.55)
    let cut = -1

    for (let index = maxChars; index >= minimum; index -= 1) {
      if (/[。！？!?；;.!]/u.test(remaining[index - 1] ?? '')) {
        cut = index
        break
      }
    }
    if (cut < 0) {
      for (let index = maxChars; index >= minimum; index -= 1) {
        if (/[,，、:：\s]/u.test(remaining[index - 1] ?? '')) {
          cut = index
          break
        }
      }
    }
    if (cut < 0) cut = maxChars
    cut = Math.max(1, safeCutIndex(remaining, cut))

    const chunk = normalizeText(remaining.slice(0, cut))
    if (chunk) chunks.push(chunk)
    remaining = normalizeText(remaining.slice(cut))
  }
  if (remaining) chunks.push(remaining)
  return chunks
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

  for (const text of splitReadAloudText(cleanTitle)) {
    const index = segments.length
    segments.push({
      id: segmentId(articleId, index, 'title'),
      index,
      kind: 'title',
      text,
      lang: inferLanguage(text),
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
      if (kind === 'heading' && cleanTitle && text === cleanTitle) continue
      const lang =
        element.getAttribute('lang') ||
        element.closest('[lang]')?.getAttribute('lang') ||
        undefined

      for (const chunk of splitReadAloudText(text)) {
        const index = segments.length
        segments.push({
          id: segmentId(articleId, index, kind),
          index,
          kind,
          text: chunk,
          lang: lang || inferLanguage(chunk),
        })
      }
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
