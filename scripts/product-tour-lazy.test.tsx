import assert from 'node:assert/strict'
import React, { act, useEffect } from 'react'
import { parseHTML } from 'linkedom'

const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
const document = window.document
Object.assign(globalThis, {
  window, document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver, React, IS_REACT_ACT_ENVIRONMENT: true,
})
const media = { matches: false, addEventListener() {}, removeEventListener() {} }
Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => media })
const saved = new Map<string, string>([['newsnook:tour-seen','true']])
Object.assign(globalThis, { localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem(key: string, val: string) { saved.set(key, val) } } })
const frames: Array<FrameRequestCallback> = []
Object.assign(globalThis, {
  requestAnimationFrame: (callback: FrameRequestCallback) => (frames.push(callback), frames.length),
  cancelAnimationFrame: () => {},
})
const { createRoot } = await import('react-dom/client')
const { useProductTour } = await import('../src/features/productTour/useProductTour')
let controls!: ReturnType<typeof useProductTour>
function Harness({ ready }: { ready: boolean }) {
  controls = useProductTour({ ready, setTab: () => {} })
  return React.createElement('main', null, 'App home')
}
const root = createRoot(document.getElementById('root')!)
const runFrame = async () => {
  const next = frames.shift()
  assert.ok(next, 'expected a scheduled animation frame')
  await act(async () => next(performance.now()))
}
try {
  await act(async () => root.render(React.createElement(Harness, { ready: false })))
  assert.equal(controls.stopIfActive(), false)
  await act(async () => controls.start())
  assert.equal(frames.length, 1, 'replay waits for the home-screen render')
  assert.equal(controls.stopIfActive(), true, 'Back can cancel a pending tour before it loads')
  await runFrame()
  assert.equal(frames.length, 0, 'cancelled tour must not request the second frame or load driver.js')
  assert.equal(controls.stopIfActive(), false)

  await act(async () => controls.start())
  await act(async () => root.render(React.createElement(Harness, { ready: false })))
  await act(async () => controls.stopIfActive())
  await runFrame()
  assert.equal(frames.length, 0, 'a second cancelled request cannot start a stale tour')
  console.log('Product tour lazy loading: stale/cancelled tours do not load the heavy driver')
} finally {
  await act(async () => root.unmount())
}
