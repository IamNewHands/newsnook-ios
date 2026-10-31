import type { ZhihuAuthor } from '../types'

export interface ZhihuUserRemark {
  name: string
  tags: string[]
}

interface PersistedRemarks {
  version: 1
  entries: Array<[string, ZhihuUserRemark]>
}

const STORAGE_PREFIX = 'newsnook:zhihu:user-remarks:v1:'
const MAX_ENTRIES = 1000
const MAX_NAME = 64
const MAX_TAG_LENGTH = 20
const MAX_TAGS = 3

export function zhihuRemarkIdentity(author: Pick<ZhihuAuthor, 'id' | 'token'>): string | null {
  // Stable numeric/hash ids take precedence over changing names and profile URLs.
  const key = (author.id || author.token || '').trim()
  return key && key.length <= 180 && !['0', 'anonymous'].includes(key.toLowerCase()) ? key : null
}

function cleanText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  return [...value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, limit).join('')
}

export function normalizeZhihuRemark(value: Partial<ZhihuUserRemark>): ZhihuUserRemark {
  const tags = Array.isArray(value.tags) ? value.tags : []
  return {
    name: cleanText(value.name, MAX_NAME),
    tags: [...new Set(tags.slice(0, 24).map((tag) => cleanText(tag, MAX_TAG_LENGTH)).filter(Boolean))].slice(0, MAX_TAGS),
  }
}

function readRecords(storage: Pick<Storage, 'getItem'> | undefined, key: string): Map<string, ZhihuUserRemark> {
  let parsed: unknown
  try { parsed = JSON.parse(storage?.getItem(key) ?? 'null') } catch { return new Map() }
  if (!parsed || typeof parsed !== 'object' || (parsed as PersistedRemarks).version !== 1) return new Map()
  const entries = (parsed as PersistedRemarks).entries
  if (!Array.isArray(entries)) return new Map()
  const rows = new Map<string, ZhihuUserRemark>()
  for (const entry of entries.slice(0, MAX_ENTRIES)) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !entry[0].trim() || entry[0].length > 180) continue
    if (!entry[1] || typeof entry[1] !== 'object') continue
    const note = normalizeZhihuRemark(entry[1])
    if (note.name || note.tags.length) rows.set(entry[0], note)
  }
  return rows
}

/** Device-local only. Keep notes out of Zhihu APIs and NewsNook cloud preferences. */
export class ZhihuRemarkStore {
  readonly storageKey: string
  private records: Map<string, ZhihuUserRemark>
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined
  private readonly listeners = new Set<() => void>()

  constructor(
    accountId?: string,
    storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined,
  ) {
    const scope = accountId?.trim() || 'guest'
    this.storageKey = STORAGE_PREFIX + encodeURIComponent(scope)
    this.storage = storage
    this.records = readRecords(storage, this.storageKey)
  }

  get(identity: string | null): ZhihuUserRemark | undefined {
    return identity ? this.records.get(identity) : undefined
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Persist before notifying React; a quota error cannot produce phantom edits. */
  save(identity: string | null, input: Partial<ZhihuUserRemark>): void {
    const key = identity?.trim()
    if (!key || key.length > 180) throw new Error('无法确定知乎用户身份，不能保存备注')
    const value = normalizeZhihuRemark(input)
    const next = new Map(this.records)
    if (value.name || value.tags.length) {
      if (!next.has(key) && next.size >= MAX_ENTRIES) throw new Error('本地备注数量已达到上限，请先删除不再需要的备注')
      next.set(key, value)
    } else {
      next.delete(key)
    }
    if (!this.storage) throw new Error('本机存储不可用，备注未保存')
    try {
      this.storage.setItem(this.storageKey, JSON.stringify({ version: 1, entries: [...next] } satisfies PersistedRemarks))
    } catch {
      throw new Error('本机存储失败，请检查可用空间后重试')
    }
    this.records = next
    this.listeners.forEach((listener) => listener())
  }

  /** Called on browser storage events so open tabs stay consistent. */
  reload(): void {
    this.records = readRecords(this.storage, this.storageKey)
    this.listeners.forEach((listener) => listener())
  }
}
