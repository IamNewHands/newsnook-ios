import { linuxDoEndpoints } from '../api/endpoints'
import { decodeCategories, decodeTagNames, decodeTopics } from '../api/decode'
import type { LinuxDoApiClient } from '../api/client'
import type { LinuxDoCategory, LinuxDoTag, LinuxDoTopicSummary } from '../types'

export class LinuxDoDiscoveryService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  async categories(): Promise<LinuxDoCategory[]> {
    return decodeCategories(await this.api.getJson(linuxDoEndpoints.categories, { auth: 'optional' }))
  }

  async category(slug: string, id: number, page = 0): Promise<LinuxDoTopicSummary[]> {
    return decodeTopics(await this.api.getJson(linuxDoEndpoints.category(slug, id, page), { auth: 'optional' }))
  }

  async tags(): Promise<LinuxDoTag[]> {
    const payload = await this.api.getJson<any>(linuxDoEndpoints.tags, { auth: 'optional' })
    const tags = payload?.tags
    if (!Array.isArray(tags)) return []
    return tags.map((tag: any) => ({
      id: typeof tag?.id === 'string' ? tag.id : undefined,
      name: decodeTagNames([tag])[0] ?? '',
      topicCount: typeof tag?.count === 'number' ? tag.count : undefined,
    })).filter((tag: LinuxDoTag) => tag.name)
  }

  async tag(name: string, page = 0): Promise<LinuxDoTopicSummary[]> {
    return decodeTopics(await this.api.getJson(linuxDoEndpoints.tag(name, page), { auth: 'optional' }))
  }
}
