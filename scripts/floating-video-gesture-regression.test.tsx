import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import { BOOST_RATE, HUD_LINGER_MS, LONG_PRESS_MS } from '../src/components/inkVideoPlayer/playback'

// Exercise the actual floating frame and the same retained player DOM node.
// Synthetic browser events must go through React's capture + bubble phases.
const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
  React, IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0),
  cancelAnimationFrame: clearTimeout,
})
Object.assign(window, { innerWidth: 390, innerHeight: 844 })
window.getComputedStyle = (() => ({
  overflow: 'visible', overflowY: 'visible', getPropertyValue: () => '0px',
})) as typeof getComputedStyle
const originalCreate = document.createElement.bind(document)
document.createElement = ((tag: string, options?: ElementCreationOptions) => {
  const element = originalCreate(tag, options)
  if (tag === 'video') Object.assign(element, {
    currentTime: 30, duration: 120, paused: true, readyState: 1, ended: false,
    videoWidth: 1920, videoHeight: 1080, volume: 1, muted: false,
    buffered: { length: 0 }, playbackRate: 1, defaultPlaybackRate: 1,
    canPlayType: () => '', load() { this.paused = true },
    async play() { this.paused = false; this.dispatchEvent(new window.Event('play')) },
    pause() { this.paused = true; this.dispatchEvent(new window.Event('pause')) },
  })
  return element
}) as typeof document.createElement
const { createRoot } = await import('react-dom/client')
const { InkVideoPlayer } = await import('../src/components/InkVideoPlayer')
const { FloatingVideoProvider } = await import('../src/features/floatingVideo/FloatingVideoProvider')
const root = createRoot(document.getElementById('root')!)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const capture = new Map<HTMLElement, Set<number>>()
function simulateCapture(target: HTMLElement) {
  const ids = new Set<number>()
  capture.set(target, ids)
  Object.assign(target, {
    setPointerCapture(id: number) { ids.add(id) },
    hasPointerCapture(id: number) { return ids.has(id) },
    releasePointerCapture(id: number) { ids.delete(id) },
  })
}
try {
  await act(async () => root.render(<FloatingVideoProvider>
    <InkVideoPlayer src="https://example.org/floating.mp4" title="小窗手势回归" />
  </FloatingVideoProvider>))
  const video = document.querySelector<HTMLVideoElement>('video')!
  await act(async () => {
    video.dispatchEvent(new window.Event('loadedmetadata'))
    video.dispatchEvent(new window.Event('durationchange'))
    video.dispatchEvent(new window.Event('canplay'))
    await video.play()
  })
  const float = document.querySelector<HTMLButtonElement>('button[aria-label="悬浮播放"]')
  assert.ok(float)
  await act(async () => { float.click(); await delay(15) })
  const frame = document.querySelector<HTMLElement>('[data-floating-video-window]')!
  const surface = frame.querySelector<HTMLElement>('[data-video-gesture-surface]')!
  assert.ok(surface && frame.querySelector('[data-video-compact]'))
  const sameVideo = video
  simulateCapture(surface)
  simulateCapture(frame)
  const windowRect = () => ({
    left: Number.parseFloat(frame.style.left), top: Number.parseFloat(frame.style.top),
    width: Number.parseFloat(frame.style.width), height: Number.parseFloat(frame.style.height),
  })
  Object.assign(surface, { getBoundingClientRect: () => {
    const r = windowRect()
    return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height }
  } })
  const coords = (x: number, y: number) => {
    const r = windowRect()
    return { x: r.left + r.width * x, y: r.top + r.height * y }
  }
  const pointer = async (type: string, id: number, x: number, y: number,
    target: HTMLElement = surface, pointerType = 'touch') => {
    const point = coords(x, y)
    const event = new window.Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, {
      pointerId: id, pointerType, button: 0, buttons: 1,
      isPrimary: id === 1, clientX: point.x, clientY: point.y,
    })
    await act(async () => { target.dispatchEvent(event); await Promise.resolve() })
  }
  const hud = (type: string) => frame.querySelector<HTMLElement>('[data-ink-hud="' + type + '"]')
  const boostedNotice = () => frame.textContent?.includes('2.5x 快进中') === true
  const settleHud = async () => {
    await act(async () => { await delay(HUD_LINGER_MS + 85) })
    assert.equal(frame.querySelector('[data-ink-hud]'), null, 'gesture HUD must dismiss after release')
  }
  const swipe = async (id: number, x1: number, y1: number, x2: number, y2: number) => {
    await pointer('pointerdown', id, x1, y1)
    await pointer('pointermove', id, x2, y2)
    await pointer('pointerup', id, x2, y2)
  }
  // Full-width seek gesture inside a small window (with precision floor for width).
  const beforeForward = video.currentTime
  await pointer('pointerdown', 1, .24, .50)
  await pointer('pointermove', 1, .80, .52)
  assert.ok(hud('top'), 'right swipe should preview forward seek in floating mode')
  assert.equal(video.currentTime, beforeForward, 'seeking must not restart streaming until pointerup')
  await pointer('pointerup', 1, .80, .52)
  assert.ok(video.currentTime > beforeForward, 'right swipe commits a forward seek')
  await settleHud()
  const beforeRewind = video.currentTime
  await swipe(2, .80, .52, .23, .53)
  assert.ok(video.currentTime < beforeRewind, 'left swipe commits a backward seek')
  await settleHud()

  await pointer('pointerdown', 3, .22, .27)
  await pointer('pointermove', 3, .22, .73)
  assert.ok(hud('brightness'), 'first downward left swipe must work in mini-player')
  await pointer('pointerup', 3, .22, .73)
  await settleHud()
  const volumeBefore = video.volume
  await pointer('pointerdown', 4, .79, .26)
  await pointer('pointermove', 4, .79, .73)
  assert.ok(hud('volume'), 'first downward right swipe must work in mini-player')
  assert.ok(video.volume < volumeBefore)
  await pointer('pointerup', 4, .79, .73)
  await settleHud()

  await pointer('pointerdown', 5, .54, .44)
  await act(async () => { await delay(LONG_PRESS_MS + 65) })
  assert.equal(video.playbackRate, BOOST_RATE, 'mini-player long press enables 2.5x boost')
  assert.ok(boostedNotice(), 'the acceleration indicator only appears during active boost')
  assert.equal(frame.querySelector('.ink-video-mini-toggle'), null, 'the big center control must not cover footage during boost')
  await pointer('pointerup', 5, .54, .44)
  assert.equal(video.playbackRate, 1, 'long press restores the user-selected rate')
  assert.equal(boostedNotice(), false, 'normal pointer release dismisses boost indicator immediately')

  // Android can send pointercancel instead of pointerup (window resize,
  // system gesture, another finger). Cancellation must restore both rate and UI.
  await pointer('pointerdown', 51, .54, .44)
  await act(async () => { await delay(LONG_PRESS_MS + 65) })
  assert.equal(video.playbackRate, BOOST_RATE)
  await pointer('pointercancel', 51, .54, .44)
  assert.equal(video.playbackRate, 1, 'pointercancel restores speed before gesture state is reset')
  assert.equal(boostedNotice(), false, 'pointercancel removes 2.5x indicator')

  await pointer('pointerdown', 52, .54, .44)
  await act(async () => { await delay(LONG_PRESS_MS + 65) })
  assert.equal(video.playbackRate, BOOST_RATE)
  capture.get(surface)!.delete(52)
  await pointer('lostpointercapture', 52, .54, .44)
  assert.equal(video.playbackRate, 1, 'capture loss returns to original rate')
  assert.equal(boostedNotice(), false, 'capture loss removes boost notice')

  // If a new touch implicitly loses capture, a stale timer must NOT boost.
  await pointer('pointerdown', 53, .54, .44)
  capture.get(surface)!.delete(53)
  await act(async () => { await delay(LONG_PRESS_MS + 65) })
  assert.equal(video.playbackRate, 1, 'no acceleration when OS already released touch capture')
  assert.equal(boostedNotice(), false)
  await pointer('pointerup', 53, .54, .44, frame)

  const beforePinchWidth = Number.parseFloat(frame.style.width)
  const beforePinchTime = video.currentTime
  await pointer('pointerdown', 6, .23, .62)
  await pointer('pointerdown', 7, .74, .62)
  await pointer('pointermove', 7, .90, .62)
  await act(async () => { await delay(30) })
  const afterPinchWidth = Number.parseFloat(frame.style.width)
  assert.ok(afterPinchWidth > beforePinchWidth, 'two fingers resize the floating FRAME')
  assert.equal(video.currentTime, beforePinchTime, 'window resizing cannot seek the video')
  assert.equal(hud('center'), null, 'window pinch must not zoom the video content')
  await pointer('pointerup', 6, .23, .62)
  await pointer('pointerup', 7, .90, .62)
  assert.equal(video, sameVideo, 'resizing must not remount or reload playback')

  // Confirm that the root did not retain ownership after a pinch.
  const afterPinchTime = video.currentTime
  await swipe(8, .25, .50, .72, .51)
  assert.ok(video.currentTime > afterPinchTime, 'single-finger seeking resumes after pinch')

  // Double taps seek by 10 seconds on the same mini-window, with no extra click toggle.
  await act(async () => delay(400))
  const tap = async (id: number, x: number) => {
    await pointer('pointerdown', id, x, .36)
    await pointer('pointerup', id, x, .36)
    const click = new window.Event('click', { bubbles: true })
    Object.assign(click, { detail: 1 })
    await act(async () => surface.dispatchEvent(click))
  }
  const timeBeforeDouble = video.currentTime
  await tap(9, .85)
  await tap(10, .85)
  assert.equal(video.currentTime, Math.min(120, timeBeforeDouble + 10),
    'double-tap right seeks 10 seconds without an extra toggle')
  await act(async () => delay(390))
  const timeBeforeLeft = video.currentTime
  await tap(11, .14)
  await tap(12, .14)
  assert.equal(video.currentTime, Math.max(0, timeBeforeLeft - 10), 'double-tap left rewinds 10 seconds')

  // Some WebView builds retarget an ending pointer to the outer captured frame.
  // The inner surface then misses pointerup; its stale pointer must not turn the
  // next one-finger long press into a fictitious two-finger gesture.
  await pointer('pointerdown', 13, .29, .47)
  capture.get(surface)!.delete(13) // OS implicitly released this capture
  await pointer('pointerup', 13, .29, .47, frame) // only the outer frame receives up
  await pointer('pointerdown', 14, .43, .47)
  await act(async () => { await delay(LONG_PRESS_MS + 65) })
  assert.equal(video.playbackRate, BOOST_RATE,
    'a lost child pointerup must not disable the following long press')
  await pointer('pointerup', 14, .43, .47)
  assert.equal(video.playbackRate, 1)
  assert.equal(boostedNotice(), false)

  // An active 2.5x boost can lose its terminal event to the floating root.
  // The document-level fallback must see the orphan and end it immediately.
  await pointer('pointerdown', 54, .43, .47)
  await act(async () => { await delay(LONG_PRESS_MS + 65) })
  assert.equal(video.playbackRate, BOOST_RATE)
  capture.get(surface)!.delete(54)
  await pointer('pointerup', 54, .43, .47, frame)
  assert.equal(video.playbackRate, 1, 'outer-frame pointerup must end an orphaned boost')
  assert.equal(boostedNotice(), false)

  // Pausing and losing app focus are terminal states even if the finger remains.
  await pointer('pointerdown', 55, .43, .47)
  await act(async () => { await delay(LONG_PRESS_MS + 65) })
  assert.equal(video.playbackRate, BOOST_RATE)
  await act(async () => { video.pause(); await Promise.resolve() })
  assert.equal(video.playbackRate, 1, 'pausing playback cancels temporary acceleration')
  assert.equal(boostedNotice(), false)
  await act(async () => { await video.play() })
  await pointer('pointerdown', 56, .43, .47)
  await act(async () => { await delay(LONG_PRESS_MS + 65) })
  assert.equal(video.playbackRate, BOOST_RATE)
  await act(async () => { window.dispatchEvent(new window.Event('blur')); await Promise.resolve() })
  assert.equal(video.playbackRate, 1, 'app/window losing focus stops boost')
  assert.equal(boostedNotice(), false)
  assert.equal(capture.get(surface)?.size, 0, 'terminal state releases child pointer captures')

  assert.equal(video.paused, false, 'none of the mini-player gesture actions pause the video')
  assert.ok(frame.isConnected, 'floating frame remains attached')
  console.log('floating-video-gesture-regression: horizontal seek, double-tap, levels, long-press, frame pinch, handoff OK')
} finally {
  await act(async () => root.unmount())
}
