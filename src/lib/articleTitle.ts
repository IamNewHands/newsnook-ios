/**
 * Feed title hygiene.
 *
 * Upstream feeds occasionally put an entire post/body into a field called "title".
 * Keep the parser tolerant, but never let body-shaped text become an unbounded title.
 * This module is deliberately DOM-free so it works in the app and in parser tests.
 */

const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g
const TAG_RE = /<[^>]*>/g
const SCRIPT_STYLE_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi
const MULTI_SPACE_RE = /[\s\u00A0\u3000]+/g

const HARD_BODY_TITLE_LENGTH = 240
const SOFT_BODY_TITLE_LENGTH = 110
const CJK_FALLBACK_LENGTH = 72
const LATIN_FALLBACK_LENGTH = 120

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }

  return value
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match)
    .replace(/&#(x?[0-9a-f]+);/gi, (match, raw: string) => {
      const isHex = raw[0]?.toLowerCase() === 'x'
      const parsed = Number.parseInt(isHex ? raw.slice(1) : raw, isHex ? 16 : 10)
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 0x10ffff) return match
      try {
        return String.fromCodePoint(parsed)
      } catch {
        return match
      }
    })
}

export function cleanArticleTitleText(value?: string): string {
  if (!value) return ''
  return decodeHtmlEntities(
    value
      .replace(SCRIPT_STYLE_RE, ' ')
      .replace(TAG_RE, ' ')
      .replace(ZERO_WIDTH_RE, ''),
  )
    .replace(MULTI_SPACE_RE, ' ')
    .trim()
}

function codePoints(value: string): string[] {
  return Array.from(value)
}

function sentenceEndCount(value: string): number {
  return (value.match(/[。！？!?]/g) ?? []).length
}

function hashtagCount(value: string): number {
  return (value.match(/#[^#\s]{1,40}#/g) ?? []).length
}

export function isBodyLikeArticleTitle(rawTitle: string, cleanedTitle = cleanArticleTitleText(rawTitle)): boolean {
  const length = codePoints(cleanedTitle).length
  if (length > HARD_BODY_TITLE_LENGTH) return true
  if (length <= SOFT_BODY_TITLE_LENGTH) return false

  const rawLineBreaks = (rawTitle.match(/[\r\n]/g) ?? []).length
  if (rawLineBreaks > 0) return true
  if (sentenceEndCount(cleanedTitle) >= 2) return true
  if (hashtagCount(cleanedTitle) >= 3) return true

  return false
}

function stripTrailingHashtagRun(value: string): string {
  const index = value.search(/(?:\s+#[^#\s]{1,40}#){2,}\s*$/)
  return index > 0 ? value.slice(0, index).trim() : value
}

function fallbackLimit(value: string): number {
  const chars = codePoints(value)
  const cjk = chars.filter((char) => /[\u3400-\u9fff\uf900-\ufaff]/u.test(char)).length
  return cjk >= Math.max(4, Math.floor(chars.length * 0.2))
    ? CJK_FALLBACK_LENGTH
    : LATIN_FALLBACK_LENGTH
}

export function titleCandidateFromText(value?: string): string {
  let cleaned = stripTrailingHashtagRun(cleanArticleTitleText(value))
  if (!cleaned) return ''

  const chars = codePoints(cleaned)
  const maxLength = fallbackLimit(cleaned)
  if (chars.length <= maxLength) return cleaned

  // Prefer a real sentence boundary when the body begins with a concise lead sentence.
  for (let index = 8; index < Math.min(chars.length, maxLength); index += 1) {
    if ('。！？!?'.includes(chars[index])) {
      return chars.slice(0, index + 1).join('').trim()
    }
  }

  let cut = chars.slice(0, maxLength).join('')
  // Avoid chopping an English word when a nearby word boundary exists.
  if (!/[\u3400-\u9fff\uf900-\ufaff]/u.test(cut)) {
    const boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('—'), cut.lastIndexOf('-'))
    if (boundary >= Math.floor(maxLength * 0.7)) cut = cut.slice(0, boundary)
  }

  cleaned = cut.replace(/[\s，,：:；;·•\-|丨—]+$/u, '').trim()
  return cleaned ? `${cleaned}…` : ''
}

/**
 * Normalise a semantic article title.
 *
 * A plausible upstream title is preserved in full. Missing/body-shaped titles are
 * replaced with a bounded candidate from the title itself or fallback body text.
 */
export function normalizeArticleTitle(rawTitle?: string, fallbackText?: string): string {
  const cleanedTitle = cleanArticleTitleText(rawTitle)
  if (cleanedTitle && !isBodyLikeArticleTitle(rawTitle ?? '', cleanedTitle)) {
    return cleanedTitle
  }

  const fromTitle = titleCandidateFromText(rawTitle)
  if (fromTitle) return fromTitle
  return titleCandidateFromText(fallbackText)
}

/** Defensive display guard for cached items created before parser-side title hygiene. */
export function feedDisplayTitle(title: string, fallbackText?: string): string {
  return normalizeArticleTitle(title, fallbackText) || '一篇文章'
}
