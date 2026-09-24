import { fetchAbsoluteText } from '../../../lib/http'
import type {
  CommentItem,
  CommentProvider,
  CommentQuote,
  CommentsQueryResult,
  CommentTab,
} from '../types'

function extractHnItemId(article: {
  sourceId?: string
  originUrl?: string
}): string | undefined {
  if (article.originUrl) {
    const match = article.originUrl.match(/item\?id=(\d+)/i)
    if (match?.[1]) return match[1]
  }
  return undefined
}

function stripHnHtml(html?: string): string {
  if (!html) return ''
  return html
    .replace(/<p>/gi, '\n\n')
    .replace(/<\/p>/gi, '')
    .replace(/<a\s+href="([^"]+)"[^>]*>.*?<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

function formatTimestamp(seconds?: number): string {
  if (!seconds) return '刚刚'
  const ms = seconds * 1000
  const diff = Math.max(0, Date.now() - ms)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)}m前`
  if (diff < day) return `${Math.floor(diff / hour)}h前`
  if (diff < 7 * day) return `${Math.floor(diff / day)}d前`

  const date = new Date(ms)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

interface HnCommentRaw {
  id: number
  author?: string
  text?: string
  created_at_i?: number
  children?: HnCommentRaw[]
}

interface HnItemResponse {
  id: number
  title?: string
  points?: number
  children?: HnCommentRaw[]
}

export const hackerNewsCommentProvider: CommentProvider = {
  canHandle(article) {
    if (article.sourceId === 'hn') return true
    if (article.originUrl?.includes('news.ycombinator.com/item')) return true
    return false
  },

  async getComments(article, _tab = 'hot', _offset = 0, signal?: AbortSignal): Promise<CommentsQueryResult> {
    const itemId = extractHnItemId(article)
    if (!itemId) {
      return { comments: [], totalCount: 0, availableTabs: [], hasMore: false }
    }

    const availableTabs: CommentTab[] = [{ id: 'hot', label: '极客讨论' }]

    try {
      const url = `https://hn.algolia.com/api/v1/items/${itemId}`
      const rawJson = await fetchAbsoluteText(url, { signal })
      const data = JSON.parse(rawJson) as HnItemResponse

      const comments: CommentItem[] = []
      const topLevel = data.children ?? []

      for (const item of topLevel) {
        if (!item.text || !item.author) continue

        const quotes: CommentQuote[] = []
        if (item.children?.length) {
          const firstChild = item.children[0]
          if (firstChild.text && firstChild.author) {
            quotes.push({
              id: String(firstChild.id),
              author: firstChild.author,
              content: stripHnHtml(firstChild.text),
              floorNumber: 1,
            })
          }
        }

        comments.push({
          id: String(item.id),
          author: item.author,
          content: stripHnHtml(item.text),
          createTimeFormatted: formatTimestamp(item.created_at_i),
          voteCount: 0,
          quotes: quotes.length > 0 ? quotes : undefined,
        })
      }

      return {
        comments,
        totalCount: comments.length,
        availableTabs,
        hasMore: false,
      }
    } catch {
      return {
        comments: [],
        totalCount: 0,
        availableTabs,
        hasMore: false,
      }
    }
  },

  async getSummaryCount(article, signal?: AbortSignal): Promise<number | undefined> {
    const itemId = extractHnItemId(article)
    if (!itemId) return undefined
    try {
      const url = `https://hn.algolia.com/api/v1/items/${itemId}`
      const rawJson = await fetchAbsoluteText(url, { signal })
      const data = JSON.parse(rawJson) as HnItemResponse
      return data.children?.length
    } catch {
      return undefined
    }
  },
}
