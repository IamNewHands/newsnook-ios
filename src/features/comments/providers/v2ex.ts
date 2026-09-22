import { fetchAbsoluteText } from '../../../lib/http'
import type { CommentItem, CommentProvider, CommentsQueryResult, CommentTab } from '../types'

/**
 * V2EX 回复适配器。
 *
 * 实测接口（2026-09-22，v1 API 仍可用且免登录）：
 *   GET https://www.v2ex.com/api/topics/show.json?id=<topicId>    → 主题（含 replies = 回复数）
 *   GET https://www.v2ex.com/api/replies/show.json?topic_id=<id>  → 全部回复（一次返回，无分页）
 *
 * 响应字段：member.username / member.avatar_large、content / content_rendered（HTML）、
 * created（epoch 秒）。实测 topic 1243998 → replies 12、replies 数组 11 条。
 *
 * 注意：v2 API（/api/v2/*）需要 Token（401），不使用。
 */
function extractV2exTopicId(article: { sourceId?: string; originUrl?: string }): string | undefined {
  const match = article.originUrl?.match(/v2ex\.com\/t\/(\d+)/i)
  return match?.[1]
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

function formatCommentTime(epochSeconds?: number): string {
  if (typeof epochSeconds !== 'number' || epochSeconds <= 0) return '刚刚'
  const diff = Math.max(0, Date.now() - epochSeconds * 1000)
  const minute = 60000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`
  if (diff < day) return `${Math.floor(diff / hour)}小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)}天前`
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
}

interface V2exRawReply {
  id?: number
  content?: string
  content_rendered?: string
  created?: number
  member?: {
    username?: string
    avatar_large?: string
    avatar_normal?: string
  }
}

/** 解析 `/api/replies/show.json` 响应 */
export function parseV2exReplies(raw: string): CommentItem[] {
  let list: V2exRawReply[]
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    list = parsed as V2exRawReply[]
  } catch {
    return []
  }

  const comments: CommentItem[] = []
  for (const item of list) {
    const content = stripHtml(item.content_rendered || item.content)
    if (!content) continue
    comments.push({
      id: String(item.id ?? `${item.member?.username ?? 'v2ex'}-${item.created ?? comments.length}`),
      author: item.member?.username || 'V2EX 用户',
      avatar: item.member?.avatar_large || item.member?.avatar_normal,
      content,
      createTimeRaw: item.created ? String(item.created) : undefined,
      createTimeFormatted: formatCommentTime(item.created),
      voteCount: 0,
    })
  }
  return comments
}

/** 主题回复数（topics/show.json 的 replies 字段） */
export function parseV2exTopicReplyCount(raw: string): number | undefined {
  try {
    const parsed = JSON.parse(raw) as Array<{ replies?: number }> | { replies?: number }
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    return typeof first?.replies === 'number' ? first.replies : undefined
  } catch {
    return undefined
  }
}

/** 网络抖动容忍：单次失败后再试一次 */
async function fetchJson(url: string, signal?: AbortSignal): Promise<string | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchAbsoluteText(url, { accept: 'application/json', signal })
    } catch (err) {
      if (signal?.aborted) throw err
      if (attempt === 1) return undefined
    }
  }
  return undefined
}

export const v2exCommentProvider: CommentProvider = {
  label: '回复',
  defaultTab: 'hot',
  // 大量主题零回复：确知有回复才显示入口
  requiresCommentCount: true,

  canHandle(article) {
    if (article.sourceId === 'v2ex') return true
    return Boolean(extractV2exTopicId(article))
  },

  async getSummaryCount(article, signal): Promise<number | undefined> {
    const topicId = extractV2exTopicId(article)
    if (!topicId) return undefined
    const raw = await fetchJson(`https://www.v2ex.com/api/topics/show.json?id=${topicId}`, signal)
    return raw ? parseV2exTopicReplyCount(raw) : undefined
  },

  async getComments(article, _tab, _offset, signal): Promise<CommentsQueryResult> {
    const tabs: CommentTab[] = [{ id: 'hot', label: '全部回复' }]
    const topicId = extractV2exTopicId(article)
    if (!topicId) {
      return { comments: [], totalCount: 0, availableTabs: [], hasMore: false }
    }

    const raw = await fetchJson(`https://www.v2ex.com/api/replies/show.json?topic_id=${topicId}`, signal)
    if (!raw) {
      return { comments: [], totalCount: 0, availableTabs: tabs, hasMore: false }
    }

    const comments = parseV2exReplies(raw)
    return {
      comments,
      totalCount: comments.length,
      availableTabs: tabs,
      // v1 回复接口一次返回全部，无分页
      hasMore: false,
    }
  },
}
