import { canExecuteZhihuOperation, zhihuOperation } from '../protocol'
import { StaleZhihuGenerationError, ZhihuSessionService } from '../session/service'
import type { ZhihuTransport } from '../transport/types'
import { ZhihuApiError } from './errors'

function looksLikeVerificationPage(body: string): boolean {
  const prefix = body.slice(0, 1200).toLowerCase()
  return prefix.includes('<!doctype html') || prefix.includes('<html') || prefix.includes('captcha') || prefix.includes('验证')
}

function responseErrorMessage(body: string): string | undefined {
  if (!body.trim()) return undefined
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const error = parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error)
      ? parsed.error as Record<string, unknown>
      : undefined
    const candidates = [error?.message, parsed.message, parsed.error_description]
    return candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim()
  } catch {
    return undefined
  }
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
    return this.requestJson(operation, url, 'GET', undefined, signal)
  }

  async getJsonWithHeaders(
    operation: string,
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ): Promise<unknown> {
    return this.requestJson(operation, url, 'GET', undefined, signal, { headers, signing: options?.signing })
  }

  async postJson(operation: string, url: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson(operation, url, 'POST', body, signal)
  }

  async putJson(operation: string, url: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson(operation, url, 'PUT', body, signal)
  }

  async patchJson(operation: string, url: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson(operation, url, 'PATCH', body, signal)
  }

  async deleteJson(operation: string, url: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson(operation, url, 'DELETE', body, signal)
  }

  async requestRawJson(
    operation: string,
    url: string,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ): Promise<unknown> {
    return this.requestJson(operation, url, method, undefined, signal, { body, headers, signing: options?.signing })
  }

  async requestJson(
    operation: string,
    url: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body?: unknown,
    signal?: AbortSignal,
    raw?: { body?: string; headers?: Record<string, string>; signing?: 'web-zse96' | 'none' },
  ): Promise<unknown> {
    const contract = zhihuOperation(operation)
    if (!contract || contract.method !== method) {
      throw new ZhihuApiError('unsupported', `知乎操作未注册为 ${method}：${operation}`)
    }
    if (contract.status === 'blocked') {
      throw new ZhihuApiError('unsupported', `知乎操作尚无可执行协议证据：${operation}`)
    }
    if (method !== 'GET' && !canExecuteZhihuOperation(operation)) {
      throw new ZhihuApiError('unsupported', `当前知乎接口未开放此操作：${operation}`)
    }
    const snapshot = this.session.getSnapshot()
    if (contract.auth === 'required' && snapshot.auth !== 'authenticated') {
      throw new ZhihuApiError('auth-expired', '此功能需要先登录知乎账号')
    }

    const attempts = method === 'GET' && contract.retry === 'safe-read' ? 2 : 1
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        this.session.assertGeneration(snapshot.generation)
        const response = await this.transport.request({
          operation,
          url,
          method,
          body: raw?.body ?? (body === undefined ? undefined : JSON.stringify(body)),
          headers: raw?.headers,
          signing: raw?.signing,
          accountId: snapshot.account?.id,
          generation: snapshot.generation,
          retry: contract.retry,
        }, signal)
        this.session.assertGeneration(snapshot.generation)

        const upstreamMessage = responseErrorMessage(response.body)
        if (response.status === 401) {
          if (snapshot.account) this.session.setAuthState('expired')
          throw new ZhihuApiError('auth-expired', upstreamMessage ?? '知乎登录已过期', 401)
        }
        if (response.status === 403) throw new ZhihuApiError('forbidden', upstreamMessage ?? '知乎拒绝了此请求', 403)
        if (response.status === 429) throw new ZhihuApiError('rate-limited', upstreamMessage ?? '知乎请求过于频繁', 429)
        if (response.status >= 400) throw new ZhihuApiError('network', upstreamMessage ?? `知乎请求失败（${response.status}）`, response.status)
        if (looksLikeVerificationPage(response.body)) {
          this.session.setAuthState('verification-required')
          throw new ZhihuApiError('verification-required', '知乎要求在官方页面完成验证')
        }
        if (response.status === 204 || !response.body.trim()) return null
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
