import { asRecord, decodeZhihuPage } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import type { Page, ZhihuContentSummary } from '../types'
import type { ZhihuReadApi } from '../feed/service'

export interface ZhihuTopicDetail {
  id: string
  name: string
  excerpt?: string
  avatarUrl?: string
  followersCount?: number
  questionsCount?: number
  discussCount?: number
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function decodeZhihuTopicDetail(value: unknown): ZhihuTopicDetail {
  const root = asRecord(value)
  if (!root) throw new ZhihuApiError('invalid-response', '知乎话题资料不是 JSON object')
  const id = stringValue(root.id) ?? stringValue(root.topic_id)
  const name = stringValue(root.name)
  if (!id || !name) throw new ZhihuApiError('invalid-response', '知乎话题资料缺少 id/name')
  return {
    id,
    name,
    excerpt: stringValue(root.excerpt),
    avatarUrl: stringValue(root.avatar_url),
    followersCount: numberValue(root.followers_count),
    questionsCount: numberValue(root.questions_count),
    discussCount: numberValue(root.discuss_count),
  }
}

export class ZhihuTopicService {
  private readonly api: ZhihuReadApi

  constructor(api: ZhihuReadApi) {
    this.api = api
  }

  async read(topicId: string, signal?: AbortSignal): Promise<ZhihuTopicDetail> {
    const id = encodeURIComponent(topicId)
    const url = new URL(`https://www.zhihu.com/api/v5.1/topics/${id}`)
    url.searchParams.set('include', 'name,excerpt,avatar_url,followers_count,questions_count,topic_id,total_pv,discuss_count')
    return decodeZhihuTopicDetail(await this.api.getJson('topic.read', url.href, signal))
  }

  async listHot(topicId: string, offset = 0, signal?: AbortSignal): Promise<Page<ZhihuContentSummary>> {
    const id = encodeURIComponent(topicId)
    const url = new URL(`https://www.zhihu.com/api/v5.1/topics/${id}/feeds/essence/v2`)
    url.searchParams.set('limit', '20')
    url.searchParams.set('offset', String(Math.max(0, offset)))
    const decoded = decodeZhihuPage(await this.api.getJson('topic.feed', url.href, signal))
    return {
      items: decoded.items,
      nextCursor: decoded.hasMore ? String(offset + 20) : undefined,
      hasMore: decoded.hasMore,
    }
  }
}
