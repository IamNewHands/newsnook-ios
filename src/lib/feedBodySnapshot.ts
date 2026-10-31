/** Durable, bounded snapshots for short syndicated posts that would otherwise
 * lose their HTML when feed lists are compacted. Uses the existing body-cache
 * quota/LRU/pinned rules; never creates a second persistent content store.
 * Only invoked after a successful feed refresh (not on cold startup).
 */
import { isPreferredFeedBody, shouldReplaceCachedBody } from './feedBodyEvidence'
import { loadCachedBody, saveCachedBody } from './bodyCache'
import { stripTags } from './htmlText'
import { normalizeContentImages } from './normalizeImages'
import { normalizeFeedLayout } from './resolveBody/feedLayout'
import { sanitizeArticleHtml } from './sanitize'
import type { Article } from './types'

const MAX_SNAPSHOTS_PER_REFRESH = 16
const MAX_RAW_HTML_CHARS = 16_000
const MAX_SHORT_POST_TEXT_CHARS = 1_800

export function shortFeedSnapshotCandidates(articles: readonly Article[]): Article[] {
  return articles.filter((article) =>
    article.contentType !== 'video' &&
    Boolean(article.contentHtml) &&
    article.contentHtml!.length <= MAX_RAW_HTML_CHARS &&
    stripTags(article.contentHtml ?? '').length <= MAX_SHORT_POST_TEXT_CHARS &&
    isPreferredFeedBody(article.feedBodyEvidence),
  ).slice(0, MAX_SNAPSHOTS_PER_REFRESH)
}

/** Every stored HTML fragment passes the same image normalizer and sanitizer
 * as a resolved article. Keep durable HTTP URLs, not short-lived blob: URLs
 * from native image tunnel hydration. The reader may still re-fetch images.
 */
export async function persistShortFeedSnapshots(
  articles: readonly Article[],
  signal?: AbortSignal,
): Promise<number> {
  let saved = 0
  const candidates = shortFeedSnapshotCandidates(articles)
  for (let index = 0; index < candidates.length; index++) {
    if (signal?.aborted) break
    const article = candidates[index]
    const existing = loadCachedBody(article.id)
    if (existing && !shouldReplaceCachedBody(article, existing)) continue
    const html = sanitizeArticleHtml(normalizeContentImages(
      normalizeFeedLayout(article.contentHtml!),
      article.originUrl || 'https://local.invalid/',
    ))
    if (!stripTags(html).trim() && !/<(?:img|audio|video)\b/i.test(html)) continue
    // CachedBody already stores sanitized HTML. Do not duplicate raw feed
    // markup inside its embedded Article metadata (or inflate the 3MB budget).
    const { contentHtml: _contentHtml, ...compactArticle } = article
    if (saveCachedBody(compactArticle, { html, bodySource: 'feed' })) saved++
    // Do not keep the browser's rendering thread occupied with a large
    // cascade of localStorage writes after a multi-source refresh.
    if (index % 4 === 3) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return saved
}
