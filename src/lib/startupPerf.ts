/** Development-only startup diagnostics. Release retains only the necessary UI-ready signal. */

import { log } from './logger'

const PREFIX = 'newsnook-boot'

export function bootMark(name: string): void {
  if (!import.meta.env.DEV) return
  const mark = `${PREFIX}:${name}`
  try {
    performance.mark(mark)
  } catch {
    // Some WebViews do not support performance.mark.
  }
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now().toFixed(1)
      : String(Date.now())
  try {
    const bridge = (window as Window & { NewsNookNative?: { reportStartupStage?: (name: string, webTimeMs: number) => void } }).NewsNookNative
    bridge?.reportStartupStage?.(name, performance.now())
  } catch {
    // Diagnostics must never block startup.
  }
  // oxlint-disable-next-line eslint/no-console -- Dev startup milestones remain observable in logcat.
  console.info(`__NNSTART ${name} web=${now}ms`)
  log.boot.info(`${name} @ ${now}ms`)
}

/** Only when the direct bridge is absent. The main WebChromeClient retains this fallback. */
export function emitFirstUiFallback(): void {
  if (import.meta.env.DEV) return // bootMark already sent the console signal.
  const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now().toFixed(1) : String(Date.now())
  // oxlint-disable-next-line eslint/no-console -- Required native readiness fallback, not telemetry.
  console.info(`__NNSTART first-ui-frame web=${now}ms`)
}

export function bootMeasure(name: string, startMark: string, endMark: string): void {
  if (!import.meta.env.DEV) return
  try {
    performance.measure(`${PREFIX}:${name}`, `${PREFIX}:${startMark}`, `${PREFIX}:${endMark}`)
  } catch {
    // Start/end mark may be unavailable.
  }
}
