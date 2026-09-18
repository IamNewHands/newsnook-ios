import type { ZhihuContentSummary } from '../types'

const STORE_KEY = 'newsnook:zhihu:smart-candidates:v1'
const STORE_VERSION = 1
const MAX_ITEMS = 240
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type ZhihuSmartPublicSource = 'android' | 'web' | 'hot'

export interface ZhihuSmartCandidateRecord {
  key: string
  item: ZhihuContentSummary
  sources: ZhihuSmartPublicSource[]
  firstSeenAt: number
  lastSeenAt: number
}

interface ZhihuSmartCandidateEnvelope {
  version: number
  updatedAt: number
  items: ZhihuSmartCandidateRecord[]
}

export interface ZhihuSmartCandidateStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(): ZhihuSmartCandidateStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function zhihuSmartEntityKey(item: Pick<ZhihuContentSummary, 'ref'>): string {
  return `${item.ref.kind}:${item.ref.id}`
}

function isPublicSource(value: unknown): value is ZhihuSmartPublicSource {
  return value === 'android' || value === 'web' || value === 'hot'
}

function isCandidate(value: unknown): value is ZhihuSmartCandidateRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<ZhihuSmartCandidateRecord>
  return typeof record.key === 'string'
    && typeof record.firstSeenAt === 'number'
    && typeof record.lastSeenAt === 'number'
    && Array.isArray(record.sources)
    && record.sources.every(isPublicSource)
    && Boolean(record.item && typeof record.item === 'object')
}

function normalize(
  envelope: ZhihuSmartCandidateEnvelope,
  now: number,
): ZhihuSmartCandidateRecord[] {
  return envelope.items
    .filter((item) => isCandidate(item) && now - item.lastSeenAt <= MAX_AGE_MS)
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
    .slice(0, MAX_ITEMS)
}

export function loadZhihuSmartCandidatePool(
  storage: ZhihuSmartCandidateStorage | null = browserStorage(),
  now = Date.now(),
): ZhihuSmartCandidateRecord[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(STORE_KEY)
    if (!raw) return []
    const envelope = JSON.parse(raw) as Partial<ZhihuSmartCandidateEnvelope>
    if (envelope.version !== STORE_VERSION || !Array.isArray(envelope.items)) {
      storage.removeItem(STORE_KEY)
      return []
    }
    return normalize(envelope as ZhihuSmartCandidateEnvelope, now)
  } catch {
    return []
  }
}

export function mergeZhihuSmartCandidatePool(
  incoming: readonly ZhihuContentSummary[],
  storage: ZhihuSmartCandidateStorage | null = browserStorage(),
  now = Date.now(),
): ZhihuSmartCandidateRecord[] {
  const existing = loadZhihuSmartCandidatePool(storage, now)
  const byKey = new Map(existing.map((record) => [record.key, record]))

  for (const item of incoming) {
    const source = item.recommendationSource
    if (!isPublicSource(source)) continue

    const key = zhihuSmartEntityKey(item)
    const previous = byKey.get(key)
    const sources = previous
      ? [...new Set([...previous.sources, source])]
      : [source]

    byKey.set(key, {
      key,
      item: { ...item },
      sources,
      firstSeenAt: previous?.firstSeenAt ?? now,
      lastSeenAt: now,
    })
  }

  const items = [...byKey.values()]
    .filter((item) => now - item.lastSeenAt <= MAX_AGE_MS)
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
    .slice(0, MAX_ITEMS)

  if (storage) {
    try {
      const envelope: ZhihuSmartCandidateEnvelope = {
        version: STORE_VERSION,
        updatedAt: now,
        items,
      }
      storage.setItem(STORE_KEY, JSON.stringify(envelope))
    } catch {
      // 候选池只是推荐增强；存储配额/隐私模式不能阻断知乎阅读。
    }
  }

  return items
}

export function clearZhihuSmartCandidatePool(
  storage: ZhihuSmartCandidateStorage | null = browserStorage(),
): void {
  try {
    storage?.removeItem(STORE_KEY)
  } catch {
    // 同上：候选池清理失败不影响阅读主链路。
  }
}
