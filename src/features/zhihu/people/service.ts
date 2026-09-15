import { asRecord, decodeZhihuPage, decodeZhihuSummary } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import { validateZhihuCursor } from '../api/endpoints'
import type { Page, ZhihuContentSummary } from '../types'
import type { ZhihuReadApi } from '../feed/service'

export type PeopleContentKind = 'answers' | 'articles' | 'questions' | 'pins'
export type PeopleRelationKind = 'followers' | 'following'
export type PeopleCollectionKind = 'collections' | 'following-collections'

export interface ZhihuPeopleProfile {
  id: string
  token: string
  name: string
  avatarUrl?: string
  headline?: string
  description?: string
  followerCount?: number
  followingCount?: number
  answerCount?: number
  articleCount?: number
  questionCount?: number
  isFollowing: boolean
  isBlocking: boolean
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function paging(value: unknown): { nextCursor?: string; hasMore: boolean } {
  const root = asRecord(value)
  const valuePaging = asRecord(root?.paging)
  const next = stringValue(valuePaging?.next)
  const nextCursor = next ? validateZhihuCursor(next) : undefined
  return {
    nextCursor,
    hasMore: valuePaging?.is_end !== true && Boolean(nextCursor),
  }
}

function pageData(value: unknown): unknown[] {
  const root = asRecord(value)
  return Array.isArray(root?.data) ? root.data : []
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
    followingCount: numberValue(root.following_count),
    answerCount: numberValue(root.answer_count),
    articleCount: numberValue(root.articles_count),
    questionCount: numberValue(root.question_count),
    isFollowing: root.is_following === true || root.isFollowing === true,
    isBlocking: root.is_blocking === true || root.isBlocking === true,
  }
}

export class ZhihuPeopleService {
  private readonly api: ZhihuReadApi

  constructor(api: ZhihuReadApi) {
    this.api = api
  }

  async read(token: string, signal?: AbortSignal): Promise<ZhihuPeopleProfile> {
    if (!token.trim()) throw new ZhihuApiError('invalid-response', '用户 token 为空')
    const url = `https://api.zhihu.com/people/${encodeURIComponent(token)}`
    return decodeZhihuPeopleProfile(await this.api.getJson('people.read', url, signal))
  }

  async listContent(
    token: string,
    kind: PeopleContentKind,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    const normalized = token.trim()
    if (!normalized) throw new ZhihuApiError('invalid-response', '用户 token 为空')
    let url: string
    if (cursor) {
      url = validateZhihuCursor(cursor)
    } else {
      const initial = new URL(`https://www.zhihu.com/api/v4/members/${encodeURIComponent(normalized)}/${kind}`)
      initial.searchParams.set('offset', '0')
      initial.searchParams.set('limit', '20')
      if (kind === 'answers') initial.searchParams.set('sort_by', 'voteups')
      if (kind === 'articles') initial.searchParams.set('sort_by', 'created')
      url = initial.href
    }
    const decoded = decodeZhihuPage(await this.api.getJson('people.content', url, signal))
    return {
      items: decoded.items,
      nextCursor: decoded.nextCursor,
      hasMore: decoded.hasMore,
    }
  }

  async listActivities(
    token: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    const normalized = token.trim()
    if (!normalized) throw new ZhihuApiError('invalid-response', '用户 token 为空')
    const url = cursor
      ? validateZhihuCursor(cursor)
      : `https://www.zhihu.com/api/v3/moments/${encodeURIComponent(normalized)}/activities`
    const decoded = decodeZhihuPage(await this.api.getJson('people.activities', url, signal))
    return { items: decoded.items, nextCursor: decoded.nextCursor, hasMore: decoded.hasMore }
  }

  async listRelations(
    profile: Pick<ZhihuPeopleProfile, 'id' | 'token'>,
    kind: PeopleRelationKind,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuPeopleProfile>> {
    const url = cursor
      ? validateZhihuCursor(cursor)
      : kind === 'followers'
        ? `https://api.zhihu.com/people/${encodeURIComponent(profile.id)}/followers?limit=20&offset=0`
        : `https://www.zhihu.com/api/v4/members/${encodeURIComponent(profile.token)}/followees?limit=20&offset=0`
    const raw = await this.api.getJson(kind === 'followers' ? 'people.followers' : 'people.following', url, signal)
    const items = pageData(raw).map((item) => {
      try {
        return decodeZhihuPeopleProfile(item)
      } catch {
        return null
      }
    }).filter((item): item is ZhihuPeopleProfile => Boolean(item))
    return { items, ...paging(raw) }
  }

  async listFollowingEntities(
    token: string,
    kind: 'questions' | 'topics',
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    const normalized = token.trim()
    if (!normalized) throw new ZhihuApiError('invalid-response', '用户 token 为空')
    const url = cursor
      ? validateZhihuCursor(cursor)
      : kind === 'questions'
        ? `https://www.zhihu.com/api/v4/members/${encodeURIComponent(normalized)}/following-questions?limit=20&offset=0`
        : `https://www.zhihu.com/api/v4/members/${encodeURIComponent(normalized)}/following-topic-contributions?limit=20&offset=0`
    const operation = kind === 'questions' ? 'people.following-questions' : 'people.following-topics'
    const raw = await this.api.getJson(operation, url, signal)
    const items = pageData(raw).map((entry) => {
      const object = asRecord(entry)
      const candidate = kind === 'topics' ? object?.topic ?? entry : entry
      return decodeZhihuSummary(candidate)
    }).filter((item): item is ZhihuContentSummary => Boolean(item))
    return { items, ...paging(raw) }
  }

  async listCollections(
    token: string,
    kind: PeopleCollectionKind,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    const normalized = token.trim()
    if (!normalized) throw new ZhihuApiError('invalid-response', '用户 token 为空')
    const url = cursor
      ? validateZhihuCursor(cursor)
      : kind === 'collections'
        ? `https://www.zhihu.com/api/v4/members/${encodeURIComponent(normalized)}/favlists?limit=20&offset=0`
        : `https://www.zhihu.com/api/v4/members/${encodeURIComponent(normalized)}/following-favlists?limit=20&offset=0`
    const raw = await this.api.getJson(`people.${kind}`, url, signal)
    const items = pageData(raw).map((entry) => {
      const object = asRecord(entry)
      if (!object) return null
      return decodeZhihuSummary({ ...object, type: stringValue(object.type) ?? 'collection' })
    }).filter((item): item is ZhihuContentSummary => Boolean(item))
    return { items, ...paging(raw) }
  }
}
