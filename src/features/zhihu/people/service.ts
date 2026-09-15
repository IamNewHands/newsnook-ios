import { asRecord, decodeZhihuPage } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import type { Page, ZhihuContentSummary } from '../types'
import type { ZhihuReadApi } from '../feed/service'

type PeopleContentKind = 'answers' | 'articles' | 'questions' | 'pins'

export interface ZhihuPeopleProfile {
  id: string
  token: string
  name: string
  avatarUrl?: string
  headline?: string
  description?: string
  followerCount?: number
  answerCount?: number
  articleCount?: number
  questionCount?: number
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function decodeZhihuPeopleProfile(value: unknown): ZhihuPeopleProfile {
  const root = asRecord(value)
  if (!root) throw new ZhihuApiError('invalid-response', '知乎用户资料不是 JSON object')
  const id = stringValue(root.id) ?? stringValue(root.url_token)
  const token = stringValue(root.url_token) ?? id
  const name = stringValue(root.name)
  if (!id || !token || !name) throw new ZhihuApiError('invalid-response', '知乎用户资料缺少 id/token/name')
  return {
    id,
    token,
    name,
    avatarUrl: stringValue(root.avatar_url),
    headline: stringValue(root.headline),
    description: stringValue(root.description),
    followerCount: numberValue(root.follower_count),
    answerCount: numberValue(root.answer_count),
    articleCount: numberValue(root.articles_count),
    questionCount: numberValue(root.question_count),
  }
}

export class ZhihuPeopleService {
  private readonly api: ZhihuReadApi

  constructor(api: ZhihuReadApi) {
    this.api = api
  }

  async read(token: string, signal?: AbortSignal): Promise<ZhihuPeopleProfile> {
    if (!token.trim()) throw new ZhihuApiError('invalid-response', '用户 token 为空')
    const url = `https://www.zhihu.com/api/v4/members/${encodeURIComponent(token)}`
    return decodeZhihuPeopleProfile(await this.api.getJson('people.read', url, signal))
  }

  async listContent(
    token: string,
    kind: PeopleContentKind,
    offset = 0,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    const url = new URL(`https://www.zhihu.com/api/v4/members/${encodeURIComponent(token)}/${kind}`)
    url.searchParams.set('offset', String(Math.max(0, offset)))
    url.searchParams.set('limit', '20')
    if (kind === 'answers') url.searchParams.set('sort_by', 'voteups')
    if (kind === 'articles') url.searchParams.set('sort_by', 'created')
    const decoded = decodeZhihuPage(await this.api.getJson('people.content', url.href, signal))
    return {
      items: decoded.items,
      nextCursor: decoded.hasMore ? String(offset + 20) : undefined,
      hasMore: decoded.hasMore,
    }
  }
}
