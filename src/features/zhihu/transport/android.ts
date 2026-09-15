import { Capacitor } from '@capacitor/core'

import { decodeBase64ToArrayBuffer, nativeProxiedRequest } from '../../proxy/nativeHttp'
import { zhihuOperation } from '../protocol'
import { buildZhihuZseHeaders } from '../crypto/zse96'
import type { ZhihuCredentialStore } from '../session/store'
import type { ZhihuRequest, ZhihuResponse, ZhihuTransport } from './types'

const REQUEST_HOSTS = new Set(['www.zhihu.com', 'api.zhihu.com', 'zhihu-pics-upload.zhimg.com'])

export function assertZhihuAuthenticatedUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || !REQUEST_HOSTS.has(url.hostname)) {
    throw new Error('知乎认证请求目标不在允许域内')
  }
  return url
}

function cookieMap(...headers: Array<string | undefined>): Map<string, string> {
  const map = new Map<string, string>()
  for (const header of headers) {
    if (!header) continue
    for (const item of header.split(';')) {
      const separator = item.indexOf('=')
      if (separator <= 0) continue
      const key = item.slice(0, separator).trim()
      const value = item.slice(separator + 1).trim()
      if (key && !map.has(key)) map.set(key, value)
    }
  }
  return map
}

function mergedCookie(...headers: Array<string | undefined>): string {
  return [...cookieMap(...headers)].map(([key, value]) => `${key}=${value}`).join('; ')
}

function decodeUtf8(base64: string): string {
  return new TextDecoder().decode(decodeBase64ToArrayBuffer(base64))
}

/**
 * Android 的认证网络通道复用已验证的 ProxiedHttp 原生 OkHttp 实现；Cookie 从
 * Keystore-backed ZhihuCredentialStore 按 accountId 现取，永远不落普通存储。
 * 非幂等写操作只执行一次，重试策略由 API 层严格控制。
 */
export function createZhihuAndroidTransport(credentials: ZhihuCredentialStore): ZhihuTransport {
  return {
    async request(input: ZhihuRequest, signal?: AbortSignal): Promise<ZhihuResponse> {
      if (!Capacitor.isNativePlatform()) throw new Error('知乎认证 transport 仅可在 Android 原生运行')
      const target = assertZhihuAuthenticatedUrl(input.url)
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

      const contract = zhihuOperation(input.operation)
      if (!contract || contract.method !== input.method) {
        throw new Error(`知乎 operation/method 不匹配：${input.operation}`)
      }
      if (contract.status === 'blocked') {
        throw new Error(`知乎操作缺少可执行协议证据：${input.operation}`)
      }

      const stored = input.accountId ? await credentials.loadAccount(input.accountId) : null
      if (contract.auth === 'required' && !stored) {
        throw new Error(`知乎操作缺少账号会话：${input.operation}`)
      }
      const cookies = stored ? mergedCookie(stored.wwwCookie, stored.apiCookie) : ''
      const parsedCookies = cookieMap(cookies)
      const headers: Record<string, string> = {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
        Referer: 'https://www.zhihu.com/',
        'X-Requested-With': 'fetch',
        ...input.headers,
      }
      if (cookies && target.hostname !== 'zhihu-pics-upload.zhimg.com') headers.Cookie = cookies
      if (input.body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
      const dc0 = parsedCookies.get('d_c0')
      if (input.signing !== 'none' && dc0 && target.hostname !== 'zhihu-pics-upload.zhimg.com') {
        Object.assign(headers, buildZhihuZseHeaders(input.url, dc0, input.body))
      }
      if (input.method !== 'GET' && input.method !== 'DELETE' && target.hostname !== 'zhihu-pics-upload.zhimg.com') {
        const xsrf = parsedCookies.get('_xsrf')
        if (xsrf) headers['x-xsrftoken'] = xsrf
        headers.Origin = 'https://www.zhihu.com'
      }

      const response = await nativeProxiedRequest({
        url: input.url,
        method: input.method,
        headers,
        data: input.bodyBase64 ? undefined : input.body,
        dataBase64: input.bodyBase64,
        followRedirects: false,
        connectTimeout: 15_000,
        readTimeout: 30_000,
      })
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      return {
        status: response.status,
        headers: response.headers,
        body: decodeUtf8(response.data),
      }
    },
  }
}
