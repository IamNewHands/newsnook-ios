import { linuxDoEndpoints } from '../api/endpoints'
import { decodeNotifications } from '../api/decode'
import type { LinuxDoApiClient } from '../api/client'
import type { LinuxDoNotification } from '../types'

export class LinuxDoNotificationService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  async list(
    offset = 0,
    limit = 30,
    options: { signal?: AbortSignal; filter?: 'read' | 'unread' } = {},
  ): Promise<{ items: LinuxDoNotification[]; nextOffset?: number; totalRows?: number }> {
    const payload = await this.api.getJson<any>(
      linuxDoEndpoints.notifications(offset, limit, options.filter),
      { auth: 'required', signal: options.signal },
    )
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
    const totalRowsValue = Number(payload?.total_rows_notifications)
    const totalRows = Number.isFinite(totalRowsValue) && totalRowsValue >= 0 ? totalRowsValue : undefined
    return { items: decodeNotifications(payload), nextOffset, totalRows }
  }

  async unreadCount(signal?: AbortSignal): Promise<number> {
    const result = await this.list(0, 1, { signal, filter: 'unread' })
    if (result.totalRows !== undefined) return result.totalRows
    return result.items.reduce((count, item) => count + (item.read ? 0 : 1), 0)
  }

  async markRead(id: number): Promise<void> {
    await this.api.putForm(
      linuxDoEndpoints.markNotificationsRead,
      { id },
      { auth: 'required' },
    )
  }

  async markAllRead(): Promise<void> {
    await this.api.putForm(
      linuxDoEndpoints.markNotificationsRead,
      {},
      { auth: 'required' },
    )
  }
}
