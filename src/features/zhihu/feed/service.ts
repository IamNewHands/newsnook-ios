import type { ZhihuApiClient } from '../api/client'
import {
  validateZhihuCursor,
  zhihuHotUrl,
  zhihuQuestionAnswersUrl,
  zhihuRecommendedUrl,
  zhihuSearchUrl,
} from '../api/endpoints'
import { decodeZhihuPage } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import type { Page, ZhihuContentSummary, ZhihuFeedMode } from '../types'

export interface ZhihuReadApi {
  getJson(operation: string, url: string, signal?: AbortSignal): Promise<unknown>
}

function mergeUnique(items: ZhihuContentSummary[]): ZhihuContentSummary[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.ref.kind}:${item.ref.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function mergeZhihuPages(
  current: Page<ZhihuContentSummary>,
  incoming: Page<ZhihuContentSummary>,
): Page<ZhihuContentSummary> {
  const nextCursor = incoming.nextCursor === current.nextCursor ? undefined : incoming.nextCursor
  return {
    items: mergeUnique([...current.items, ...incoming.items]),
    nextCursor,
    hasMore: incoming.hasMore && Boolean(nextCursor),
  }
}

export class ZhihuFeedService {
  private readonly api: ZhihuReadApi

  constructor(api: ZhihuReadApi) {
    this.api = api
  }

  async listFeed(
    mode: ZhihuFeedMode,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    let operation: string
    let url: string
    if (cursor) {
      url = validateZhihuCursor(cursor)
      operation = mode === 'hot' ? 'feed.hot' : mode === 'following' ? 'feed.following' : 'feed.recommended'
    } else if (mode === 'hot') {
      operation = 'feed.hot'
      url = `${zhihuHotUrl()}?limit=50&mobile=true`
    } else if (mode === 'following') {
      operation = 'feed.following'
      url = 'https://api.zhihu.com/moments_v3?feed_type=recommend'
    } else {
      operation = 'feed.recommended'
      url = zhihuRecommendedUrl()
    }

    const raw = await this.api.getJson(operation, url, signal)
    const decoded = decodeZhihuPage(raw)
    return { items: decoded.items, nextCursor: decoded.nextCursor, hasMore: decoded.hasMore }
  }

  async search(
    query: string,
    offset = 0,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    const normalized = query.trim()
    if (!normalized) return { items: [], hasMore: false }
    const raw = await this.api.getJson('search.query', zhihuSearchUrl(normalized, offset), signal)
    const decoded = decodeZhihuPage(raw)
    return {
      items: decoded.items,
      nextCursor: decoded.hasMore ? String(offset + 20) : undefined,
      hasMore: decoded.hasMore,
    }
  }

  async questionAnswers(
    questionId: string,
    offset = 0,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    if (!questionId) throw new ZhihuApiError('invalid-response', '问题 id 为空')
    const raw = await this.api.getJson('question.answers', zhihuQuestionAnswersUrl(questionId, offset), signal)
    const decoded = decodeZhihuPage(raw)
    return {
      items: decoded.items,
      nextCursor: decoded.hasMore ? String(offset + 20) : undefined,
      hasMore: decoded.hasMore,
    }
  }
}

export function createZhihuFeedService(api: ZhihuApiClient): ZhihuFeedService {
  return new ZhihuFeedService(api)
}
