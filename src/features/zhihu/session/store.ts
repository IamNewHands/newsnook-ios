import type { SecureStore } from '../../account/secureStore'

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
}
