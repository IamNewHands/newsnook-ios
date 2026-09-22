import type { ReadAloudPosition } from './types'

const STORAGE_KEY = 'newsnook:read-aloud-position:v1'
const MAX_POSITIONS = 80

interface PositionStore {
  latestArticleId?: string
  positions: Record<string, ReadAloudPosition>
}

function loadStore(): PositionStore {
  if (typeof localStorage === 'undefined') return { positions: {} }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { positions: {} }
    const parsed = JSON.parse(raw) as Partial<PositionStore>
    const positions: Record<string, ReadAloudPosition> = {}
    if (parsed.positions && typeof parsed.positions === 'object') {
      for (const [articleId, value] of Object.entries(parsed.positions)) {
        if (!value || typeof value !== 'object') continue
        const position = value as Partial<ReadAloudPosition>
        if (
          typeof position.segmentIndex !== 'number' ||
          !Number.isInteger(position.segmentIndex) ||
          position.segmentIndex < 0
        ) {
          continue
        }
        positions[articleId] = {
          articleId,
          segmentIndex: position.segmentIndex,
          characterOffset:
            typeof position.characterOffset === 'number' &&
            Number.isFinite(position.characterOffset) &&
            position.characterOffset >= 0
              ? Math.floor(position.characterOffset)
              : 0,
          ...(typeof position.elapsedMs === 'number' &&
          Number.isFinite(position.elapsedMs) &&
          position.elapsedMs >= 0
            ? { elapsedMs: position.elapsedMs }
            : {}),
          updatedAt:
            typeof position.updatedAt === 'number' && Number.isFinite(position.updatedAt)
              ? position.updatedAt
              : 0,
        }
      }
    }
    return {
      latestArticleId:
        typeof parsed.latestArticleId === 'string' ? parsed.latestArticleId : undefined,
      positions,
    }
  } catch {
    return { positions: {} }
  }
}

function saveStore(store: PositionStore): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // 朗读位置是辅助状态，存储失败不应中断朗读。
  }
}

export function loadReadAloudPosition(articleId: string): ReadAloudPosition | null {
  return loadStore().positions[articleId] ?? null
}

export function loadLatestReadAloudPosition(): ReadAloudPosition | null {
  const store = loadStore()
  return store.latestArticleId ? store.positions[store.latestArticleId] ?? null : null
}

export function saveReadAloudPosition(position: ReadAloudPosition): void {
  const store = loadStore()
  store.latestArticleId = position.articleId
  store.positions[position.articleId] = { ...position, updatedAt: Date.now() }

  const entries = Object.values(store.positions).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  )
  store.positions = Object.fromEntries(
    entries.slice(0, MAX_POSITIONS).map((item) => [item.articleId, item]),
  )
  saveStore(store)
}

export function clearReadAloudPosition(articleId: string): void {
  const store = loadStore()
  delete store.positions[articleId]
  if (store.latestArticleId === articleId) {
    store.latestArticleId = Object.values(store.positions).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    )[0]?.articleId
  }
  saveStore(store)
}
