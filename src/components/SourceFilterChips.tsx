import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bookmark, BookmarkCheck, ChevronDown, CircleMinus, Search, X } from 'lucide-react'

import { useLongPressAction } from '../hooks/useLongPressAction'
import type { Point } from '../lib/contextActions'
import type { NewsSource } from '../sources/registry'
import { ContextActionMenu, type ContextActionItem } from './ContextActionMenu'

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

/** 信源多到这个数才给搜索框；再少的话面板本来就一屏放得下 */
const SEARCH_THRESHOLD = 12
const PANEL_MARGIN = 12
const PANEL_MIN_WIDTH = 260
const PANEL_MAX_WIDTH = 460
const PANEL_MAX_HEIGHT = 420
const PANEL_MIN_HEIGHT = 180

interface PanelBox {
  left: number
  top: number
  width: number
  maxHeight: number
}

/**
 * 面板贴在触发按钮正下方，并夹在视口内：
 * 横向不越界，纵向高度按剩余空间收缩，保证底部的信源仍能滚到。
 */
function resolvePanelBox(anchor: DOMRect): PanelBox {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.max(
    PANEL_MIN_WIDTH,
    Math.min(PANEL_MAX_WIDTH, viewportWidth - PANEL_MARGIN * 2),
  )
  const left = Math.min(
    Math.max(PANEL_MARGIN, anchor.left),
    Math.max(PANEL_MARGIN, viewportWidth - width - PANEL_MARGIN),
  )
  const top = anchor.bottom + 6
  const maxHeight = Math.max(
    PANEL_MIN_HEIGHT,
    Math.min(PANEL_MAX_HEIGHT, viewportHeight - top - PANEL_MARGIN),
  )
  return { left, top, width, maxHeight }
}

/**
 * 信源筛选入口：一个按钮 + 点击展开的小面板。
 *
 * 早期版本把信源铺成一条横向滚动轨道，预设里信源一多（「推荐」分类是预设内全部信源）
 * 就得左右滑着找，既看不到全貌也不好定位。现在入口只占一行，
 * 展开后是换行排布的胶囊网格，配搜索框，长按仍是原有的收藏 / 移出菜单。
 */
export function SourceFilterChips({
  sources,
  selectedSourceId,
  onSelect,
  favoriteSourceIds = [],
  onToggleFavorite,
  onRemoveSource,
  counts,
}: Props) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [box, setBox] = useState<PanelBox | null>(null)
  const [actionMenu, setActionMenu] = useState<{ sourceId: string; anchor: Point } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const longPress = useLongPressAction<string>((sourceId, anchor) => {
    setActionMenu({ sourceId, anchor })
  })

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId),
    [selectedSourceId, sources],
  )

  const filteredSources = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return sources
    return sources.filter(
      (source) =>
        source.name.toLowerCase().includes(keyword) ||
        source.label.toLowerCase().includes(keyword),
    )
  }, [query, sources])

  const updateBox = useCallback(() => {
    const anchor = triggerRef.current?.getBoundingClientRect()
    if (!anchor) return
    setBox(resolvePanelBox(anchor))
  }, [])

  useLayoutEffect(() => {
    if (!panelOpen) {
      setBox(null)
      return
    }
    updateBox()
  }, [panelOpen, updateBox])

  useEffect(() => {
    if (!panelOpen) return
    window.addEventListener('resize', updateBox)
    window.visualViewport?.addEventListener('resize', updateBox)
    return () => {
      window.removeEventListener('resize', updateBox)
      window.visualViewport?.removeEventListener('resize', updateBox)
    }
  }, [panelOpen, updateBox])

  // 点面板外面收起：用 pointerdown 而不是加一层遮罩，
  // 头部有 backdrop-blur，fixed 遮罩会被它的包含块困住，尺寸不对。
  useEffect(() => {
    if (!panelOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setPanelOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanelOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [panelOpen])

  if (!sources.length) return null

  const actionSource = actionMenu
    ? sources.find((source) => source.id === actionMenu.sourceId)
    : undefined
  const actionIsFavorite = actionSource ? favoriteSourceIds.includes(actionSource.id) : false
  const actionItems: ContextActionItem[] = actionSource
    ? [
        ...(onToggleFavorite
          ? [
              {
                id: 'favorite',
                label: actionIsFavorite ? '取消收藏' : '收藏到当前预设',
                icon: actionIsFavorite ? BookmarkCheck : Bookmark,
                tone: 'accent' as const,
                onSelect: () => onToggleFavorite(actionSource.id),
              },
            ]
          : []),
        ...(onRemoveSource
          ? [
              {
                id: 'remove',
                label: '从当前分类移出',
                icon: CircleMinus,
                tone: 'danger' as const,
                onSelect: () => onRemoveSource(actionSource.id),
              },
            ]
          : []),
      ]
    : []

  const manageHint = Boolean(onToggleFavorite || onRemoveSource)
  const selectedCount = selectedSource ? counts?.[selectedSource.id] : undefined
  const totalCount = selectedSource ? selectedCount : sources.length

  const renderPill = (source: NewsSource | null) => {
    const isAll = source === null
    const isSelected = isAll ? selectedSourceId === null : selectedSourceId === source.id
    const sourceId = source?.id ?? ''
    const count = isAll ? sources.length : counts?.[sourceId]
    const favorite = !isAll && favoriteSourceIds.includes(sourceId)
    return (
      <button
        key={isAll ? '__all__' : sourceId}
        type="button"
        role="radio"
        aria-checked={isSelected}
        onClick={() => {
          if (!isAll && longPress.consumeClick(sourceId)) return
          onSelect(isAll ? null : sourceId)
          setPanelOpen(false)
        }}
        onPointerDown={(event) => {
          if (!isAll) longPress.start(sourceId, event)
        }}
        onPointerMove={longPress.move}
        onPointerUp={longPress.cancel}
        onPointerCancel={longPress.cancel}
        onPointerLeave={longPress.cancel}
        onContextMenu={(event) => {
          event.preventDefault()
          if (isAll) return
          setActionMenu({
            sourceId,
            anchor: { x: event.clientX, y: event.clientY },
          })
        }}
        aria-haspopup={isAll ? undefined : 'menu'}
        aria-label={
          isAll
            ? `全部信源，共 ${sources.length} 个`
            : `${source.name}${favorite ? '，已收藏' : ''}${manageHint ? '，长按管理' : ''}`
        }
        className={`flex max-w-full shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] transition-all duration-200 active:scale-95 ${
          isSelected
            ? 'bg-paper font-medium text-ink shadow-2xs ring-1 ring-paper/25'
            : 'border border-haze/80 bg-ink-raised/60 text-paper-muted/90 hover:border-paper-faint/50 hover:bg-ink-raised hover:text-paper'
        }`}
        style={{ WebkitTouchCallout: 'none' }}
      >
        <span className="max-w-[150px] truncate">{isAll ? '全部信源' : source.name}</span>
        {favorite && (
          <BookmarkCheck
            size={10}
            strokeWidth={1.8}
            className={isSelected ? 'text-ink/75' : 'text-cinnabar-soft'}
          />
        )}
        {typeof count === 'number' && (
          <span
            className={`font-mono text-[9.5px] leading-none ${
              isSelected ? 'font-semibold text-ink/75' : 'text-paper-faint/80'
            }`}
          >
            {count}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="relative w-full">
      <div className="page-x lg:px-6 xl:px-8 2xl:px-10 mx-auto flex max-w-[2400px] items-center gap-1.5 py-0.5 select-none">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            setQuery('')
            setPanelOpen((open) => !open)
          }}
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          aria-label={
            selectedSource
              ? `信源筛选：${selectedSource.name}，点击更换`
              : `信源筛选：全部信源，共 ${sources.length} 个，点击展开`
          }
          className={`flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[11.5px] transition-all duration-200 active:scale-95 ${
            panelOpen
              ? 'border border-paper-faint/60 bg-ink-raised text-paper'
              : selectedSource
                ? 'bg-paper font-medium text-ink shadow-2xs ring-1 ring-paper/25'
                : 'border border-haze/80 bg-ink-raised/60 text-paper-muted/90 hover:border-paper-faint/50 hover:bg-ink-raised hover:text-paper'
          }`}
        >
          <span className="max-w-[46vw] truncate lg:max-w-none">
            {selectedSource ? selectedSource.name : '全部信源'}
          </span>
          {typeof totalCount === 'number' && (
            <span
              className={`font-mono text-[9.5px] leading-none ${
                selectedSource && !panelOpen ? 'font-semibold text-ink/75' : 'text-paper-faint/80'
              }`}
            >
              {totalCount}
            </span>
          )}
          <ChevronDown
            size={12}
            strokeWidth={2}
            className={`shrink-0 transition-transform duration-200 ${panelOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {selectedSource && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-label="取消信源筛选，显示全部"
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-haze/80 bg-ink-raised/60 text-paper-muted transition-colors hover:border-paper-faint/50 hover:text-paper active:scale-95"
          >
            <X size={12} strokeWidth={2} />
          </button>
        )}
      </div>

      {panelOpen &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="选择信源"
            className="fixed z-[70] flex flex-col overflow-hidden rounded-2xl border border-haze/90 bg-ink-raised/98 text-paper shadow-[0_18px_48px_-18px_rgba(0,0,0,0.72),0_2px_10px_rgba(0,0,0,0.28)]"
            style={{ left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-haze/70 px-3 py-2">
              <span className="font-mono text-[10px] tracking-[0.16em] text-paper-faint">
                信源 · {filteredSources.length}
                {selectedSource ? ' · 已选 1' : ''}
              </span>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                aria-label="关闭信源面板"
                className="flex h-6 w-6 items-center justify-center rounded-full text-paper-muted transition-colors hover:bg-paper/10 hover:text-paper"
              >
                <X size={13} strokeWidth={1.8} />
              </button>
            </div>

            {sources.length > SEARCH_THRESHOLD && (
              <div className="px-3 pt-2.5">
                <div className="relative">
                  <Search
                    size={13}
                    className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-paper-faint"
                  />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索信源…"
                    aria-label="搜索信源"
                    className="w-full rounded-lg border border-haze bg-ink py-1.5 pr-2.5 pl-7 text-[12.5px] text-paper placeholder:text-paper-faint/60 focus:border-cinnabar/50 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div
              role="radiogroup"
              aria-label="信源列表"
              className="flex min-h-0 flex-1 flex-wrap content-start gap-1.5 overflow-y-auto px-3 py-2.5"
            >
              {renderPill(null)}
              {filteredSources.map((source) => renderPill(source))}
              {!filteredSources.length && (
                <p className="w-full py-6 text-center text-[12px] text-paper-faint">
                  没有匹配「{query.trim()}」的信源
                </p>
              )}
            </div>

            {manageHint && (
              <p className="border-t border-haze/70 px-3 py-2 font-mono text-[9.5px] leading-relaxed text-paper-faint">
                长按信源可收藏到当前预设或从分类移出
              </p>
            )}
          </div>,
          document.body,
        )}

      <ContextActionMenu
        open={Boolean(actionSource && actionMenu)}
        anchor={actionMenu?.anchor ?? { x: 0, y: 0 }}
        title={actionSource?.name ?? ''}
        caption="当前预设 · 信源管理"
        actions={actionItems}
        onClose={() => setActionMenu(null)}
      />
    </div>
  )
}
