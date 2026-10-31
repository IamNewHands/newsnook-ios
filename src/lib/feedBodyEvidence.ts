/** Small, durable syndication signals; no publisher or route allowlists.
 * Full-body elements are explicit protocol evidence. RSS descriptions are not:
 * a short description is treated as complete only when its own markup looks
 * like a self-contained text post with author-provided paragraph breaks.
 */
import { stripTags } from './htmlText'

export type FeedBodyEvidence = 'declared' | 'structured' | 'teaser' | 'unknown'
export type FeedBodyField = 'content' | 'description' | 'summary'

const TEASER_CTA = /read\s+(?:the\s+)?full\s+(?:story|article|post)|continue\s+reading|view\s+(?:the\s+)?full\s+article|阅读全文|查看全文|点击查看全文/i
const STRUCTURAL_BREAKS = /<br\s*\/?>(?:\s|&nbsp;|&#160;)*<br\s*\/?>|\r?\n[\t ]*\r?\n/i
const ELLIPSIS_END = /(?:\.{3,}|…+)\s*$/

export function isPartialFeedTeaser(html?: string): boolean {
  if (!html) return false
  return TEASER_CTA.test(stripTags(html))
}

/** Evidence is intentionally conservative: image thumbnails alone do not
 * turn ordinary RSS descriptions into full articles. */
export function classifyFeedBody(html: string | undefined, field: FeedBodyField): FeedBodyEvidence {
  if (!html) return 'unknown'
  const text = stripTags(html)
  if (!text && !/<(?:img|video|audio)\b/i.test(html)) return 'unknown'
  if (isPartialFeedTeaser(html) || ELLIPSIS_END.test(text)) return 'teaser'
  if (field === 'summary') return 'teaser'
  if (field === 'content') return 'declared'
  // Descriptions are often excerpts. Require both editorial paragraph breaks
  // and inline media after them; breaks or a preview thumbnail alone do not
  // prove completeness. No website/provider/URL rules are involved.
  const editorialBreak = STRUCTURAL_BREAKS.exec(html)
  if (text.length >= 12 && text.length <= 800 && editorialBreak &&
      /<(?:img|picture|video|audio)\b/i.test(html.slice(editorialBreak.index + editorialBreak[0].length))) {
    return 'structured'
  }
  return 'unknown'
}

export function isPreferredFeedBody(evidence: FeedBodyEvidence | undefined): boolean {
  return evidence === 'declared' || evidence === 'structured'
}

/** Detect old unwrapped feed markup without importing a DOM parser at startup. */
export function isLegacyLooseFeedBody(html: string): boolean {
  return /<br\b/i.test(html) && !/<(?:p|div|section|article|blockquote|li|h[1-6])\b/i.test(html)
}

/** Some legacy Readability outputs split a single status sentence into
 * dozens of tiny paragraphs. Repair only when the syndication text is also
 * present in that extraction, to avoid replacing unrelated long articles or
 * intentional short-line content such as poetry.
 */
function isFragmentedExtraction(cachedHtml: string, originalFeedHtml: string): boolean {
  if (/<(?:blockquote|pre|ul|ol|table)\b/i.test(cachedHtml)) return false
  // matchAll is not available on the oldest supported Android WebView.
  const paragraphs = (cachedHtml.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) ?? [])
    .map((block) => stripTags(block).trim()).filter(Boolean)
  if (paragraphs.length < 10) return false
  const short = paragraphs.filter((line) => line.length <= 26)
  if (short.length / paragraphs.length < 0.85) return false
  const punctuated = paragraphs.filter((line) => /[。！？!?；;:：.]$/.test(line))
  if (punctuated.length / paragraphs.length > 0.3) return false
  const normalize = (value: string) => stripTags(value).replace(/\s+/g, '').toLowerCase()
  const original = normalize(originalFeedHtml)
  return original.length >= 36 && normalize(cachedHtml).includes(original)
}

/** A refreshed feed with real body content should supersede a cached webpage
 * extraction or legacy unstructured feed HTML, without dropping offline caches
 * when the fresh source has not yet provided the replacement. */
export function shouldReplaceCachedBody(
  feed: { contentHtml?: string; feedBodyEvidence?: FeedBodyEvidence },
  cached: { html: string; bodySource: string },
): boolean {
  if (!feed.contentHtml || !isPreferredFeedBody(feed.feedBodyEvidence)) return false
  if (cached.bodySource === 'blocked' || cached.bodySource === 'feed-excerpt') return true
  if (cached.bodySource === 'feed') return isLegacyLooseFeedBody(cached.html)
  if (cached.bodySource === 'video') return false
  // Structured descriptions are only inferred to be complete. Even explicit
  // syndication content cannot evict a longer publisher article on refresh.
  // Comparing meaningful text (not markup bytes) avoids image/style noise.
  if (feed.feedBodyEvidence === 'structured' &&
      cached.bodySource === 'readability' &&
      isFragmentedExtraction(cached.html, feed.contentHtml)) return true
  const incomingLength = stripTags(feed.contentHtml).length
  const retainedLength = stripTags(cached.html).length
  return incomingLength > retainedLength &&
    (feed.feedBodyEvidence === 'declared' || retainedLength < 80)
}

/** Only retry tentative text when it becomes stale or the network reconnects.
 * Keep the cached excerpt on screen during the attempt and on failure. */
export const FEED_EXCERPT_RECHECK_MS = 10 * 60 * 1000

export function shouldRecheckCachedExcerpt(
  bodySource: string,
  savedAt: number,
  now: number,
  reconnected = false,
): boolean {
  return bodySource === 'feed-excerpt' && (reconnected ||
    !Number.isFinite(savedAt) || now - savedAt >= FEED_EXCERPT_RECHECK_MS)
}

export function isExcerptUpgrade(
  priorHtml: string,
  result: { contentHtml: string; bodySource: string },
): boolean {
  if (!['feed', 'readability', 'netease'].includes(result.bodySource)) return false
  return stripTags(result.contentHtml).length >= stripTags(priorHtml).length
}
