import { linuxDoEndpoints } from '../api/endpoints'
import { decodeTopics } from '../api/decode'
import { sanitizeLinuxDoCooked } from '../content/sanitize'
import type { LinuxDoApiClient } from '../api/client'
import type { LinuxDoPost, LinuxDoTopicSummary, LinuxDoUser } from '../types'

export interface LinuxDoSearchResult {
  topics: LinuxDoTopicSummary[]
  posts: LinuxDoPost[]
  users: LinuxDoUser[]
}

export class LinuxDoSearchService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  async search(query: string, page = 1): Promise<LinuxDoSearchResult> {
    const payload = await this.api.getJson<any>(linuxDoEndpoints.search(query, page), { auth: 'optional' })
    const topicsPayload = { topic_list: { topics: payload?.topics ?? [] }, users: payload?.users ?? [] }
    const users: LinuxDoUser[] = Array.isArray(payload?.users)
      ? payload.users.map((u: any) => ({
          id: Number(u.id),
          username: String(u.username ?? ''),
          name: typeof u.name === 'string' ? u.name : undefined,
          avatarTemplate: typeof u.avatar_template === 'string'
            ? 'https://linux.do' + u.avatar_template.replace('{size}', '96')
            : undefined,
        })).filter((u: LinuxDoUser) => Number.isFinite(u.id) && u.username)
      : []
    return {
      topics: decodeTopics(topicsPayload),
      posts: Array.isArray(payload?.posts)
        ? payload.posts.map((post: any): LinuxDoPost => ({
            id: Number(post?.id ?? 0),
            postNumber: Number(post?.post_number ?? 0),
            username: String(post?.username ?? ''),
            name: typeof post?.name === 'string' ? post.name : undefined,
            avatarTemplate: typeof post?.avatar_template === 'string'
              ? 'https://linux.do' + post.avatar_template.replace('{size}', '96')
              : undefined,
            cooked: sanitizeLinuxDoCooked(typeof post?.blurb === 'string' ? post.blurb : ''),
            createdAt: String(post?.created_at ?? ''),
            topicId: typeof post?.topic?.id === 'number' ? post.topic.id : undefined,
            topicSlug: typeof post?.topic?.slug === 'string' ? post.topic.slug : undefined,
            topicTitle: typeof post?.topic?.title === 'string'
              ? post.topic.title
              : typeof post?.topic?.fancy_title === 'string'
                ? post.topic.fancy_title
                : undefined,
            actions: [],
          })).filter((post: LinuxDoPost) => post.id > 0 && post.postNumber > 0)
        : [],
      users,
    }
  }
}
