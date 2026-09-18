import { useState } from 'react'
import { Check, LayoutGrid, List, Monitor, Moon, Pencil, Play, Sun } from 'lucide-react'

// 自定义主题高度依赖现代 CSS（如支持 rgb 拆分甚至 color-mix），低版本下显示不全且容易跑偏
const isModernWebView = () => {
  const m = navigator.userAgent.match(/Chrome\/(\d+)/)
  return !m || parseInt(m[1], 10) >= 89
}

import { SettingsSection, SettingsShell } from '../../components/SettingsShell'
import { ToggleSwitch } from '../../components/ToggleSwitch'
import {
  deriveSchemeTokens,
  type CustomSchemeColors,
  type CustomSchemePrefs,
} from '../../lib/customScheme'
import {
  clearStartupSplashSeen,
  hasSeenStartupSplash,
} from '../../lib/storage'
import type { HomeFeedLayout } from '../../sources/preferences'
import {
  THEME_MODES,
  THEME_SCHEMES,
  type ResolvedTheme,
  type ThemeMode,
  type ThemeScheme,
  type ThemeSchemeSwatch,
} from '../../lib/theme'

interface Props {
  theme: ThemeMode
  resolved: ResolvedTheme
  scheme: ThemeScheme
  customScheme?: CustomSchemePrefs
  homeFeedLayout: HomeFeedLayout
  einkMode: boolean
  onChange: (theme: ThemeMode) => void
  onSchemeChange: (scheme: ThemeScheme) => void
  onEditCustomScheme: () => void
  onHomeFeedLayoutChange: (layout: HomeFeedLayout) => void
  onEinkModeChange: (enabled: boolean) => void
  onBack: () => void
}

const MODE_ICONS: Record<ThemeMode, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
}

/** 风格预览卡的昼/夜半块：缩微的浮层、字形与一点强调色 */
function SchemeSwatchPane({ swatch }: { swatch: ThemeSchemeSwatch }) {
  return (
    <span className="relative flex-1" style={{ backgroundColor: swatch.ink }}>
      <span
        className="absolute left-2.5 top-2 h-3.5 w-2/3 rounded-[3px]"
        style={{ backgroundColor: swatch.raised }}
        aria-hidden
      />
      <span
        className="absolute bottom-2 left-2.5 font-display leading-none"
        style={{ color: swatch.paper, fontSize: 17 }}
        aria-hidden
      >
        Aa
      </span>
      <span
        className="absolute bottom-2.5 right-2.5 h-[3px] w-5 rounded-full"
        style={{ backgroundColor: swatch.accent }}
        aria-hidden
      />
    </span>
  )
}

/** 自定义卡的预览取色：用用户配色实时推导，其余方案用注册表静态 swatch */
function swatchFromColors(colors: CustomSchemeColors, mode: ResolvedTheme): ThemeSchemeSwatch {
  const tokens = deriveSchemeTokens(colors, mode)
  return {
    ink: tokens['--tone-ink'],
    raised: tokens['--tone-ink-raised'],
    paper: tokens['--tone-paper'],
    accent: tokens['--tone-cinnabar'],
  }
}

export function AppearanceScreen({
  theme,
  resolved,
  scheme,
  customScheme,
  homeFeedLayout,
  einkMode,
  onChange,
  onSchemeChange,
  onEditCustomScheme,
  onHomeFeedLayoutChange,
  onEinkModeChange,
  onBack,
}: Props) {
  const active = THEME_MODES.find((mode) => mode.id === theme)
  const activeScheme = THEME_SCHEMES.find((item) => item.id === scheme)
  const [replayArmed, setReplayArmed] = useState(() => !hasSeenStartupSplash())

  const armFullSplashOnce = () => {
    clearStartupSplashSeen()
    setReplayArmed(true)
  }

  return (
    <SettingsShell
      title="外观"
      caption={`${activeScheme?.label ?? '墨问'} · ${active?.label ?? '夜读'} · 当前${resolved === 'dark' ? '深色' : '浅色'}`}
      onBack={onBack}
    >
      <div className="page-x pt-5">
        <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-haze bg-ink-raised shadow-[var(--shadow-lift)]">
          <div className="px-5 pt-5 pb-4">
            <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-cinnabar-soft">
              <span className="h-px w-5 bg-cinnabar" aria-hidden />
              预览
            </p>
            <h2 className="mt-3 font-display text-[22px] leading-snug text-paper">有所闻</h2>
            <p className="mt-2 text-[13px] leading-[1.85] text-paper-muted">
              灯下翻页，字要立得住，行要走得开。
            </p>
          </div>
          <div className="h-px w-full bg-haze" />
          <div className="flex items-center gap-2 bg-ink px-5 py-3">
            <span className="h-2 w-2 rounded-full bg-cinnabar" aria-hidden />
            <span className="text-[12px] text-paper-muted">链接与标记</span>
          </div>
        </div>
      </div>

      {isModernWebView() && (
        <SettingsSection title="风格">
          <ul aria-label="选择外观风格" className="page-x grid grid-cols-2 gap-3">
            {THEME_SCHEMES.map((item) => {
            const checked = item.id === scheme
            const isCustom = item.id === 'custom'
            const swatch =
              isCustom && customScheme
                ? {
                    light: swatchFromColors(customScheme.light, 'light'),
                    dark: swatchFromColors(customScheme.dark, 'dark'),
                  }
                : item.swatch

            return (
              <li key={item.id} className={isCustom ? 'col-span-2' : undefined}>
                <button
                  type="button"
                  aria-label={`选择${item.label}风格`}
                  aria-pressed={checked}
                  onClick={() => onSchemeChange(item.id)}
                  className={`flex w-full flex-col gap-2.5 rounded-2xl border p-3 text-left transition-colors duration-200 hover:border-cinnabar/45 hover:bg-ink-raised ${
                    checked ? 'border-cinnabar/60 bg-ink-raised' : 'border-haze bg-ink-raised/40'
                  }`}
                >
                  <span
                    className={`relative flex h-[68px] overflow-hidden rounded-lg border transition-colors duration-200 ${
                      checked ? 'border-cinnabar/40' : 'border-haze'
                    }`}
                  >
                    <SchemeSwatchPane swatch={swatch.light} />
                    <span className="w-px shrink-0" style={{ backgroundColor: 'rgb(0 0 0 / 0.28)' }} aria-hidden />
                    <SchemeSwatchPane swatch={swatch.dark} />
                  </span>

                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-[14.5px] text-paper">{item.label}</span>
                      <span className="mt-0.5 block truncate font-mono text-[9.5px] tracking-[0.12em] text-paper-faint">
                        {isCustom && checked ? '已选中，可继续调整配色' : item.caption}
                      </span>
                    </span>
                    {checked && (
                      <Check
                        size={15}
                        strokeWidth={2.2}
                        className="shrink-0 text-cinnabar"
                        aria-hidden
                      />
                    )}
                  </span>
                </button>
                {isCustom && checked && customScheme && (
                  <button
                    type="button"
                    onClick={onEditCustomScheme}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-haze bg-ink-raised/60 px-3 py-2 font-mono text-[11px] text-paper-muted transition-colors hover:border-cinnabar/50 hover:text-paper"
                  >
                    <Pencil size={13} strokeWidth={1.8} aria-hidden />
                    调整自定义配色
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </SettingsSection>
      )}

      <SettingsSection title="主题">
        <ul
          aria-label="选择明暗主题"
          className="divide-y divide-haze border-y border-haze md:grid md:grid-cols-3 md:gap-px md:divide-y-0 md:bg-haze"
        >
          {THEME_MODES.map((mode) => {
            const Icon = MODE_ICONS[mode.id]
            const checked = mode.id === theme

            return (
              <li key={mode.id} className="bg-ink">
                <button
                  type="button"
                  aria-pressed={checked}
                  onClick={() => onChange(mode.id)}
                  className="page-x flex w-full items-center gap-3 py-4 text-left transition-colors hover:bg-ink-raised"
                >
                  <span
                    className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border transition-colors duration-200 ${
                      checked ? 'border-cinnabar/60 bg-cinnabar/15' : 'border-haze bg-paper/5'
                    }`}
                  >
                    <Icon
                      size={15}
                      strokeWidth={1.6}
                      className={checked ? 'text-cinnabar-soft' : 'text-paper-muted'}
                      aria-hidden
                    />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] text-paper">{mode.label}</span>
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-paper-faint">
                      {mode.caption}
                    </span>
                  </span>

                  {checked && (
                    <Check
                      size={15}
                      strokeWidth={2.2}
                      className="shrink-0 text-cinnabar"
                      aria-hidden
                    />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </SettingsSection>

      <SettingsSection title="首页布局">
        <div className="page-x grid grid-cols-2 gap-3">
          {([
            {
              id: 'classic' as const,
              label: '经典列表',
              caption: '单栏图文列表，延续原来的阅读节奏',
              Icon: List,
            },
            {
              id: 'cards' as const,
              label: '双栏卡片',
              caption: '新版杂志式双栏，更适合浏览与发现',
              Icon: LayoutGrid,
            },
          ] satisfies Array<{ id: HomeFeedLayout; label: string; caption: string; Icon: typeof List }>).map((item) => {
            const checked = homeFeedLayout === item.id
            const Icon = item.Icon
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={checked}
                onClick={() => onHomeFeedLayoutChange(item.id)}
                className={`relative overflow-hidden rounded-2xl border p-3 text-left transition-all duration-200 ${
                  checked
                    ? 'border-cinnabar/60 bg-ink-raised shadow-sm'
                    : 'border-haze bg-ink-raised/45 hover:border-cinnabar/35 hover:bg-ink-raised/70'
                }`}
              >
                <span className="mb-3 block h-20 rounded-xl border border-haze/80 bg-ink p-2" aria-hidden>
                  {item.id === 'classic' ? (
                    <span className="flex h-full flex-col gap-1.5">
                      {[0, 1, 2].map((row) => (
                        <span key={row} className="flex flex-1 items-center gap-2 rounded-md bg-ink-raised/70 px-1.5">
                          <span className="flex-1">
                            <span className="block h-1.5 w-4/5 rounded-full bg-paper/20" />
                            <span className="mt-1 block h-1 w-2/3 rounded-full bg-paper/10" />
                          </span>
                          <span className="h-6 w-6 rounded bg-paper/10" />
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="grid h-full grid-cols-2 gap-1.5">
                      {[0, 1, 2, 3].map((card) => (
                        <span key={card} className="overflow-hidden rounded-md border border-haze/60 bg-ink-raised/70">
                          {card !== 2 && <span className="block h-5 bg-paper/10" />}
                          <span className="block p-1">
                            <span className="block h-1.5 w-4/5 rounded-full bg-paper/20" />
                            <span className="mt-1 block h-1 w-3/5 rounded-full bg-paper/10" />
                          </span>
                        </span>
                      ))}
                    </span>
                  )}
                </span>

                <span className="flex items-start gap-2.5">
                  <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border ${
                    checked ? 'border-cinnabar/45 bg-cinnabar/12 text-cinnabar' : 'border-haze text-paper-muted'
                  }`}>
                    <Icon size={14} strokeWidth={1.7} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[14px] font-medium text-paper">
                      {item.label}
                      {item.id === 'cards' && (
                        <span className="rounded-full bg-cinnabar/12 px-1.5 py-0.5 font-mono text-[8.5px] font-normal tracking-[0.08em] text-cinnabar-soft">
                          新版
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-[11px] leading-[1.55] text-paper-faint">
                      {item.caption}
                    </span>
                  </span>
                  {checked && <Check size={15} strokeWidth={2.2} className="mt-1 shrink-0 text-cinnabar" aria-hidden />}
                </span>
              </button>
            )
          })}
        </div>
        <p className="page-x mt-2 font-mono text-[9.5px] leading-relaxed text-paper-faint">
          新安装默认使用双栏卡片；从旧版本升级的用户继续保持经典列表，除非在这里手动切换。
        </p>
      </SettingsSection>

      <SettingsSection title="墨水屏">
        <div className="page-x">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-haze bg-ink-raised p-4 shadow-[var(--shadow-lift)]">
            <div className="min-w-0 flex-1">
              <span className="font-display text-[15px] font-medium text-paper">墨水屏模式</span>
              <p className="mt-1 text-[12px] leading-relaxed text-paper-muted">
                关闭动画与装饰效果；文章左右点击翻页，中间打开阅读菜单；音量键亦可翻页。颜色仍跟随上方主题。
              </p>
            </div>
            <ToggleSwitch
              checked={einkMode}
              label="墨水屏模式"
              onChange={() => onEinkModeChange(!einkMode)}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="启动">
        <div className="page-x">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-haze bg-ink-raised p-4 shadow-[var(--shadow-lift)]">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Play
                  size={15}
                  strokeWidth={1.7}
                  className="shrink-0 text-cinnabar-soft"
                  aria-hidden
                />
                <span className="font-display text-[15px] font-medium text-paper">
                  下次完整开场
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-paper-muted">
                {replayArmed ? '已安排，下次冷启动播放一次' : '清除标记，仅下次生效'}
              </p>
            </div>
            <button
              type="button"
              disabled={replayArmed}
              onClick={armFullSplashOnce}
              className="shrink-0 rounded-full border border-cinnabar/50 bg-cinnabar/12 px-3.5 py-1.5 font-mono text-[11px] text-cinnabar-soft transition-colors hover:border-cinnabar/70 hover:bg-cinnabar/18 disabled:border-haze disabled:bg-transparent disabled:text-paper-faint"
            >
              {replayArmed ? '已安排' : '安排'}
            </button>
          </div>
        </div>
      </SettingsSection>
    </SettingsShell>
  )
}
