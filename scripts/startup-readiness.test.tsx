import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import React, { act, lazy, Suspense } from 'react'
import { parseHTML } from 'linkedom'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
})
let nextFrame = 0
const frames = new Map<number, FrameRequestCallback>()
Object.assign(window, {
  requestAnimationFrame: (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id },
  cancelAnimationFrame: (id: number) => frames.delete(id),
})
const frame = async () => {
  const pending = [...frames.values()]
  frames.clear()
  await act(async () => { pending.forEach(callback => callback(performance.now())) })
}
assert.ok(existsSync(new URL('../src/components/StartupReadiness.tsx', import.meta.url)),
  'Startup completion needs an explicit gate for unresolved local restoration and Suspense surfaces')
const { StartupReadinessProvider, StartupPending } = await import('../src/components/StartupReadiness')
const { useStartupBlocker } = await import('../src/hooks/useStartupReadiness')
const { createRoot } = await import('react-dom/client')
let reported = 0
const onReady = () => { reported += 1 }
const root = createRoot(document.getElementById('root')!)
function Restore({ pending }: { pending: boolean }) {
  useStartupBlocker(pending)
  return <main>{pending ? 'Restoring local cache' : 'Cached headlines and controls'}</main>
}
try {
  await act(async () => root.render(<React.StrictMode><StartupReadinessProvider onReady={onReady}><Restore pending /></StartupReadinessProvider></React.StrictMode>))
  await frame(); await frame()
  assert.equal(reported, 0, 'a committed shell must not report while required local state is restoring')
  assert.equal(frames.size, 0, 'pending restoration waits for an event rather than polling each frame')

  await act(async () => root.render(<React.StrictMode><StartupReadinessProvider onReady={onReady}><Restore pending={false} /></StartupReadinessProvider></React.StrictMode>))
  await frame()
  assert.equal(reported, 0, 'a layout commit is not a displayed frame')
  await act(async () => root.render(<React.StrictMode><StartupReadinessProvider onReady={onReady}><Restore pending /></StartupReadinessProvider></React.StrictMode>))
  await frame()
  assert.equal(reported, 0, 'new blocking work cancels an already scheduled completion frame')

  let resolvePage!: (module: { default: React.ComponentType }) => void
  const Page = lazy(() => new Promise<{ default: React.ComponentType }>(resolve => { resolvePage = resolve }))
  const surface = <StartupReadinessProvider onReady={onReady}><Suspense fallback={<StartupPending><div>Opening restored reader</div></StartupPending>}><Page /></Suspense></StartupReadinessProvider>
  await act(async () => root.render(surface))
  await frame(); await frame()
  assert.equal(reported, 0, 'a restored reader or community fallback is not the requested surface')
  assert.match(document.body.textContent ?? '', /Opening restored reader/)
  await act(async () => resolvePage({ default: () => <article>Restored reader controls</article> }))
  await frame(); await frame()
  assert.equal(reported, 1, 'the first committed usable surface reports after a browser frame')
  assert.match(document.body.textContent ?? '', /Restored reader controls/)

  await act(async () => root.render(<StartupReadinessProvider onReady={onReady}><Restore pending /></StartupReadinessProvider>))
  await act(async () => root.render(<StartupReadinessProvider onReady={onReady}><Restore pending={false} /></StartupReadinessProvider>))
  await frame(); await frame()
  assert.equal(reported, 1, 'later navigation cannot report startup a second time')

  await act(async () => root.render(null))
  await act(async () => root.render(<StartupReadinessProvider onReady={onReady}><main>First-use reading style choice</main></StartupReadinessProvider>))
  await frame()
  await act(async () => root.render(null))
  await frame()
  assert.equal(reported, 1, 'unmount cancels a pending completion callback')

  await act(async () => root.render(<StartupReadinessProvider onReady={onReady}><main>First-use reading style choice</main></StartupReadinessProvider>))
  await frame(); await frame()
  assert.equal(reported, 2, 'first-use controls can be ready without fetching articles')

  await act(async () => root.render(null))
  const UnderlyingPage = lazy(() => new Promise<{ default: React.ComponentType }>(() => {}))
  const layeredSurface = (overlay: boolean, overlayPending: boolean) => (
    <StartupReadinessProvider onReady={onReady}>
      <Suspense fallback={<StartupPending pending={!overlay}><main>Opening underlying community</main></StartupPending>}>
        <UnderlyingPage />
      </Suspense>
      {overlay && <StartupPending pending={overlayPending}><aside>Browser controls</aside></StartupPending>}
    </StartupReadinessProvider>
  )
  await act(async () => root.render(layeredSurface(false, false)))
  await frame(); await frame()
  assert.equal(reported, 2, 'the selected unresolved community still blocks')
  await act(async () => root.render(layeredSurface(true, true)))
  await frame(); await frame()
  assert.equal(reported, 2, 'an overlay must resolve its own surface before bypassing the covered page')
  await act(async () => root.render(layeredSurface(true, false)))
  await frame(); await frame()
  assert.equal(reported, 3, 'a usable overlay is not delayed by the covered community fallback')
  assert.match(document.body.textContent ?? '', /Opening underlying community/)
} finally {
  await act(async () => root.unmount())
}
console.log('Startup readiness: local restore, Suspense, cancellation, StrictMode and one-shot reporting passed')
