export type CommentTabId = 'hot' | 'latest' | 'long' | 'short'

export interface CommentQuote {
  id: string
  author: string
  content: string
  location?: string
  floorNumber?: number
}

export interface CommentItem {
  id: string
  author: string
  avatar?: string
  location?: string
  content: string
  createTimeRaw?: string
  createTimeFormatted: string
  voteCount: number
  againstCount?: number
  quotes?: CommentQuote[]
  isHot?: boolean
}

export interface CommentTab {
  id: CommentTabId
  label: string
  count?: number
}

export interface CommentsQueryResult {
  comments: CommentItem[]
  totalCount: number
  availableTabs: CommentTab[]
  hasMore: boolean
  nextOffset?: number | string
}

export interface CommentProvider {
  /**
   * 该来源对这类内容的自称：'跟贴' | '评论' | '回复' | '讨论' | '吐槽' | '留言'。
   * 缺省按 '评论' 取词（见 service.commentsLabelFor）。
   */
  label?: string
  /** 该来源默认展开的评论分类（缺省 'hot'，由抽屉取默认 tab） */
  defaultTab?: CommentTabId
  /**
   * 入口是否必须等到「确知有评论」才出现。
   * 适用于按文章计数可靠的来源（WordPress / Substack 等）：计数为 0 时不显示任何入口，
   * 避免为大量零评论文章渲染空入口。缺省 false = 入口在有评论能力的来源上立即显示（现状行为）。
   */
  requiresCommentCount?: boolean
  canHandle(article: { sourceId?: string; originUrl?: string; neteaseDocId?: string }): boolean
  getComments(
    article: { id: string; sourceId?: string; originUrl?: string; neteaseDocId?: string },
    tab?: CommentTabId,
    offset?: number | string,
    signal?: AbortSignal,
  ): Promise<CommentsQueryResult>
  getSummaryCount?(
    article: { id: string; sourceId?: string; originUrl?: string; neteaseDocId?: string },
    signal?: AbortSignal,
  ): Promise<number | undefined>
}
