import { linuxDoEndpoints } from '../api/endpoints'
import { decodeTopics } from '../api/decode'
import type { LinuxDoApiClient } from '../api/client'
import type { LinuxDoFeedMode, LinuxDoTopicSummary } from '../types'

export class LinuxDoFeedService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  async list(mode: LinuxDoFeedMode, page = 0): Promise<LinuxDoTopicSummary[]> {
    const url =
      mode === 'latest'
        ? linuxDoEndpoints.latest(page)
        : mode === 'top'
          ? linuxDoEndpoints.top('weekly', page)
          : mode === 'new'
            ? linuxDoEndpoints.newTopics(page)
            : linuxDoEndpoints.unread(page)
    return decodeTopics(await this.api.getJson(url, { auth: mode === 'unread' ? 'required' : 'optional' }))
  }
}
