import type { Page, ZhihuContentSummary, ZhihuFeedMode } from '../types'

const CACHE_VERSION = 1
const CACHE_PREFIX = 'newsnook:zhihu:public-feed:v1:'
const MAX_ITEMS = 120
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface ZhihuPublicCacheStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface CacheEnvelope {
  version: number
  savedAt: number
  page: Page<ZhihuContentSummary>
}

function browserStorage(): ZhihuPublicCacheStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function keyFor(mode: ZhihuFeedMode): string | null {
  // 关注流属于账号作用域，绝不能进入公共 localStorage 缓存。
  return mode === 'following' ? null : `${CACHE_PREFIX}${mode}`
}

function looksLikeSummary(value: unknown): value is ZhihuContentSummary {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ZhihuContentSummary>
  return typeof item.title === 'string' && typeof item.excerpt === 'string' && typeof item.url === 'string'
    && Boolean(item.ref && typeof item.ref.id === 'string' && typeof item.ref.kind === 'string')
}

export function loadZhihuPublicFeedCache(
  mode: ZhihuFeedMode,
  storage: ZhihuPublicCacheStorage | null = browserStorage(),
  now = Date.now(),
): Page<ZhihuContentSummary> | null {
  const key = keyFor(mode)
  if (!key || !storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const envelope = JSON.parse(raw) as Partial<CacheEnvelope>
    if (envelope.version !== CACHE_VERSION || typeof envelope.savedAt !== 'number' || now - envelope.savedAt > MAX_AGE_MS) {
      storage.removeItem(key)
      return null
    }
    const page = envelope.page
    if (!page || !Array.isArray(page.items) || !page.items.every(looksLikeSummary)) {
      storage.removeItem(key)
      return null
    }
    return {
      items: page.items.slice(0, MAX_ITEMS),
      nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : undefined,
      hasMore: page.hasMore === true,
    }
  } catch {
    return null
  }
}

export function saveZhihuPublicFeedCache(
  mode: ZhihuFeedMode,
  page: Page<ZhihuContentSummary>,
  storage: ZhihuPublicCacheStorage | null = browserStorage(),
  now = Date.now(),
): void {
  const key = keyFor(mode)
  if (!key || !storage) return
  try {
    const envelope: CacheEnvelope = {
      version: CACHE_VERSION,
      savedAt: now,
      page: { ...page, items: page.items.slice(0, MAX_ITEMS) },
    }
    storage.setItem(key, JSON.stringify(envelope))
  } catch {
    // quota/禁用存储不能阻断公开阅读；私有草稿不会复用此容错策略。
  }
}
