export type ZhihuAuthState =
  | 'guest'
  | 'authenticating'
  | 'authenticated'
  | 'expired'
  | 'verification-required'

export interface ZhihuAccountRef {
  id: string
  name?: string
}

export interface ZhihuSessionSnapshot {
  auth: ZhihuAuthState
  account: ZhihuAccountRef | null
  generation: number
}
