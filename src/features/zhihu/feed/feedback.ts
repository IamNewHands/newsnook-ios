import { log } from '../../../lib/logger'
import type { ZhihuApiClient } from '../api/client'
import { ZhihuApiError } from '../api/errors'
import type { ZhihuSessionService } from '../session/service'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'
import {
  recordZhihuRecommendationImpression,
  recordZhihuRecommendationSignal,
  type ZhihuRecommendationAction,
  type ZhihuRecommendationSignalItem,
} from './recommendation'

type UpstreamTouchAction = 'touch' | 'read'

interface PendingTouch {
  ref: ZhihuEntityRef
}

function upstreamType(ref: ZhihuEntityRef): 'answer' | 'article' | 'pin' | null {
  return ref.kind === 'answer' || ref.kind === 'article' || ref.kind === 'pin'
    ? ref.kind
    : null
}

function multipartItemsBody(
  payload: readonly [string, string, UpstreamTouchAction][],
): { body: string; contentType: string } {
  const boundary = `----NewsNookZhihuBoundary${Date.now().toString(36)}`
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="items"',
    '',
    JSON.stringify(payload),
    `--${boundary}--`,
    '',
  ].join('\r\n')
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

export class ZhihuRecommendationFeedbackService {
  private readonly api: ZhihuApiClient
  private readonly session: ZhihuSessionService
  private readonly pendingByAccount = new Map<string, Map<string, PendingTouch>>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(api: ZhihuApiClient, session: ZhihuSessionService) {
    this.api = api
    this.session = session
  }

  recordImpression(accountId: string | null | undefined, item: ZhihuContentSummary): void {
    recordZhihuRecommendationImpression(accountId, item)
    if (!accountId || !upstreamType(item.ref)) return

    let pending = this.pendingByAccount.get(accountId)
    if (!pending) {
      pending = new Map()
      this.pendingByAccount.set(accountId, pending)
    }
    pending.set(`${item.ref.kind}:${item.ref.id}`, { ref: item.ref })

    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flushImpressions()
    }, 850)
  }

  recordSignal(
    accountId: string | null | undefined,
    item: ZhihuRecommendationSignalItem,
    action: ZhihuRecommendationAction,
  ): void {
    recordZhihuRecommendationSignal(accountId, item, action)
  }

  recordRead(accountId: string | null | undefined, item: ZhihuContentSummary): void {
    this.recordSignal(accountId, item, 'open')
    if (!accountId || !upstreamType(item.ref)) return

    void this.postTouches(accountId, [{ ref: item.ref }], 'read')
      .catch((error) => log.feed.debug('zhihu read feedback failed', error))
  }

  async flushImpressions(): Promise<void> {
    const activeAccountId = this.session.getSnapshot().account?.id
    if (!activeAccountId) {
      this.pendingByAccount.clear()
      return
    }

    const pending = this.pendingByAccount.get(activeAccountId)
    this.pendingByAccount.clear()
    if (!pending || pending.size === 0) return

    try {
      await this.postTouches(activeAccountId, [...pending.values()], 'touch')
    } catch (error) {
      log.feed.debug('zhihu impression feedback failed', error)
    }
  }

  dispose(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    this.pendingByAccount.clear()
  }

  private async postTouches(
    accountId: string,
    items: readonly PendingTouch[],
    action: UpstreamTouchAction,
  ): Promise<void> {
    if (this.session.getSnapshot().account?.id !== accountId) return

    const payload = items
      .map(({ ref }) => {
        const type = upstreamType(ref)
        return type ? [type, ref.id, action] as [string, string, UpstreamTouchAction] : null
      })
      .filter((entry): entry is [string, string, UpstreamTouchAction] => entry !== null)

    if (payload.length === 0) return
    const multipart = multipartItemsBody(payload)

    try {
      await this.api.requestRawJson(
        'feed.lastread.touch',
        'https://www.zhihu.com/lastread/touch',
        'POST',
        multipart.body,
        {
          'Content-Type': multipart.contentType,
          'X-Requested-With': 'fetch',
        },
        undefined,
        { signing: 'web-zse96' },
      )
    } catch (error) {
      // 该 endpoint 的成功响应在不同客户端版本可能为空或不是 JSON。HTTP/API 层已经先
      // 处理 4xx/5xx；因此只把“2xx 但无法 JSON.parse”视作 best-effort 成功。
      if (error instanceof ZhihuApiError && error.code === 'invalid-response') return
      throw error
    }
  }
}
