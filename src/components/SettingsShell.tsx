import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

import { useEdgeSwipeBack } from '../hooks/useEdgeSwipeBack'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { isSwipeBackNavigation, markSwipeBackNavigation } from '../lib/edgeSwipeBack'

interface Props {
  title: string
  caption?: string
  action?: ReactNode
  onBack: () => void
  children: ReactNode
}

/** 设置类页面的统一外壳：覆盖在主界面之上，保留返回路径 */
export function SettingsShell({ title, caption, action, onBack, children }: Props) {
  const reduced = useReducedMotion()
  const swipeRef = useRef<HTMLDivElement>(null)
  /**
   * 右滑返回时不播「从右滑入」的入场动画：返回是弹栈，父级页应该在子页滑走的
   * 同时直接出现。再滑入一次会看成两级动画，正是「返回时跳一下」的来源之一。
   */
  const [entering] = useState(() => !isSwipeBackNavigation())

  const handleSwipeBack = useCallback(() => {
    markSwipeBackNavigation()
    onBack()
  }, [onBack])

  /**
   * 左缘右滑返回接在统一外壳里：每个设置页自带的 `onBack` 就是它的上一级，接
   * 一次就覆盖全部二级页，各页不必各自接线，也就不会出现「一处能滑、另一处
   * 忘了接」。只认左缘窄条（`edgeOnly`），免得和分类管理里的横向拖拽抢手势。
   */
  useEdgeSwipeBack({
    containerRef: swipeRef,
    onBack: handleSwipeBack,
    edgeOnly: true,
    reduced,
  })

  return (
    <div
      ref={swipeRef}
      className="absolute inset-0 z-30 flex flex-col bg-ink"
      style={{
        // 挂在 AppShell 已 paddingTop: var(--sat) 的内容区里（main 为 containing block），
        // 顶部再垫 --sat 会在 edge-to-edge + 新 WebView 上叠出双倍状态栏空白。
        // 底部 AppShell 不垫 --sab，仍由本壳避让手势条。
        paddingBottom: 'var(--sab)',
      }}
    >
      <style>{`@keyframes settings-in { from { opacity: 0; transform: translateX(18px) } to { opacity: 1; transform: none } }`}</style>

      {/*
        入场动画挂在内层而不是上面这层：CSS 动画（含 fill-mode 的终态）优先级高于
        内联 style，动画挂在外层会把右滑返回写的内联 transform 顶掉，整页拖不动。
      */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ animation: reduced || !entering ? undefined : 'settings-in 320ms var(--ease-ink) both' }}
      >
        <header className="shrink-0 pt-2 pb-3">
          <div className="page-x lg:px-8 max-w-4xl mx-auto w-full">
            <div className="flex items-start gap-2">
              <button type="button" onClick={onBack} aria-label="返回" className="-ml-1.5 shrink-0 p-1.5 hover:text-paper">
                <ArrowLeft size={19} strokeWidth={1.6} className="text-paper" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h1 className="truncate font-display text-[22px] leading-none text-paper sm:text-[24px] md:text-[28px]">
                      {title}
                    </h1>
                    {caption && (
                      <p className="mt-1.5 line-clamp-2 font-mono text-[10px] lg:text-[11px] tracking-[0.14em] text-paper-faint">
                        {caption}
                      </p>
                    )}
                  </div>
                  {action ? <div className="shrink-0">{action}</div> : null}
                </div>
              </div>
            </div>
            <div className="mt-3 h-px w-full bg-haze" />
          </div>
        </header>

        <div
          data-settings-scroll
          className="scroll-hidden min-h-0 flex-1 overflow-y-auto"
          style={{ paddingBottom: '24px' }}
        >
          <div className="max-w-4xl mx-auto w-full">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="page-x flex items-center gap-3 pt-7 pb-2">
        <span className="font-mono text-[10px] tracking-[0.28em] text-paper-faint">{title}</span>
        <span className="h-px flex-1 bg-haze" aria-hidden />
      </div>
      {children}
    </section>
  )
}

export function SettingsHint({ children }: { children: ReactNode }) {
  return (
    <p className="page-x max-w-2xl pt-4 text-[11.5px] leading-relaxed text-paper-faint">
      {children}
    </p>
  )
}
