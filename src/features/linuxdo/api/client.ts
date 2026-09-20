import { Capacitor } from '@capacitor/core'

import { detectBrowserChallenge } from '../../../lib/browserChallenge'
import { linuxDoEndpoints } from './endpoints'
import { LinuxDoApiError, type LinuxDoSessionSnapshot } from '../types'
import { readLinuxDoSession, requestLinuxDoNative } from '../session/native'

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface RequestOptions {
  method?: Method
  body?: Record<string, unknown>
  form?: Record<string, string | number | boolean | Array<string | number> | undefined>
  signal?: AbortSignal
  auth?: 'optional' | 'required'
  csrf?: boolean
  retryRead?: boolean
}

function formBody(form: RequestOptions['form']): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(form ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item))
    } else {
      params.set(key, String(value))
    }
  }
  return params.toString()
}

function retryAfterSeconds(headers: Record<string, string> | undefined): number | undefined {
  if (!headers) return undefined
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== 'retry-after') continue
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds
  }
  return undefined
}

function messageFromBody(text: string, fallback: string): string {
  try {
    const payload = JSON.parse(text)
    if (Array.isArray(payload?.errors) && payload.errors[0]) return String(payload.errors[0])
    if (typeof payload?.error === 'string') return payload.error
  } catch {
    // non-json
  }
  return fallback
}

function classify(status: number, text: string, headers?: Record<string, string>): LinuxDoApiError {
  if (detectBrowserChallenge({ status, body: text, headers })) {
    return new LinuxDoApiError('browser-verification', 'Linux.do 需要浏览器安全验证', status)
  }
  if (status === 401) return new LinuxDoApiError('auth-required', '请先登录 Linux.do', status)
  if (status === 403) return new LinuxDoApiError('forbidden', messageFromBody(text, '当前账号没有权限执行此操作'), status)
  if (status === 404) return new LinuxDoApiError('not-found', '内容不存在或已被移除', status)
  if (status === 429) {
    const retryAfter = retryAfterSeconds(headers)
    return new LinuxDoApiError('rate-limited', '请求过于频繁，请稍后再试', status, retryAfter)
  }
  if (status >= 400 && status < 500) return new LinuxDoApiError('validation', messageFromBody(text, '请求参数无效'), status)
  if (status >= 500) return new LinuxDoApiError('server', 'Linux.do 服务暂时不可用', status)
  return new LinuxDoApiError('unknown', '请求失败', status)
}

export class LinuxDoApiClient {
  private session: LinuxDoSessionSnapshot = { authenticated: false, authMode: 'none' }
  private csrfToken = ''

  async restore(): Promise<LinuxDoSessionSnapshot> {
    this.session = await readLinuxDoSession()
    return this.session
  }

  setSession(session: LinuxDoSessionSnapshot): void {
    this.session = session
    this.csrfToken = ''
  }

  sessionSnapshot(): LinuxDoSessionSnapshot {
    return this.session
  }

  async getJson<T>(url: string, options?: Omit<RequestOptions, 'method' | 'body' | 'form'>): Promise<T> {
    return this.requestJson<T>(url, { ...options, method: 'GET', retryRead: options?.retryRead ?? true })
  }

  async getText(url: string, options?: Omit<RequestOptions, 'method' | 'body' | 'form'>): Promise<string> {
    return this.requestText(url, { ...options, method: 'GET', retryRead: options?.retryRead ?? true })
  }

  async postForm<T>(url: string, form: RequestOptions['form'], options?: Omit<RequestOptions, 'method' | 'body' | 'form'>): Promise<T> {
    return this.requestJson<T>(url, { ...options, method: 'POST', form, csrf: options?.csrf ?? true })
  }

  async putForm<T>(url: string, form: RequestOptions['form'], options?: Omit<RequestOptions, 'method' | 'body' | 'form'>): Promise<T> {
    return this.requestJson<T>(url, { ...options, method: 'PUT', form, csrf: options?.csrf ?? true })
  }

  async deleteJson<T>(url: string, form?: RequestOptions['form'], options?: Omit<RequestOptions, 'method' | 'body' | 'form'>): Promise<T> {
    return this.requestJson<T>(url, { ...options, method: 'DELETE', form, csrf: options?.csrf ?? true })
  }

  async csrf(): Promise<string> {
    if (this.csrfToken) return this.csrfToken
    const payload = await this.requestJson<{ csrf?: string }>(linuxDoEndpoints.csrf, {
      method: 'GET',
      auth: 'required',
      retryRead: true,
    })
    const token = payload?.csrf?.trim()
    if (!token) throw new LinuxDoApiError('auth-required', '无法建立 Linux.do 写入会话')
    this.csrfToken = token
    return token
  }

  private async requestJson<T>(url: string, options: RequestOptions): Promise<T> {
    if (options.auth === 'required' && !this.session.authenticated) {
      throw new LinuxDoApiError('auth-required', '请先登录 Linux.do', 401)
    }
    const text = await this.requestText(url, options)
    try {
      return JSON.parse(text) as T
    } catch {
      throw new LinuxDoApiError('unknown', 'Linux.do 返回了无法解析的数据')
    }
  }

  private async requestText(url: string, options: RequestOptions): Promise<string> {
    const method = options.method ?? 'GET'
    const csrf = options.csrf && this.session.authMode !== 'user-api-key' ? await this.csrf() : ''
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
    }
    if (csrf) headers['X-CSRF-Token'] = csrf

    let body: string | undefined
    if (options.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
      body = formBody(options.form)
    } else if (options.body) {
      headers['Content-Type'] = 'application/json; charset=UTF-8'
      body = JSON.stringify(options.body)
    }

    const execute = async () => {
      if (Capacitor.isNativePlatform()) {
        const response = await requestLinuxDoNative({ url, method, headers, body })
        const responseHeaders = response.headers ?? {}
        const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? {})
        if (response.status < 200 || response.status >= 300) throw classify(response.status, text, responseHeaders)
        return text
      }

      if (method !== 'GET') {
        throw new LinuxDoApiError('auth-required', 'Linux.do 登录与互动功能需要在 NewsNook App 中使用')
      }
      const proxyUrl = '/api/page?url=' + encodeURIComponent(url) + '&accept=' + encodeURIComponent(headers.Accept)
      const response = await fetch(proxyUrl, {
        method: 'GET',
        signal: options.signal,
        headers: { Accept: headers.Accept },
      })
      const text = await response.text()
      if (!response.ok) throw classify(response.status, text, Object.fromEntries(response.headers.entries()))
      return text
    }

    try {
      return await execute()
    } catch (error) {
      if (error instanceof LinuxDoApiError) {
        if (method === 'GET' && options.retryRead && error.kind === 'rate-limited' && (error.retryAfterSeconds ?? 0) <= 2) {
          await new Promise((resolve) => setTimeout(resolve, Math.max(500, (error.retryAfterSeconds ?? 1) * 1000)))
          return execute()
        }
        throw error
      }
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new LinuxDoApiError('network', error instanceof Error ? error.message : '网络连接失败')
    }
  }
}
