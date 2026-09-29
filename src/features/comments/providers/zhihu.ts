import { fetchAbsoluteText } from '../../../lib/http'
import type {
  CommentItem,
  CommentProvider,
  CommentQuote,
  CommentsQueryResult,
  CommentTab,
} from '../types'

function extractZhihuStoryId(article: {
  id?: string
  sourceId?: string
  originUrl?: string
  neteaseDocId?: string
}): string | undefined {
  if (article.originUrl) {
    const match = article.originUrl.match(/(?:story|news)\/(\d+)/i)
    if (match?.[1]) return match[1]
  }
  if (article.neteaseDocId && /^\d+$/.test(article.neteaseDocId)) {
    return article.neteaseDocId
  }
  if (article.id) {
    const match = article.id.match(/(\d{6,10})/i)
    if (match?.[1]) return match[1]
  }
  return undefined
}

function formatTimestamp(seconds?: number): string {
  if (!seconds) return '刚刚'
  const ms = seconds * 1000
  const diff = Math.max(0, Date.now() - ms)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`
  if (diff < day) return `${Math.floor(diff / hour)}小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`

  const date = new Date(ms)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

interface ZhihuCommentRaw {
  id: number
  author: string
  avatar: string
  content: string
  likes: number
  time: number
  reply_to?: {
    id: number
    author: string
    content: string
    status: number
  }
}

interface ZhihuStoryExtra {
  long_comments?: number
  short_comments?: number
  comments?: number
  popularity?: number
}

function cleanCommentContent(raw?: string): string {
  if (!raw) return ''
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim()
}

export const zhihuCommentProvider: CommentProvider = {
  canHandle(article) {
    if (article.sourceId === 'zhihu' || article.sourceId === 'zhihu-daily' || article.sourceId?.startsWith('zhihu')) return true
    if (article.originUrl?.includes('daily.zhihu.com') || article.originUrl?.includes('zhihu.com')) return true
    return false
  },

  async getComments(article, tab = 'short', _offset = 0, signal?: AbortSignal): Promise<CommentsQueryResult> {
    const storyId = extractZhihuStoryId(article)
    if (!storyId) {
      return { comments: [], totalCount: 0, availableTabs: [], hasMore: false }
    }

    try {
      // 1. 获取评论数量统计
      let extra: ZhihuStoryExtra = {}
      try {
        const extraRaw = await fetchAbsoluteText(
          `https://news-at.zhihu.com/api/4/story-extra/${storyId}`,
          { signal },
        )
        extra = JSON.parse(extraRaw) as ZhihuStoryExtra
      } catch {
        // 忽略 extra 失败
      }

      const availableTabs: CommentTab[] = [
        { id: 'short', label: '短评', count: extra.short_comments },
        { id: 'long', label: '深度长评', count: extra.long_comments },
      ]

      const endpoint = tab === 'long' ? 'long-comments' : 'short-comments'
      const url = `https://news-at.zhihu.com/api/4/story/${storyId}/${endpoint}`

      const rawJson = await fetchAbsoluteText(url, { signal })
      const data = JSON.parse(rawJson) as { comments?: ZhihuCommentRaw[] }
      const list = data.comments ?? []

      const parsedComments: CommentItem[] = list.map((item) => {
        const quotes: CommentQuote[] = []
        if (item.reply_to && item.reply_to.content) {
          quotes.push({
            id: String(item.reply_to.id),
            author: item.reply_to.author || '知乎用户',
            content: cleanCommentContent(item.reply_to.content),
            floorNumber: 1,
          })
        }

        return {
          id: String(item.id),
          author: item.author || '知乎用户',
          avatar: item.avatar,
          content: cleanCommentContent(item.content),
          createTimeFormatted: formatTimestamp(item.time),
          voteCount: item.likes || 0,
          quotes: quotes.length > 0 ? quotes : undefined,
          isHot: (item.likes ?? 0) >= 20,
        }
      })

      const totalCount = (extra.comments ?? parsedComments.length) || 0

      return {
        comments: parsedComments,
        totalCount,
        availableTabs,
        hasMore: false,
      }
    } catch {
      return {
        comments: [],
        totalCount: 0,
        availableTabs: [
          { id: 'short', label: '短评' },
          { id: 'long', label: '深度长评' },
        ],
        hasMore: false,
      }
    }
  },

  async getSummaryCount(article, signal?: AbortSignal): Promise<number | undefined> {
    const storyId = extractZhihuStoryId(article)
    if (!storyId) return undefined
    try {
      const extraRaw = await fetchAbsoluteText(
        `https://news-at.zhihu.com/api/4/story-extra/${storyId}`,
        { signal },
      )
      const extra = JSON.parse(extraRaw) as ZhihuStoryExtra
      return extra.comments
    } catch {
      return undefined
    }
  },
}
