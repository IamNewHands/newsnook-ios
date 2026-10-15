import { haptics } from '../lib/haptics'

interface Option<T> {
  label: string
  value: T
}

interface Props<T> {
  label: string
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
}

/** 墨砚风格分段选择：等分格子，配备硬件加速的连续滑动高亮滑块 */
export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: Props<T>) {
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const count = options.length || 1

  return (
    <div
      role="group"
      aria-label={label}
      className="relative flex rounded-xl border border-haze bg-ink-raised/50 p-1"
    >
      {/* 连续滑动滑块指示器 */}
      {activeIndex >= 0 && (
        <div
          aria-hidden="true"
          className="absolute inset-y-1 rounded-lg border border-cinnabar/30 bg-cinnabar/20 shadow-xs transition-transform duration-260 ease-[var(--ease-ink,cubic-bezier(0.22,1,0.36,1))]"
          style={{
            width: `calc((100% - 8px) / ${count})`,
            transform: `translate3d(calc(${activeIndex * 100}% ), 0, 0)`,
          }}
        />
      )}

      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (!active) {
                void haptics.tick()
                onChange(option.value)
              }
            }}
            className={`relative z-10 flex-1 rounded-lg py-2 text-[12.5px] font-medium transition-all duration-200 active:scale-[0.96] ${
              active ? 'text-paper' : 'text-paper-faint hover:text-paper-muted'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
