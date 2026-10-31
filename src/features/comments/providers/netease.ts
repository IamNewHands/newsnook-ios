import { fetchAbsoluteText } from '../../../lib/http'
import type {
  CommentItem,
  CommentProvider,
  CommentQuote,
  CommentsQueryResult,
  CommentTab,
} from '../types'

const NETEASE_PRODUCT_KEY = 'a2869674571f77b5a0867c3d71db5856'

function extractNeteaseDocId(article: {
  sourceId?: string
  originUrl?: string
  neteaseDocId?: string
}): string | undefined {
  if (article.neteaseDocId && /^[a-zA-Z0-9_-]+$/.test(article.neteaseDocId)) {
    return article.neteaseDocId
  }
  if (article.originUrl) {
    const match = article.originUrl.match(
      /(?:article\/|video\/|news\/|photoview\/[A-Z0-9]+\/|\/)([A-Z0-9]{16,24}|[a-zA-Z0-9_-]+)\.html/i,
    )
    if (match?.[1]) return match[1]
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

interface NeteaseRawComment {
  commentId?: string | number
  user?: {
    nickname?: string
    userImage?: string
    location?: string
    ipLocation?: string
  }
  content?: string
  vote?: number
  against?: number
  createTime?: string
  buildLevel?: number
}

interface NeteaseCommentResponse {
  comments?: Record<string, NeteaseRawComment>
  commentIds?: string[]
  newListSize?: number
  hotListSize?: number
  code?: number
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

function isNeteaseCommentForeign(article: {
  sourceId?: string
  originUrl?: string
}): boolean {
  const id = article.sourceId ?? ''
  if (
    id.startsWith('zhihu') ||
    id.startsWith('jandan') ||
    id.startsWith('hn') ||
    id.startsWith('eastmoney') ||
    id.startsWith('wscn') ||
    id.startsWith('cls') ||
    id.startsWith('jiqizhixin')
  ) {
    return true
  }
  const url = article.originUrl ?? ''
  return (
    url.includes('zhihu.com') ||
    url.includes('eastmoney.com') ||
    url.includes('wallstreetcn.com') ||
    url.includes('cls.cn') ||
    url.includes('jiqizhixin.com')
  )
}

export const neteaseCommentProvider: CommentProvider = {
  canHandle(article) {
    if (article.sourceId?.startsWith('netease')) return true
    if (article.originUrl?.includes('163.com')) return true
    if (article.neteaseDocId && !isNeteaseCommentForeign(article)) {
      return true
    }
    return false
  },

  async getComments(article, tab = 'hot', offset = 0, signal?: AbortSignal): Promise<CommentsQueryResult> {
    const docId = extractNeteaseDocId(article)
    if (!docId) {
      return { comments: [], totalCount: 0, availableTabs: [], hasMore: false }
    }

    const currentOffset = typeof offset === 'number' ? offset : Number.parseInt(String(offset), 10) || 0
    const listType = tab === 'latest' ? 'newList' : 'hotList'
    const limit = 30
    const url = `https://comment.api.163.com/api/v1/products/${NETEASE_PRODUCT_KEY}/threads/${docId}/comments/${listType}?offset=${currentOffset}&limit=${limit}&showLevelThreshold=72&headLimit=1&tailLimit=2`

    try {
      const rawJson = await fetchAbsoluteText(url, { signal })
      const data = JSON.parse(rawJson) as NeteaseCommentResponse
      const commentsDict = data.comments ?? {}
      const commentIdList = data.commentIds ?? []

      const totalCount = tab === 'latest' ? (data.newListSize ?? data.hotListSize ?? 0) : (data.hotListSize ?? data.newListSize ?? 0)
      const availableTabs: CommentTab[] = [
        { id: 'hot', label: '热门跟贴', count: data.hotListSize },
        { id: 'latest', label: '最新跟贴', count: data.newListSize },
      ]

      const parsedComments: CommentItem[] = []

      for (const entry of commentIdList) {
        // entry 可能是单 ID "12345" 或盖楼复合 ID "12340,12345"
        const ids = entry.split(',').map((s) => s.trim()).filter(Boolean)
        if (!ids.length) continue

        const mainId = ids[ids.length - 1]
        const mainComment = commentsDict[mainId]
        if (!mainComment || !mainComment.content) continue

        // 盖楼引用的父级评论
        const quotes: CommentQuote[] = []
        for (let i = 0; i < ids.length - 1; i++) {
          const parent = commentsDict[ids[i]]
          if (parent && parent.content) {
            quotes.push({
              id: String(parent.commentId || ids[i]),
              author: parent.user?.nickname || '跟贴网友',
              content: cleanCommentContent(parent.content),
              location: parent.user?.location || parent.user?.ipLocation,
              floorNumber: i + 1,
            })
          }
        }

        parsedComments.push({
          id: String(mainComment.commentId || mainId),
          author: mainComment.user?.nickname || '火星网友',
          avatar: mainComment.user?.userImage,
          location: mainComment.user?.location || mainComment.user?.ipLocation,
          content: cleanCommentContent(mainComment.content),
          createTimeRaw: mainComment.createTime,
          createTimeFormatted: formatRelativeTime(mainComment.createTime),
          voteCount: mainComment.vote || 0,
          againstCount: mainComment.against || 0,
          quotes: quotes.length > 0 ? quotes : undefined,
          isHot: (mainComment.vote ?? 0) >= 10,
        })
      }

      const hasMore = tab === 'latest'
        ? (currentOffset + parsedComments.length < (data.newListSize ?? 0) && parsedComments.length > 0)
        : (commentIdList.length >= limit && currentOffset + parsedComments.length < (data.hotListSize ?? 0))

      return {
        comments: parsedComments,
        totalCount,
        availableTabs,
        hasMore,
        nextOffset: currentOffset + parsedComments.length,
      }
    } catch {
      return {
        comments: [],
        totalCount: 0,
        availableTabs: [
          { id: 'hot', label: '热门跟贴' },
          { id: 'latest', label: '最新跟贴' },
        ],
        hasMore: false,
      }
    }
  },

  async getSummaryCount(article, signal?: AbortSignal): Promise<number | undefined> {
    const docId = extractNeteaseDocId(article)
    if (!docId) return undefined
    const url = `https://comment.api.163.com/api/v1/products/${NETEASE_PRODUCT_KEY}/threads/${docId}/comments/hotList?offset=0&limit=1`
    try {
      const rawJson = await fetchAbsoluteText(url, { signal })
      const data = JSON.parse(rawJson) as NeteaseCommentResponse
      return (data.newListSize ?? data.hotListSize) || 0
    } catch {
      return undefined
    }
  },
}
