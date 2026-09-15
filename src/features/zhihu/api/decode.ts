import type { Page, ZhihuAuthor, ZhihuContentSummary, ZhihuEntityKind, ZhihuEntityRef } from '../types'

type JsonRecord = Record<string, unknown>

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function htmlText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function decodeZhihuAuthor(value: unknown): ZhihuAuthor | undefined {
  const author = asRecord(value)
  if (!author) return undefined
  const id = stringValue(author.id) ?? stringValue(author.url_token)
  const name = stringValue(author.name)
  if (!id || !name) return undefined
  return {
    id,
    token: stringValue(author.url_token),
    name,
    avatarUrl: stringValue(author.avatar_url),
    headline: stringValue(author.headline),
  }
}

function entityKind(value: unknown): ZhihuEntityKind | null {
  switch (value) {
    case 'answer': case 'article': case 'pin': case 'question': case 'people': case 'collection': case 'comment': case 'topic':
      return value
    default:
      return null
  }
}

function canonicalUrl(ref: ZhihuEntityRef, object: JsonRecord): string {
  const explicit = stringValue(object.url)
  if (explicit?.startsWith('http')) return explicit
  switch (ref.kind) {
    case 'answer': {
      const question = asRecord(object.question)
      const qid = stringValue(question?.id)
      return qid ? `https://www.zhihu.com/question/${qid}/answer/${ref.id}` : `https://www.zhihu.com/answer/${ref.id}`
    }
    case 'article': return `https://zhuanlan.zhihu.com/p/${ref.id}`
    case 'question': return `https://www.zhihu.com/question/${ref.id}`
    case 'pin': return `https://www.zhihu.com/pin/${ref.id}`
    case 'people': return `https://www.zhihu.com/people/${encodeURIComponent(stringValue(object.url_token) ?? ref.id)}`
    case 'collection': return `https://www.zhihu.com/collection/${encodeURIComponent(ref.id)}`
    case 'topic': return `https://www.zhihu.com/topic/${encodeURIComponent(ref.id)}/hot`
    default: return `https://www.zhihu.com/`
  }
}

export function decodeZhihuSummary(value: unknown): ZhihuContentSummary | null {
  let object = asRecord(value)
  if (!object) return null
  // feed/search wrappers
  object = asRecord(object.target) ?? asRecord(object.object) ?? asRecord(object.content) ?? object

  const kind = entityKind(object.type) ?? (object.question && object.content ? 'answer' : null)
  const id = stringValue(object.id)
  if (!kind || !id) return null
  const ref: ZhihuEntityRef = { kind, id }
  const question = asRecord(object.question)
  const title = stringValue(object.title) ?? stringValue(question?.title) ?? stringValue(object.name) ?? '知乎内容'
  const excerpt = stringValue(object.excerpt) ?? htmlText(object.content) ?? ''
  return {
    ref,
    title,
    excerpt,
    url: canonicalUrl(ref, object),
    author: decodeZhihuAuthor(object.author),
    voteupCount: numberValue(object.voteup_count),
    commentCount: numberValue(object.comment_count),
    createdAt: numberValue(object.created_time) ?? numberValue(object.created_at),
  }
}

export interface DecodedZhihuPage extends Page<ZhihuContentSummary> {
  skipped: number
}

export function decodeZhihuPage(value: unknown): DecodedZhihuPage {
  const root = asRecord(value)
  if (!root) throw new Error('知乎响应不是 JSON object')
  const data = Array.isArray(root.data) ? root.data : []
  const items: ZhihuContentSummary[] = []
  let skipped = 0
  const seen = new Set<string>()
  for (const raw of data) {
    const item = decodeZhihuSummary(raw)
    if (!item) {
      skipped += 1
      continue
    }
    const key = `${item.ref.kind}:${item.ref.id}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }
  const paging = asRecord(root.paging)
  const next = stringValue(paging?.next)
  const isEnd = paging?.is_end === true
  return { items, nextCursor: next || undefined, hasMore: Boolean(next) && !isEnd, skipped }
}

export interface ZhihuContentDetail extends ZhihuContentSummary {
  contentHtml: string
  createdAt?: number
  questionId?: string
  voteState: 'up' | 'down' | 'neutral'
  isFollowing: boolean
}

export function decodeZhihuContentDetail(value: unknown): ZhihuContentDetail {
  const object = asRecord(value)
  const summary = decodeZhihuSummary(object)
  if (!object || !summary) throw new Error('知乎正文缺少实体 id/type')
  const contentHtml = stringValue(object.content) ?? stringValue(object.detail) ?? ''
  const question = asRecord(object.question)
  const reaction = asRecord(object.reaction)
  const relation = asRecord(reaction?.relation)
  const relationship = asRecord(object.relationship)
  const rawVote = stringValue(relation?.vote)?.toLowerCase()
  const voteState = rawVote === 'up' || rawVote === 'down' ? rawVote : 'neutral'
  return {
    ...summary,
    contentHtml,
    createdAt: numberValue(object.created_time),
    questionId: stringValue(question?.id),
    voteState,
    isFollowing: relationship?.is_following === true || relation?.following === true,
  }
}
