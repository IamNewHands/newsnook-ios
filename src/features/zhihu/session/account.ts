import { ZhihuApiError } from '../api/errors'
import type { ZhihuApiClient } from '../api/client'
import {
  authenticateZhihuNative,
  clearZhihuNativeBrowserSession,
  isNativeZhihuSessionAvailable,
} from './native'
import type { ZhihuSessionService } from './service'
import type { ZhihuCredentialStore } from './store'
import type { ZhihuStoredAccount } from './types'

export class ZhihuAccountService {
  private readonly session: ZhihuSessionService
  private readonly credentials: ZhihuCredentialStore
  private readonly api: ZhihuApiClient

  constructor(
    session: ZhihuSessionService,
    credentials: ZhihuCredentialStore,
    api: ZhihuApiClient,
  ) {
    this.session = session
    this.credentials = credentials
    this.api = api
  }

  async addAccount(url?: string): Promise<ZhihuStoredAccount> {
    if (!this.isNativeAuthAvailable()) throw new Error('知乎登录/注册目前需要 NewsNook Android 原生应用')
    this.session.setAuthState('authenticating')
    try {
      const stored = await authenticateZhihuNative({ url, resume: null })
      await this.credentials.saveAccount(stored)
      await this.credentials.setActiveAccountId(stored.account.id)
      this.session.switchAccount(stored.account, 'authenticated')
      return stored
    } catch (error) {
      const current = await this.currentStoredAccount()
      this.session.setAuthState(current ? 'authenticated' : 'guest')
      throw error
    }
  }

  isNativeAuthAvailable(): boolean {
    return isNativeZhihuSessionAvailable()
  }

  listAccounts(): Promise<ZhihuStoredAccount[]> {
    return this.credentials.listAccounts()
  }

  async currentStoredAccount(): Promise<ZhihuStoredAccount | null> {
    const id = this.session.getSnapshot().account?.id ?? await this.credentials.getActiveAccountId()
    return id ? this.credentials.loadAccount(id) : null
  }

  async hydrate(): Promise<ZhihuStoredAccount | null> {
    const activeId = await this.credentials.getActiveAccountId()
    const current = this.session.getSnapshot()
    if (!activeId) {
      // 冷启动本来就是 guest 时不能再次 switchAccount(null)：那会无意义地 bump
      // generation，把同时启动的匿名推荐流请求判成“账号已切换”的过期响应。
      if (current.account || current.auth !== 'guest') this.session.switchAccount(null)
      return null
    }
    const stored = await this.credentials.loadAccount(activeId)
    if (!stored) {
      await this.credentials.setActiveAccountId(null)
      if (current.account || current.auth !== 'guest') this.session.switchAccount(null)
      return null
    }
    if (current.account?.id === stored.account.id) this.session.setAuthState('authenticated')
    else this.session.switchAccount(stored.account, 'authenticated')
    try {
      await this.api.getJson('session.validate', 'https://www.zhihu.com/api/v4/me')
      return stored
    } catch (error) {
      if (error instanceof ZhihuApiError && error.code === 'verification-required') {
        this.session.setAuthState('verification-required')
        return stored
      }
      this.session.setAuthState('expired')
      return stored
    }
  }

  async authenticate(url?: string): Promise<ZhihuStoredAccount> {
    if (!this.isNativeAuthAvailable()) throw new Error('知乎登录/注册目前需要 NewsNook Android 原生应用')
    const resume = await this.currentStoredAccount()
    const previousAuth = this.session.getSnapshot().auth
    this.session.setAuthState('authenticating')
    try {
      const stored = await authenticateZhihuNative({ url, resume })
      await this.credentials.saveAccount(stored)
      await this.credentials.setActiveAccountId(stored.account.id)
      this.session.switchAccount(stored.account, 'authenticated')
      return stored
    } catch (error) {
      const current = await this.currentStoredAccount()
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('ZH_AUTH_CANCELLED')) {
        this.session.setAuthState(current ? (previousAuth === 'guest' ? 'authenticated' : previousAuth) : 'guest')
      } else {
        this.session.setAuthState(current ? 'expired' : 'guest')
      }
      throw error
    }
  }

  async switchAccount(accountId: string): Promise<ZhihuStoredAccount> {
    const stored = await this.credentials.loadAccount(accountId)
    if (!stored) throw new Error('找不到该知乎账号的安全会话')
    await this.credentials.setActiveAccountId(accountId)
    this.session.switchAccount(stored.account, 'authenticated')
    try {
      await this.api.getJson('session.validate', 'https://www.zhihu.com/api/v4/me')
      return stored
    } catch (error) {
      if (error instanceof ZhihuApiError && error.code === 'verification-required') {
        this.session.setAuthState('verification-required')
      } else {
        this.session.setAuthState('expired')
      }
      throw error
    }
  }

  async removeCurrentAccount(): Promise<void> {
    const accountId = this.session.getSnapshot().account?.id
    if (accountId) await this.credentials.removeAccount(accountId)
    await clearZhihuNativeBrowserSession()
    this.session.switchAccount(null)
  }
}
