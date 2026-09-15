import type { ZhihuAuthor } from '../types'

export interface ZhihuCommentNode {
  id: string
  contentHtml: string
  createdAt?: number
  author: ZhihuAuthor
  replyToAuthor?: ZhihuAuthor
  likeCount: number
  liked: boolean
  canDelete: boolean
  childCount: number
  children: ZhihuCommentNode[]
}
