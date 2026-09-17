import { useCallback, useEffect, useRef, useState } from 'react'
import { Bookmark, BookmarkCheck, CircleMinus, X } from 'lucide-react'
import type { NewsSource } from '../sources/registry'

interface Props {
  sources: NewsSource[]
  selectedSourceId: string | null
  onSelect: (sourceId: string | null) => void
  favoriteSourceIds?: readonly string[]
  onToggleFavorite?: (sourceId: string) => void
  onRemoveSource?: (sourceId: string) => void
  /** 可选：每个信源的文章数量统计 */
  counts?: Record<string, number>
}

const LONG_PRESS_MS = 520
const MOVE_CANCEL_PX = 10

export function SourceFilterChips({
  sources,
  selectedSourceId,
  onSelect,
  favoriteSourceIds = [],
  onToggleFavorite,
  onRemoveSource,
  counts,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pressTimerRef = useRef<number | null>(null)
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null)
  const suppressClickRef = useRef<string | null>(null)
  const suppressClearTimerRef = useRef<number | null>(null)
  const [actionSourceId, setActionSourceId] = useState<string | null>(null)

  const clearPress = useCallback(() => {
    if (pressTimerRef.current !== null) window.clearTimeout(pressTimerRef.current)
    pressTimerRef.current = null
    pressOriginRef.current = null
  }, [])

  const suppressNextClick = useCallback((sourceId: string) => {
    suppressClickRef.current = sourceId
    if (suppressClearTimerRef.current !== null) window.clearTimeout(suppressClearTimerRef.current)
    suppressClearTimerRef.current = window.setTimeout(() => {
      if (suppressClickRef.current === sourceId) suppressClickRef.current = null
      suppressClearTimerRef.current = null
    }, 900)
  }, [])

  useEffect(() => () => {
    clearPress()
    if (suppressClearTimerRef.current !== null) window.clearTimeout(suppressClearTimerRef.current)
  }, [clearPress])

  const openActions = useCallback((sourceId: string, suppressClick = false) => {
    clearPress()
    if (suppressClick) suppressNextClick(sourceId)
    setActionSourceId(sourceId)
  }, [clearPress, suppressNextClick])

  const startPress = useCallback((sourceId: string, x: number, y: number) => {
    clearPress()
    pressOriginRef.current = { x, y }
    pressTimerRef.current = window.setTimeout(() => openActions(sourceId, true), LONG_PRESS_MS)
  }, [clearPress, openActions])

  const movePress = useCallback((x: number, y: number) => {
    const origin = pressOriginRef.current
    if (!origin) return
    if (Math.hypot(x - origin.x, y - origin.y) > MOVE_CANCEL_PX) clearPress()
  }, [clearPress])

  const handleSourceClick = useCallback((sourceId: string, isSelected: boolean) => {
    if (suppressClickRef.current === sourceId) {
      suppressClickRef.current = null
      return
    }
    onSelect(isSelected ? null : sourceId)
  }, [onSelect])

  useEffect(() => {
    if (!actionSourceId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionSourceId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [actionSourceId])

  if (!sources.length) return null

  const actionSource = actionSourceId ? sources.find((source) => source.id === actionSourceId) : undefined
  const actionIsFavorite = actionSource ? favoriteSourceIds.includes(actionSource.id) : false

  return (
    <div className="relative w-full">
      <div
        ref={containerRef}
        className="horizontal-scroll-rail scroll-hidden max-w-[2400px] mx-auto flex items-center gap-1.5 overflow-x-auto px-4 lg:px-6 xl:px-8 2xl:px-10 py-0.5 select-none"
      >
        {sources.length > 1 && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`group flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 font-mono text-[10.5px] transition-all duration-200 active:scale-95 ${
              selectedSourceId === null
                ? 'bg-paper text-ink font-medium shadow-2xs ring-1 ring-paper/25'
                : 'border border-haze/80 bg-ink-raised/60 text-paper-muted/90 hover:border-paper-faint/50 hover:bg-ink-raised hover:text-paper'
            }`}
          >
            <span>全部</span>
            <span className={`font-mono text-[9px] leading-none ${selectedSourceId === null ? 'text-ink/75 font-semibold' : 'text-paper-faint/80 group-hover:text-paper-muted'}`}>
              {sources.length}
            </span>
          </button>
        )}

        {sources.map((source) => {
          const isSelected = selectedSourceId === source.id
          const count = counts?.[source.id]
          const favorite = favoriteSourceIds.includes(source.id)
          return (
            <button
              key={source.id}
              type="button"
              onClick={() => handleSourceClick(source.id, isSelected)}
              onPointerDown={(event) => startPress(source.id, event.clientX, event.clientY)}
              onPointerMove={(event) => movePress(event.clientX, event.clientY)}
              onPointerUp={clearPress}
              onPointerCancel={clearPress}
              onPointerLeave={clearPress}
              onContextMenu={(event) => {
                event.preventDefault()
                openActions(source.id)
              }}
              aria-haspopup="dialog"
              aria-label={`${source.name}${favorite ? '，已收藏' : ''}，长按管理`}
              className={`group flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-[10.5px] transition-all duration-200 active:scale-95 ${
                isSelected
                  ? 'bg-paper text-ink font-medium shadow-2xs ring-1 ring-paper/25'
                  : 'border border-haze/80 bg-ink-raised/60 text-paper-muted/90 hover:border-paper-faint/50 hover:bg-ink-raised hover:text-paper'
              }`}
            >
              <span className="truncate max-w-[140px]">{source.name}</span>
              {favorite && <BookmarkCheck size={10} strokeWidth={1.8} className={isSelected ? 'text-ink/75' : 'text-cinnabar-soft'} />}
              {typeof count === 'number' && (
                <span className={`font-mono text-[9px] leading-none ${isSelected ? 'text-ink/75 font-semibold' : 'text-paper-faint/80 group-hover:text-paper-muted'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {actionSource && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 px-3 pb-[max(12px,var(--sab))] backdrop-blur-[2px]"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setActionSourceId(null)
          }}
        >
          <div role="dialog" aria-modal="true" aria-label={`管理信源 ${actionSource.name}`} className="w-full max-w-md rounded-2xl border border-haze bg-ink-raised p-2 shadow-2xl">
            <div className="flex items-center justify-between gap-3 px-2 py-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-paper">{actionSource.name}</p>
                <p className="mt-0.5 font-mono text-[10px] text-paper-faint">当前预设 · 信源管理</p>
              </div>
              <button type="button" onClick={() => setActionSourceId(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-paper-muted hover:bg-paper/10 hover:text-paper" aria-label="关闭信源管理">
                <X size={16} />
              </button>
            </div>

            {onToggleFavorite && (
              <button type="button" onClick={() => { onToggleFavorite(actionSource.id); setActionSourceId(null) }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[13px] text-paper transition-colors hover:bg-paper/10 active:bg-paper/15">
                {actionIsFavorite ? <BookmarkCheck size={17} className="text-cinnabar-soft" /> : <Bookmark size={17} className="text-cinnabar-soft" />}
                <span>{actionIsFavorite ? '取消收藏' : '收藏到当前预设'}</span>
              </button>
            )}

            {onRemoveSource && (
              <button type="button" onClick={() => { onRemoveSource(actionSource.id); setActionSourceId(null) }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[13px] text-cinnabar-soft transition-colors hover:bg-cinnabar/10 active:bg-cinnabar/15">
                <CircleMinus size={17} />
                <span>从当前分类移出</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
