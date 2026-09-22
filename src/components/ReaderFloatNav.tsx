import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface Props {
  /** 正文滚动容器；翻页与位置换算都基于它 */
  targetRef: RefObject<HTMLElement | null>
}

/**
 * 悬浮「上下翻页」按钮组：竖排的 ▲ / ▼ 两个按钮，点一下翻一屏。
 * 整组按钮都可拖动——按住任意位置拖即移动，轻点才算翻页。
 * 位置持久化到 localStorage（`newsnook:reader-float-nav`）。
 *
 * 拖动 vs 点击：pointer 位移超过阈值即判定为拖动，并在 pointerup 后抑制那次 click，
 * 避免拖完手一松又翻一屏。容器上 `touch-action: none` 让浏览器不抢手势。
 */
const DRAG_THRESHOLD = 6
const PAGE_FACTOR = 0.9
/** 默认位置：右侧偏下，便于单手拇指够到。{x, y} 为视口比例，落点用客户端坐标换算。 */
const DEFAULT_POS = { x: 0.86, y: 0.6 }
const STORAGE_KEY = 'newsnook:reader-float-nav'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

interface StoredPos {
  x: number
  y: number
}

function readStoredPos(): StoredPos {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_POS }
    const parsed = JSON.parse(raw) as Partial<StoredPos>
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return { ...DEFAULT_POS }
    return { x: clamp(parsed.x, 0, 1), y: clamp(parsed.y, 0, 1) }
  } catch {
    return { ...DEFAULT_POS }
  }
}

export function ReaderFloatNav({ targetRef }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<StoredPos>(readStoredPos)
  const draggingRef = useRef(false)
  const movedRef = useRef(false)
  const startPointerRef = useRef<{
    pointerId: number
    x: number
    y: number
    posX: number
    posY: number
  } | null>(null)
  const [dragging, setDragging] = useState(false)

  const paintPosition = useCallback((x: number, y: number) => {
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const localX = clamp(x, 0, Math.max(0, window.innerWidth - rect.width))
    const localY = clamp(y, 0, Math.max(0, window.innerHeight - rect.height))
    root.style.left = `${localX}px`
    root.style.top = `${localY}px`
  }, [])

  useEffect(() => {
    paintPosition(pos.x * window.innerWidth, pos.y * window.innerHeight)
  }, [pos, paintPosition])

  const persist = useCallback((x: number, y: number) => {
    const nextX = clamp(x / Math.max(1, window.innerWidth), 0, 1)
    const nextY = clamp(y / Math.max(1, window.innerHeight), 0, 1)
    setPos({ x: nextX, y: nextY })
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: nextX, y: nextY }))
    } catch {
      /* 存储不可用时忽略，仅当次会话有效 */
    }
  }, [])

  const scrollByPage = useCallback(
    (direction: 1 | -1) => {
      const target = targetRef.current
      if (!target) return
      // 与 ReaderScrollIndicator 的 PageUp/PageDown 保持一致：翻 0.9 屏。
      target.scrollBy({ top: direction * target.clientHeight * PAGE_FACTOR, behavior: 'smooth' })
    },
    [targetRef],
  )

  const onRootPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // 整个按钮组都能拖；同一时刻只认一根手指。
    if (event.button !== 0) return
    if (draggingRef.current || startPointerRef.current) return
    const root = rootRef.current
    if (!root) return
    // 只挡外层（阅读器手势/翻页点击），不 preventDefault——否则按钮的 click 会丢。
    event.stopPropagation()
    const rect = root.getBoundingClientRect()
    startPointerRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      posX: rect.left,
      posY: rect.top,
    }
    movedRef.current = false
    draggingRef.current = true
    setDragging(true)
  }

  useEffect(() => {
    if (!dragging) return
    const onPointerMove = (event: globalThis.PointerEvent) => {
      const start = startPointerRef.current
      if (!start || start.pointerId !== event.pointerId) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (!movedRef.current && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        movedRef.current = true
      }
      if (!movedRef.current) return
      event.preventDefault()
      paintPosition(start.posX + dx, start.posY + dy)
    }
    const onPointerEnd = (event: globalThis.PointerEvent) => {
      const start = startPointerRef.current
      if (!start || start.pointerId !== event.pointerId) return
      draggingRef.current = false
      setDragging(false)
      if (movedRef.current) {
        const nextX = start.posX + (event.clientX - start.x)
        const nextY = start.posY + (event.clientY - start.y)
        paintPosition(nextX, nextY)
        persist(nextX, nextY)
      }
      startPointerRef.current = null
      // 注意：movedRef 留到下一次 pointerdown 才复位——button 的 click 在 pointerup
      // 之后才派发，这里清掉会让拖完那一下又被当成点击。
    }
    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerEnd)
    window.addEventListener('pointercancel', onPointerEnd)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
      // 组件卸载时若还在拖，复位拖动状态，避免脏引用或无指针时仍处于 dragging。
      draggingRef.current = false
      startPointerRef.current = null
    }
  }, [dragging, paintPosition, persist])

  const onNavClick = (direction: 1 | -1) => (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    // 刚刚是拖动而不是点击：不翻页。
    if (movedRef.current) return
    scrollByPage(direction)
  }

  return (
    <div
      ref={rootRef}
      data-reader-float-nav
      role="group"
      aria-label="上下翻页"
      onPointerDown={onRootPointerDown}
      className={`fixed z-[60] flex select-none flex-col overflow-hidden rounded-2xl border border-haze/40 bg-ink/45 text-paper shadow-lg backdrop-blur-md transition-opacity duration-200 ${
        dragging ? 'cursor-grabbing opacity-100 ring-1 ring-cinnabar/50' : 'cursor-grab opacity-65 hover:opacity-100'
      }`}
      style={{ touchAction: 'none' }}
    >
      <button
        type="button"
        aria-label="上一屏"
        title="上一屏（可拖动整组按钮换位置）"
        onClick={onNavClick(-1)}
        className="flex h-11 w-11 items-center justify-center text-paper/85 transition-colors hover:bg-ink-raised/60 active:bg-ink-raised/80"
      >
        <ChevronUp size={20} aria-hidden />
      </button>
      <span aria-hidden className="h-px w-full bg-haze/30" />
      <button
        type="button"
        aria-label="下一屏"
        title="下一屏（可拖动整组按钮换位置）"
        onClick={onNavClick(1)}
        className="flex h-11 w-11 items-center justify-center text-paper/85 transition-colors hover:bg-ink-raised/60 active:bg-ink-raised/80"
      >
        <ChevronDown size={20} aria-hidden />
      </button>
    </div>
  )
}