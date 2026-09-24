import { fetchAbsoluteText } from '../../../lib/http'
import type {
  CommentItem,
  CommentProvider,
  CommentQuote,
  CommentsQueryResult,
  CommentTab,
} from '../types'

const EM_GBAPI = 'https://gbapi.eastmoney.com'
const EM_COMMON_QS =
  'deviceid=0d2798cab1716439a343c9965c20c59d&version=2&product=eastmoney&plat=wap'

const EASTMONEY_SOURCE_IDS = new Set(['eastmoney-kx', 'eastmoney-news'])

function isEastmoneyHost(url?: string): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'eastmoney.com' || host.endsWith('.eastmoney.com')
  } catch {
    return /eastmoney\.com/i.test(url)
  }
}

/** 从东财文章 URL 提取资讯 newsid（与 WAP `__NewsID` 一致） */
export function extractEastmoneyNewsId(article: {
  sourceId?: string
  originUrl?: string
  neteaseDocId?: string
}): string | undefined {
  const candidates = [article.originUrl, article.neteaseDocId]
  for (const raw of candidates) {
    if (!raw) continue
    const fromPath =
      raw.match(/\/a\/(\d{12,})\.html/i)?.[1] ||
      raw.match(/,(\d{12,})\.html/i)?.[1] ||
      raw.match(/newsid[=_](\d{12,})/i)?.[1]
    if (fromPath) return fromPath
    if (/^\d{12,}$/.test(raw.trim())) return raw.trim()
  }
  return undefined
}

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return '刚刚'
  try {
    const timestamp = Date.parse(dateStr.replace(/-/g, '/'))
    if (Number.isNaN(timestamp)) return dateStr
    const diff = Math.max(0, Date.now() - timestamp)
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour

    if (diff < minute) return '刚刚'
    if (diff < hour) return `${Math.floor(diff / minute)}分钟前`
    if (diff < day) return `${Math.floor(diff / hour)}小时前`
    if (diff < 7 * day) return `${Math.floor(diff / day)}天前`
    return dateStr.slice(5, 16)
  } catch {
    return dateStr
  }
}

function cleanReplyText(raw?: string): string {
  if (!raw) return ''
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim()
}

interface EmReplyUser {
  user_nickname?: string
  user_name?: string
}

interface EmReplyItem {
  reply_id?: number | string
  reply_text?: string
  reply_publish_time?: string
  reply_like_count?: number
  reply_ip_address?: string
  reply_user?: EmReplyUser
  child_replys?: EmReplyItem[]
  source_reply?: EmReplyItem
}

interface EmReplyListResponse {
  rc?: number
  re?: EmReplyItem[]
  count?: number
  reply_total_count?: number
}

interface EmBriefResponse {
  rc?: number
  re?: Array<{
    post_id?: number
    post_comment_count?: number
  }>
}

function mapReply(item: EmReplyItem, isHot = false): CommentItem | null {
  const id = item.reply_id != null ? String(item.reply_id) : ''
  const content = cleanReplyText(item.reply_text)
  if (!id || !content) return null

  const quotes: CommentQuote[] = []
  const source = item.source_reply
  if (source?.reply_text) {
    quotes.push({
      id: String(source.reply_id ?? ''),
      author: source.reply_user?.user_nickname || source.reply_user?.user_name || '股吧网友',
      content: cleanReplyText(source.reply_text),
      location: source.reply_ip_address,
    })
  }
  const child = item.child_replys?.[0]
  if (child?.reply_text && quotes.length === 0) {
    quotes.push({
      id: String(child.reply_id ?? ''),
      author: child.reply_user?.user_nickname || child.reply_user?.user_name || '股吧网友',
      content: cleanReplyText(child.reply_text),
      location: child.reply_ip_address,
    })
  }

  return {
    id,
    author: item.reply_user?.user_nickname || item.reply_user?.user_name || '股吧网友',
    location: item.reply_ip_address,
    content,
    createTimeRaw: item.reply_publish_time,
    createTimeFormatted: formatRelativeTime(item.reply_publish_time),
    voteCount: Number(item.reply_like_count) || 0,
    quotes: quotes.length > 0 ? quotes : undefined,
    isHot,
  }
}

async function fetchEmJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const raw = await fetchAbsoluteText(url, {
    signal,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  })
  return JSON.parse(raw) as T
}

function replyListUrl(newsId: string, tab: 'hot' | 'latest', page: number, pageSize: number): string {
  // WAP：资讯用 newsid + type=1；热门走 ArticleHotReply，最新走 ArticleNewReplyList
  const path =
    tab === 'hot' ? 'reply/api/Reply/ArticleHotReply' : 'reply/api/Reply/ArticleNewReplyList'
  const sorttype = tab === 'hot' ? -1 : 1
  return `${EM_GBAPI}/${path}?postid=${encodeURIComponent(newsId)}&type=1&ps=${pageSize}&p=${page}&sort=1&sorttype=${sorttype}&${EM_COMMON_QS}`
}

function briefUrl(newsId: string): string {
  return `${EM_GBAPI}/abstract/api/PostShort/ArticleBriefInfo?postid=${encodeURIComponent(newsId)}&type=1&${EM_COMMON_QS}`
}

export const eastmoneyCommentProvider: CommentProvider = {
  canHandle(article) {
    if (article.sourceId && EASTMONEY_SOURCE_IDS.has(article.sourceId)) return true
    if (isEastmoneyHost(article.originUrl)) return true
    return false
  },

  async getComments(article, tab = 'hot', offset = 0, signal?: AbortSignal): Promise<CommentsQueryResult> {
    const newsId = extractEastmoneyNewsId(article)
    const availableTabs: CommentTab[] = [
      { id: 'hot', label: '热门跟帖' },
      { id: 'latest', label: '最新跟帖' },
    ]
    if (!newsId) {
      return { comments: [], totalCount: 0, availableTabs: [], hasMore: false }
    }

    const pageSize = 20
    const currentOffset = typeof offset === 'number' ? offset : Number.parseInt(String(offset), 10) || 0
    const page = Math.floor(currentOffset / pageSize) + 1
    const activeTab = tab === 'latest' ? 'latest' : 'hot'

    try {
      const data = await fetchEmJson<EmReplyListResponse>(replyListUrl(newsId, activeTab, page, pageSize), signal)
      if (data.rc !== 1) {
        return { comments: [], totalCount: 0, availableTabs, hasMore: false }
      }

      const rawList = data.re ?? []
      const comments = rawList
        .map((item) => mapReply(item, activeTab === 'hot'))
        .filter((item): item is CommentItem => Boolean(item))

      const totalCount = Number(data.reply_total_count) || Number(data.count) || comments.length
      const hasMore =
        activeTab === 'latest'
          ? currentOffset + comments.length < totalCount && comments.length > 0
          : false

      return {
        comments,
        totalCount,
        availableTabs: [
          { id: 'hot', label: '热门跟帖', count: activeTab === 'hot' ? Number(data.count) || comments.length : undefined },
          { id: 'latest', label: '最新跟帖', count: Number(data.reply_total_count) || Number(data.count) || undefined },
        ],
        hasMore,
        nextOffset: currentOffset + comments.length,
      }
    } catch {
      return { comments: [], totalCount: 0, availableTabs, hasMore: false }
    }
  },

  async getSummaryCount(article, signal?: AbortSignal): Promise<number | undefined> {
    const newsId = extractEastmoneyNewsId(article)
    if (!newsId) return undefined
    try {
      const data = await fetchEmJson<EmBriefResponse>(briefUrl(newsId), signal)
      if (data.rc !== 1) return undefined
      const count = data.re?.[0]?.post_comment_count
      return typeof count === 'number' ? count : undefined
    } catch {
      return undefined
    }
  },
}
