import { linuxDoEndpoints } from '../api/endpoints'
import { decodePost, decodeTopic } from '../api/decode'
import type { LinuxDoApiClient } from '../api/client'
import type { LinuxDoPost, LinuxDoTopic } from '../types'

export class LinuxDoTopicService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  async get(slug: string, id: number, postNumber?: number): Promise<LinuxDoTopic> {
    return decodeTopic(await this.api.getJson(linuxDoEndpoints.topic(slug, id, postNumber), { auth: 'optional' }))
  }

  async raw(postId: number): Promise<string> {
    return this.api.getText(linuxDoEndpoints.postRaw(postId), { auth: 'required' })
  }

  async loadPosts(topicId: number, ids: number[]): Promise<LinuxDoPost[]> {
    if (!ids.length) return []
    const payload = await this.api.getJson<any>(linuxDoEndpoints.posts(topicId, ids), { auth: 'optional' })
    return Array.isArray(payload?.post_stream?.posts) ? payload.post_stream.posts.map(decodePost) : []
  }

  async reply(topicId: number, raw: string, replyToPostNumber?: number): Promise<LinuxDoPost> {
    const payload = await this.api.postForm<any>(
      linuxDoEndpoints.postsCreate,
      { topic_id: topicId, raw, reply_to_post_number: replyToPostNumber },
      { auth: 'required' },
    )
    return decodePost(payload)
  }

  async createTopic(input: { title: string; raw: string; category?: number; tags?: string[] }): Promise<LinuxDoPost> {
    const form: Record<string, string | number | boolean | Array<string | number> | undefined> = {
      title: input.title,
      raw: input.raw,
      category: input.category,
      'tags[]': input.tags,
    }
    const payload = await this.api.postForm<any>(linuxDoEndpoints.postsCreate, form, { auth: 'required' })
    return decodePost(payload)
  }

  async editPost(postId: number, raw: string): Promise<LinuxDoPost> {
    const payload = await this.api.putForm<any>(linuxDoEndpoints.post(postId), { 'post[raw]': raw }, { auth: 'required' })
    return decodePost(payload)
  }

  async deletePost(postId: number): Promise<void> {
    await this.api.deleteJson(linuxDoEndpoints.post(postId), undefined, { auth: 'required' })
  }

  async setNotificationLevel(topicId: number, level: number): Promise<void> {
    await this.api.postForm(linuxDoEndpoints.topicNotification(topicId), { notification_level: level }, { auth: 'required' })
  }
}
