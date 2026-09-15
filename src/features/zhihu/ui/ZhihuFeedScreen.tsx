import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { RefreshCw } from 'lucide-react'

import { PULL_THRESHOLD_PX, resistedPullDistance } from '../../../lib/pullToRefresh'
import type { ZhihuApiError } from '../api/errors'
import type { ZhihuContentSummary, ZhihuFeedMode } from '../types'
import {
  ZhihuContentRow,
  ZhihuEmptyState,
  ZhihuErrorBanner,
  ZhihuLoadingState,
  ZhihuSurface,
} from './ZhihuUi'

interface Props {
  mode: ZhihuFeedMode
  items: ZhihuContentSummary[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: ZhihuApiError | null
  authenticated: boolean
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>
  onModeChange: (mode: ZhihuFeedMode) => void
  onRefresh: () => void
  onLoadMore: () => void
  onOpen: (item: ZhihuContentSummary) => void
}

function errorMessage(error: ZhihuApiError): string {
  switch (error.code) {
    case 'verification-required': return '知乎要求进行安全验证，请稍后再试或在知乎完成验证。'
    case 'rate-limited': return '请求过于频繁，知乎暂时限流。'
    case 'unsupported': return error.message
    case 'invalid-response': return '知乎返回的数据结构发生了变化，当前内容未被错误地当成空列表。'
    default: return `读取失败：${error.message}`
  }
}

export function ZhihuFeedScreen({
  mode,
  items,
  loading,
  loadingMore,
  hasMore,
  error,
  authenticated,
  scrollContainerRef,
  onModeChange,
  onRefresh,
  onLoadMore,
  onOpen,
}: Props) {
  const [pullDistance, setPullDistance] = useState(0)
  const pullDistanceRef = useRef(0)
  const pullGestureRef = useRef<{
    startX: number
    startY: number
    lock: 'none' | 'vertical'
  } | null>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const loadMoreArmedRef = useRef(false)
  const loadRequestKeyRef = useRef('')
  const loadMoreUserIntentAtRef = useRef(0)

  useEffect(() => {
    loadMoreArmedRef.current = false
    loadRequestKeyRef.current = ''
  }, [mode])

  // 只有用户确实向下滚动到列表尾部后才允许 IntersectionObserver 续载。
  // 避免首屏布局变化/图片解码把 sentinel 推入 rootMargin 后连续自动翻页。
  useEffect(() => {
    const root = scrollContainerRef.current
    const target = loadMoreSentinelRef.current
    if (!root || !target || !hasMore || loading) return

    let lastTop = root.scrollTop
    const markUserIntent = () => { loadMoreUserIntentAtRef.current = performance.now() }
    const onScroll = () => {
      const nextTop = root.scrollTop
      const recentUserGesture = performance.now() - loadMoreUserIntentAtRef.current < 1400
      if (recentUserGesture && nextTop > lastTop + 1) loadMoreArmedRef.current = true
      lastTop = nextTop
    }
    root.addEventListener('touchstart', markUserIntent, { passive: true })
    root.addEventListener('pointerdown', markUserIntent, { passive: true })
    root.addEventListener('wheel', markUserIntent, { passive: true })
    root.addEventListener('scroll', onScroll, { passive: true })

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      if (!loadMoreArmedRef.current || loadingMore) return
      const last = items.at(-1)
      const requestKey = `${mode}:${last?.ref.kind ?? 'none'}:${last?.ref.id ?? 'none'}`
      if (loadRequestKeyRef.current === requestKey) return
      loadRequestKeyRef.current = requestKey
      loadMoreArmedRef.current = false
      onLoadMore()
    }, { root, rootMargin: '0px 0px 240px 0px', threshold: 0.01 })

    observer.observe(target)
    return () => {
      observer.disconnect()
      root.removeEventListener('touchstart', markUserIntent)
      root.removeEventListener('pointerdown', markUserIntent)
      root.removeEventListener('wheel', markUserIntent)
      root.removeEventListener('scroll', onScroll)
    }
  }, [hasMore, items, loading, loadingMore, mode, onLoadMore, scrollContainerRef])

  useEffect(() => {
    const root = scrollContainerRef.current
    if (!root) return

    const updatePullDistance = (value: number) => {
      pullDistanceRef.current = value
      setPullDistance(value)
    }
    const cancelPull = () => {
      pullGestureRef.current = null
      updatePullDistance(0)
    }

    const onTouchStart = (event: globalThis.TouchEvent) => {
      if (loading || event.touches.length !== 1 || root.scrollTop > 0) {
        cancelPull()
        return
      }
      const touch = event.touches[0]
      if (!touch) return
      pullGestureRef.current = { startX: touch.clientX, startY: touch.clientY, lock: 'none' }
      updatePullDistance(0)
    }

    const onTouchMove = (event: globalThis.TouchEvent) => {
      const gesture = pullGestureRef.current
      const touch = event.touches[0]
      if (!gesture || !touch || event.touches.length !== 1) {
        cancelPull()
        return
      }
      if (root.scrollTop > 0) {
        cancelPull()
        return
      }

      const dx = touch.clientX - gesture.startX
      const dy = touch.clientY - gesture.startY
      if (gesture.lock === 'none') {
        const absX = Math.abs(dx)
        const absY = Math.abs(dy)
        if (absX < 8 && absY < 8) return
        // 横滑、上滑、斜向手势都不允许误触发刷新。
        if (dy <= 0 || absX >= absY * 0.92) {
          cancelPull()
          return
        }
        gesture.lock = 'vertical'
      }

      if (event.cancelable) event.preventDefault()
      updatePullDistance(resistedPullDistance(Math.max(0, dy)))
    }

    const onTouchEnd = () => {
      const gesture = pullGestureRef.current
      const shouldRefresh = Boolean(
        gesture?.lock === 'vertical'
        && pullDistanceRef.current >= PULL_THRESHOLD_PX
        && !loading,
      )
      pullGestureRef.current = null
      updatePullDistance(0)
      if (shouldRefresh) onRefresh()
    }

    const onTouchCancel = () => cancelPull()
    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: false })
    root.addEventListener('touchend', onTouchEnd, { passive: true })
    root.addEventListener('touchcancel', onTouchCancel, { passive: true })
    return () => {
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('touchend', onTouchEnd)
      root.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [loading, onRefresh, scrollContainerRef])

  const modes: Array<{ id: ZhihuFeedMode; label: string; enabled: boolean; hint?: string }> = [
    { id: 'recommended', label: '推荐', enabled: true },
    { id: 'hot', label: '热榜', enabled: true },
    { id: 'following', label: '关注', enabled: authenticated, hint: authenticated ? undefined : '登录知乎后可读关注动态' },
  ]

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-3 sm:px-6">
      <div
        aria-hidden={pullDistance <= 0}
        className="flex items-end justify-center overflow-hidden transition-[height] duration-75"
        style={{ height: `${pullDistance}px` }}
      >
        <div className="mb-2.5 flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-paper-faint">
          <span className="relative flex size-5 items-center justify-center">
            <span
              className="absolute inset-0 rounded-full bg-cinnabar/20 blur-[5px]"
              style={{ opacity: Math.min(0.85, pullDistance / 72), transform: `scale(${0.6 + Math.min(1, pullDistance / 72) * 0.8})` }}
            />
            <span
              className="relative size-2 rounded-full bg-cinnabar"
              style={{ transform: `scale(${0.55 + Math.min(1, pullDistance / 72) * 0.45})` }}
            />
          </span>
          <span>{pullDistance >= PULL_THRESHOLD_PX ? '松开刷新' : '下拉刷新'}</span>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 rounded-xl border border-haze p-1">
          {modes.map((item) => {
            const active = mode === item.id
            return (
              <button
                key={item.id}
                type="button"
                disabled={!item.enabled}
                title={item.hint}
                aria-pressed={active}
                onClick={() => item.enabled && onModeChange(item.id)}
                className={`flex-1 rounded-lg py-2 text-[12.5px] transition-colors duration-200 ${
                  active
                    ? 'bg-cinnabar/20 text-paper'
                    : item.enabled
                      ? 'text-paper-faint hover:bg-paper/5 hover:text-paper-muted'
                      : 'cursor-not-allowed text-paper-faint/45'
                }`}
              >
                {item.label}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="刷新信息流"
          title="刷新"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-haze/70 bg-ink-raised/50 text-paper-muted transition-colors hover:border-paper-faint/40 hover:bg-ink-raised hover:text-paper disabled:opacity-35"
        >
          <RefreshCw size={16} strokeWidth={1.6} className={loading ? 'animate-spin text-cinnabar-soft' : ''} />
        </button>
      </div>

      {error && <div className="mb-3"><ZhihuErrorBanner>{errorMessage(error)}</ZhihuErrorBanner></div>}

      {loading && items.length === 0 ? (
        <ZhihuLoadingState label="正在读取知乎…" />
      ) : items.length === 0 && !error ? (
        <ZhihuEmptyState title="没有可显示的内容" description={mode === 'following' ? '关注动态需要登录知乎后读取。' : '稍后下拉刷新再试。'} />
      ) : (
        <ZhihuSurface className="divide-y divide-haze/55">
          {items.map((item) => (
            <ZhihuContentRow key={`${item.ref.kind}:${item.ref.id}`} item={item} onOpen={onOpen} />
          ))}
        </ZhihuSurface>
      )}

      {items.length > 0 && hasMore && (
        <div ref={loadMoreSentinelRef} className="flex min-h-14 items-center justify-center gap-2 font-mono text-[10px] tracking-[0.06em] text-paper-faint">
          {loadingMore ? (
            <>
              <RefreshCw size={12} className="animate-spin text-cinnabar-soft" />
              <span>正在加载更多</span>
            </>
          ) : (
            <span>继续上滑加载</span>
          )}
        </div>
      )}
      {items.length > 0 && !hasMore && !loading && (
        <div className="py-5 text-center font-mono text-[10px] tracking-[0.08em] text-paper-faint">已经到底了</div>
      )}
    </div>
  )
}
