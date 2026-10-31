import type { NewsSource } from '../../sources/registry'
import { fetchSourceText } from '../http'
import { parseGenericFeed } from '../parseFeed/generic'
import type { Article } from '../types'
import { classifyFeedBody } from '../feedBodyEvidence'

/** Fetch the originating feed only when compact list persistence discarded a
 * body that was known complete, or the list predates content evidence. Feed
 * transport and RSSHub failover remain the existing shared implementations.
 */
export async function recoverFeedContent(
  article: Article,
  source: NewsSource | undefined,
  signal?: AbortSignal,
  fetchFeed: typeof fetchSourceText = fetchSourceText,
): Promise<Article> {
  if (
    source?.kind !== 'feed' || article.contentType === 'video' || article.contentHtml ||
    article.feedBodyEvidence === 'teaser'
  ) return article
  const payload = await fetchFeed(source, signal)
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const entry = parseGenericFeed(source, payload, Date.now()).find((candidate) =>
    candidate.id === article.id && candidate.originUrl === article.originUrl,
  )
  if (!entry?.contentHtml) return article
  return {
    ...article,
    contentHtml: entry.contentHtml,
    feedBodyEvidence: entry.feedBodyEvidence ?? classifyFeedBody(entry.contentHtml, 'description'),
  }
}
