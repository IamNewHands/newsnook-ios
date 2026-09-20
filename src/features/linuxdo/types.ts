export type LinuxDoFeedMode = 'latest' | 'top' | 'new' | 'unread'

export interface LinuxDoUser {
  id: number
  username: string
  name?: string
  avatarTemplate?: string
  trustLevel?: number
  unreadNotifications?: number
}

export interface LinuxDoCategory {
  id: number
  name: string
  slug: string
  color?: string
  textColor?: string
  topicCount?: number
  description?: string
}

export interface LinuxDoTag {
  id?: string
  name: string
  topicCount?: number
}

export interface LinuxDoTopicSummary {
  id: number
  slug: string
  title: string
  fancyTitle?: string
  postsCount: number
  replyCount: number
  views: number
  likeCount: number
  createdAt: string
  lastPostedAt: string
  categoryId?: number
  tags: string[]
  posters: Array<{ userId?: number; username?: string; avatarTemplate?: string; description?: string }>
  unseen?: boolean
  unread?: number
  newPosts?: number
  pinned?: boolean
  closed?: boolean
  archived?: boolean
}

export interface LinuxDoPost {
  id: number
  postNumber: number
  username: string
  name?: string
  avatarTemplate?: string
  createdAt: string
  updatedAt?: string
  cooked: string
  raw?: string
  replyToPostNumber?: number
  topicId?: number
  topicSlug?: string
  topicTitle?: string
  yours?: boolean
  canEdit?: boolean
  canDelete?: boolean
  bookmarked?: boolean
  bookmarkId?: number
  bookmarkName?: string
  bookmarkReminderAt?: string
  actions: Array<{ id: number; count?: number; acted?: boolean; canAct?: boolean }>
}

export interface LinuxDoTopic {
  id: number
  slug: string
  title: string
  fancyTitle?: string
  categoryId?: number
  tags: string[]
  postsCount: number
  views: number
  likeCount: number
  createdAt: string
  lastPostedAt: string
  postStream: { stream: number[]; posts: LinuxDoPost[] }
  details?: { canCreatePost?: boolean; notificationLevel?: number }
}

export interface LinuxDoNotification {
  id: number
  notificationType: number
  read: boolean
  createdAt: string
  postNumber?: number
  topicId?: number
  fancyTitle?: string
  slug?: string
  data: Record<string, unknown>
}

export type LinuxDoAuthMode = 'user-api-key' | 'browser-session' | 'none'

export type LinuxDoErrorKind =
  | 'network'
  | 'auth-required'
  | 'forbidden'
  | 'browser-verification'
  | 'rate-limited'
  | 'not-found'
  | 'validation'
  | 'server'
  | 'unknown'

export class LinuxDoApiError extends Error {
  readonly kind: LinuxDoErrorKind
  readonly status?: number
  readonly retryAfterSeconds?: number

  constructor(kind: LinuxDoErrorKind, message: string, status?: number, retryAfterSeconds?: number) {
    super(message)
    this.name = 'LinuxDoApiError'
    this.kind = kind
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export interface LinuxDoSessionSnapshot {
  authenticated: boolean
  authMode: LinuxDoAuthMode
  currentUser?: LinuxDoUser
  userAgent?: string
  apiVersion?: number
  expiresAt?: string
}

export interface LinuxDoCapabilities {
  boost: { available: boolean; endpoint?: string; reason?: string }
  drafts: boolean
  uploads: boolean
  bookmarks: boolean
}
