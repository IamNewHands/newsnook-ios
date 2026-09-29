import { type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import type { PanelBox } from '../hooks/useAnchoredPanel'

interface AnchoredPanelProps {
  /** 位置：由 useAnchoredPanel 给出；为 null 时不渲染 */
  box: PanelBox | null
  panelRef: RefObject<HTMLDivElement | null>
  /** 面板的无障碍名称 */
  ariaLabel: string
  /** 关闭按钮的无障碍名称 */
  closeLabel: string
  /** 面板顶部的等宽小标题（可含计数） */
  title: ReactNode
  onClose: () => void
  children: ReactNode
}

/** 挂到 document.body 的展开面板外壳；定位与交互见 `useAnchoredPanel` */
export function AnchoredPanel({
  box,
  panelRef,
  ariaLabel,
  closeLabel,
  title,
  onClose,
  children,
}: AnchoredPanelProps) {
  if (!box) return null
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      className="fixed z-[70] flex flex-col overflow-hidden rounded-2xl border border-haze/90 bg-ink-raised/98 text-paper shadow-[0_18px_48px_-18px_rgba(0,0,0,0.72),0_2px_10px_rgba(0,0,0,0.28)]"
      style={{ left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-haze/70 px-3 py-2">
        <span className="font-mono text-[10px] tracking-[0.16em] text-paper-faint">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="flex h-6 w-6 items-center justify-center rounded-full text-paper-muted transition-colors hover:bg-paper/10 hover:text-paper"
        >
          <X size={13} strokeWidth={1.8} />
        </button>
      </div>
      {children}
    </div>,
    document.body,
  )
}