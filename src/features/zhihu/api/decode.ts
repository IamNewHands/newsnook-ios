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
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(stringValue).filter((item): item is string => Boolean(item))
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

function refFromZhihuUrl(raw: string | undefined): ZhihuEntityRef | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || !(url.hostname === 'zhihu.com' || url.hostname === 'www.zhihu.com' || url.hostname === 'zhuanlan.zhihu.com')) return null
    let match = /^\/question\/(\d+)\/answer\/(\d+)/.exec(url.pathname)
    if (match) return { kind: 'answer', id: match[2]! }
    match = /^\/question\/(\d+)/.exec(url.pathname)
    if (match) return { kind: 'question', id: match[1]! }
    match = /^\/p\/(\d+)/.exec(url.pathname)
    if (match && url.hostname === 'zhuanlan.zhihu.com') return { kind: 'article', id: match[1]! }
    match = /^\/pin\/(\d+)/.exec(url.pathname)
    if (match) return { kind: 'pin', id: match[1]! }
  } catch {
    return null
  }
  return null
}

function componentRouteUrl(card: JsonRecord): string | undefined {
  const action = asRecord(card.action)
  const parameter = stringValue(action?.parameter)
  if (!parameter) return undefined
  try {
    const route = new URLSearchParams(parameter).get('route_url')
    if (!route) return undefined
    const url = new URL(route)
    if (url.hostname === 'zhihu.com') url.hostname = 'www.zhihu.com'
    return url.href
  } catch {
    return undefined
  }
}

function collectRecords(value: unknown, output: JsonRecord[] = []): JsonRecord[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, output)
    return output
  }
  const record = asRecord(value)
  if (!record) return output
  output.push(record)
  for (const nested of Object.values(record)) collectRecords(nested, output)
  return output
}

function componentText(records: JsonRecord[], suffix: string): string | undefined {
  const match = records.find((record) => stringValue(record.test_id)?.endsWith(suffix) && typeof record.text === 'string')
  return stringValue(match?.text)
}

function decodeHotListFeed(card: JsonRecord): ZhihuContentSummary | null {
  if (card.type !== 'hot_list_feed') return null
  const target = asRecord(card.target)
  if (!target) return null
  const link = asRecord(target.link)
  const rawUrl = stringValue(link?.url)
  let ref = refFromZhihuUrl(rawUrl)
  if (!ref) {
    const cardId = stringValue(card.card_id)
    const questionId = cardId?.startsWith('Q_') ? cardId.slice(2) : undefined
    if (questionId && /^\d+$/.test(questionId)) ref = { kind: 'question', id: questionId }
  }
  if (!ref) return null
  const title = htmlText(stringValue(asRecord(target.title_area)?.text)) || '知乎热榜'
  const excerpt = htmlText(stringValue(asRecord(target.excerpt_area)?.text))
  const metrics = stringValue(asRecord(target.metrics_area)?.text)
  const tag = stringValue(asRecord(target.text_tag_area)?.text)
  return {
    ref,
    title,
    excerpt,
    url: rawUrl ?? canonicalUrl(ref, {}),
    recommendationReason: [tag, metrics].filter(Boolean).join(' · ') || undefined,
  }
}

function decodeComponentCard(card: JsonRecord): ZhihuContentSummary | null {
  if (card.type !== 'ComponentCard') return null
  const extra = asRecord(card.extra)
  const rawType = stringValue(extra?.content_type)?.toLowerCase()
  const contentId = stringValue(extra?.content_id)
  const routeUrl = componentRouteUrl(card)
  const routeRef = refFromZhihuUrl(routeUrl)
  const kind = entityKind(rawType)
  const ref = kind && contentId ? { kind, id: contentId } satisfies ZhihuEntityRef : routeRef
  if (!ref) return null

  const records = collectRecords(card.children)
  const title = htmlText(componentText(records, '.title')) || '知乎内容'
  const excerpt = htmlText(componentText(records, '.description'))
  const business = asRecord(extra?.business_ext_map)
  const user = asRecord(business?.userInfo)
  const authorName = stringValue(user?.userName)
  const authorId = stringValue(user?.memberHashId)
  const author = authorName && authorId ? {
    id: authorId,
    token: authorId,
    name: authorName,
    avatarUrl: stringValue(user?.avatarUrl),
  } : undefined

  return {
    ref,
    title,
    excerpt,
    url: routeUrl ?? canonicalUrl(ref, {}),
    author,
  }
}

export function decodeZhihuSummary(value: unknown): ZhihuContentSummary | null {
  let object = asRecord(value)
  if (!object) return null
  const hot = decodeHotListFeed(object)
  if (hot) return hot
  const component = decodeComponentCard(object)
  if (component) return component

  // feed/search wrappers
  object = asRecord(object.target) ?? asRecord(object.object) ?? asRecord(object.content) ?? object

  const kind = entityKind(object.type) ?? (object.question && object.content ? 'answer' : null)
  const id = stringValue(object.id)
  if (!kind || !id) return null
  const ref: ZhihuEntityRef = { kind, id }
  const question = asRecord(object.question)
  const title = htmlText(stringValue(object.title) ?? stringValue(question?.title) ?? stringValue(object.name)) || '知乎内容'
  const excerpt = htmlText(stringValue(object.excerpt)) || htmlText(object.content) || ''
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
  /** 编辑器专用原始可编辑 HTML；不能用阅读 sanitizer 的结果覆盖。 */
  editableContentHtml?: string
  createdAt?: number
  questionId?: string
  previousAnswerIds?: string[]
  nextAnswerIds?: string[]
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
  const pagination = asRecord(object.pagination_info) ?? asRecord(object.paginationInfo)
  const rawVote = stringValue(relation?.vote)?.toLowerCase()
  const voteState = rawVote === 'up' || rawVote === 'down' ? rawVote : 'neutral'
  return {
    ...summary,
    contentHtml,
    editableContentHtml: stringValue(object.editable_content) ?? contentHtml,
    createdAt: numberValue(object.created_time),
    questionId: stringValue(question?.id),
    previousAnswerIds: stringArray(pagination?.prev_answer_ids ?? pagination?.prevAnswerIds),
    nextAnswerIds: stringArray(pagination?.next_answer_ids ?? pagination?.nextAnswerIds),
    voteState,
    isFollowing: relationship?.is_following === true || relation?.following === true,
  }
}
