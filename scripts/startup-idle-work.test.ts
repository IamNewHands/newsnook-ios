import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

const pending = new Map<number, () => void>()
let nextId = 0
let mode = ''
Object.assign(globalThis, { window: {
  requestIdleCallback(callback: () => void) { mode = 'idle'; const id = ++nextId; pending.set(id, callback); return id },
  cancelIdleCallback(id: number) { pending.delete(id) },
  setTimeout(callback: () => void, delay: number) { mode = 'timer'; assert.equal(delay, 0); const id = ++nextId; pending.set(id, callback); return id },
  clearTimeout(id: number) { pending.delete(id) },
} })
assert.ok(existsSync(new URL('../src/lib/idleWork.ts', import.meta.url)),
  'Startup cache maintenance needs cancellable idle scheduling after the first usable frame')
const { scheduleIdleWork } = await import('../src/lib/idleWork')
const applied: string[] = []
const cancel = scheduleIdleWork(() => applied.push('stale later state'))
const staleCallback = [...pending.values()][0]
assert.equal(applied.length, 0, 'scheduling maintenance must not scan cache synchronously')
assert.equal(mode, 'idle')
cancel(); cancel()
assert.equal(pending.size, 0, 'cleanup removes the pending idle request')
staleCallback()
assert.equal(applied.length, 0, 'a callback already queued by the browser cannot run after cancellation')
const current = scheduleIdleWork(() => applied.push('current later state'))
const callback = [...pending.values()][0]
pending.clear(); callback(); callback(); current()
assert.deepEqual(applied, ['current later state'], 'maintenance executes at most once for the current request')

delete (window as unknown as Record<string, unknown>).requestIdleCallback
delete (window as unknown as Record<string, unknown>).cancelIdleCallback
const cancelFallback = scheduleIdleWork(() => applied.push('fallback'))
assert.equal(mode, 'timer', 'WebViews without idle callbacks still maintain caches')
const fallback = [...pending.values()][0]
cancelFallback(); fallback()
assert.deepEqual(applied, ['current later state'], 'the legacy timer path preserves cancellation')
console.log('Startup idle work: deferred execution, latest request, one-shot and legacy cancellation passed')
