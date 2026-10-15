import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** 面板与视口边缘的安全距离 */
const PANEL_MARGIN = 12
const PANEL_MIN_WIDTH = 260
const PANEL_MAX_WIDTH = 460
const PANEL_MAX_HEIGHT = 420
const PANEL_MIN_HEIGHT = 180

export interface PanelBox {
  left: number
  top: number
  width: number
  maxHeight: number
}

/**
 * 面板贴在触发按钮正下方，并夹在视口内：
 * 横向不越界，纵向高度按剩余空间收缩，保证底部的选项仍能滚到。
 */
export function resolvePanelBox(anchor: DOMRect): PanelBox {
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

interface UseAnchoredPanelOptions {
  open: boolean
  /** 触发按钮：面板贴在它正下方，点它不算「点面板外面」 */
  triggerRef: RefObject<HTMLElement | null>
  onClose: () => void
}

/**
 * 「触发按钮 + 展开面板」的公共行为：定位、视口变化重算、点外收起、Esc 收起。
 *
 * 面板必须经 portal 挂到 document.body：头部有 `backdrop-blur`，会成为 `fixed`
 * 后代的包含块，直接放在里面定位会错。点外用 `pointerdown` 判定，不加遮罩。
 */
export function useAnchoredPanel({ open, triggerRef, onClose }: UseAnchoredPanelOptions) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<PanelBox | null>(null)

  const updateBox = useCallback(() => {
    const anchor = triggerRef.current?.getBoundingClientRect()
    if (!anchor) return
    setBox(resolvePanelBox(anchor))
  }, [triggerRef])

  useLayoutEffect(() => {
    if (!open) {
      setBox(null)
      return
    }
    updateBox()
  }, [open, updateBox])

  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', updateBox)
    window.visualViewport?.addEventListener('resize', updateBox)
    return () => {
      window.removeEventListener('resize', updateBox)
      window.visualViewport?.removeEventListener('resize', updateBox)
    }
  }, [open, updateBox])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, open, triggerRef])

  return { panelRef, box }
}