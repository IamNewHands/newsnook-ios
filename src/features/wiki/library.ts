import type { WikiEntry } from './encyclopedia'

const HISTORY_KEY = 'newsnook.wiki.history.v1'
const BOOKMARKS_KEY = 'newsnook.wiki.bookmarks.v1'
const MAX_HISTORY = 50
const MAX_BOOKMARKS = 200
export type SavedWikiEntry = Pick<WikiEntry, 'query' | 'title' | 'url' | 'providerId'> & { savedAt: number }
export function readWikiLibrary(kind: 'history' | 'bookmarks'): SavedWikiEntry[] {
  try {
    const raw = localStorage.getItem(kind === 'history' ? HISTORY_KEY : BOOKMARKS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is SavedWikiEntry =>
      !!item && typeof item === 'object' &&
      typeof item.query === 'string' && typeof item.title === 'string' &&
      typeof item.providerId === 'string' && typeof item.url === 'string' &&
      typeof item.savedAt === 'number'
    ).slice(0, kind === 'history' ? MAX_HISTORY : MAX_BOOKMARKS)
  } catch { return [] }
}
export function wikiEntryIdentity(entry: Pick<SavedWikiEntry, 'query' | 'providerId'>) {
  return entry.providerId + ':' + entry.query.toLocaleLowerCase()
}
export function rememberWikiEntry(entry: WikiEntry, kind: 'history' | 'bookmarks'): SavedWikiEntry[] {
  const record: SavedWikiEntry = {
    query: entry.query, title: entry.title, url: entry.url,
    providerId: entry.providerId, savedAt: Date.now(),
  }
  const list = [record, ...readWikiLibrary(kind).filter(existing => wikiEntryIdentity(existing) !== wikiEntryIdentity(record))]
    .slice(0, kind === 'history' ? MAX_HISTORY : MAX_BOOKMARKS)
  try { localStorage.setItem(kind === 'history' ? HISTORY_KEY : BOOKMARKS_KEY, JSON.stringify(list)) } catch { /* quota */ }
  return list
}
export function removeWikiBookmark(entry: Pick<SavedWikiEntry, 'query' | 'providerId'>): SavedWikiEntry[] {
  const next = readWikiLibrary('bookmarks').filter(item => wikiEntryIdentity(item) !== wikiEntryIdentity(entry))
  try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next)) } catch { /* storage */ }
  return next
}
