import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { RefreshCw } from 'lucide-react'

import { PullIndicator } from '../../../components/PullIndicator'
import { usePullToRefresh } from '../../../hooks/usePullToRefresh'
import type { ZhihuApiError } from '../api/errors'
import type { ZhihuContentSummary, ZhihuFeedMode } from '../types'
import {
  ZhihuContentRow,
  ZhihuEmptyState,
  ZhihuErrorBanner,
  ZhihuLoadingState,
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
  onRefresh: () => Promise<void> | void
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
  const pullSurfaceRef = useRef<HTMLDivElement>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const loadRequestKeyRef = useRef('')
  const { indicatorRef, phase } = usePullToRefresh({
    onRefresh,
    containerRef: scrollContainerRef,
    surfaceRef: pullSurfaceRef,
  })

  useEffect(() => {
    loadRequestKeyRef.current = ''
  }, [mode])

  // 与新闻首页保持一致：sentinel 一进入底部预取区就续载。
  // 旧版额外要求“最近一次触摸 + 向下滚动”后再 armed，sentinel 往往先进入观察区，
  // 等 armed=true 时 IntersectionObserver 已不会再次回调，表现为上拉毫无反应。
  useEffect(() => {
    const root = scrollContainerRef.current
    const target = loadMoreSentinelRef.current
    if (!root || !target || !hasMore || loading) return

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || loadingMore) return
      const last = items.at(-1)
      const requestKey = `${mode}:${last?.ref.kind ?? 'none'}:${last?.ref.id ?? 'none'}`
      if (loadRequestKeyRef.current === requestKey) return
      loadRequestKeyRef.current = requestKey
      onLoadMore()
    }, { root, rootMargin: '240px 0px', threshold: 0.01 })

    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, items, loading, loadingMore, mode, onLoadMore, scrollContainerRef])

  const modes: Array<{ id: ZhihuFeedMode; label: string; enabled: boolean; hint?: string }> = [
    { id: 'recommended', label: '推荐', enabled: true },
    { id: 'hot', label: '热榜', enabled: true },
    { id: 'following', label: '关注', enabled: authenticated, hint: authenticated ? undefined : '登录知乎后可读关注动态' },
  ]

  return (
    <div className="relative mx-auto w-full max-w-3xl">
      <PullIndicator indicatorRef={indicatorRef} phase={phase} />
      <div ref={pullSurfaceRef} className="pb-28 pt-3">
        <div className="mb-3 flex items-center gap-2 px-4 sm:px-6">
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

      {error && <div className="mb-3 px-4 sm:px-6"><ZhihuErrorBanner>{errorMessage(error)}</ZhihuErrorBanner></div>}

      {loading && items.length === 0 ? (
        <div className="px-4 sm:px-6"><ZhihuLoadingState label="正在读取知乎…" /></div>
      ) : items.length === 0 && !error ? (
        <div className="px-4 sm:px-6"><ZhihuEmptyState title="没有可显示的内容" description={mode === 'following' ? '关注动态需要登录知乎后读取。' : '稍后下拉刷新再试。'} /></div>
      ) : (
        <div className="divide-y divide-haze/55 border-y border-haze/70 bg-ink-raised/20">
          {items.map((item) => (
            <ZhihuContentRow key={`${item.ref.kind}:${item.ref.id}`} item={item} onOpen={onOpen} compact />
          ))}
        </div>
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
    </div>
  )
}
