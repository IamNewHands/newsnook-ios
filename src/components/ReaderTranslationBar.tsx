import { memo } from 'react'
import { Columns2, FileText, Undo2, X } from 'lucide-react'

import { haptics } from '../lib/haptics'
import type { ReaderTranslationMode } from './ReaderTranslationMenu'

interface Props {
  visible: boolean
  currentMode: ReaderTranslationMode
  onSelectMode: (mode: ReaderTranslationMode) => void
  onDismiss?: () => void
}

/**
 * 正文内悬浮翻译模式切换胶囊：
 * 贴合用户大拇指操作区，支持在「原文 / 双语对照 / 仅显示译文」间零延迟瞬间切换。
 */
export const ReaderTranslationBar = memo(function ReaderTranslationBar({
  visible,
  currentMode,
  onSelectMode,
  onDismiss,
}: Props) {
  const handleSelect = (mode: ReaderTranslationMode) => {
    if (mode === currentMode) return
    void haptics.selection()
    onSelectMode(mode)
  }

  const MODES: Array<{ id: ReaderTranslationMode; label: string; Icon: typeof Columns2 }> = [
    { id: 'original', label: '原文', Icon: Undo2 },
    { id: 'compare', label: '双语', Icon: Columns2 },
    { id: 'replace', label: '纯译文', Icon: FileText },
  ]

  const activeIndex = MODES.findIndex((m) => m.id === currentMode)

  return (
    <aside
      aria-label="正文翻译切换快捷栏"
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-30 transition-all duration-300 ease-[var(--ease-ink)] pointer-events-auto safe-bottom-6 ${
        visible
          ? 'opacity-100 translate-y-0 scale-100'
          : 'opacity-0 translate-y-8 scale-90 pointer-events-none'
      }`}
    >
      <div className="relative flex items-center rounded-full border border-haze/90 bg-ink/94 p-1 shadow-2xl shadow-black/45 backdrop-blur-md">
        {/* 动态平滑滑块指示器 */}
        {activeIndex >= 0 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1 bottom-1 left-1 rounded-full border border-cinnabar/30 bg-cinnabar/20 shadow-xs transition-transform duration-260 ease-[var(--ease-ink,cubic-bezier(0.22,1,0.36,1))]"
            style={{
              width: '64px',
              transform: `translate3d(${activeIndex * 64}px, 0, 0)`,
            }}
          />
        )}

        {MODES.map(({ id, label, Icon }) => {
          const active = currentMode === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => handleSelect(id)}
              className={`relative z-10 flex h-7.5 w-16 items-center justify-center gap-1.5 rounded-full transition-colors duration-200 active:scale-95 ${
                active ? 'text-cinnabar font-medium' : 'text-paper-muted hover:text-paper'
              }`}
            >
              <Icon size={12.5} strokeWidth={active ? 2 : 1.6} />
              <span className="font-display text-[12px] leading-none tracking-[0.02em]">
                {label}
              </span>
            </button>
          )
        })}

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="隐藏快捷切换栏"
            title="隐藏快捷切换栏（可随时在顶部重新打开）"
            className="relative z-10 -mr-0.5 ml-1 flex size-6 items-center justify-center rounded-full text-paper-faint transition hover:bg-haze/40 hover:text-paper"
          >
            <X size={12} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </aside>
  )
})
