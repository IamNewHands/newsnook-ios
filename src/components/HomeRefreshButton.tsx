import { useCallback, useEffect, useRef, type ButtonHTMLAttributes } from 'react'

import { handleHomeNavigationTap } from '../lib/homeRefreshActivation'

interface HomeRefreshButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  active: boolean
  refreshing?: boolean
  onNavigateHome: () => void
  onRefresh: () => Promise<void> | void
}

export function HomeRefreshButton({
  active,
  refreshing = false,
  onNavigateHome,
  onRefresh,
  type,
  children,
  ...buttonProps
}: HomeRefreshButtonProps) {
  const previousTapAtRef = useRef<number | null>(null)
  const refreshInFlightRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    if (!active) previousTapAtRef.current = null
  }, [active])

  const startRefresh = useCallback(() => {
    if (refreshing || refreshInFlightRef.current) return

    const result = onRefresh()
    if (!result || typeof result.then !== 'function') return

    const pending = Promise.resolve(result)
      .finally(() => {
        if (refreshInFlightRef.current === pending) refreshInFlightRef.current = null
      })
    refreshInFlightRef.current = pending
    void pending.catch(() => undefined)
  }, [onRefresh, refreshing])

  const handleClick = useCallback(() => {
    previousTapAtRef.current = handleHomeNavigationTap({
      isHome: active,
      previousTapAt: previousTapAtRef.current,
      now: Date.now(),
      onNavigateHome,
      onRefresh: startRefresh,
    })
  }, [active, onNavigateHome, startRefresh])

  return (
    <button {...buttonProps} type={type ?? 'button'} onClick={handleClick}>
      {children}
    </button>
  )
}
