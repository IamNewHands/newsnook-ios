import { memo, useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Globe, LayoutTemplate, Settings2 } from 'lucide-react'

export interface PresetSwitcherItem {
  id: string
  name: string
  description?: string
  /** 内置场景包 */
  builtin?: boolean
  active: boolean
}

export interface SiteSwitcherItem {
  id: string
  name: string
  description?: string
  active: boolean
}

export interface PresetSwitcherProps {
  activeName: string
  items: PresetSwitcherItem[]
  onSelect: (id: string) => void
  onManage: () => void
  /** 独立站点工作区；与 preset 完全分离，选择时不得调用 onSelect。 */
  siteItems?: SiteSwitcherItem[]
  onSelectSite?: (id: string) => void
  /** 有已适配站点时传入，点击后进入站点浏览 */
  onSites?: () => void
  /** 已适配站点数量 */
  siteCount?: number
  variant?: 'pill' | 'card' | 'tabbar' | 'sidebar'
}

/**
 * 场景预设快捷切换：
 * - variant='tabbar': 移动端底栏中央动作入口，轻微抬升但不成为独立页面
 * - variant='sidebar': PC 侧栏中的普通导航动作，与速闻/稍后读同层级
 * - variant='pill': 紧凑胶囊，保留给站点工作区等非首页场景
 * - variant='card': 保留给需要突出展示当前预设的桌面场景
 * - 弹窗在移动端为底部抽屉，在平板/PC 端自适应为居中精美浮窗
 */
export function PresetSwitcher({
  activeName,
  items,
  onSelect,
  onManage,
  siteItems = [],
  onSelectSite,
  onSites,
  siteCount = 0,
  variant = 'pill',
}: PresetSwitcherProps) {
  const [open, setOpen] = useState(false)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const builtins = useMemo(() => items.filter((item) => item.builtin), [items])
  const mine = useMemo(() => items.filter((item) => !item.builtin), [items])

  // 不用 backdrop-blur：全屏毛玻璃在 Android WebView 上会强制栅格化整页信息流，
  // 打开时常卡数百毫秒～1s+。半透明遮罩 + 轻位移入场即可，兼容 Chrome 69。
  const sheet =
    open &&
    createPortal(
      <div
        className="fixed inset-0 z-[80] flex items-end justify-center md:items-center p-0 md:p-6"
        role="presentation"
      >
        <button
          type="button"
          aria-label="关闭"
          className="absolute inset-0 bg-black/55"
          onClick={() => setOpen(false)}
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="preset-switcher-sheet relative z-10 flex max-h-[min(82vh,580px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl md:rounded-2xl border border-haze/90 bg-ink-raised shadow-lg"
          style={{
            paddingBottom: 'calc(var(--sab, 0px) + 14px)',
          }}
        >
          <div className="flex shrink-0 justify-center pt-2.5 pb-1 md:hidden" aria-hidden>
            <span className="h-1 w-10 rounded-full bg-haze" />
          </div>

          <div className="page-x flex shrink-0 items-center justify-between gap-3 pt-3 pb-3 border-b border-haze/50">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-cinnabar/15 text-cinnabar">
                <LayoutTemplate size={16} />
              </div>
              <div className="min-w-0">
                <h2 id={titleId} className="font-display text-[18px] font-semibold leading-none text-paper">
                  切换布局
                </h2>
                <p className="mt-1 font-mono text-[10.5px] tracking-wide text-paper-faint truncate">
                  当前布局：<span className="text-cinnabar font-medium">{activeName}</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onManage()
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-haze/90 bg-ink px-3 py-1.5 font-mono text-[11px] font-medium text-paper-muted hover:border-cinnabar/60 hover:text-cinnabar transition-colors"
            >
              <Settings2 size={13} strokeWidth={1.7} />
              管理预设
            </button>
          </div>

          <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 py-2.5 sm:px-5 sm:py-3 space-y-3">
            {builtins.length > 0 && (
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-paper-faint">
                    内置精选场景
                  </span>
                  <span className="h-px flex-1 bg-haze/60" />
                </div>
                <ul className="grid grid-cols-2 gap-1.5 sm:gap-2">
                  {builtins.map((item) => (
                    <PresetGridCard
                      key={item.id}
                      item={item}
                      onPick={() => {
                        if (!item.active) onSelect(item.id)
                        setOpen(false)
                      }}
                    />
                  ))}
                </ul>
              </section>
            )}

            {mine.length > 0 && (
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-paper-faint">
                    我的自定义预设
                  </span>
                  <span className="h-px flex-1 bg-haze/60" />
                </div>
                <ul className="space-y-2">
                  {mine.map((item) => (
                    <PresetPickRow
                      key={item.id}
                      item={item}
                      onPick={() => {
                        if (!item.active) onSelect(item.id)
                        setOpen(false)
                      }}
                    />
                  ))}
                </ul>
              </section>
            )}

            {(siteItems.length > 0 || (onSites && siteCount > 0)) && (
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-paper-faint">
                    第三方站点
                  </span>
                  <span className="h-px flex-1 bg-haze/60" />
                </div>
                <div className="space-y-2">
                  {siteItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (!item.active) onSelectSite?.(item.id)
                        setOpen(false)
                      }}
                      className={`group flex w-full items-center gap-3.5 rounded-xl border p-3 text-left transition-colors ${
                        item.active
                          ? 'border-cinnabar/60 bg-cinnabar/12'
                          : 'border-haze/80 bg-ink/50 hover:border-cinnabar/40 hover:bg-ink-raised'
                      }`}
                    >
                      <div
                        className={`flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                          item.active
                            ? 'bg-cinnabar text-white'
                            : 'bg-ink-raised border border-haze text-paper-muted group-hover:border-cinnabar/40 group-hover:text-cinnabar'
                        }`}
                      >
                        {item.active ? <Check size={16} strokeWidth={2.2} /> : <Globe size={15} strokeWidth={1.6} />}
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className={`truncate font-display text-[15px] font-semibold ${item.active ? 'text-cinnabar' : 'text-paper'}`}>
                          {item.name}
                        </span>
                        {item.description && (
                          <span className="mt-0.5 block truncate text-[12px] text-paper-faint">
                            {item.description}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 rounded-full border border-haze/80 bg-ink px-2.5 py-1 font-mono text-[10.5px] font-medium text-paper-faint">
                        {item.active ? '当前' : '进入'}
                      </span>
                    </button>
                  ))}

                  {onSites && siteCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        onSites()
                      }}
                      className="group flex w-full items-center gap-3.5 rounded-xl border border-haze/80 bg-ink/50 p-3 text-left transition-colors hover:border-cinnabar/40 hover:bg-ink-raised"
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink-raised border border-haze text-paper-muted group-hover:border-cinnabar/40 group-hover:text-cinnabar transition-colors">
                        <Globe size={15} strokeWidth={1.6} />
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className="truncate font-display text-[15px] font-semibold text-paper">其他已适配站点</span>
                        <span className="mt-0.5 block text-[12px] text-paper-faint">{siteCount} 个 CMS 站点可浏览</span>
                      </span>
                      <span className="shrink-0 rounded-full border border-haze/80 bg-ink px-2.5 py-1 font-mono text-[10.5px] font-medium text-paper-faint">浏览</span>
                    </button>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>,
      document.body,
    )

  if (variant === 'tabbar') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`布局，当前：${activeName}，点击切换`}
          title={`当前布局：${activeName}`}
          data-tour="preset-switcher"
          className="group relative -mt-2 flex h-[62px] w-full flex-col items-center justify-start gap-0.5 pt-0 text-paper-muted transition-colors duration-200 active:scale-[0.98]"
        >
          <span className="relative flex size-11 items-center justify-center rounded-full border border-haze/90 bg-ink-raised shadow-[0_5px_16px_rgba(0,0,0,0.16)] transition-all duration-200 group-hover:border-cinnabar/45 group-hover:text-cinnabar group-active:translate-y-0.5">
            <span className="absolute inset-1 rounded-full bg-cinnabar/8" aria-hidden />
            <LayoutTemplate
              size={19}
              strokeWidth={1.85}
              className="relative text-cinnabar transition-transform duration-200 group-hover:scale-105"
            />
          </span>
          <span className="font-mono text-[10.5px] font-medium tracking-[0.14em] text-paper-muted transition-colors group-hover:text-cinnabar">
            布局
          </span>
        </button>
        {sheet}
      </>
    )
  }

  if (variant === 'sidebar') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`布局，当前：${activeName}，点击切换`}
          title={`当前布局：${activeName}`}
          className="group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-paper-muted transition-all duration-200 hover:bg-ink-raised/50 hover:text-paper"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <LayoutTemplate
              size={16}
              strokeWidth={1.7}
              className="shrink-0 text-cinnabar-soft transition-colors group-hover:text-cinnabar"
            />
            <span className="text-[13.5px] tracking-wide">布局</span>
          </span>
          <span className="max-w-[104px] truncate font-mono text-[9.5px] text-paper-faint transition-colors group-hover:text-paper-muted">
            {activeName}
          </span>
        </button>
        {sheet}
      </>
    )
  }

  if (variant === 'card') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`当前布局：${activeName}，点击切换`}
          className="group relative w-full rounded-xl border border-haze/90 bg-ink-raised/90 p-2.5 text-left transition-all duration-200 hover:border-cinnabar/60 hover:bg-ink-raised hover:shadow-sm active:scale-[0.99] focus-visible:outline-hidden"
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="flex items-center gap-1 font-mono text-[10px] tracking-[0.16em] text-paper-faint">
              <span className="size-1.5 rounded-full bg-cinnabar" />
              布局与场景
            </span>
            <span className="font-mono text-[9.5px] font-medium text-cinnabar group-hover:translate-x-0.5 transition-transform duration-200">
              切换 →
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-cinnabar/15 text-cinnabar group-hover:bg-cinnabar group-hover:text-white transition-colors duration-200">
                <LayoutTemplate size={14} strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="truncate font-display text-[14.5px] font-semibold text-paper group-hover:text-cinnabar transition-colors duration-200">
                  {activeName}
                </div>
              </div>
            </div>
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink border border-haze/80 text-paper-faint group-hover:border-cinnabar/50 group-hover:text-cinnabar transition-all">
              <ChevronDown size={12} strokeWidth={2} className="group-hover:translate-y-0.5 transition-transform" />
            </div>
          </div>
        </button>
        {sheet}
      </>
    )
  }

  // 默认 pill 胶囊形态（用于移动端顶栏）
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`当前布局：${activeName}，点击切换`}
        className="group flex max-w-[8.5rem] sm:max-w-[10.5rem] items-center gap-1.5 rounded-full border border-haze/90 bg-ink-raised/80 px-2.5 py-1 text-paper shadow-2xs transition-all duration-200 hover:border-cinnabar/40 hover:bg-ink-raised active:scale-95"
      >
        <LayoutTemplate
          size={11.5}
          strokeWidth={1.8}
          className="shrink-0 text-cinnabar group-hover:scale-105 transition-transform"
        />
        <span className="min-w-0 truncate font-mono text-[11px] font-medium tracking-wide text-paper group-hover:text-cinnabar transition-colors">
          {activeName}
        </span>
        <ChevronDown
          size={11}
          strokeWidth={1.8}
          className="shrink-0 text-paper-faint group-hover:text-cinnabar group-hover:translate-y-0.5 transition-all"
        />
      </button>
      {sheet}
    </>
  )
}

const PresetGridCard = memo(function PresetGridCard({
  item,
  onPick,
}: {
  item: PresetSwitcherItem
  onPick: () => void
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onPick}
        aria-pressed={item.active}
        className={`group relative flex min-h-[78px] w-full flex-col overflow-hidden rounded-xl border px-2.5 py-2.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar/45 ${
          item.active
            ? 'border-cinnabar/75 bg-cinnabar/12 shadow-[0_4px_12px_rgba(0,0,0,0.08)]'
            : 'border-haze/80 bg-ink/55 hover:-translate-y-px hover:border-cinnabar/40 hover:bg-ink hover:shadow-sm active:translate-y-0'
        }`}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-lg border transition-all duration-200 ${
              item.active
                ? 'border-cinnabar bg-cinnabar text-white shadow-xs'
                : 'border-haze bg-ink-raised text-paper-muted group-hover:border-cinnabar/35 group-hover:text-cinnabar'
            }`}
          >
            {item.active ? (
              <Check size={14} strokeWidth={2.4} />
            ) : (
              <LayoutTemplate size={13.5} strokeWidth={1.7} />
            )}
          </span>

          <span
            className={`min-w-0 flex-1 truncate font-display text-[13.5px] font-semibold leading-none transition-colors ${
              item.active ? 'text-cinnabar' : 'text-paper group-hover:text-cinnabar'
            }`}
          >
            {item.name}
          </span>

          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[8.5px] font-semibold leading-none tracking-[0.06em] transition-colors ${
              item.active
                ? 'bg-cinnabar/15 text-cinnabar'
                : 'border border-haze/80 bg-ink-raised/70 text-paper-faint group-hover:border-cinnabar/30 group-hover:text-cinnabar'
            }`}
          >
            {item.active ? '当前' : '选用'}
          </span>
        </span>

        {item.description && (
          <span className="mt-1.5 block line-clamp-2 pl-9 text-[10px] leading-[1.35] text-paper-faint transition-colors group-hover:text-paper-muted">
            {item.description}
          </span>
        )}

        {item.active && (
          <span className="pointer-events-none absolute inset-x-2.5 bottom-0 h-px bg-gradient-to-r from-transparent via-cinnabar/45 to-transparent" aria-hidden />
        )}
      </button>
    </li>
  )
})

const PresetPickRow = memo(function PresetPickRow({
  item,
  onPick,
}: {
  item: PresetSwitcherItem
  onPick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className={`group relative flex w-full items-center gap-3.5 rounded-xl border p-3 text-left transition-colors ${
          item.active
            ? 'border-cinnabar/60 bg-cinnabar/12'
            : 'border-haze/80 bg-ink/50 hover:border-cinnabar/40 hover:bg-ink-raised'
        }`}
      >
        <div
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
            item.active
              ? 'bg-cinnabar text-white'
              : 'bg-ink-raised border border-haze text-paper-muted group-hover:border-cinnabar/40 group-hover:text-cinnabar'
          }`}
        >
          {item.active ? <Check size={16} strokeWidth={2.2} /> : <LayoutTemplate size={15} strokeWidth={1.6} />}
        </div>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={`truncate font-display text-[15px] font-semibold ${
                item.active ? 'text-cinnabar' : 'text-paper group-hover:text-paper'
              }`}
            >
              {item.name}
            </span>
            {item.active && (
              <span className="inline-flex items-center rounded-full bg-cinnabar/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-cinnabar">
                当前生效
              </span>
            )}
          </span>
          {item.description && (
            <span className="mt-0.5 block truncate text-[12px] text-paper-faint group-hover:text-paper-muted transition-colors">
              {item.description}
            </span>
          )}
        </span>

        {!item.active && (
          <span className="shrink-0 rounded-full border border-haze/80 bg-ink px-2.5 py-1 font-mono text-[10.5px] font-medium text-paper-faint group-hover:border-cinnabar/40 group-hover:text-cinnabar transition-colors">
            选用
          </span>
        )}
      </button>
    </li>
  )
})
