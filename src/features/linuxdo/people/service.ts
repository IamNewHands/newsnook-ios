import { linuxDoEndpoints } from '../api/endpoints'
import { decodeTopics } from '../api/decode'
import { sanitizeLinuxDoCooked } from '../content/sanitize'
import type { LinuxDoApiClient } from '../api/client'
import type { LinuxDoTopicSummary, LinuxDoUser } from '../types'

export interface LinuxDoUserProfile extends LinuxDoUser {
  bioRaw?: string
  bioCooked?: string
  createdAt?: string
  lastSeenAt?: string
  topicCount?: number
  postCount?: number
  likesGiven?: number
  likesReceived?: number
}

export interface LinuxDoUserActivity {
  topics: LinuxDoTopicSummary[]
  actions: unknown[]
}

export interface LinuxDoBoostListItem {
  id: number
  raw: string
  cooked: string
  createdAt?: string
  postId?: number
  user?: LinuxDoUser
  post?: {
    id: number
    url?: string
    excerpt?: string
    username?: string
    avatarTemplate?: string
    topicId?: number
    topicTitle?: string
    categoryId?: number
  }
}

export class LinuxDoPeopleService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  async profile(username: string): Promise<LinuxDoUserProfile> {
    const payload = await this.api.getJson<any>(linuxDoEndpoints.user(username), { auth: 'optional' })
    const user = payload?.user ?? payload
    return {
      id: Number(user?.id ?? 0),
      username: String(user?.username ?? username),
      name: typeof user?.name === 'string' ? user.name : undefined,
      avatarTemplate: typeof user?.avatar_template === 'string'
        ? 'https://linux.do' + user.avatar_template.replace('{size}', '144')
        : undefined,
      trustLevel: typeof user?.trust_level === 'number' ? user.trust_level : undefined,
      bioRaw: typeof user?.bio_raw === 'string' ? user.bio_raw : undefined,
      bioCooked: typeof user?.bio_cooked === 'string' ? sanitizeLinuxDoCooked(user.bio_cooked) : undefined,
      createdAt: typeof user?.created_at === 'string' ? user.created_at : undefined,
      lastSeenAt: typeof user?.last_seen_at === 'string' ? user.last_seen_at : undefined,
      topicCount: typeof user?.topic_count === 'number' ? user.topic_count : undefined,
      postCount: typeof user?.post_count === 'number' ? user.post_count : undefined,
      likesGiven: typeof user?.likes_given === 'number' ? user.likes_given : undefined,
      likesReceived: typeof user?.likes_received === 'number' ? user.likes_received : undefined,
    }
  }

  async activity(username: string, offset = 0): Promise<LinuxDoUserActivity> {
    const payload = await this.api.getJson<any>(linuxDoEndpoints.userActivity(username, offset), { auth: 'optional' })
    const topicsPayload = { topic_list: { topics: payload?.topics ?? [] }, users: payload?.users ?? [] }
    return {
      topics: decodeTopics(topicsPayload),
      actions: Array.isArray(payload?.user_actions) ? payload.user_actions : [],
    }
  }

  async boostsGiven(username: string): Promise<LinuxDoBoostListItem[]> {
    return this.boostList(linuxDoEndpoints.boostsGiven(username))
  }

  async boostsReceived(username: string): Promise<LinuxDoBoostListItem[]> {
    return this.boostList(linuxDoEndpoints.boostsReceived(username))
  }

  private async boostList(url: string): Promise<LinuxDoBoostListItem[]> {
    const payload = await this.api.getJson<any>(url, { auth: 'optional' })
    const list = Array.isArray(payload?.boosts) ? payload.boosts : []
    return list.map((boost: any): LinuxDoBoostListItem => ({
      id: Number(boost?.id ?? 0),
      raw: String(boost?.raw ?? ''),
      cooked: sanitizeLinuxDoCooked(typeof boost?.cooked === 'string' ? boost.cooked : ''),
      createdAt: typeof boost?.created_at === 'string' ? boost.created_at : undefined,
      postId: typeof boost?.post_id === 'number' ? boost.post_id : undefined,
      user: boost?.user ? {
        id: Number(boost.user.id ?? 0),
        username: String(boost.user.username ?? ''),
        name: typeof boost.user.name === 'string' ? boost.user.name : undefined,
        avatarTemplate: typeof boost.user.avatar_template === 'string'
          ? 'https://linux.do' + boost.user.avatar_template.replace('{size}', '96')
          : undefined,
      } : undefined,
      post: boost?.post ? {
        id: Number(boost.post.id ?? 0),
        url: typeof boost.post.url === 'string' ? boost.post.url : undefined,
        excerpt: typeof boost.post.excerpt === 'string' ? boost.post.excerpt : undefined,
        username: typeof boost.post.username === 'string' ? boost.post.username : undefined,
        avatarTemplate: typeof boost.post.avatar_template === 'string'
          ? 'https://linux.do' + boost.post.avatar_template.replace('{size}', '96')
          : undefined,
        topicId: typeof boost.post.topic_id === 'number' ? boost.post.topic_id : undefined,
        topicTitle: typeof boost.post.topic_title === 'string' ? boost.post.topic_title : undefined,
        categoryId: typeof boost.post.category_id === 'number' ? boost.post.category_id : undefined,
      } : undefined,
    })).filter((boost: LinuxDoBoostListItem) => boost.id > 0)
  }
}
