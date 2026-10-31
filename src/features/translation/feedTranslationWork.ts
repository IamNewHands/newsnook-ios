import { loadCachedFeedTranslation } from './feedTranslationStorage'
import { isArticleForeign } from './quality'
import type { Article } from '../../lib/types'
import type { TranslatedFeedItem, TranslationLanguage } from './types'

export { isValidTranslationQuality } from './quality'

/**
 * 从当前列表挑出真正需要联网翻译的条目。
 * 已在内存状态、会话内失败或非外文的先跳过；剩下的再查持久缓存——
 * React 状态合并是异步的，缓存合并 effect 的 setState 落地前管道 effect 就会执行，
 * 不查缓存会把 localStorage 里已有译文（含上一轮被中断时落盘的结果）重新交给翻译 API。
 */
export function collectFeedTranslationWork(
  articles: Article[],
  translated: ReadonlyMap<string, TranslatedFeedItem>,
  failedIds: ReadonlySet<string>,
  targetLanguage: TranslationLanguage,
): { needed: Article[]; cachedHits: TranslatedFeedItem[] } {
  const needed: Article[] = []
  const cachedHits: TranslatedFeedItem[] = []
  for (let i = 0; i < articles.length; i += 1) {
    const art = articles[i]
    if (translated.get(art.id)?.targetLanguage === targetLanguage) continue
    if (failedIds.has(art.id)) continue
    if (!isArticleForeign(art, targetLanguage)) continue
    const cached = loadCachedFeedTranslation(art.id, targetLanguage)
    if (cached) {
      cachedHits.push(cached)
      continue
    }
    needed.push(art)
  }
  return { needed, cachedHits }
}
