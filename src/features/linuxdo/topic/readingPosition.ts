import { log } from '../../../lib/logger'
import { readRaw, writeRawOrThrow } from '../../../lib/storage'
import type { LinuxDoPost, LinuxDoTopic } from '../types'

const STORAGE_KEY = 'linuxdo-topic-positions:v1'
const POSITION_LIMIT = 240

export interface LinuxDoTopicPosition {
  postNumber: number
  /** Distance from the post's top to the viewport's top, including header space. */
  offset: number
  /** Opening-only hint; captured/stored positions retain their existing offsets. */
  alignBelowToolbar?: boolean
}

type StoredPosition = LinuxDoTopicPosition & { updatedAt: number }

function positions(): Record<string, StoredPosition> {
  try {
    const raw = JSON.parse(readRaw(STORAGE_KEY) ?? '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, StoredPosition] => {
      const value = entry[1] as StoredPosition | null
      return !!value && Number.isInteger(value.postNumber) && value.postNumber > 0
        && Number.isFinite(value.offset) && Number.isFinite(value.updatedAt)
    }).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, POSITION_LIMIT))
  } catch { return {} }
}

function key(topicId: number, userId?: number): string {
  return `${userId ?? 'guest'}:${topicId}`
}

export function linuxDoTopicPositionOf(topicId: number, userId?: number): LinuxDoTopicPosition | undefined {
  return positions()[key(topicId, userId)]
}

/** Persist only on leaving/backgrounding, never on every scroll or as an HTTP ACK. */
export function rememberLinuxDoTopicPosition(topicId: number, userId: number | undefined, position: LinuxDoTopicPosition): void {
  const next = { ...positions(), [key(topicId, userId)]: { ...position, updatedAt: Date.now() } }
  const kept = Object.entries(next).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, POSITION_LIMIT)
  try { writeRawOrThrow(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept))) }
  catch (error) { log.storage.warn('LinuxDO topic position save failed', error) }
}

/** Match Discourse's lastUnreadUrl when no explicit link or local viewport exists. */
export function linuxDoServerResumePosition(topic: LinuxDoTopic): LinuxDoTopicPosition | undefined {
  const lastRead = topic.lastReadPostNumber
  if (typeof lastRead !== 'number' || !Number.isInteger(lastRead) || lastRead <= 0) return undefined
  const highest = topic.highestPostNumber ?? Math.max(topic.postsCount, lastRead)
  return { postNumber: Math.min(lastRead + 1, highest), offset: 0 }
}

export function captureLinuxDoTopicPosition(root: HTMLElement): LinuxDoTopicPosition | undefined {
  const viewport = root.getBoundingClientRect()
  const visibleTop = viewport.top + (root.querySelector<HTMLElement>('[data-linuxdo-reading-toolbar]')?.offsetHeight ?? 0)
  let fallback: LinuxDoTopicPosition | undefined
  for (const element of root.querySelectorAll<HTMLElement>('article[data-linuxdo-post-number]')) {
    const rect = element.getBoundingClientRect()
    const postNumber = Number(element.dataset.linuxdoPostNumber)
    const overlap = Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, visibleTop)
    if (!Number.isInteger(postNumber) || postNumber <= 0 || overlap <= 0) continue
    const position = { postNumber, offset: viewport.top - rect.top }
    fallback ??= position
    // Keep a readable post as the anchor, rather than a sliver of the previous
    // card under the sticky controls. Offsets remain relative to the scroller.
    if (overlap >= Math.min(32, Math.max(1, rect.height * 0.2))) return position
  }
  return fallback
}

export function restoreLinuxDoTopicPosition(root: HTMLElement, position: LinuxDoTopicPosition): boolean {
  const posts = Array.from(root.querySelectorAll<HTMLElement>('article[data-linuxdo-post-number]'))
  const element = posts.find(post => Number(post.dataset.linuxdoPostNumber) === position.postNumber)
    // Deleted floors can leave a hole; choose the nearest floor in the returned window.
    ?? posts.sort((a, b) => Math.abs(Number(a.dataset.linuxdoPostNumber) - position.postNumber)
      - Math.abs(Number(b.dataset.linuxdoPostNumber) - position.postNumber))[0]
  if (!element) return false
  const rect = element.getBoundingClientRect()
  const offset = Math.min(position.offset, Math.max(0, rect.height - 1))
  const inset = position.alignBelowToolbar ? root.querySelector<HTMLElement>('[data-linuxdo-reading-toolbar]')?.offsetHeight ?? 0 : 0
  root.scrollTop = Math.max(0, root.scrollTop + rect.top - root.getBoundingClientRect().top + offset - inset)
  return true
}

/** Continue around a deep-linked window, rather than appending the earliest missing floors. */
export function adjacentLinuxDoPostIds(stream: number[], posts: LinuxDoPost[], direction: 'before' | 'after' | 'gap'): number[] {
  const present = new Set(posts.map(post => post.id))
  const indices = stream.map((id, index) => present.has(id) ? index : -1).filter(index => index >= 0)
  if (!indices.length) return []
  const gaps = stream.slice(Math.min(...indices), Math.max(...indices) + 1).filter(id => !present.has(id))
  // Quotes/new replies can merge distant windows; fill their interior before advancing.
  if (gaps.length) return direction === 'before' ? gaps.slice(-40) : gaps.slice(0, 40)
  if (direction === 'gap') return []
  return direction === 'before'
    ? stream.slice(Math.max(0, Math.min(...indices) - 40), Math.min(...indices)).filter(id => !present.has(id))
    : stream.slice(Math.max(...indices) + 1, Math.max(...indices) + 41).filter(id => !present.has(id))
}
