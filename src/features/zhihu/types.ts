export type ZhihuEntityKind =
  | 'question'
  | 'answer'
  | 'article'
  | 'pin'
  | 'people'
  | 'collection'
  | 'comment'
  | 'topic'

export interface ZhihuEntityRef {
  kind: ZhihuEntityKind
  id: string
}

export interface Page<T> {
  items: T[]
  nextCursor?: string
  hasMore: boolean
}

export type ZhihuFeedMode = 'following' | 'recommended' | 'hot'
export type ZhihuRecommendationMode = 'smart' | 'web' | 'android' | 'mixed' | 'local'

export type ZhihuRoute =
  | { screen: 'feed'; mode: ZhihuFeedMode }
  | { screen: 'entity'; ref: ZhihuEntityRef }
  | {
      screen: 'search'
      query: string
      /** 知乎 member_hash_id；存在时搜索严格限制为该用户的创作。 */
      restrictedMemberHashId?: string
      restrictedMemberName?: string
    }
  | { screen: 'editor'; localDraftId: string }
  | { screen: 'notifications' }
  | { screen: 'conversation'; peerId: string }
  | { screen: 'collections'; urlToken: string }
  | { screen: 'profile' }

export interface RouteFrame {
  route: ZhihuRoute
  /** 评论/段落等稳定锚点；返回时交由页面恢复。 */
  anchor?: string
  scrollTop: number
}

export type RouteAction =
  | { type: 'push'; frame: RouteFrame }
  | { type: 'replace'; frame: RouteFrame }
  | { type: 'back' }
  | { type: 'reset'; frame: RouteFrame }

export interface ZhihuAuthor {
  id: string
  token?: string
  name: string
  avatarUrl?: string
  headline?: string
}

export interface ZhihuContentSummary {
  ref: ZhihuEntityRef
  title: string
  excerpt: string
  url: string
  author?: ZhihuAuthor
  voteupCount?: number
  commentCount?: number
  createdAt?: number
  imageUrl?: string
  /** 推荐子模式来源，仅用于 NewsNook 知乎工作区展示/本地排序。 */
  recommendationSource?: 'web' | 'android' | 'hot' | 'following' | 'local'
  /** 本地推荐必须解释“为什么看到它”，不能做黑箱排序。 */
  recommendationReason?: string
}
