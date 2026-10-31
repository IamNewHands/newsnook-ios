import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

import { useEdgeSwipeBack } from '../hooks/useEdgeSwipeBack'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { haptics } from '../lib/haptics'
import { isSwipeBackNavigation, markSwipeBackNavigation } from '../lib/edgeSwipeBack'

interface Props {
  title: ReactNode
  caption?: string
  toolbar?: ReactNode
  className?: string
  action?: ReactNode
  footer?: ReactNode
  onBack: () => void
  children: ReactNode
}

/** 设置类页面的统一外壳：覆盖在主界面之上，保留返回路径，支持边缘右滑手势返回与平滑退场动效 */
export function SettingsShell({ title, caption, toolbar, className, action, footer, onBack, children }: Props) {
  const reduced = useReducedMotion()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [exiting, setExiting] = useState(false)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  /**
   * 右滑返回时不播「从右滑入」的入场动画：返回是弹栈，父级页应该在子页滑走的
   * 同时直接出现。再滑入一次会看成两级动画，正是「返回时跳一下」的来源之一。
   */
  const [entering] = useState(() => !isSwipeBackNavigation())

  const handleBack = useCallback(() => {
    if (exiting) return
    if (reduced) {
      onBackRef.current()
      return
    }
    void haptics.tick()
    setExiting(true)
  }, [exiting, reduced])

  /** 右滑已经把手势里的本页送出屏幕，这里只补上父级的路由状态。 */
  const handleSwipeBack = useCallback(() => {
    markSwipeBackNavigation()
    onBackRef.current()
  }, [])

  /**
   * 左缘右滑返回接在统一外壳里：每个设置页自带的 `onBack` 就是它的上一级，接
   * 一次就覆盖全部二级页，各页不必各自接线。只认左缘窄条（`edgeOnly`），免得
   * 和分类管理里的横向拖拽抢手势。
   */
  useEdgeSwipeBack({
    containerRef,
    onBack: handleSwipeBack,
    edgeOnly: true,
    disabled: exiting,
    reduced,
  })

  // 退出动画安全计时器兜底，避免内核异常导致停滞
  useEffect(() => {
    if (!exiting) return
    const timer = window.setTimeout(() => {
      onBackRef.current()
    }, 240)
    return () => window.clearTimeout(timer)
  }, [exiting])

  const onAnimationEnd = (event: React.AnimationEvent<HTMLDivElement>) => {
    if (event.target === containerRef.current && exiting) {
      onBackRef.current()
    }
  }

  const animationStyle = reduced
    ? undefined
    : exiting
      ? 'settings-out 200ms cubic-bezier(0.32, 0.72, 0, 1) both'
      : undefined

  return (
    <div
      ref={containerRef}
      onAnimationEnd={onAnimationEnd}
      className={`paper-settings-shell absolute inset-0 z-30 flex flex-col bg-ink ${className ?? ""}`}
      style={{
        paddingBottom: 'var(--sab)',
        animation: animationStyle,
      }}
    >
      <style>{`
        @keyframes settings-in { from { opacity: 0; transform: translate3d(20px, 0, 0) } to { opacity: 1; transform: translate3d(0, 0, 0) } }
        @keyframes settings-out { from { opacity: 1; transform: translate3d(0, 0, 0) } to { opacity: 0; transform: translate3d(24px, 0, 0) } }
      `}</style>

      {/*
        入场动画挂在内层而不是上面这层：CSS 动画（含 fill-mode 的终态）优先级高于
        内联 style，动画挂在外层会把右滑返回写的内联 transform 顶掉，整页拖不动。
      */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ animation: reduced || !entering ? undefined : 'settings-in 300ms var(--ease-ink) both' }}
      >
        <header className="paper-settings-shell-header shrink-0 bg-ink/90 backdrop-blur-md">
          <div className="paper-settings-shell-header-inner page-x lg:px-8 max-w-4xl mx-auto w-full">
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={handleBack}
                aria-label="返回"
                className="-ml-1.5 shrink-0 p-1.5 transition-transform duration-100 active:scale-[0.88] hover:text-paper"
              >
                <ArrowLeft size={19} strokeWidth={1.6} className="text-paper" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h1 className="paper-settings-shell-title truncate font-display text-[22px] leading-none text-paper sm:text-[24px] md:text-[28px]">
                      {title}
                    </h1>
                    {caption && (
                      <p className="paper-settings-shell-caption mt-1.5 line-clamp-2 font-mono text-[10px] lg:text-[11px] tracking-[0.14em] text-paper-faint">
                        {caption}
                      </p>
                    )}
                  </div>
                  {action ? <div className="shrink-0">{action}</div> : null}
                </div>
              </div>
            </div>
          </div>
        </header>

        {toolbar && <div className="paper-settings-shell-toolbar shrink-0">{toolbar}</div>}

        <div
          data-settings-scroll
          className="paper-settings-shell-scroll scroll-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: '24px' }}
        >
          <div className="max-w-4xl mx-auto w-full">
            {children}
          </div>
        </div>

        {footer && (
          <footer className="shrink-0 border-t border-haze/30 bg-ink/95 backdrop-blur-md">
            <div className="page-x lg:px-8 max-w-4xl mx-auto w-full py-2.5">
              {footer}
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}

/** 统一设置分组容器：默认收拢为一块可读的分组表面；瓷片、卡片网格使用 plain 布局。 */
export function SettingsSection({
  title,
  children,
  variant = 'group',
}: {
  title: string
  children: ReactNode
  variant?: 'group' | 'plain'
}) {
  return (
    <section className={`paper-settings-section paper-settings-section--${variant}`}>
      <div className="paper-settings-section-heading">
        <h2 className="paper-settings-section-title">{title}</h2>
      </div>
      <div className="paper-settings-section-content">{children}</div>
    </section>
  )
}

export function SettingsHint({ children }: { children: ReactNode }) {
  return (
    <p className="paper-settings-hint page-x max-w-2xl pt-4 text-[11.5px] leading-relaxed text-paper-faint">
      {children}
    </p>
  )
}
