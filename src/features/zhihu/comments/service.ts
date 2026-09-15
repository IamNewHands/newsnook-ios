import { asRecord } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import type { ZhihuReadApi } from '../feed/service'
import type { Page, ZhihuAuthor, ZhihuEntityRef } from '../types'
import type { ZhihuCommentNode } from './types'

export interface ZhihuCommentCacheEntry extends Page<ZhihuCommentNode> {}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function rootCacheKey(ref: ZhihuEntityRef): string {
  return `${ref.kind}:${ref.id}`
}

function mergeCommentPages(
  current: ZhihuCommentCacheEntry | undefined,
  incoming: Page<ZhihuCommentNode>,
): ZhihuCommentCacheEntry {
  if (!current) return { ...incoming, items: [...incoming.items] }
  const seen = new Set(current.items.map((item) => item.id))
  return {
    items: [...current.items, ...incoming.items.filter((item) => !seen.has(item.id))],
    nextCursor: incoming.nextCursor,
    hasMore: incoming.hasMore,
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function decodeAuthor(value: unknown): ZhihuAuthor | undefined {
  const root = asRecord(value)
  if (!root) return undefined
  const id = stringValue(root.id) ?? stringValue(root.url_token) ?? stringValue(root.urlToken)
  const name = stringValue(root.name)
  if (!id || !name) return undefined
  return {
    id,
    token: stringValue(root.url_token) ?? stringValue(root.urlToken),
    name,
    avatarUrl: stringValue(root.avatar_url) ?? stringValue(root.avatarUrl),
    headline: stringValue(root.headline),
  }
}

export function decodeZhihuComment(value: unknown): ZhihuCommentNode | null {
  const root = asRecord(value)
  if (!root) return null
  const id = stringValue(root.id)
  const author = decodeAuthor(root.author)
  if (!id || !author) return null
  const rawChildren = Array.isArray(root.child_comments)
    ? root.child_comments
    : Array.isArray(root.childComments)
      ? root.childComments
      : []
  const children = rawChildren.map(decodeZhihuComment).filter((item): item is ZhihuCommentNode => Boolean(item))
  return {
    id,
    contentHtml: stringValue(root.content) ?? '',
    createdAt: numberValue(root.created_time) ?? numberValue(root.createdTime),
    author,
    replyToAuthor: decodeAuthor(root.reply_to_author ?? root.replyToAuthor),
    likeCount: numberValue(root.like_count) ?? numberValue(root.likeCount) ?? 0,
    liked: booleanValue(root.liked),
    canDelete: booleanValue(root.can_delete ?? root.canDelete),
    childCount: numberValue(root.child_comment_count) ?? numberValue(root.childCommentCount) ?? children.length,
    children,
  }
}

function decodeCommentPage(value: unknown): Page<ZhihuCommentNode> {
  const root = asRecord(value)
  if (!root) throw new ZhihuApiError('invalid-response', '知乎评论响应不是 JSON object')
  const data = Array.isArray(root.data) ? root.data : []
  const items = data.map(decodeZhihuComment).filter((item): item is ZhihuCommentNode => Boolean(item))
  const paging = asRecord(root.paging)
  const next = stringValue(paging?.next)
  return {
    items,
    nextCursor: next || undefined,
    hasMore: paging?.is_end !== true && Boolean(next),
  }
}

function rootCommentType(ref: ZhihuEntityRef): string | null {
  switch (ref.kind) {
    case 'answer': return 'answers'
    case 'article': return 'articles'
    case 'pin': return 'pins'
    case 'question': return 'questions'
    default: return null
  }
}

function assertCommentCursor(cursor: string): string {
  const url = new URL(cursor)
  if (url.protocol !== 'https:' || url.hostname !== 'www.zhihu.com' || !url.pathname.startsWith('/api/v4/comment_v5/')) {
    throw new ZhihuApiError('invalid-response', '知乎评论返回了非法分页地址')
  }
  return url.href
}

export class ZhihuCommentsService {
  private readonly api: ZhihuReadApi
  private readonly rootCache = new Map<string, ZhihuCommentCacheEntry>()
  private readonly childCache = new Map<string, ZhihuCommentCacheEntry>()

  constructor(api: ZhihuReadApi) {
    this.api = api
  }

  cachedRoot(ref: ZhihuEntityRef): ZhihuCommentCacheEntry | undefined {
    return this.rootCache.get(rootCacheKey(ref))
  }

  cachedChildren(commentId: string): ZhihuCommentCacheEntry | undefined {
    return this.childCache.get(commentId)
  }

  async listRoot(ref: ZhihuEntityRef, cursor?: string, signal?: AbortSignal): Promise<Page<ZhihuCommentNode>> {
    const type = rootCommentType(ref)
    if (!type) throw new ZhihuApiError('unsupported', `${ref.kind} 暂无评论读取适配`)
    const url = cursor
      ? assertCommentCursor(cursor)
      : `https://www.zhihu.com/api/v4/comment_v5/${type}/${encodeURIComponent(ref.id)}/root_comment?order_by=score`
    const page = decodeCommentPage(await this.api.getJson('comment.list-root', url, signal))
    const merged = mergeCommentPages(cursor ? this.rootCache.get(rootCacheKey(ref)) : undefined, page)
    this.rootCache.set(rootCacheKey(ref), merged)
    return page
  }

  async listChildren(commentId: string, cursor?: string, signal?: AbortSignal): Promise<Page<ZhihuCommentNode>> {
    const url = cursor
      ? assertCommentCursor(cursor)
      : `https://www.zhihu.com/api/v4/comment_v5/comment/${encodeURIComponent(commentId)}/child_comment`
    const page = decodeCommentPage(await this.api.getJson('comment.list-child', url, signal))
    const merged = mergeCommentPages(cursor ? this.childCache.get(commentId) : undefined, page)
    this.childCache.set(commentId, merged)
    return page
  }
}
