import { memo } from 'react'
import { LayoutGrid, List } from 'lucide-react'

import { haptics } from '../lib/haptics'
import type { HomeFeedLayout } from '../sources/preferences'

interface Props {
  layout: HomeFeedLayout
  onChange: (layout: HomeFeedLayout) => void
  className?: string
}

/**
 * 顶部卡片 / 列表版式优雅切换组件：
 * 采用墨砚胶囊轨道与连续水墨滑块，支持触感振动与无障碍语义。
 */
export const FeedLayoutSwitcher = memo(function FeedLayoutSwitcher({
  layout,
  onChange,
  className = '',
}: Props) {
  const isCards = layout === 'cards'

  const handleSelect = (next: HomeFeedLayout) => {
    if (next === layout) return
    void haptics.selection()
    onChange(next)
  }

  return (
    <div
      role="radiogroup"
      aria-label="视图布局"
      className={`relative inline-flex h-8 items-center rounded-full border border-haze/70 bg-ink-raised/50 p-[2.5px] backdrop-blur-md transition-colors hover:border-paper-faint/30 ${className}`}
    >
      {/* 连续平滑滑动指示滑块 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-[2.5px] bottom-[2.5px] left-[2.5px] w-[27px] rounded-full border border-cinnabar/30 bg-cinnabar/15 shadow-xs transition-transform duration-260 ease-[var(--ease-ink,cubic-bezier(0.22,1,0.36,1))]"
        style={{
          transform: isCards ? 'translate3d(0, 0, 0)' : 'translate3d(27px, 0, 0)',
        }}
      />

      {/* 双栏卡片 */}
      <button
        type="button"
        role="radio"
        aria-checked={isCards}
        aria-label="卡片视图"
        title="双栏卡片"
        onClick={() => handleSelect('cards')}
        className={`relative z-10 flex h-[27px] w-[27px] items-center justify-center rounded-full transition-colors duration-200 active:scale-95 ${
          isCards ? 'text-cinnabar' : 'text-paper-muted/80 hover:text-paper'
        }`}
      >
        <LayoutGrid size={14} strokeWidth={1.7} />
      </button>

      {/* 经典列表 */}
      <button
        type="button"
        role="radio"
        aria-checked={!isCards}
        aria-label="列表视图"
        title="经典列表"
        onClick={() => handleSelect('classic')}
        className={`relative z-10 flex h-[27px] w-[27px] items-center justify-center rounded-full transition-colors duration-200 active:scale-95 ${
          !isCards ? 'text-cinnabar' : 'text-paper-muted/80 hover:text-paper'
        }`}
      >
        <List size={14} strokeWidth={1.7} />
      </button>
    </div>
  )
})
