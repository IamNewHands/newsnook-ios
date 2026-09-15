import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { RefreshCw } from 'lucide-react'

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
  const pullStartYRef = useRef<number | null>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = scrollContainerRef.current
    const target = loadMoreSentinelRef.current
    if (!root || !target || !hasMore || loading || loadingMore) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
    }, { root, rootMargin: '0px 0px 360px 0px', threshold: 0.01 })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, onLoadMore, scrollContainerRef])

  useEffect(() => {
    const root = scrollContainerRef.current
    if (!root) return
    const updatePullDistance = (value: number) => {
      pullDistanceRef.current = value
      setPullDistance(value)
    }
    const onTouchStart = (event: globalThis.TouchEvent) => {
      if (loading || root.scrollTop > 1) return
      pullStartYRef.current = event.touches[0]?.clientY ?? null
      updatePullDistance(0)
    }
    const onTouchMove = (event: globalThis.TouchEvent) => {
      const startY = pullStartYRef.current
      const currentY = event.touches[0]?.clientY
      if (startY === null || currentY === undefined) return
      if (root.scrollTop > 1) {
        pullStartYRef.current = null
        updatePullDistance(0)
        return
      }
      const delta = currentY - startY
      updatePullDistance(delta > 0 ? Math.min(92, delta * 0.46) : 0)
    }
    const onTouchEnd = () => {
      const shouldRefresh = pullDistanceRef.current >= 56 && !loading
      pullStartYRef.current = null
      updatePullDistance(0)
      if (shouldRefresh) onRefresh()
    }
    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: true })
    root.addEventListener('touchend', onTouchEnd, { passive: true })
    root.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('touchend', onTouchEnd)
      root.removeEventListener('touchcancel', onTouchEnd)
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
          <span>{pullDistance >= 56 ? '松开刷新' : '下拉刷新'}</span>
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
