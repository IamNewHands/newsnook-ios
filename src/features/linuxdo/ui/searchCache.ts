import type { LinuxDoPost, LinuxDoTopicSummary, LinuxDoUser } from '../types'

export type LinuxDoSearchTab = 'topics' | 'posts' | 'users'

export interface LinuxDoSearchCache {
  query: string
  lastQuery: string
  topics: LinuxDoTopicSummary[]
  posts: LinuxDoPost[]
  users: LinuxDoUser[]
  activeTab: LinuxDoSearchTab
  page: number
  hasMore: boolean
  scrollTop: number
}

export function createLinuxDoSearchCache(): LinuxDoSearchCache {
  return {
    query: '',
    lastQuery: '',
    topics: [],
    posts: [],
    users: [],
    activeTab: 'topics',
    page: 1,
    hasMore: false,
    scrollTop: 0,
  }
}
