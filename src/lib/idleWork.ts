/** Yield noncritical maintenance to an idle turn; cleanup also invalidates queued callbacks. */
export function scheduleIdleWork(work: () => void): () => void {
  let pending = true
  const run = () => {
    if (!pending) return
    pending = false
    work()
  }
  const useIdle = typeof window.requestIdleCallback === 'function' && typeof window.cancelIdleCallback === 'function'
  const id = useIdle
    ? window.requestIdleCallback(run, { timeout: 1000 })
    : window.setTimeout(run, 0)
  return () => {
    pending = false
    if (useIdle) window.cancelIdleCallback(id)
    else window.clearTimeout(id)
  }
}
