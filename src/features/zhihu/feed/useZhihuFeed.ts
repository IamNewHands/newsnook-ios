import { useCallback, useEffect, useRef, useState } from 'react'

import { ZhihuApiError } from '../api/errors'
import { loadZhihuPublicFeedCache, saveZhihuPublicFeedCache } from '../storage/cache'
import type { Page, ZhihuContentSummary, ZhihuFeedMode, ZhihuRecommendationMode } from '../types'
import { mergeZhihuPages, type ZhihuFeedService } from './service'

export interface ZhihuFeedPreviewState extends Page<ZhihuContentSummary> {
  loading: boolean
  loadingMore: boolean
  error: ZhihuApiError | null
}

type FeedState = ZhihuFeedPreviewState

const EMPTY: FeedState = { items: [], hasMore: false, loading: true, loadingMore: false, error: null }

function asApiError(error: unknown): ZhihuApiError {
  return error instanceof ZhihuApiError
    ? error
    : new ZhihuApiError('network', error instanceof Error ? error.message : '知乎网络请求失败')
}

function cachedState(
  mode: ZhihuFeedMode,
  recommendationMode: ZhihuRecommendationMode,
): FeedState | undefined {
  const cached = loadZhihuPublicFeedCache(mode, undefined, Date.now(), recommendationMode)
  return cached
    ? { ...cached, loading: false, loadingMore: false, error: null }
    : undefined
}

function initialPreviews(
  recommendationMode: ZhihuRecommendationMode,
): Partial<Record<ZhihuFeedMode, FeedState>> {
  const recommended = cachedState('recommended', recommendationMode)
  const hot = cachedState('hot', recommendationMode)
  return {
    ...(recommended ? { recommended } : {}),
    ...(hot ? { hot } : {}),
  }
}

export function useZhihuFeed(
  service: ZhihuFeedService,
  mode: ZhihuFeedMode,
  recommendationMode: ZhihuRecommendationMode = 'smart',
  accountId?: string | null,
  enabled = true,
) {
  const initialPreviewRef = useRef<Partial<Record<ZhihuFeedMode, FeedState>> | null>(null)
  if (!initialPreviewRef.current) initialPreviewRef.current = initialPreviews(recommendationMode)

  const [previews, setPreviews] = useState<Partial<Record<ZhihuFeedMode, FeedState>>>(
    () => initialPreviewRef.current ?? {},
  )
  const previewsRef = useRef(previews)
  previewsRef.current = previews

  const [state, setState] = useState<FeedState>(() => {
    const seeded = initialPreviewRef.current?.[mode] ?? cachedState(mode, recommendationMode)
    return seeded ? { ...seeded, loading: true } : EMPTY
  })

  const requestEpoch = useRef(0)
  const refreshControllerRef = useRef<AbortController | null>(null)
  const prefetchControllersRef = useRef(new Map<string, AbortController>())
  const prefetchedKeysRef = useRef(new Set<string>())
  const activeModeRef = useRef(mode)
  activeModeRef.current = mode
  const previousAccountIdRef = useRef(accountId)

  const putPreview = useCallback((targetMode: ZhihuFeedMode, next: FeedState) => {
    previewsRef.current = { ...previewsRef.current, [targetMode]: next }
    setPreviews((prev) => ({ ...prev, [targetMode]: next }))
  }, [])

  useEffect(() => {
    if (previousAccountIdRef.current === accountId) return
    previousAccountIdRef.current = accountId

    // 关注流属于账号私有状态：账号变化时必须立即丢弃旧账号的内存预览。
    const next = { ...previewsRef.current }
    delete next.following
    previewsRef.current = next
    setPreviews(next)

    for (const [key, controller] of prefetchControllersRef.current) {
      if (key.startsWith('following:')) {
        controller.abort()
        prefetchControllersRef.current.delete(key)
        prefetchedKeysRef.current.delete(key)
      }
    }
  }, [accountId])

  const refresh = useCallback(async () => {
    if (!enabled) return

    requestEpoch.current += 1
    const epoch = requestEpoch.current
    refreshControllerRef.current?.abort()
    const controller = new AbortController()
    refreshControllerRef.current = controller

    const seeded = previewsRef.current[mode] ?? cachedState(mode, recommendationMode)
    const seededState: FeedState = seeded
      ? { ...seeded, loading: true, loadingMore: false, error: null }
      : { ...EMPTY }

    setState(seededState)
    putPreview(mode, seededState)

    try {
      const page = await service.listFeed(mode, undefined, controller.signal, recommendationMode, accountId)
      if (controller.signal.aborted || requestEpoch.current !== epoch || activeModeRef.current !== mode) return

      saveZhihuPublicFeedCache(mode, page, undefined, Date.now(), recommendationMode)
      const next: FeedState = { ...page, loading: false, loadingMore: false, error: null }
      setState(next)
      putPreview(mode, next)
    } catch (error) {
      if (controller.signal.aborted || requestEpoch.current !== epoch || activeModeRef.current !== mode) return

      const next: FeedState = {
        ...seededState,
        loading: false,
        loadingMore: false,
        error: asApiError(error),
      }
      setState(next)
      putPreview(mode, next)
    } finally {
      if (refreshControllerRef.current === controller) refreshControllerRef.current = null
    }
  }, [accountId, enabled, mode, putPreview, recommendationMode, service])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    return () => {
      refreshControllerRef.current?.abort()
      refreshControllerRef.current = null
    }
  }, [enabled, refresh])

  const prefetch = useCallback((targetMode: ZhihuFeedMode) => {
    if (!enabled || targetMode === activeModeRef.current) return
    if (targetMode === 'following' && !accountId) return

    const accountScope = targetMode === 'following' ? accountId ?? 'guest' : 'public'
    const key = `${targetMode}:${recommendationMode}:${accountScope}`
    if (prefetchedKeysRef.current.has(key) || prefetchControllersRef.current.has(key)) return

    const cached = previewsRef.current[targetMode] ?? cachedState(targetMode, recommendationMode)
    if (cached && previewsRef.current[targetMode] !== cached) putPreview(targetMode, cached)

    const controller = new AbortController()
    prefetchControllersRef.current.set(key, controller)
    putPreview(targetMode, {
      ...(cached ?? EMPTY),
      loading: cached ? false : true,
      loadingMore: false,
      error: null,
    })

    void service.listFeed(targetMode, undefined, controller.signal, recommendationMode, accountId).then(
      async (page) => {
        if (controller.signal.aborted) return
        let previewPage = page
        if (page.hasMore && page.nextCursor) {
          try {
            const secondPage = await service.listFeed(targetMode, page.nextCursor, controller.signal, recommendationMode, accountId)
            if (!controller.signal.aborted) previewPage = mergeZhihuPages(page, secondPage)
          } catch {
            // 邻页预取的第二屏失败时保留第一屏；不让预取错误影响当前阅读页。
          }
        }
        if (controller.signal.aborted) return
        saveZhihuPublicFeedCache(targetMode, previewPage, undefined, Date.now(), recommendationMode)
        putPreview(targetMode, { ...previewPage, loading: false, loadingMore: false, error: null })
        prefetchedKeysRef.current.add(key)
      },
      (error) => {
        if (controller.signal.aborted) return
        // 预取失败不能污染当前页；有缓存时继续保留缓存内容，下一次仍允许重试。
        putPreview(targetMode, {
          ...(cached ?? { items: [], hasMore: false }),
          loading: false,
          loadingMore: false,
          error: asApiError(error),
        })
      },
    ).finally(() => {
      prefetchControllersRef.current.delete(key)
    })
  }, [accountId, enabled, putPreview, recommendationMode, service])

  const dismiss = useCallback((item: Pick<ZhihuContentSummary, 'ref'>) => {
    const key = `${item.ref.kind}:${item.ref.id}`
    const withoutItem = (items: ZhihuContentSummary[]) =>
      items.filter((candidate) => `${candidate.ref.kind}:${candidate.ref.id}` !== key)

    setState((current) => {
      if (!current.items.some((candidate) => `${candidate.ref.kind}:${candidate.ref.id}` === key)) return current
      return { ...current, items: withoutItem(current.items) }
    })

    const preview = previewsRef.current[mode]
    if (preview?.items.some((candidate) => `${candidate.ref.kind}:${candidate.ref.id}` === key)) {
      putPreview(mode, { ...preview, items: withoutItem(preview.items) })
    }
  }, [mode, putPreview])

  const loadMore = useCallback(() => {
    if (state.loading || state.loadingMore || !state.hasMore || !state.nextCursor) return

    const epoch = requestEpoch.current
    const cursor = state.nextCursor
    const baseState = state
    const pending: FeedState = { ...state, loadingMore: true, error: null }
    setState(pending)
    putPreview(mode, pending)

    void service.listFeed(mode, cursor, undefined, recommendationMode, accountId).then(
      (page) => {
        if (requestEpoch.current !== epoch || activeModeRef.current !== mode) return
        const merged = mergeZhihuPages(baseState, page)
        saveZhihuPublicFeedCache(mode, merged, undefined, Date.now(), recommendationMode)
        const next: FeedState = { ...merged, loading: false, loadingMore: false, error: null }
        setState(next)
        putPreview(mode, next)
      },
      (error) => {
        if (requestEpoch.current !== epoch || activeModeRef.current !== mode) return
        const next: FeedState = { ...baseState, loadingMore: false, error: asApiError(error) }
        setState(next)
        putPreview(mode, next)
      },
    )
  }, [accountId, mode, putPreview, recommendationMode, service, state])

  useEffect(() => () => {
    refreshControllerRef.current?.abort()
    for (const controller of prefetchControllersRef.current.values()) controller.abort()
    prefetchControllersRef.current.clear()
  }, [])

  return { ...state, previews, prefetch, refresh, dismiss, loadMore }
}
