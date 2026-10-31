import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mock } from 'node:test'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import type { BrowserRecoverySession } from '../src/features/browser/useBrowserSession'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const recovery = deferred<BrowserRecoverySession | null>()
const workspace = deferred<void>()
const browserCss = deferred<void>()
const agentCss = deferred<void>()
let recoveryReads = 0
let browserRegistrations = 0
mock.module('@capacitor/core', { namedExports: {
  WebPlugin: class {}, CapacitorHttp: {}, Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true },
  registerPlugin: (name: string) => {
    if (name === 'NewsNookBrowser') browserRegistrations++
    return { takeRecoverySession: async () => { recoveryReads++; return { session: await recovery.promise } } }
  },
} })

const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
const document = window.document
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
const requestFrame = (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId }
const cancelFrame = (id: number) => { frames.delete(id) }
Object.assign(window, { requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame })
Object.assign(globalThis, {
  window, document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver, React, IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame,
})

type WorkspaceProps = { initialUrl?: string; recoverySession?: BrowserRecoverySession; onExit: () => void }
Object.assign(globalThis, { __browserLauncherStartupTest: {
  workspace, browserCss, agentCss,
  renderWorkspace: ({ initialUrl, recoverySession, onExit }: WorkspaceProps) =>
    <section aria-label="Browser content" data-url={initialUrl ?? recoverySession?.tabs[0]?.url}>
      <button onClick={onExit}>Exit browser</button>
    </section>,
} })
// Keep the real Suspense/recovery state machine; hold each child JS/CSS chunk independently.
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (new URL(url).pathname.endsWith('/features/browser/BrowserWorkspace.tsx')) {
      return { format: 'module', shortCircuit: true, source:
        'await globalThis.__browserLauncherStartupTest.workspace.promise;\n'
        + 'export const BrowserWorkspace = globalThis.__browserLauncherStartupTest.renderWorkspace;' }
    }
    if (new URL(url).pathname.endsWith('/features/browser/browser.css')) {
      return { format: 'module', shortCircuit: true, source:
        'await globalThis.__browserLauncherStartupTest.browserCss.promise;' }
    }
    if (new URL(url).pathname.endsWith('/features/browser/agent/agent.css')) {
      return { format: 'module', shortCircuit: true, source:
        'await globalThis.__browserLauncherStartupTest.agentCss.promise;' }
    }
    return nextLoad(url, context)
  },
})

const { createRoot } = await import('react-dom/client')
const { BrowserLauncher } = await import('../src/features/browser/BrowserLauncher')
const { StartupReadinessProvider } = await import('../src/components/StartupReadiness')
const { openBrowserWithUrl } = await import('../src/features/browser/browserOpen')
const root = createRoot(document.getElementById('root')!)
let readyCalls = 0
const onReady = () => { readyCalls++ }
const visibilityChanges: boolean[] = []
const onVisibilityChange = (visible: boolean) => { visibilityChanges.push(visible) }
function Harness() {
  return <React.StrictMode><StartupReadinessProvider onReady={onReady}>
    <main>Cached home feed</main><BrowserLauncher onVisibilityChange={onVisibilityChange}/>
  </StartupReadinessProvider></React.StrictMode>
}
async function frame() {
  const callbacks = [...frames.values()]
  frames.clear()
  await act(async () => callbacks.forEach(callback => callback(performance.now())))
}

try {
  await act(async () => root.render(<Harness/>))
  assert.equal(visibilityChanges.at(-1), false, 'startup reports that no browser overlay is selected yet')
  assert.equal(recoveryReads, 1, 'StrictMode shares one native recovery read')
  assert.equal(browserRegistrations, 1, 'startup recovery registers one native browser plugin')
  await frame()
  await frame()
  assert.equal(readyCalls, 0, 'unresolved native recovery cannot report the home feed as the initial ready surface')
  assert.equal(frames.size, 0, 'a pending recovery waits for its result without polling animation frames')

  await act(async () => openBrowserWithUrl('https://example.test/explicit'))
  assert.equal(visibilityChanges.at(-1), true, 'a selected browser overlay supersedes the background feed even while chunks load')
  assert.match(document.body.textContent ?? '', /正在打开浏览器/)
  await frame()
  await frame()
  assert.equal(readyCalls, 0, 'an explicit browser entry still waits for its lazy workspace content')

  await act(async () => {
    workspace.resolve()
    await import('../src/features/browser/BrowserWorkspace')
  })
  assert.ok(!document.querySelector('[aria-label="Browser content"]'), 'loaded browser code must wait for its styles before mounting')
  await frame()
  await frame()
  assert.equal(readyCalls, 0, 'loaded browser code with pending CSS is not a usable initial surface')
  await act(async () => {
    browserCss.resolve()
    await import('../src/features/browser/browser.css')
  })
  await frame()
  await frame()
  assert.ok(!document.querySelector('[aria-label="Browser content"]'), 'agent chrome styles are required along with browser styles')
  assert.equal(readyCalls, 0)
  await act(async () => {
    agentCss.resolve()
    await import('../src/features/browser/agent/agent.css')
  })
  assert.equal(document.querySelector('[aria-label="Browser content"]')?.getAttribute('data-url'), 'https://example.test/explicit')
  assert.equal(readyCalls, 0)
  await frame()
  assert.equal(readyCalls, 0, 'the workspace must reach its rendering frame before ready')
  await frame()
  assert.equal(readyCalls, 1)

  await act(async () => recovery.resolve({
    activeIndex: 0,
    tabs: [{ url: 'https://example.test/stale-recovery', title: 'Old page', desktop: false }],
  }))
  assert.equal(document.querySelector('[aria-label="Browser content"]')?.getAttribute('data-url'), 'https://example.test/explicit',
    'the user-selected URL supersedes a late startup recovery')
  await frame()
  await frame()
  assert.equal(readyCalls, 1, 'a late recovery result cannot send a second ready notification')

  await act(async () => document.querySelector('button')!.dispatchEvent(new window.Event('click', { bubbles: true })))
  assert.equal(visibilityChanges.at(-1), false, 'exiting the browser makes the underlying initial surface relevant again')
  assert.equal(document.querySelector('[aria-label="Browser content"]'), null)
  await act(async () => root.render(null))
  await act(async () => root.render(<Harness/>))
  await frame()
  await frame()
  assert.equal(readyCalls, 2, 'a new initial surface can become ready after the consumed recovery')
  assert.equal(recoveryReads, 1, 'remount does not read or replay a consumed native recovery')
  assert.equal(document.querySelector('[aria-label="Browser content"]'), null)

  const legacy = await import('../src/features/browser/useBrowserSession')
  const native = await import('../src/features/browser/nativeBrowser')
  assert.equal(legacy.takeBrowserRecoverySession, native.takeBrowserRecoverySession, 'the legacy hook entry preserves the recovery API')
  assert.equal(browserRegistrations, 1, 'loading the full browser hook reuses the startup native plugin')
  console.log('Browser launcher startup: pending recovery, JS/CSS readiness, explicit URL race, shared plugin and one-shot readiness passed')
} finally {
  workspace.resolve()
  browserCss.resolve()
  agentCss.resolve()
  recovery.resolve(null)
  await act(async () => root.unmount())
  hooks.deregister()
  mock.restoreAll()
  delete (globalThis as Record<string, unknown>).__browserLauncherStartupTest
}
