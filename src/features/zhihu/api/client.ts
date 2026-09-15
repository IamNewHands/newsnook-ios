import { zhihuOperation } from '../protocol'
import { StaleZhihuGenerationError, ZhihuSessionService } from '../session/service'
import type { ZhihuTransport } from '../transport/types'
import { ZhihuApiError } from './errors'

function looksLikeVerificationPage(body: string): boolean {
  const prefix = body.slice(0, 1200).toLowerCase()
  return prefix.includes('<!doctype html') || prefix.includes('<html') || prefix.includes('captcha') || prefix.includes('验证')
}

export class ZhihuApiClient {
  private readonly transport: ZhihuTransport
  private readonly session: ZhihuSessionService

  constructor(
    transport: ZhihuTransport,
    session: ZhihuSessionService,
  ) {
    this.transport = transport
    this.session = session
  }

  async getJson(operation: string, url: string, signal?: AbortSignal): Promise<unknown> {
    const contract = zhihuOperation(operation)
    if (!contract || contract.method !== 'GET') {
      throw new ZhihuApiError('unsupported', `知乎操作未注册为 GET：${operation}`)
    }
    const snapshot = this.session.getSnapshot()
    if (contract.auth === 'required' && snapshot.auth !== 'authenticated') {
      throw new ZhihuApiError('unsupported', '此功能需要知乎独立登录，当前版本尚未通过实网认证验收')
    }

    const attempts = contract.retry === 'safe-read' ? 2 : 1
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        this.session.assertGeneration(snapshot.generation)
        const response = await this.transport.request({
          operation,
          url,
          method: 'GET',
          accountId: snapshot.account?.id,
          generation: snapshot.generation,
          retry: contract.retry,
        }, signal)
        this.session.assertGeneration(snapshot.generation)

        if (response.status === 401) throw new ZhihuApiError('auth-expired', '知乎登录已过期', 401)
        if (response.status === 403) throw new ZhihuApiError('forbidden', '知乎拒绝了此请求', 403)
        if (response.status === 429) throw new ZhihuApiError('rate-limited', '知乎请求过于频繁', 429)
        if (response.status >= 400) throw new ZhihuApiError('network', `知乎请求失败（${response.status}）`, response.status)
        if (looksLikeVerificationPage(response.body)) {
          throw new ZhihuApiError('verification-required', '知乎要求在官方页面完成验证')
        }
        try {
          return JSON.parse(response.body) as unknown
        } catch {
          throw new ZhihuApiError('invalid-response', '知乎返回了无法解析的数据')
        }
      } catch (error) {
        if (error instanceof StaleZhihuGenerationError) {
          throw new ZhihuApiError('stale-generation', error.message)
        }
        if (error instanceof ZhihuApiError) throw error
        if (signal?.aborted) throw error
        lastError = error
        if (attempt + 1 >= attempts) break
      }
    }
    throw new ZhihuApiError('network', lastError instanceof Error ? lastError.message : '知乎网络请求失败')
  }
}
