export type ZhihuAuthState =
  | 'guest'
  | 'authenticating'
  | 'authenticated'
  | 'expired'
  | 'verification-required'

export interface ZhihuAccountRef {
  id: string
  name?: string
  urlToken?: string
  avatarUrl?: string
  headline?: string
}

export interface ZhihuStoredAccount {
  account: ZhihuAccountRef
  wwwCookie: string
  apiCookie: string
  profileJson?: string
  updatedAt: number
}

export interface ZhihuSessionSnapshot {
  auth: ZhihuAuthState
  account: ZhihuAccountRef | null
  generation: number
}
