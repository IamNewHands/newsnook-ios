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
}

export interface ZhihuAnswerNeighbors {
  previous?: ZhihuEntityRef
  next?: ZhihuEntityRef
}

function neighborsOf(items: ZhihuContentSummary[], answerId: string): ZhihuAnswerNeighbors | null {
  const index = items.findIndex((item) => item.ref.id === answerId)
  if (index < 0) return null
  return {
    previous: index > 0 ? items[index - 1]?.ref : undefined,
    next: items[index + 1]?.ref,
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

      const cursor = sequence.initialized ? sequence.nextCursor : undefined
      const cursorKey = cursor ?? '<first>'
      if (sequence.loadedCursors.has(cursorKey)) {
        sequence.hasMore = false
        return neighbors ?? {}
      }

      const page = await this.reader.questionAnswers(questionId, 'default', cursor, signal)
      if (signal?.aborted) return {}
      sequence.loadedCursors.add(cursorKey)

      const seen = new Set(sequence.items.map((item) => item.ref.id))
      const incoming = page.items.filter((item) => item.ref.kind === 'answer' && !seen.has(item.ref.id))
      sequence.items = [...sequence.items, ...incoming]
      sequence.nextCursor = page.nextCursor
      sequence.hasMore = page.hasMore && Boolean(page.nextCursor)
      sequence.initialized = true
    }

    return {}
  }
}
