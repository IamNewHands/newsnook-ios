import { fetchAbsoluteText } from '../../../lib/http'
import type {
  CommentItem,
  CommentProvider,
  CommentQuote,
  CommentsQueryResult,
  CommentTab,
} from '../types'

/**
 * 机核（gcores）评论适配器。
 *
 * 实测接口（2026-09-22）：
 *   GET https://www.gcores.com/gapi/v1/<articles|radios>/<id>/comments?page[limit]=20&page[offset]=0&include=user
 *
 * 关键约束：gapi 是严格 JSON:API，**必须**带 `Accept: application/vnd.api+json`，
 * 否则 406 Not acceptable（radios 尤其明显）。
 *
 * 响应形状：
 *   data[]     → { id, attributes: { body, depth, likes-count, created-at }, relationships: { user: { data: { id } }, parent } }
 *   included[] → users: { id, attributes: { nickname, thumb, location } }
 *   meta['record-count'] → 该文评论总数（入口门控用）
 *
 * 头像：`https://image.gcores.com/<thumb>`（实测 200）。
 * 覆盖来源：机核 RSS 里 articles 与 radios 两类（feed 实测 15 articles + 5 radios）。
 */
const GAPI_ACCEPT = 'application/vnd.api+json'
const GORES_PAGE_SIZE = 20

type GcoresKind = 'articles' | 'radios'

export function extractGcoresTarget(
  article: { sourceId?: string; originUrl?: string },
): { kind: GcoresKind; id: string } | undefined {
  const match = article.originUrl?.match(/gcores\.com\/(articles|radios)\/(\d+)/i)
  if (match?.[1] && match[2]) {
    return { kind: match[1].toLowerCase() as GcoresKind, id: match[2] }
  }
  return undefined
}

function formatCommentTime(raw?: string): string {
  if (!raw) return '刚刚'
  const timestamp = Date.parse(raw)
  if (Number.isNaN(timestamp)) return raw
  const diff = Math.max(0, Date.now() - timestamp)
  const minute = 60000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`
  if (diff < day) return `${Math.floor(diff / hour)}小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`
  return raw.slice(0, 10)
}

function stripHtml(html?: string): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim()
}

interface GcoresRawComment {
  id?: string
  attributes?: {
    body?: string
    depth?: number
    'likes-count'?: number
    'created-at'?: string
  }
  relationships?: {
    user?: { data?: { id?: string } }
    parent?: { data?: { id?: string } | null }
  }
}

interface GcoresRawUser {
  id?: string
  attributes?: {
    nickname?: string
    thumb?: string
    location?: string
  }
}

/** 解析 gapi 评论响应（JSON:API：data + included） */
export function parseGcoresComments(raw: string): CommentItem[] {
  let payload: { data?: GcoresRawComment[]; included?: GcoresRawUser[] }
  try {
    payload = JSON.parse(raw) as typeof payload
  } catch {
    return []
  }

  const users = new Map<string, GcoresRawUser>()
  for (const item of payload.included ?? []) {
    if (item?.id) users.set(item.id, item)
  }

  const byId = new Map<string, GcoresRawComment>()
  for (const item of payload.data ?? []) {
    if (item?.id) byId.set(item.id, item)
  }

  const comments: CommentItem[] = []
  for (const item of payload.data ?? []) {
    if (!item?.id) continue
    const content = stripHtml(item.attributes?.body)
    if (!content) continue

    const user = item.relationships?.user?.data?.id
      ? users.get(item.relationships.user.data.id)
      : undefined
    const likes = item.attributes?.['likes-count'] ?? 0
    const parentId = item.relationships?.parent?.data?.id
    const parent = parentId ? byId.get(parentId) : undefined
    const parentBody = parent ? stripHtml(parent.attributes?.body) : undefined
    const parentUser = parent?.relationships?.user?.data?.id
      ? users.get(parent.relationships.user.data.id)
      : undefined

    const quotes: CommentQuote[] = []
    if (parentId && parentBody) {
      quotes.push({
        id: parentId,
        author: parentUser?.attributes?.nickname || '机核用户',
        content: parentBody,
        location: parentUser?.attributes?.location,
      })
    }

    comments.push({
      id: item.id,
      author: user?.attributes?.nickname || '机核用户',
      avatar: user?.attributes?.thumb ? `https://image.gcores.com/${user.attributes.thumb}` : undefined,
      location: user?.attributes?.location,
      content,
      createTimeRaw: item.attributes?.['created-at'],
      createTimeFormatted: formatCommentTime(item.attributes?.['created-at']),
      voteCount: likes,
      isHot: likes >= 10,
      quotes: quotes.length > 0 ? quotes : undefined,
    })
  }
  return comments
}

/** 评论总数（meta.record-count） */
export function parseGcoresRecordCount(raw: string): number | undefined {
  try {
    const parsed = JSON.parse(raw) as { meta?: { 'record-count'?: number } }
    const count = parsed.meta?.['record-count']
    return typeof count === 'number' ? count : undefined
  } catch {
    return undefined
  }
}

function commentsUrl(target: { kind: GcoresKind; id: string }, limit: number, offset: number): string {
  return `https://www.gcores.com/gapi/v1/${target.kind}/${target.id}/comments?page[limit]=${limit}&page[offset]=${offset}&include=user`
}

/** 网络抖动容忍：单次失败后再试一次 */
async function fetchGapi(url: string, signal?: AbortSignal): Promise<string | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchAbsoluteText(url, { accept: GAPI_ACCEPT, signal })
    } catch (err) {
      if (signal?.aborted) throw err
      if (attempt === 1) return undefined
    }
  }
  return undefined
}

export const gcoresCommentProvider: CommentProvider = {
  label: '评论',
  defaultTab: 'hot',
  // 大量条目零评论：确知有评论才显示入口
  requiresCommentCount: true,

  canHandle(article) {
    return Boolean(extractGcoresTarget(article))
  },

  async getSummaryCount(article, signal): Promise<number | undefined> {
    const target = extractGcoresTarget(article)
    if (!target) return undefined
    const raw = await fetchGapi(commentsUrl(target, 1, 0), signal)
    return raw ? parseGcoresRecordCount(raw) : undefined
  },

  async getComments(article, _tab, offset = 0, signal): Promise<CommentsQueryResult> {
    const tabs: CommentTab[] = [{ id: 'hot', label: '全部评论' }]
    const target = extractGcoresTarget(article)
    if (!target) {
      return { comments: [], totalCount: 0, availableTabs: [], hasMore: false }
    }

    const itemOffset = Math.max(0, Number(offset) || 0)
    const raw = await fetchGapi(commentsUrl(target, GORES_PAGE_SIZE, itemOffset), signal)
    if (!raw) {
      return { comments: [], totalCount: 0, availableTabs: tabs, hasMore: false }
    }

    const comments = parseGcoresComments(raw)
    const total = parseGcoresRecordCount(raw)

    return {
      comments,
      totalCount: total ?? comments.length,
      availableTabs: tabs,
      hasMore: typeof total === 'number' ? itemOffset + comments.length < total : comments.length >= GORES_PAGE_SIZE,
      nextOffset: itemOffset + GORES_PAGE_SIZE,
    }
  },
}
