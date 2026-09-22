import type { ReadAloudSnapshot } from './types'

export function shouldShowGlobalReadAloudBar(
  snapshot: ReadAloudSnapshot,
  currentReaderArticleId: string | null,
): boolean {
  const controllable =
    snapshot.state === 'loading' ||
    snapshot.state === 'playing' ||
    snapshot.state === 'paused'
  if (!controllable) return false
  return !currentReaderArticleId || snapshot.articleId !== currentReaderArticleId
}
