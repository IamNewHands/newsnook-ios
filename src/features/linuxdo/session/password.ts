import { detectBrowserChallenge } from '../../../lib/browserChallenge'
import type { LinuxDoSessionSnapshot } from '../types'
import { readLinuxDoBrowserSession, requestLinuxDoNative } from './native'

const ORIGIN = 'https://linux.do'
const CSRF_URL = ORIGIN + '/session/csrf.json'
const SESSION_URL = ORIGIN + '/session.json'

export type LinuxDoSecondFactorMethod = 'totp' | 'backup'

export interface LinuxDoSecondFactorState {
  kind: 'second-factor'
  totpEnabled: boolean
  backupEnabled: boolean
  securityKeyEnabled: boolean
  message: string
}

export interface LinuxDoPasswordAuthenticated {
  kind: 'authenticated'
  session: LinuxDoSessionSnapshot
}

export type LinuxDoPasswordLoginResult = LinuxDoSecondFactorState | LinuxDoPasswordAuthenticated

export class LinuxDoPasswordLoginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinuxDoPasswordLoginError'
  }
}

function formBody(values: Record<string, string | number | undefined>): string {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '') continue
    form.set(key, String(value))
  }
  return form.toString()
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === 'true'
}

function readableLoginError(payload: Record<string, unknown>, status: number): string {
  const reason = textValue(payload.reason)
  const error = textValue(payload.error)
  if (reason === 'expired') return '密码已过期，请先在 Linux.do 网页重置密码'
  if (reason === 'suspended') return error || '该账号当前已被暂停登录'
  if (reason === 'not_activated') return '账号尚未完成激活，请先检查邮箱并完成激活'
  if (booleanValue(payload.pending_approval)) return '账号正在等待社区审核，暂时无法登录'
  if (status === 429) return '登录尝试过于频繁，请稍后再试'
  if (status === 403) return error || 'Linux.do 暂时拒绝了本次登录请求'
  if (status >= 500) return 'Linux.do 登录服务暂时不可用，请稍后再试'
  return error || '用户名、邮箱或密码不正确'
}

async function csrfToken(): Promise<string> {
  const response = await requestLinuxDoNative({
    url: CSRF_URL,
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
  })
  if (detectBrowserChallenge({ status: response.status, body: response.data, headers: response.headers })) {
    throw new LinuxDoPasswordLoginError('Linux.do 需要先完成 Cloudflare 浏览器验证，再返回登录')
  }
  const payload = parseJson(response.data)
  const csrf = textValue(payload.csrf)
  if (response.status < 200 || response.status >= 300 || !csrf) {
    throw new LinuxDoPasswordLoginError('无法建立 Linux.do 安全登录会话，请稍后重试')
  }
  return csrf
}

export async function loginLinuxDoWithPassword(options: {
  login: string
  password: string
  secondFactorToken?: string
  secondFactorMethod?: LinuxDoSecondFactorMethod
}): Promise<LinuxDoPasswordLoginResult> {
  const login = options.login.trim()
  if (!login || !options.password) throw new LinuxDoPasswordLoginError('请输入用户名/邮箱和密码')

  const csrf = await csrfToken()
  const secondFactorMethod =
    options.secondFactorMethod === 'backup' ? 2 :
      options.secondFactorMethod === 'totp' ? 1 :
        undefined

  const response = await requestLinuxDoNative({
    url: SESSION_URL,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-CSRF-Token': csrf,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: formBody({
      login,
      password: options.password,
      second_factor_token: options.secondFactorToken?.trim(),
      second_factor_method: secondFactorMethod,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    }),
  })

  if (detectBrowserChallenge({ status: response.status, body: response.data, headers: response.headers })) {
    throw new LinuxDoPasswordLoginError('Linux.do 需要先完成 Cloudflare 浏览器验证，再返回登录')
  }
  const payload = parseJson(response.data)
  const totpEnabled = booleanValue(payload.totp_enabled)
  const backupEnabled = booleanValue(payload.backup_enabled) || booleanValue(payload.backup_codes_enabled)
  const securityKeyEnabled = booleanValue(payload.security_key_enabled) || booleanValue(payload.security_key_required)

  if ((totpEnabled || backupEnabled || securityKeyEnabled) && textValue(payload.error)) {
    if (!totpEnabled && !backupEnabled && securityKeyEnabled) {
      throw new LinuxDoPasswordLoginError('该账号仅启用了安全密钥 / Passkey，请使用系统浏览器登录 Linux.do')
    }
    return {
      kind: 'second-factor',
      totpEnabled,
      backupEnabled,
      securityKeyEnabled,
      message: textValue(payload.error) || '请输入二次验证码',
    }
  }

  if (response.status < 200 || response.status >= 300 || textValue(payload.error) || payload.failed === true) {
    throw new LinuxDoPasswordLoginError(readableLoginError(payload, response.status))
  }

  const session = await readLinuxDoBrowserSession()
  if (!session.authenticated) {
    throw new LinuxDoPasswordLoginError('登录请求已完成，但未能建立 Linux.do 会话，请重试')
  }

  return {
    kind: 'authenticated',
    session: { ...session, authMode: 'browser-session' },
  }
}
