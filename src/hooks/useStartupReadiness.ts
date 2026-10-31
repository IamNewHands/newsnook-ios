import { createContext, useContext, useLayoutEffect, useSyncExternalStore } from 'react'

/** Only initial local restoration and the selected surface participate in this gate.
 * A pending surface waits for a state change; it never polls or waits for network data.
 */
export function createReadiness(onReady: () => void) {
  const blockers = new Set<symbol>()
  const listeners = new Set<() => void>()
  let active = false
  let ready = false
  let firstFrame: number | undefined
  let secondFrame: number | undefined

  const cancelFrames = () => {
    if (firstFrame !== undefined) window.cancelAnimationFrame(firstFrame)
    if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame)
    firstFrame = secondFrame = undefined
  }
  const schedule = () => {
    if (!active || ready || blockers.size || firstFrame !== undefined || secondFrame !== undefined) return
    firstFrame = window.requestAnimationFrame(() => {
      firstFrame = undefined
      if (!active || ready || blockers.size) return
      secondFrame = window.requestAnimationFrame(() => {
        secondFrame = undefined
        if (!active || ready || blockers.size) return
        ready = true
        onReady()
        listeners.forEach(listener => listener())
      })
    })
  }

  return {
    block() {
      if (ready) return () => {}
      const token = Symbol()
      blockers.add(token)
      cancelFrames()
      return () => {
        if (blockers.delete(token)) schedule()
      }
    },
    start() { active = true; schedule() },
    stop() { active = false; cancelFrames() },
    getSnapshot: () => ready,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export const StartupContext = createContext<ReturnType<typeof createReadiness> | null>(null)
const alreadyReady = () => true
const subscribeWithoutProvider = () => () => {}

export function useStartupBlocker(pending: boolean): void {
  const readiness = useContext(StartupContext)
  useLayoutEffect(() => pending ? readiness?.block() : undefined, [pending, readiness])
}

/** Noncritical maintenance may begin once the initial surface has had a browser frame. */
export function useStartupReady(): boolean {
  const readiness = useContext(StartupContext)
  return useSyncExternalStore(
    readiness?.subscribe ?? subscribeWithoutProvider,
    readiness?.getSnapshot ?? alreadyReady,
    alreadyReady,
  )
}
