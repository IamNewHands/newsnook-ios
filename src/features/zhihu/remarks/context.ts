import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'

import type { ZhihuAuthor } from '../types'
import { ZhihuRemarkStore, zhihuRemarkIdentity, type ZhihuUserRemark } from './store'

export interface ZhihuRemarkContextValue {
  store: ZhihuRemarkStore
  edit: (author: ZhihuAuthor) => void
}

export const ZhihuRemarkContext = createContext<ZhihuRemarkContextValue | null>(null)
const emptySubscribe = () => () => {}
const emptySnapshot = () => undefined

export function useZhihuUserRemark(author: Pick<ZhihuAuthor, 'id' | 'token'>): ZhihuUserRemark | undefined {
  const context = useContext(ZhihuRemarkContext)
  const key = zhihuRemarkIdentity(author)
  const subscribe = context?.store.subscribe ?? emptySubscribe
  const getSnapshot = useCallback(() => context?.store.get(key), [context?.store, key])
  return useSyncExternalStore(subscribe, getSnapshot, emptySnapshot)
}
