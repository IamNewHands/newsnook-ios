import type { ZhihuContentDetail } from '../api/decode'
import type { Page, ZhihuContentSummary, ZhihuEntityRef } from '../types'

interface AnswerPageReader {
  questionAnswers(
    questionId: string,
    order: 'default',
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>>
}

interface AnswerSequence {
  items: ZhihuContentSummary[]
  nextCursor?: string
  hasMore: boolean
  initialized: boolean
  loadedCursors: Set<string>
  loadingCursor?: string
  loadingPage?: Promise<void>
}

export interface ZhihuAnswerNeighbors {
  previous?: ZhihuEntityRef
  next?: ZhihuEntityRef
  previousPreview?: ZhihuContentSummary
  nextPreview?: ZhihuContentSummary
}

interface AnswerDetailReader {
  read(ref: ZhihuEntityRef): Promise<ZhihuContentDetail>
}

/**
 * Keeps the current and adjacent rendered answer payloads warm while the answer reader stays open.
 * Failed reads are never cached, so the next preload/navigation attempt is a real retry.
 */
export class ZhihuAnswerDetailPreloader {
  private readonly reader: AnswerDetailReader
  private readonly cache = new Map<string, ZhihuContentDetail>()
  private readonly pending = new Map<string, Promise<ZhihuContentDetail>>()
  private readonly maxEntries: number

  constructor(reader: AnswerDetailReader, maxEntries = 5) {
    this.reader = reader
    this.maxEntries = Math.max(3, maxEntries)
  }

  peek(ref: ZhihuEntityRef): ZhihuContentDetail | undefined {
    return ref.kind === 'answer' ? this.cache.get(ref.id) : undefined
  }

  remember(detail: ZhihuContentDetail): void {
    if (detail.ref.kind !== 'answer') return
    this.cache.delete(detail.ref.id)
    this.cache.set(detail.ref.id, detail)
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
  }

  load(ref: ZhihuEntityRef): Promise<ZhihuContentDetail> {
    if (ref.kind !== 'answer') return this.reader.read(ref)
    const cached = this.cache.get(ref.id)
    if (cached) {
      this.remember(cached)
      return Promise.resolve(cached)
    }
    const existing = this.pending.get(ref.id)
    if (existing) return existing

    const request = this.reader.read(ref).then((detail) => {
      this.remember(detail)
      return detail
    }).finally(() => {
      if (this.pending.get(ref.id) === request) this.pending.delete(ref.id)
    })
    this.pending.set(ref.id, request)
    return request
  }
}

function neighborsOf(items: ZhihuContentSummary[], answerId: string): ZhihuAnswerNeighbors | null {
  const index = items.findIndex((item) => item.ref.id === answerId)
  if (index < 0) return null
  return {
    previous: index > 0 ? items[index - 1]?.ref : undefined,
    next: items[index + 1]?.ref,
    previousPreview: index > 0 ? items[index - 1] : undefined,
    nextPreview: items[index + 1],
  }
}

/**
 * Keeps one stable, server-default answer sequence per question.
 *
 * Detail `pagination_info` is intentionally not accepted here: its neighbors belong to
 * the detail request context and are not guaranteed to match the question's default order.
 */
export class ZhihuAnswerNavigator {
  private readonly reader: AnswerPageReader
  private readonly sequences = new Map<string, AnswerSequence>()

  constructor(reader: AnswerPageReader) {
    this.reader = reader
  }

  private async loadNextPage(questionId: string, sequence: AnswerSequence): Promise<void> {
    const cursor = sequence.initialized ? sequence.nextCursor : undefined
    const cursorKey = cursor ?? '<first>'
    if (sequence.loadedCursors.has(cursorKey)) {
      sequence.hasMore = false
      return
    }
    if (sequence.loadingPage && sequence.loadingCursor === cursorKey) {
      await sequence.loadingPage
      return
    }

    const loadingPage = this.reader.questionAnswers(questionId, 'default', cursor).then((page) => {
      sequence.loadedCursors.add(cursorKey)
      const seen = new Set(sequence.items.map((item) => item.ref.id))
      const incoming = page.items.filter((item) => item.ref.kind === 'answer' && !seen.has(item.ref.id))
      sequence.items = [...sequence.items, ...incoming]
      sequence.nextCursor = page.nextCursor
      sequence.hasMore = page.hasMore && Boolean(page.nextCursor)
      sequence.initialized = true
    }).finally(() => {
      if (sequence.loadingPage === loadingPage) {
        sequence.loadingCursor = undefined
        sequence.loadingPage = undefined
      }
    })
    sequence.loadingCursor = cursorKey
    sequence.loadingPage = loadingPage
    await loadingPage
  }

  async neighbors(questionId: string, answerId: string, signal?: AbortSignal): Promise<ZhihuAnswerNeighbors> {
    let sequence = this.sequences.get(questionId)
    if (!sequence) {
      sequence = {
        items: [],
        hasMore: true,
        initialized: false,
        loadedCursors: new Set<string>(),
      }
      this.sequences.set(questionId, sequence)
    }

    while (!signal?.aborted) {
      const neighbors = neighborsOf(sequence.items, answerId)
      if (neighbors && (neighbors.next || (sequence.initialized && !sequence.hasMore))) return neighbors
      if (sequence.initialized && (!sequence.hasMore || !sequence.nextCursor)) return neighbors ?? {}

      await this.loadNextPage(questionId, sequence)
      if (signal?.aborted) return {}
    }

    return {}
  }
}
