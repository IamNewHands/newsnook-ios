import { getSecureStore, type SecureStore } from '../account/secureStore'
import { ZhihuApiClient } from './api/client'
import { ZhihuCredentialStore } from './session/store'
import { ZhihuSessionService } from './session/service'
import { createZhihuSafeReadTransport } from './transport/safeRead'
import type { ZhihuTransport } from './transport/types'

export interface ZhihuRuntime {
  session: ZhihuSessionService
  credentials: ZhihuCredentialStore
  api: ZhihuApiClient
}

export function createZhihuRuntime(options: {
  transport?: ZhihuTransport
  secureStore?: SecureStore
} = {}): ZhihuRuntime {
  const session = new ZhihuSessionService()
  const credentials = new ZhihuCredentialStore(options.secureStore ?? getSecureStore())
  const api = new ZhihuApiClient(options.transport ?? createZhihuSafeReadTransport(), session)
  return { session, credentials, api }
}
