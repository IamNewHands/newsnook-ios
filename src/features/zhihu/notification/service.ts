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
  const createdAt = numberValue(root.created_time)
  const explicitId = firstText(root.id)
  const content = firstText(root.content)
  // ACK（例如 {msg:"success"}）不是消息实体，不能伪造 id=0 后让 UI 当成已发送。
  if ((!explicitId && createdAt === undefined) || !content) return null
  return {
    id: explicitId || String(createdAt),
    content,
    createdAt,
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

  async sendMessage(peerId: string, content: string, signal?: AbortSignal): Promise<ZhihuPrivateMessage> {
    const normalizedPeer = peerId.trim()
    const normalizedContent = content.trim()
    if (!normalizedPeer) throw new ZhihuApiError('invalid-response', '私信接收者不能为空')
    if (!normalizedContent) throw new ZhihuApiError('invalid-response', '私信内容不能为空')

    const startedAt = Math.floor(Date.now() / 1000) - 10
    // 非幂等：POST 永远只执行一次。Web v4 端点在部分版本只返回 {msg:"success"}，
    // 因此响应没有消息实体时只做 GET 读回确认，绝不因为网络/确认失败自动重发。
    const raw = await this.api.postJson(
      'message.send',
      'https://www.zhihu.com/api/v4/messages',
      { type: 'common', content: normalizedContent, receiver_hash: normalizedPeer },
      signal,
    )
    const root = asRecord(raw)
    const direct = decodeMessage(raw) ?? decodeMessage(root?.data) ?? decodeMessage(root?.message)
    if (direct) return direct

    const error = asRecord(root?.error)
    const errorMessage = firstText(error?.message, root?.message)
    if (error) throw new ZhihuApiError('forbidden', errorMessage || '知乎拒绝发送私信')

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 350)
          signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        })
      }
      const page = await this.conversation(normalizedPeer, undefined, signal)
      const confirmed = page.items.find((message) => {
        if (message.content !== normalizedContent) return false
        if (message.createdAt && message.createdAt < startedAt) return false
        const receiverMatches = !message.receiver
          || message.receiver.id === normalizedPeer
          || message.receiver.token === normalizedPeer
        return receiverMatches
      })
      if (confirmed) return confirmed
    }

    throw new ZhihuApiError(
      'conflict',
      '私信请求已经提交，但暂时没有从会话中读回确认结果。请先刷新会话确认，不要立即重复发送。',
    )
  }
}
