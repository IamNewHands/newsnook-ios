/** Cross-source reading history, independent from body cache. */
import type { Article } from '../../lib/types'
import { readRaw, writeRawOrThrow } from '../../lib/storage'
import type { CachedArticleEntry } from '../../lib/bodyCache'
import type { LinuxDoTopic } from '../linuxdo/types'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../zhihu/types'
import { log } from '../../lib/logger'

const KEY = 'reading-history:v1'
const MIGRATED = 'reading-history:body-migrated:v1'
export const MAX_READING_HISTORY = 500
type Origin = 'feed' | 'cms' | 'linuxdo' | 'zhihu'
interface Base {
  key: string
  origin: Origin
  title: string
  sourceLabel: string
  readAt: number
  firstReadAt: number
  visits: number
  excerpt?: string
  image?: string
}
export type ReadingHistoryEntry =
  | (Base & { kind: 'article'; article: Article })
  | (Base & { kind: 'linuxdo'; topicId: number; slug: string })
  | (Base & { kind: 'zhihu'; ref: ZhihuEntityRef })

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const short = (value: string | undefined, max: number) => (value ?? '').trim().slice(0, max)
const zhihuKinds = new Set<ZhihuEntityRef['kind']>(['question', 'answer', 'article', 'pin'])

function valid(item: unknown): item is ReadingHistoryEntry {
  if (!item || typeof item !== 'object') return false
  const value = item as Record<string, unknown>
  if (!isText(value.key) || !isText(value.title) || !isText(value.sourceLabel) || !isTime(value.readAt)) return false
  if (!['feed', 'cms', 'linuxdo', 'zhihu'].includes(String(value.origin))) return false
  if (value.kind === 'article') {
    const a = value.article as Article | undefined
    return !!a && isText(a.id) && isText(a.originUrl) && isText(a.sourceId)
  }
  if (value.kind === 'linuxdo') return Number.isSafeInteger(value.topicId) && Number(value.topicId) > 0 && isText(value.slug)
  if (value.kind === 'zhihu') {
    const ref = value.ref as ZhihuEntityRef | undefined
    return !!ref && zhihuKinds.has(ref.kind) && isText(ref.id)
  }
  return false
}

function normalize(items: ReadingHistoryEntry[]): ReadingHistoryEntry[] {
  const seen = new Set<string>()
  return items.filter(valid).sort((a, b) => b.readAt - a.readAt).filter((item) => {
    if (seen.has(item.key)) return false
    seen.add(item.key)
    return true
  }).slice(0, MAX_READING_HISTORY)
}

export function listReadingHistory(): ReadingHistoryEntry[] {
  try {
    const data: unknown = JSON.parse(readRaw(KEY) ?? 'null')
    if (!data || typeof data !== 'object' || (data as { version?: number }).version !== 1) return []
    const items = (data as { items?: unknown }).items
    return Array.isArray(items) ? normalize(items.filter(valid)) : []
  } catch {
    return []
  }
}


function save(items: ReadingHistoryEntry[]): ReadingHistoryEntry[] {
  let entries = normalize(items)
  while (entries.length && JSON.stringify(entries).length > 310000) entries = entries.slice(0, -25)
  try {
    writeRawOrThrow(KEY, JSON.stringify({ version: 1, items: entries }))
    return entries
  } catch (error) {
    log.storage.warn('Reading history write failed', error)
    try {
      entries = entries.slice(0, Math.floor(entries.length / 2))
      writeRawOrThrow(KEY, JSON.stringify({ version: 1, items: entries }))
      return entries
    } catch {
      return listReadingHistory()
    }
  }
}
function upsert(item: ReadingHistoryEntry): ReadingHistoryEntry[] {
  const entries = listReadingHistory()
  const previous = entries.find((entry) => entry.key === item.key)
  return save([{ ...item, firstReadAt: previous?.firstReadAt ?? item.readAt,
    visits: previous ? (previous.visits || 1) + (item.readAt - previous.readAt > 15000 ? 1 : 0) : 1 },
    ...entries.filter((entry) => entry.key !== item.key)])
}
function articleEntry(article: Article, origin: 'feed' | 'cms', at: number): ReadingHistoryEntry {
  const copy: Article = {
    id: short(article.id, 300), title: short(article.title, 280), summary: short(article.summary, 280),
    publishedAt: article.publishedAt, hasRealDate: article.hasRealDate,
    sourceId: short(article.sourceId, 140), sourceName: short(article.sourceName, 100),
    sourceLabel: short(article.sourceLabel, 100), sourceGroup: article.sourceGroup,
    originUrl: short(article.originUrl, 2000),
    ...(article.image ? { image: short(article.image, 2000) } : {}),
    ...(article.contentType ? { contentType: article.contentType } : {}),
    ...(article.videoUrl ? { videoUrl: short(article.videoUrl, 2000) } : {}),
    ...(article.audioUrl ? { audioUrl: short(article.audioUrl, 2000) } : {}),
    ...(article.neteaseDocId ? { neteaseDocId: short(article.neteaseDocId, 160) } : {}),
  }
  return { kind: 'article', key: 'article:' + article.sourceId + ':' + article.id, origin,
    article: copy, title: copy.title, sourceLabel: copy.sourceLabel || copy.sourceName || '订阅内容',
    excerpt: copy.summary, image: copy.image, readAt: at, firstReadAt: at, visits: 1 }
}
export function recordArticleRead(article: Article, origin: 'feed' | 'cms' = 'feed', at = Date.now()): ReadingHistoryEntry[] {
  if (!article.id || !article.title || !article.originUrl) return listReadingHistory()
  return upsert(articleEntry(article, origin, at))
}
/** Private messages / non-regular topic archetypes must not enter the unified history. */
export function recordLinuxDoRead(topic: LinuxDoTopic, at = Date.now()): ReadingHistoryEntry[] {
  if (!Number.isSafeInteger(topic.id) || topic.id <= 0 || !topic.title ||
    (topic.archetype && topic.archetype !== 'regular')) return listReadingHistory()
  return upsert({ kind: 'linuxdo', key: 'linuxdo:' + topic.id, origin: 'linuxdo',
    title: short(topic.title, 280), sourceLabel: 'Linux.do', topicId: topic.id,
    slug: short(topic.slug || 'topic', 160), readAt: at, firstReadAt: at, visits: 1 })
}
export function recordZhihuRead(detail: ZhihuContentSummary, at = Date.now()): ReadingHistoryEntry[] {
  if (!zhihuKinds.has(detail.ref.kind) || !detail.ref.id || !detail.title) return listReadingHistory()
  return upsert({ kind: 'zhihu', key: 'zhihu:' + detail.ref.kind + ':' + detail.ref.id,
    origin: 'zhihu', title: short(detail.title, 280), sourceLabel: '知乎',
    excerpt: short(detail.excerpt, 280),
    ...(detail.imageUrl ? { image: short(detail.imageUrl, 2000) } : {}),
    ref: { kind: detail.ref.kind, id: short(detail.ref.id, 180) },
    readAt: at, firstReadAt: at, visits: 1 })
}
export function removeReadingHistory(key: string): ReadingHistoryEntry[] {
  return save(listReadingHistory().filter((item) => item.key !== key))
}
export function removeReadingHistories(keys: Iterable<string>): ReadingHistoryEntry[] {
  const set = new Set(keys)
  if (!set.size) return listReadingHistory()
  return save(listReadingHistory().filter((item) => !set.has(item.key)))
}
export function restoreReadingHistories(items: ReadingHistoryEntry[]): ReadingHistoryEntry[] {
  if (!items.length) return listReadingHistory()
  const existing = listReadingHistory()
  const existingKeys = new Set(existing.map((item) => item.key))
  const toAdd = items.filter((item) => !existingKeys.has(item.key) && valid(item))
  return save([...toAdd, ...existing])
}
export function clearReadingHistory(): ReadingHistoryEntry[] {
  return save([])
}
/** One-off migration: cached saved-for-later prefetches are not actual reads. */
export function migrateCachedReadingHistory(
  cached: CachedArticleEntry[], readIds: ReadonlySet<string>,
): ReadingHistoryEntry[] {
  if (readRaw(MIGRATED) === '1') return listReadingHistory()
  const entries = listReadingHistory()
  const keys = new Set(entries.map((item) => item.key))
  const additions = cached.filter((item) => readIds.has(item.article.id) && isTime(item.usedAt))
    .map((item) => articleEntry(item.article, 'feed', item.usedAt))
    .filter((item) => !keys.has(item.key))
  const result = additions.length ? save([...entries, ...additions]) : entries
  try { writeRawOrThrow(MIGRATED, '1') } catch { /* idempotent retry */ }
  return result
}

