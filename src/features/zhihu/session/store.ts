import type { SecureStore } from '../../account/secureStore'
import type { ZhihuStoredAccount } from './types'

const PREFIX = 'site.zhihu.'

export function zhihuSecureKey(accountId: string, name: string): string {
  const safeAccount = accountId.replace(/[^a-zA-Z0-9._-]/g, '_')
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${PREFIX}${safeAccount}.${safeName}`
}

/**
 * 知乎认证材料的持久化边界。Android 最终由现有 SecureStore/Keystore 落盘；
 * Web 使用其进程内实现，因此不会把 Cookie/token 写入 localStorage。
 */
export class ZhihuCredentialStore {
  private readonly secureStore: SecureStore

  constructor(secureStore: SecureStore) {
    this.secureStore = secureStore
  }

  get(accountId: string, name: string): Promise<string | null> {
    return this.secureStore.get(zhihuSecureKey(accountId, name))
  }

  set(accountId: string, name: string, value: string): Promise<void> {
    return this.secureStore.set(zhihuSecureKey(accountId, name), value)
  }

  remove(accountId: string, name: string): Promise<void> {
    return this.secureStore.remove(zhihuSecureKey(accountId, name))
  }

  private meta(name: string): string {
    return zhihuSecureKey('__meta__', name)
  }

  async listAccountIds(): Promise<string[]> {
    const raw = await this.secureStore.get(this.meta('accounts'))
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return [...new Set(parsed.filter((value): value is string => typeof value === 'string' && value.length > 0))]
    } catch {
      return []
    }
  }

  async listAccounts(): Promise<ZhihuStoredAccount[]> {
    const ids = await this.listAccountIds()
    const accounts = await Promise.all(ids.map((id) => this.loadAccount(id)))
    return accounts.filter((account): account is ZhihuStoredAccount => account !== null)
  }

  async loadAccount(accountId: string): Promise<ZhihuStoredAccount | null> {
    const raw = await this.get(accountId, 'session')
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<ZhihuStoredAccount>
      const account = parsed.account
      if (!account || typeof account.id !== 'string' || !account.id) return null
      if (typeof parsed.wwwCookie !== 'string' || typeof parsed.apiCookie !== 'string') return null
      return {
        account: {
          id: account.id,
          name: typeof account.name === 'string' ? account.name : undefined,
          urlToken: typeof account.urlToken === 'string' ? account.urlToken : undefined,
          avatarUrl: typeof account.avatarUrl === 'string' ? account.avatarUrl : undefined,
          headline: typeof account.headline === 'string' ? account.headline : undefined,
        },
        wwwCookie: parsed.wwwCookie,
        apiCookie: parsed.apiCookie,
        profileJson: typeof parsed.profileJson === 'string' ? parsed.profileJson : undefined,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      }
    } catch {
      return null
    }
  }

  async saveAccount(value: ZhihuStoredAccount): Promise<void> {
    const ids = await this.listAccountIds()
    if (!ids.includes(value.account.id)) {
      await this.secureStore.set(this.meta('accounts'), JSON.stringify([...ids, value.account.id]))
    }
    await this.set(value.account.id, 'session', JSON.stringify(value))
  }

  async removeAccount(accountId: string): Promise<void> {
    await this.remove(accountId, 'session')
    const ids = (await this.listAccountIds()).filter((id) => id !== accountId)
    await this.secureStore.set(this.meta('accounts'), JSON.stringify(ids))
    if ((await this.getActiveAccountId()) === accountId) await this.setActiveAccountId(null)
  }

  async getActiveAccountId(): Promise<string | null> {
    const value = await this.secureStore.get(this.meta('active'))
    return value && value.length > 0 ? value : null
  }

  async setActiveAccountId(accountId: string | null): Promise<void> {
    if (accountId) await this.secureStore.set(this.meta('active'), accountId)
    else await this.secureStore.remove(this.meta('active'))
  }
}
