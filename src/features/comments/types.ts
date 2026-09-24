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
