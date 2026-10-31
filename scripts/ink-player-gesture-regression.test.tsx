import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import { BOOST_RATE, HUD_LINGER_MS, LONG_PRESS_MS } from '../src/components/inkVideoPlayer/playback'

/**
 * Regression for real React pointer-handler sequencing, not just the pure
 * coordinate helpers. Android emits several independent pointerup/cancel events.
 */
const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
  React, IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} disconnect() {} },
})
Object.assign(window, { innerWidth: 400, innerHeight: 800 })
window.getComputedStyle = (() => ({
  overflow: 'visible', overflowY: 'visible', getPropertyValue: () => '0px',
})) as typeof getComputedStyle

const make = document.createElement.bind(document)
document.createElement = ((tag: string, options?: ElementCreationOptions) => {
  const el = make(tag, options)
  if (tag === 'video') Object.assign(el, {
    currentTime: 20, duration: 90, paused: true, readyState: 1,
    videoWidth: 1280, videoHeight: 720, buffered: { length: 0 },
    volume: 1, muted: false, playbackRate: 1, defaultPlaybackRate: 1,
    canPlayType: () => '',
    load() { this.paused = true },
    async play() { this.paused = false; this.dispatchEvent(new window.Event('play')) },
    pause() { this.paused = true; this.dispatchEvent(new window.Event('pause')) },
  })
  return el
}) as typeof document.createElement

const { createRoot } = await import('react-dom/client')
const { InkVideoPlayer } = await import('../src/components/InkVideoPlayer')
const root = createRoot(document.getElementById('root')!)
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

try {
  await act(async () => root.render(<InkVideoPlayer src="https://example.org/video.mp4" title="手势回归" mediaPageHost={false} />))
  const video = document.querySelector<HTMLVideoElement>('video')!
  await act(async () => video.dispatchEvent(new window.Event('canplay')))
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="全屏"]')!.click())
  assert.ok(document.querySelector('[data-video-fullscreen="true"]'), 'gesture test must run fullscreen')
  await act(async () => video.play())

  const surface = document.querySelector<HTMLElement>('[data-video-gesture-surface]')!
  assert.ok(surface)
  const capture = new Set<number>()
  Object.assign(surface, {
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 400, bottom: 800, x: 0, y: 0, width: 400, height: 800 }
    },
    setPointerCapture(id: number) { capture.add(id) },
    hasPointerCapture(id: number) { return capture.has(id) },
    releasePointerCapture(id: number) { capture.delete(id) },
  })

  const pointer = async (type: string, id: number, x: number, y: number) => {
    const evt = new window.Event(type, { bubbles: true, cancelable: true })
    Object.assign(evt, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', button: 0, buttons: 1, isPrimary: id === 1 })
    await act(async () => { surface.dispatchEvent(evt); await Promise.resolve() })
  }
  const hud = (kind: string) => document.querySelector('[data-ink-hud="' + kind + '"]')
  const afterHud = async () => { await act(async () => { await pause(HUD_LINGER_MS + 85) }) }

  // Downward-only strokes in the upper half must work without an initial upward movement.
  await pointer('pointerdown', 1, 90, 180)
  await pointer('pointermove', 1, 92, 280)
  assert.ok(hud('brightness'), 'left side first downward stroke must show brightness')
  assert.ok(Number(document.querySelector('[data-ink-hud="brightness"]')?.getAttribute('aria-label')?.match(/\d+/)?.[0] ?? 100) < 100)
  await pointer('pointerup', 1, 92, 280)
  await afterHud()
  assert.equal(hud('brightness'), null, 'brightness HUD dismisses after pointerup')

  await pointer('pointerdown', 2, 325, 190)
  await pointer('pointermove', 2, 325, 295)
  assert.ok(hud('volume'), 'right side first downward stroke must show volume')
  assert.ok(video.volume < 1, 'volume decreases immediately on the downward stroke')
  await pointer('pointerup', 2, 325, 295)
  await afterHud()
  assert.equal(hud('volume'), null, 'volume HUD dismisses after pointerup')

  // First pointer lifting must not convert the remaining finger into a tap.
  await pointer('pointerdown', 3, 160, 310)
  await pointer('pointerdown', 4, 240, 310)
  await pointer('pointermove', 4, 320, 310)
  assert.ok(hud('center'), 'pinch must show zoom HUD')
  const zoomText = hud('center')?.textContent ?? ''
  assert.match(zoomText, /%/)
  await pointer('pointerup', 3, 160, 310)
  await pointer('pointermove', 4, 330, 310)
  await pointer('pointerup', 4, 330, 310)
  await afterHud()
  assert.equal(hud('center'), null, 'HUD must fade after the last pinch pointer lifts')

  // Long-press boost must still work on an already zoomed picture.
  await pointer('pointerdown', 5, 210, 305)
  await act(async () => { await pause(LONG_PRESS_MS + 60) })
  assert.equal(video.playbackRate, BOOST_RATE, 'boost must work at zoom > 1')
  await pointer('pointerup', 5, 210, 305)
  assert.equal(video.playbackRate, 1, 'boost must restore user playback rate on release')

  // Android may cancel either finger rather than emitting two normal pointerups.
  await pointer('pointerdown', 6, 160, 310)
  await pointer('pointerdown', 7, 240, 310)
  await pointer('pointermove', 7, 300, 310)
  assert.ok(hud('center'))
  await pointer('pointercancel', 6, 160, 310)
  assert.equal(capture.size, 0, 'cancelling one finger releases every captured pinch pointer')
  await pointer('pointerup', 7, 300, 310) // stale terminal event after cancel
  await afterHud()
  assert.equal(hud('center'), null, 'pointercancel always clears zoom HUD')
  assert.equal(video.paused, false, 'stale second-finger pointerup must not toggle playback')

  // Losing pointer capture must also close the transaction.
  await pointer('pointerdown', 8, 160, 310)
  await pointer('pointerdown', 9, 240, 310)
  await pointer('pointermove', 9, 300, 310)
  assert.ok(hud('center'))
  await pointer('lostpointercapture', 8, 160, 310)
  assert.equal(capture.size, 0, 'unexpected capture loss cleans up the other finger as well')
  await afterHud()
  assert.equal(hud('center'), null, 'lost pointer capture must not leave HUD stuck')
  await pointer('pointerup', 9, 300, 310)

  console.log('ink-player-gesture-regression: downward-first brightness/volume, pinch, cancellation, lost capture, post-zoom boost OK')
} finally {
  await act(async () => root.unmount())
}
