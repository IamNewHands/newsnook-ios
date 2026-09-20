import { linuxDoEndpoints } from '../api/endpoints'
import { decodeNotifications } from '../api/decode'
import type { LinuxDoApiClient } from '../api/client'
import type { LinuxDoNotification } from '../types'

export class LinuxDoNotificationService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  async list(offset = 0, limit = 30): Promise<{ items: LinuxDoNotification[]; nextOffset?: number }> {
    const payload = await this.api.getJson<any>(linuxDoEndpoints.notifications(offset, limit), { auth: 'required' })
    const loadMore = typeof payload?.load_more_notifications === 'string' ? payload.load_more_notifications : ''
    let nextOffset: number | undefined
    if (loadMore) {
      try {
        const parsed = new URL(loadMore, linuxDoEndpoints.origin)
        const value = Number(parsed.searchParams.get('offset'))
        if (Number.isFinite(value) && value >= 0) nextOffset = value
      } catch {
        nextOffset = undefined
      }
    }
    return { items: decodeNotifications(payload), nextOffset }
  }

  async markRead(id?: number): Promise<void> {
    await this.api.postForm(
      linuxDoEndpoints.markNotificationsRead,
      id ? { id } : {},
      { auth: 'required' },
    )
  }
}
