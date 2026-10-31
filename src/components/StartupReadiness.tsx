import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createReadiness, StartupContext, useStartupBlocker } from '../hooks/useStartupReadiness'

export function StartupReadinessProvider({ children, onReady }: { children: ReactNode; onReady: () => void }) {
  const callbackRef = useRef(onReady)
  callbackRef.current = onReady
  const [readiness] = useState(() => createReadiness(() => callbackRef.current()))
  // Child layout effects register their blockers before the provider arms a frame.
  useLayoutEffect(() => {
    readiness.start()
    return () => readiness.stop()
  }, [readiness])
  return <StartupContext.Provider value={readiness}>{children}</StartupContext.Provider>
}

/** A lazy initial route cannot report its loading fallback as fully displayed. */
export function StartupPending({ children, pending = true }: { children: ReactNode; pending?: boolean }) {
  useStartupBlocker(pending)
  return <>{children}</>
}
