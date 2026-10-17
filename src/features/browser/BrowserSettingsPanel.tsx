import type { KeyboardEvent } from 'react'
import { Check, Circle, PanelBottom, PanelTop, Trash2, type LucideIcon } from 'lucide-react'
import { BrowserPageHeader } from './BrowserPrimitives'
import { ToggleSwitch } from '../../components/ToggleSwitch'

export type BrowserSearchChoice = 'bing' | 'google' | 'baidu' | 'duckduckgo'

interface BrowserSettingsPanelProps {
  search: BrowserSearchChoice
  bottomAddress: boolean
  desktop: boolean
  hasPage: boolean
  pending?: boolean
  historyCount: number
  onBack: () => void
  onSearchChange: (id: BrowserSearchChoice) => void
  onAddressPositionChange: (bottom: boolean) => void
  onDesktopChange: () => void
  onClearHistory: () => void
}

interface Choice<T extends string> {
  id: T
  label: string
  icon?: LucideIcon
}

const searchChoices: Choice<BrowserSearchChoice>[] = [
  { id: 'bing', label: 'Bing' },
  { id: 'google', label: 'Google' },
  { id: 'baidu', label: '百度' },
  { id: 'duckduckgo', label: 'DuckDuckGo' },
]

const addressChoices: Choice<'top' | 'bottom'>[] = [
  { id: 'top', label: '顶部', icon: PanelTop },
  { id: 'bottom', label: '底部', icon: PanelBottom },
]

function ChoiceGroup<T extends string>({
  label,
  choices,
  value,
  onChange,
  inline = false,
}: {
  label: string
  choices: Choice<T>[]
  value: T
  onChange: (id: T) => void
  inline?: boolean
}) {
  function moveSelection(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % choices.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + choices.length) % choices.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = choices.length - 1
    } else {
      return
    }
    event.preventDefault()
    const next = choices[nextIndex]
    if (value !== next.id) onChange(next.id)
    const radios = event.currentTarget.closest('[role="radiogroup"]')
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    radios?.[nextIndex]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={inline ? 'grid grid-cols-2 gap-2' : 'overflow-hidden rounded-2xl border border-haze bg-ink-raised'}
    >
      {choices.map((choice, index) => {
        const selected = value === choice.id
        const Icon = choice.icon
        return (
          <button
            key={choice.id}
            type="button"
            role="radio"
            aria-label={choice.label}
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!selected) onChange(choice.id)
            }}
            onKeyDown={event => moveSelection(event, index)}
            className={'flex min-h-14 w-full min-w-0 items-center gap-3 px-4 py-3 text-left text-[15px] transition-colors active:bg-haze focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cinnabar '
              + (inline
                ? 'rounded-xl border ' + (selected ? 'border-cinnabar/50 bg-cinnabar/10' : 'border-haze bg-ink-raised')
                : 'border-b border-haze last:border-b-0 ' + (selected ? 'bg-cinnabar/5' : 'hover:bg-ink'))}
          >
            {Icon && <Icon size={18} className="shrink-0 text-paper-muted" aria-hidden="true" />}
            <span className="min-w-0 flex-1 text-paper">{choice.label}</span>
            {selected ? (
              <Check size={19} className="shrink-0 text-cinnabar" aria-hidden="true" />
            ) : (
              <Circle size={18} className="shrink-0 text-paper-faint" aria-hidden="true" />
            )}
          </button>
        )
      })}
    </div>
  )
}

export function BrowserSettingsPanel({
  search,
  bottomAddress,
  desktop,
  hasPage,
  pending = false,
  historyCount,
  onBack,
  onSearchChange,
  onAddressPositionChange,
  onDesktopChange,
  onClearHistory,
}: BrowserSettingsPanelProps) {
  return (
    <section
      aria-label="浏览器设置"
      className="absolute inset-0 z-30 flex min-h-0 flex-col bg-ink text-paper"
      style={{ paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)' }}
    >
      <BrowserPageHeader title="浏览器设置" onBack={onBack} />

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain px-4 py-5">
        <section aria-labelledby="browser-settings-search">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 id="browser-settings-search" className="text-sm font-semibold text-paper-muted">搜索</h3>
            <span className="text-sm text-paper-faint">默认搜索引擎</span>
          </div>
          <ChoiceGroup
            label="默认搜索引擎"
            choices={searchChoices}
            value={search}
            onChange={onSearchChange}
          />
        </section>

        <section aria-labelledby="browser-settings-layout">
          <h3 id="browser-settings-layout" className="mb-3 text-sm font-semibold text-paper-muted">布局</h3>
          <p className="mb-3 text-[15px] text-paper">地址栏位置</p>
          <ChoiceGroup
            label="地址栏位置"
            choices={addressChoices}
            value={bottomAddress ? 'bottom' : 'top'}
            onChange={value => onAddressPositionChange(value === 'bottom')}
            inline
          />
        </section>

        <section aria-labelledby="browser-settings-display">
          <h3 id="browser-settings-display" className="mb-3 text-sm font-semibold text-paper-muted">网页显示</h3>
          <div className="flex min-h-18 items-center gap-3 rounded-2xl border border-haze bg-ink-raised pl-4 pr-1">
            <div className="min-w-0 flex-1 py-3">
              <p className="text-[15px] text-paper">桌面版网页</p>
              {!hasPage && <p className="mt-1 text-sm text-paper-muted">打开网页后可设置</p>}
            </div>
            <div className="flex size-16 shrink-0 items-center justify-center [&>button]:before:absolute [&>button]:before:-inset-3 [&>button]:before:content-['']">
              <ToggleSwitch
                checked={desktop}
                label="桌面版网页"
                disabled={!hasPage || pending}
                onChange={() => {
                  if (hasPage && !pending) onDesktopChange()
                }}
              />
            </div>
          </div>
        </section>

        <section aria-labelledby="browser-settings-data">
          <h3 id="browser-settings-data" className="mb-3 text-sm font-semibold text-paper-muted">浏览数据</h3>
          <button
            type="button"
            aria-label="清除浏览历史"
            disabled={historyCount === 0}
            onClick={onClearHistory}
            className="flex min-h-18 w-full items-center gap-3 rounded-2xl border border-haze bg-ink-raised px-4 py-3 text-left transition-colors hover:bg-haze active:bg-haze disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-cinnabar"
          >
            <div className="min-w-0 flex-1">
              <span className="block text-[15px] text-paper">清除浏览历史</span>
              <span className="mt-1 block text-sm text-paper-muted">
                {historyCount > 0 ? historyCount + ' 条记录' : '暂无浏览历史'}
              </span>
            </div>
            <Trash2 size={19} className="shrink-0 text-paper-muted" aria-hidden="true" />
          </button>
        </section>
      </div>
    </section>
  )
}
