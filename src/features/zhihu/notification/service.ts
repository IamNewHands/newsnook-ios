import { asRecord } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import { validateZhihuCursor } from '../api/endpoints'

export type ZhihuNotificationCategory = 'comment' | 'like' | 'favlist_me' | 'follow'

export interface ZhihuNotificationItem {
  id: string
  title: string
  text: string
  createdAt?: number
  unread: boolean
  targetUrl?: string
  author?: {
    id?: string
    token?: string
    name: string
    avatarUrl?: string
  }
}

export interface ZhihuNotificationOverview {
  items: ZhihuNotificationItem[]
  nextCursor?: string
  hasMore: boolean
  unread: Record<ZhihuNotificationCategory, number>
  messageUnread: number
}

export interface ZhihuNotificationPage {
  items: ZhihuNotificationItem[]
  nextCursor?: string
  hasMore: boolean
}

export interface ZhihuNotificationApi {
  getJson(operation: string, url: string, signal?: AbortSignal): Promise<unknown>
  postJson(operation: string, url: string, body?: unknown, signal?: AbortSignal): Promise<unknown>
}

export function mergeZhihuNotificationItems(
  previous: ZhihuNotificationItem[],
  incoming: ZhihuNotificationItem[],
): ZhihuNotificationItem[] {
  const seen = new Set(previous.map((item) => item.id))
  return [...previous, ...incoming.filter((item) => !seen.has(item.id) && seen.add(item.id))]
}

export interface ZhihuMessagePeer {
  id: string
  token?: string
  name: string
  avatarUrl?: string
  headline?: string
}

export interface ZhihuPrivateMessage {
  id: string
  content: string
  createdAt?: number
  sender?: ZhihuMessagePeer
  receiver?: ZhihuMessagePeer
}

export interface ZhihuPrivateMessagePage {
  items: ZhihuPrivateMessage[]
  nextCursor?: string
  hasMore: boolean
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function decodePeer(value: unknown): ZhihuMessagePeer | undefined {
  const root = asRecord(value)
  if (!root) return undefined
  const id = stringValue(root.id) ?? stringValue(root.url_token)
  const name = stringValue(root.name)
  if (!id || !name) return undefined
  return {
    id,
    token: stringValue(root.url_token),
    name,
    avatarUrl: stringValue(root.avatar_url),
    headline: stringValue(root.headline),
  }
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value)?.trim()
    if (text) return text
  }
  return ''
}

function decodeNotification(value: unknown): ZhihuNotificationItem | null {
  const root = asRecord(value)
  if (!root) return null
  const content = asRecord(root.content)
  const head = asRecord(root.head)
  const author = decodePeer(head?.author)
  const targetSource = asRecord(root.target_source)
  const target = asRecord(root.target)
  const id = firstText(root.unique_id, root.id) || `${numberValue(root.created) ?? 0}-${firstText(root.card_type, root.type)}`
  const title = firstText(content?.title, content?.sub_title, root.detail_title, head?.labels)
  const text = firstText(content?.text, content?.sub_text, content?.abstract_text, targetSource?.full_text, targetSource?.text, title)
  const targetUrl = firstText(content?.target_link, targetSource?.target_link, head?.target_link, target?.url) || undefined
  if (!id || (!title && !text)) return null
  return {
    id,
    title: title || '知乎通知',
    text,
    createdAt: numberValue(root.created),
    unread: root.is_read === false,
    targetUrl,
    author: author ? {
      id: author.id,
      token: author.token,
      name: author.name,
      avatarUrl: author.avatarUrl,
    } : undefined,
  }
}

function decodeMessage(value: unknown): ZhihuPrivateMessage | null {
  const root = asRecord(value)
  if (!root) return null
  const id = firstText(root.id) || `${numberValue(root.created_time) ?? 0}`
  const content = firstText(root.content)
  if (!id) return null
  return {
    id,
    content,
    createdAt: numberValue(root.created_time),
    sender: decodePeer(root.sender),
    receiver: decodePeer(root.receiver),
  }
}

function pagingFrom(root: Record<string, unknown>): { nextCursor?: string; hasMore: boolean } {
  const paging = asRecord(root.paging)
  const next = stringValue(paging?.next)
  const hasMore = paging?.is_end !== true && Boolean(next)
  return { nextCursor: hasMore && next ? validateZhihuCursor(next) : undefined, hasMore }
}

const CATEGORY_TITLES: Record<ZhihuNotificationCategory, string> = {
  comment: '评论转发@',
  like: '赞同喜欢',
  favlist_me: '收藏了我',
  follow: '关注订阅',
}

export class ZhihuNotificationService {
  private readonly api: ZhihuNotificationApi

  constructor(api: ZhihuNotificationApi) {
    this.api = api
  }

  async overview(cursor?: string, signal?: AbortSignal): Promise<ZhihuNotificationOverview> {
    const url = cursor ? validateZhihuCursor(cursor) : 'https://api.zhihu.com/notifications/v3/message/v3?limit=20'
    const raw = await this.api.getJson('notification.list', url, signal)
    const root = asRecord(raw)
    if (!root) throw new ZhihuApiError('invalid-response', '知乎通知响应不是 JSON object')
    const data = Array.isArray(root.data) ? root.data : []
    const head = Array.isArray(root.head) ? root.head : []
    const unread = Object.fromEntries(
      Object.entries(CATEGORY_TITLES).map(([key, title]) => {
        const item = head.map(asRecord).find((entry) => entry?.detail_title === title)
        return [key, numberValue(item?.unread_count) ?? 0]
      }),
    ) as Record<ZhihuNotificationCategory, number>
    const unreadRoot = asRecord(root.unread)
    const messageUnread = numberValue(asRecord(unreadRoot?.message)?.count) ?? 0
    const paging = pagingFrom(root)
    return {
      items: data.map(decodeNotification).filter((item): item is ZhihuNotificationItem => Boolean(item)),
      ...paging,
      unread,
      messageUnread,
    }
  }

  async markCategoryRead(category: ZhihuNotificationCategory, signal?: AbortSignal): Promise<void> {
    await this.api.postJson(
      'notification.readall',
      `https://api.zhihu.com/notifications/v3/timeline/entry/${category}/actions/readall`,
      undefined,
      signal,
    )
  }

  async timeline(
    category: ZhihuNotificationCategory,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<ZhihuNotificationPage> {
    const url = cursor
      ? validateZhihuCursor(cursor)
      : `https://api.zhihu.com/notifications/v3/timeline/entry/${category}?limit=20`
    const raw = await this.api.getJson('notification.timeline', url, signal)
    const root = asRecord(raw)
    if (!root) throw new ZhihuApiError('invalid-response', '知乎分类通知响应不是 JSON object')
    const data = Array.isArray(root.data) ? root.data : []
    return {
      items: data.map(decodeNotification).filter((item): item is ZhihuNotificationItem => Boolean(item)),
      ...pagingFrom(root),
    }
  }

  async readPeer(peerId: string, signal?: AbortSignal): Promise<ZhihuMessagePeer> {
    const raw = await this.api.getJson(
      'message.peer',
      `https://api.zhihu.com/messages/user/${encodeURIComponent(peerId)}`,
      signal,
    )
    const peer = decodePeer(raw)
    if (!peer) throw new ZhihuApiError('invalid-response', '知乎私信用户资料缺少必要字段')
    return peer
  }

  async conversation(peerId: string, cursor?: string, signal?: AbortSignal): Promise<ZhihuPrivateMessagePage> {
    const url = cursor
      ? validateZhihuCursor(cursor)
      : `https://api.zhihu.com/messages?limit=20&sender_id=${encodeURIComponent(peerId)}`
    const raw = await this.api.getJson('message.list', url, signal)
    const root = asRecord(raw)
    if (!root) throw new ZhihuApiError('invalid-response', '知乎私信响应不是 JSON object')
    const data = Array.isArray(root.data) ? root.data : []
    return {
      items: data.map(decodeMessage).filter((item): item is ZhihuPrivateMessage => Boolean(item)),
      ...pagingFrom(root),
    }
  }

  async sendMessage(peerId: string, content: string, _signal?: AbortSignal): Promise<ZhihuPrivateMessage> {
    const normalizedPeer = peerId.trim()
    const normalizedContent = content.trim()
    if (!normalizedPeer) throw new ZhihuApiError('invalid-response', '私信接收者不能为空')
    if (!normalizedContent) throw new ZhihuApiError('invalid-response', '私信内容不能为空')
    // 参考实现只能证明“曾存在私信发送协议”，当前没有 NewsNook 授权实网写入→读回证据。
    // 不在 Apache-2.0 生产树中携带从 AGPL 参考实现抽取的白盒协议表，也不发送猜测 payload。
    throw new ZhihuApiError('unsupported', '知乎私信发送尚未完成授权实网验证，当前仅支持读取会话和保存本机输入草稿')
  }
}
