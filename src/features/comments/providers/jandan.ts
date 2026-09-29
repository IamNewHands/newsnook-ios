import { fetchAbsoluteText } from '../../../lib/http'
import type {
  CommentItem,
  CommentProvider,
  CommentQuote,
  CommentsQueryResult,
  CommentTab,
} from '../types'

function extractJandanPostId(article: {
  id?: string
  sourceId?: string
  originUrl?: string
  neteaseDocId?: string
}): string | undefined {
  if (article.originUrl) {
    const match = article.originUrl.match(/jandan\.net\/(?:p\/)?(\d+)/i)
    if (match?.[1]) return match[1]
  }
  if (article.id) {
    const match = article.id.match(/(?:jandan[-_])?(\d{4,8})/i)
    if (match?.[1]) return match[1]
  }
  return undefined
}

function stripHtml(html?: string): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim()
}

interface JandanTucaoItem {
  comment_ID: number | string
  comment_post_ID: number | string
  comment_author?: string
  comment_date?: string
  comment_content?: string
  vote_positive?: number
  vote_negative?: number
  ip_location?: string
  avatar_ref?: string
}

interface JandanTucaoResponse {
  code: number
  msg?: string
  hot_tucao?: JandanTucaoItem[]
  data?: JandanTucaoItem[] | null
}

export const jandanCommentProvider: CommentProvider = {
  canHandle(article) {
    if (article.sourceId === 'jandan') return true
    if (article.originUrl?.includes('jandan.net')) return true
    return false
  },

  async getComments(article, tab = 'hot', _offset = 0, signal?: AbortSignal): Promise<CommentsQueryResult> {
    const postId = extractJandanPostId(article)
    if (!postId) {
      return { comments: [], totalCount: 0, availableTabs: [], hasMore: false }
    }

    try {
      const url = `https://jandan.net/api/tucao/post/${postId}`
      const rawJson = await fetchAbsoluteText(url, { signal })
      const res = JSON.parse(rawJson) as JandanTucaoResponse

      const rawList = res.data ?? []
      const hotList = res.hot_tucao ?? []
      const totalCount = rawList.length

      const availableTabs: CommentTab[] = [
        { id: 'hot', label: '热门吐槽', count: hotList.length > 0 ? hotList.length : undefined },
        { id: 'latest', label: '最新吐槽', count: totalCount },
      ]

      // 构建快速查找 map，用于解析 @回复 的引用楼层
      const itemMap = new Map<string, JandanTucaoItem>()
      for (const item of rawList) {
        itemMap.set(String(item.comment_ID), item)
      }

      // 根据选中的 Tab 决定展示列表
      let activeList: JandanTucaoItem[]
      if (tab === 'hot') {
        if (hotList.length > 0) {
          activeList = hotList
        } else {
          // 自动按净赞数降序排列热门
          activeList = [...rawList].sort(
            (a, b) => ((b.vote_positive || 0) - (b.vote_negative || 0)) - ((a.vote_positive || 0) - (a.vote_negative || 0)),
          )
        }
      } else {
        activeList = rawList
      }

      const parsedComments: CommentItem[] = activeList.map((item) => {
        const id = String(item.comment_ID)
        const author = item.comment_author || '无聊蛋友'
        let rawContent = item.comment_content || ''
        const positive = Number(item.vote_positive) || 0
        const negative = Number(item.vote_negative) || 0

        // 解析引用回复：#@[author]14310378#
        const quotes: CommentQuote[] = []
        const atMatch = rawContent.match(/#@\[([^\]]+)\](\d+)#/i)
        if (atMatch) {
          const atAuthor = atMatch[1]
          const atId = atMatch[2]
          const referenced = itemMap.get(atId)
          rawContent = rawContent.replace(/#@\[([^\]]+)\](\d+)#/g, '').trim()
          quotes.push({
            id: atId,
            author: referenced?.comment_author || atAuthor,
            content: stripHtml(referenced?.comment_content || `回复 @${atAuthor}`),
            floorNumber: 1,
          })
        }

        const avatar = item.avatar_ref
          ? item.avatar_ref.startsWith('/')
            ? `https://cdn.jandan.net${item.avatar_ref}`
            : item.avatar_ref
          : undefined

        return {
          id,
          author,
          avatar,
          ipLocation: item.ip_location ? `${item.ip_location}` : undefined,
          content: stripHtml(rawContent),
          createTimeFormatted: item.comment_date?.slice(0, 16) || '刚刚',
          voteCount: positive,
          againstCount: negative,
          quotes: quotes.length > 0 ? quotes : undefined,
          isHot: positive >= 20 || (positive >= 10 && positive > negative * 3),
        }
      })

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
          { id: 'hot', label: '热门吐槽' },
          { id: 'latest', label: '最新吐槽' },
        ],
        hasMore: false,
      }
    }
  },

  async getSummaryCount(article, signal?: AbortSignal): Promise<number | undefined> {
    const postId = extractJandanPostId(article)
    if (!postId) return undefined
    try {
      const url = `https://jandan.net/api/tucao/post/${postId}`
      const rawJson = await fetchAbsoluteText(url, { signal })
      const res = JSON.parse(rawJson) as JandanTucaoResponse
      const count = (res.data ?? []).length
      return count > 0 ? count : undefined
    } catch {
      return undefined
    }
  },
}
