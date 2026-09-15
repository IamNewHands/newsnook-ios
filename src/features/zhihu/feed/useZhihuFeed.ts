import { useCallback, useEffect, useRef, useState } from 'react'

import { ZhihuApiError } from '../api/errors'
import { loadZhihuPublicFeedCache, saveZhihuPublicFeedCache } from '../storage/cache'
import type { Page, ZhihuContentSummary, ZhihuFeedMode, ZhihuRecommendationMode } from '../types'
import { mergeZhihuPages, type ZhihuFeedService } from './service'

interface FeedState extends Page<ZhihuContentSummary> {
  loading: boolean
  loadingMore: boolean
  error: ZhihuApiError | null
}

const EMPTY: FeedState = { items: [], hasMore: false, loading: true, loadingMore: false, error: null }

function asApiError(error: unknown): ZhihuApiError {
  return error instanceof ZhihuApiError
    ? error
    : new ZhihuApiError('network', error instanceof Error ? error.message : '知乎网络请求失败')
}

export function useZhihuFeed(
  service: ZhihuFeedService,
  mode: ZhihuFeedMode,
  recommendationMode: ZhihuRecommendationMode = 'android',
  accountId?: string | null,
) {
  const [state, setState] = useState<FeedState>(EMPTY)
  const requestEpoch = useRef(0)

  const refresh = useCallback(() => {
    requestEpoch.current += 1
    const epoch = requestEpoch.current
    const controller = new AbortController()
    const cached = loadZhihuPublicFeedCache(mode, undefined, Date.now(), recommendationMode)
    setState((prev) => ({
      ...prev,
      items: cached?.items ?? [],
      nextCursor: cached?.nextCursor,
      hasMore: cached?.hasMore ?? false,
      loading: true,
      error: null,
    }))
    void service.listFeed(mode, undefined, controller.signal, recommendationMode, accountId).then(
      (page) => {
        if (requestEpoch.current !== epoch) return
        saveZhihuPublicFeedCache(mode, page, undefined, Date.now(), recommendationMode)
        setState({ ...page, loading: false, loadingMore: false, error: null })
      },
      (error) => {
        if (controller.signal.aborted || requestEpoch.current !== epoch) return
        setState((prev) => ({ ...prev, loading: false, loadingMore: false, error: asApiError(error) }))
      },
    )
    return () => controller.abort()
  }, [accountId, mode, recommendationMode, service])

  useEffect(() => refresh(), [refresh])

  const loadMore = useCallback(() => {
    if (state.loading || state.loadingMore || !state.hasMore || !state.nextCursor) return
    const epoch = requestEpoch.current
    const cursor = state.nextCursor
    setState((prev) => ({ ...prev, loadingMore: true, error: null }))
    void service.listFeed(mode, cursor, undefined, recommendationMode, accountId).then(
      (page) => {
        if (requestEpoch.current !== epoch) return
        setState((prev) => {
          const merged = mergeZhihuPages(prev, page)
          saveZhihuPublicFeedCache(mode, merged, undefined, Date.now(), recommendationMode)
          return { ...merged, loading: false, loadingMore: false, error: null }
        })
      },
      (error) => {
        if (requestEpoch.current !== epoch) return
        setState((prev) => ({ ...prev, loadingMore: false, error: asApiError(error) }))
      },
    )
  }, [accountId, mode, recommendationMode, service, state.hasMore, state.loading, state.loadingMore, state.nextCursor])

  return { ...state, refresh, loadMore }
}
