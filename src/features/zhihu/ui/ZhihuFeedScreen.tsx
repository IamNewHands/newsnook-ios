import { useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { RefreshCw } from 'lucide-react'

import { PullIndicator } from '../../../components/PullIndicator'
import { usePullToRefresh } from '../../../hooks/usePullToRefresh'
import { useReducedMotion } from '../../../hooks/useReducedMotion'
import { useSwipeCategory, type SwipeDirection } from '../../../hooks/useSwipeCategory'
import type { ZhihuApiError } from '../api/errors'
import type { ZhihuFeedPreviewState } from '../feed/useZhihuFeed'
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
  previews: Partial<Record<ZhihuFeedMode, ZhihuFeedPreviewState>>
  authenticated: boolean
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>
  onModeChange: (mode: ZhihuFeedMode) => void
  onPrefetchMode: (mode: ZhihuFeedMode) => void
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

function ZhihuFeedPeek({
  items,
  loading,
  mode,
}: {
  items: ZhihuContentSummary[]
  loading: boolean
  mode: ZhihuFeedMode
}) {
  if (items.length === 0) {
    return (
      <div className="space-y-3 px-3 sm:px-5" aria-hidden>
        {Array.from({ length: 7 }, (_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-2xl border border-haze/55 bg-ink-raised/36 p-3.5 sm:p-4"
          >
            <div className="flex gap-3.5">
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="h-5 w-[86%] rounded-md bg-haze/55" />
                <div className="h-3.5 w-full rounded bg-haze/40" />
                <div className="h-3.5 w-[74%] rounded bg-haze/35" />
                <div className="h-3 w-16 rounded bg-haze/30" />
              </div>
              {index % 2 === 0 && <div className="aspect-[4/3] w-[31%] max-w-28 shrink-0 rounded-xl bg-haze/45" />}
            </div>
          </div>
        ))}
        {loading && (
          <div className="py-2 text-center font-mono text-[9.5px] tracking-[0.08em] text-paper-faint/55">
            {mode === 'following' ? '正在准备关注动态' : '正在准备内容'}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3 px-3 sm:px-5" aria-hidden>
      {items.slice(0, 60).map((item) => (
        <ZhihuContentRow
          key={`${mode}:${item.ref.kind}:${item.ref.id}`}
          item={item}
          onOpen={() => undefined}
          compact
          showReason={false}
        />
      ))}
    </div>
  )
}

export function ZhihuFeedScreen({
  mode,
  items,
  loading,
  loadingMore,
  hasMore,
  error,
  previews,
  authenticated,
  scrollContainerRef,
  onModeChange,
  onPrefetchMode,
  onRefresh,
  onLoadMore,
  onOpen,
}: Props) {
  const pullSurfaceRef = useRef<HTMLDivElement>(null)
  const swipeTrackRef = useRef<HTMLDivElement>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const loadRequestKeyRef = useRef('')
  const reduced = useReducedMotion()
  const { indicatorRef, phase, cancel: cancelPull } = usePullToRefresh({
    onRefresh,
    containerRef: scrollContainerRef,
    surfaceRef: pullSurfaceRef,
  })

  useEffect(() => {
    loadRequestKeyRef.current = ''
  }, [mode])

  // 与新闻首页保持一致：sentinel 一进入底部预取区就续载。
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

  const modes = useMemo<Array<{ id: ZhihuFeedMode; label: string; enabled: boolean; hint?: string }>>(() => [
    { id: 'recommended', label: '推荐', enabled: true },
    { id: 'hot', label: '热榜', enabled: true },
    { id: 'following', label: '关注', enabled: authenticated, hint: authenticated ? undefined : '登录知乎后可读关注动态' },
  ], [authenticated])

  const activeIndex = Math.max(0, modes.findIndex((item) => item.id === mode))
  const enabledModes = modes.filter((item) => item.enabled)
  const activeEnabledIndex = Math.max(0, enabledModes.findIndex((item) => item.id === mode))
  const prevMode = enabledModes[activeEnabledIndex - 1]
  const nextMode = enabledModes[activeEnabledIndex + 1]

  const neighbourOf = (direction: SwipeDirection) => direction === 'next' ? nextMode : prevMode

  // 当前页稳定后后台预热左右相邻页。公开流优先命中 localStorage，
  // 关注流只保存在当前账号的内存快照里，避免跨账号泄漏。
  useEffect(() => {
    if (loading) return
    const targets = [prevMode?.id, nextMode?.id].filter((value): value is ZhihuFeedMode => Boolean(value))
    if (targets.length === 0) return

    const timer = window.setTimeout(() => {
      targets.forEach(onPrefetchMode)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [loading, mode, nextMode?.id, onPrefetchMode, prevMode?.id])

  const { dragX, transitionMs, containerWidth } = useSwipeCategory({
    containerRef: swipeTrackRef,
    disabled: enabledModes.length < 2,
    reduced,
    canGo: (direction) => Boolean(neighbourOf(direction)),
    onCommit: (direction) => {
      const target = neighbourOf(direction)
      if (target) onModeChange(target.id)
    },
    onHorizontalLock: cancelPull,
  })

  const swipeTransition = transitionMs > 0 ? `transform ${transitionMs}ms var(--ease-ink)` : 'none'
  const indicatorDragPct = containerWidth > 0 ? (-dragX / containerWidth) * 100 : 0
  const dragProgress = containerWidth > 0 ? Math.min(1, Math.abs(dragX) / containerWidth) : 0

  const prevPreview = prevMode ? previews[prevMode.id] : undefined
  const nextPreview = nextMode ? previews[nextMode.id] : undefined

  return (
    <div className="relative mx-auto w-full max-w-3xl">
      <PullIndicator indicatorRef={indicatorRef} phase={phase} />

      <div className="sticky top-0 z-30 border-b border-haze/45 bg-ink/94 px-3 backdrop-blur-xl sm:px-5">
        <div className="flex items-center gap-2">
          <div className="relative grid min-w-0 flex-1 grid-cols-3">
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-0 left-0 flex h-0.5 w-1/3 justify-center"
              style={{
                transform: `translate3d(calc(${activeIndex * 100}% + ${indicatorDragPct}%), 0, 0)`,
                transition: swipeTransition,
              }}
            >
              <span className="h-0.5 w-7 rounded-full bg-cinnabar" />
            </span>
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
                  className={`relative z-10 min-h-12 px-2 text-[13px] transition-colors duration-200 ${
                    active
                      ? 'font-medium text-paper'
                      : item.enabled
                        ? 'text-paper-faint hover:text-paper-muted'
                        : 'cursor-not-allowed text-paper-faint/30'
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
            className="hidden size-9 shrink-0 items-center justify-center rounded-lg text-paper-faint transition-colors hover:bg-paper/5 hover:text-paper disabled:opacity-35 sm:flex"
          >
            <RefreshCw size={15} strokeWidth={1.6} className={loading ? 'animate-spin text-cinnabar-soft' : ''} />
          </button>
        </div>
      </div>

      <div ref={pullSurfaceRef} className="pb-28 pt-3">
        <div ref={swipeTrackRef} className="relative overflow-hidden" style={{ touchAction: 'pan-y' }}>
          {dragX > 0 && prevMode && (
            <div
              className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-ink"
              style={{
                transform: `translate3d(calc(${dragX}px - 100%), 0, 0)`,
                transition: swipeTransition,
                backfaceVisibility: 'hidden',
                opacity: 0.86 + dragProgress * 0.14,
              }}
              aria-hidden
            >
              <ZhihuFeedPeek
                items={prevPreview?.items ?? []}
                loading={prevPreview?.loading ?? true}
                mode={prevMode.id}
              />
            </div>
          )}

          <div
            className="relative z-10"
            style={{
              transform: dragX === 0 && transitionMs === 0 ? undefined : `translate3d(${dragX}px, 0, 0)`,
              transition: swipeTransition,
              backfaceVisibility: dragX === 0 && transitionMs === 0 ? undefined : 'hidden',
              boxShadow: dragX === 0 ? undefined : '0 0 32px rgb(0 0 0 / 0.08)',
            }}
          >
            {error && <div className="mb-3 px-4 sm:px-6"><ZhihuErrorBanner>{errorMessage(error)}</ZhihuErrorBanner></div>}

            {loading && items.length === 0 ? (
              <div className="px-4 sm:px-6"><ZhihuLoadingState label="正在读取知乎…" /></div>
            ) : items.length === 0 && !error ? (
              <div className="px-4 sm:px-6">
                <ZhihuEmptyState
                  title="没有可显示的内容"
                  description={mode === 'following' ? '关注动态需要登录知乎后读取。' : '稍后下拉刷新再试。'}
                />
              </div>
            ) : (
              <div className="space-y-3 px-3 sm:px-5">
                {items.map((item) => (
                  <ZhihuContentRow key={`${item.ref.kind}:${item.ref.id}`} item={item} onOpen={onOpen} compact showReason={false} />
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

          {dragX < 0 && nextMode && (
            <div
              className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-ink"
              style={{
                transform: `translate3d(calc(${dragX}px + 100%), 0, 0)`,
                transition: swipeTransition,
                backfaceVisibility: 'hidden',
                opacity: 0.86 + dragProgress * 0.14,
              }}
              aria-hidden
            >
              <ZhihuFeedPeek
                items={nextPreview?.items ?? []}
                loading={nextPreview?.loading ?? true}
                mode={nextMode.id}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
