import assert from 'node:assert/strict'
import React, { act, useState } from 'react'
import { parseHTML } from 'linkedom'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true })
const captures = new WeakMap<HTMLElement, Set<number>>()
window.HTMLElement.prototype.setPointerCapture = function (id) { captures.set(this, new Set([...(captures.get(this) ?? []), id])) }
window.HTMLElement.prototype.hasPointerCapture = function (id) { return captures.get(this)?.has(id) ?? false }
window.HTMLElement.prototype.releasePointerCapture = function (id) { captures.get(this)?.delete(id) }
window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 600 }) as DOMRect
window.HTMLElement.prototype.scrollTo = function (options: ScrollToOptions) { this.scrollLeft = options.left ?? 0 }
const { createRoot } = await import('react-dom/client')
const { ImageLightbox } = await import('../src/components/ImageLightbox')
const items = [1, 2, 3].map((n) => ({ src: `https://example.com/${n}.jpg`, alt: `图片${n}` }))
let closed = false
function Fixture({ single = false }: { single?: boolean }) {
  const [index, setIndex] = useState(1)
  const gallery = single ? [items[0]] : items
  const current = single ? 0 : index
  return <ImageLightbox {...gallery[current]} items={gallery} index={current} total={gallery.length}
    onSelect={setIndex} onPrevious={current > 0 ? () => setIndex(current - 1) : undefined}
    onNext={current < gallery.length - 1 ? () => setIndex(current + 1) : undefined} onClose={() => { closed = true }} />
}
const root = createRoot(document.getElementById('root')!)
const selected = () => document.querySelector('[aria-label="图片缩略图"] button[aria-current="true"]')?.getAttribute('aria-label')
async function pointer(type: string, x: number, y = 100, id = 1) {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', buttons: 1 })
  await act(async () => document.querySelector('[data-image-stage]')!.dispatchEvent(event))
}
async function finishSlide() {
  const track = document.querySelector('[data-image-track]')!
  await act(async () => track.dispatchEvent(Object.assign(new window.Event('transitionend', { bubbles: true }), { propertyName: 'transform' })))
}
try {
  await act(async () => root.render(<Fixture />))
  assert.equal(selected(), '查看第 2 张图片', 'thumbnail selection must match the opening image')
  await act(async () => (document.querySelector('[aria-label="查看第 1 张图片"]') as HTMLButtonElement).click())
  assert.equal(selected(), '查看第 1 张图片')
  await pointer('pointerdown', 250)
  await pointer('pointermove', 100)
  const track = document.querySelector<HTMLElement>('[data-image-track]')
  assert.ok(track, 'a swipe must move a strip containing the current and adjacent images')
  assert.ok(track.querySelector('img[src="https://example.com/2.jpg"]'), 'next image must already be rendered during dragging')
  const incoming = track.querySelector<HTMLImageElement>('img[src="https://example.com/2.jpg"]')!
  Object.defineProperties(incoming, {
    naturalWidth: { value: 900, configurable: true },
    naturalHeight: { value: 1100, configurable: true },
    complete: { value: true, configurable: true },
  })
  await act(async () => incoming.dispatchEvent(new window.Event('load')))
  assert.match(track.style.transform, /-150px/, 'the strip follows the finger before release')
  await pointer('pointerup', 100)
  assert.equal(selected(), '查看第 1 张图片', 'keep the current image until the slide finishes')
  assert.match(track.style.transform, /-100%/, 'animate the incoming image to the viewport center')
  const landedTransform = track.style.transform
  const landedImageClass = incoming.className
  const landedImageLayer = incoming.style.willChange
  const landedImageSize = [incoming.style.width, incoming.style.height]
  await finishSlide()
  assert.equal(selected(), '查看第 2 张图片', 'left swipe advances without closing')
  assert.equal(track.style.transform, landedTransform, 'committing a landed image must not jump the track back to another coordinate system')
  assert.equal(incoming.className, landedImageClass, 'the landed image keeps its sizing mode at handoff')
  assert.equal(incoming.style.willChange, landedImageLayer, 'the landed image keeps its compositor layer at handoff')
  assert.deepEqual([incoming.style.width, incoming.style.height], landedImageSize, 'handoff does not resize the already visible image')
  assert.equal(track.querySelector('img[src="https://example.com/2.jpg"]'), incoming, 'reuse the loaded incoming image instead of remounting it at completion')
  assert.equal(incoming.style.opacity, '1', 'the incoming image stays visible after becoming current')
  assert.equal(Number.parseFloat(incoming.style.width), 390, 'the newly current ref fits the loaded image to the stage width')
  assert.ok(Math.abs(Number.parseFloat(incoming.style.height) - 390 * 1100 / 900) < 0.01, 'fit preserves the image aspect ratio')
  assert.equal(document.querySelector('[role="status"]'), null, 'a preloaded incoming image does not flash a loading state')
  assert.equal(closed, false)
  await pointer('pointerdown', 100)
  await pointer('pointermove', 250)
  assert.ok(track.querySelector('img[src="https://example.com/1.jpg"]'), 'previous image must be ready during a rightward drag')
  await pointer('pointerup', 250)
  await finishSlide()
  assert.equal(selected(), '查看第 1 张图片', 'right swipe goes back')
  await pointer('pointerdown', 100)
  await pointer('pointermove', 250)
  assert.match(track.style.transform, /33px/, 'first image resists pulling beyond the gallery boundary')
  await pointer('pointerup', 250)
  assert.equal(selected(), '查看第 1 张图片')
  await act(async () => document.dispatchEvent(Object.assign(new window.Event('keydown', { bubbles: true }), { key: 'ArrowRight' })))
  assert.equal(selected(), '查看第 2 张图片', 'desktop arrow keys switch images')
  await pointer('pointerdown', 250)
  await pointer('pointermove', 220)
  await pointer('pointerup', 220)
  assert.match(track.style.transform, /-100%/, 'a short drag rebounds to the current image')
  await finishSlide()
  assert.equal(selected(), '查看第 2 张图片')
  await pointer('pointerdown', 250)
  await pointer('pointermove', 100)
  await pointer('pointercancel', 100)
  assert.match(track.style.transform, /-100%/, 'canceling a drag restores the strip')
  await finishSlide()
  assert.equal(selected(), '查看第 2 张图片', 'a canceled drag never commits a slide')
  await pointer('pointerdown', 250)
  await pointer('pointermove', 100)
  await pointer('pointerup', 100)
  await act(async () => (document.querySelector('[aria-label="查看第 1 张图片"]') as HTMLButtonElement).click())
  await finishSlide()
  assert.equal(selected(), '查看第 1 张图片', 'thumbnail selection cancels a pending swipe')
  await act(async () => (document.querySelector('[aria-label="查看第 2 张图片"]') as HTMLButtonElement).click())
  await pointer('pointerdown', 100, 100, 1)
  await pointer('pointerdown', 200, 100, 2)
  await pointer('pointermove', 300, 100, 2)
  await pointer('pointerup', 300, 100, 2)
  await pointer('pointerup', 100, 100, 1)
  await pointer('pointerdown', 250)
  await pointer('pointermove', 100)
  await pointer('pointerup', 100)
  assert.equal(selected(), '查看第 2 张图片', 'panning a zoomed image must not switch the gallery')
  assert.match(incoming.style.transform, /scale\(2, 2\)/, 'pinch zoom retains its scale during a pan')
  assert.match(incoming.style.transform, /translate3d\(-155px/, 'the current image ref receives the bounded zoomed pan')
  assert.equal(closed, false)
  await act(async () => root.render(<Fixture key="single" single />))
  assert.equal(document.querySelector('[aria-label="图片缩略图"]'), null, 'single image has no filmstrip')
  await act(async () => root.render(<Fixture key="fallback" />))
  await pointer('pointerdown', 250)
  await pointer('pointermove', 100)
  await pointer('pointerup', 100)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })
  assert.equal(selected(), '查看第 3 张图片', 'the slide commits even if a transitionend event is lost')
  window.matchMedia = (() => ({ matches: true })) as typeof window.matchMedia
  await pointer('pointerdown', 100)
  await pointer('pointermove', 250)
  await pointer('pointerup', 250)
  assert.equal(selected(), '查看第 2 张图片', 'reduced motion switches without waiting for an animation')
  const failed = document.querySelector<HTMLImageElement>('[data-image-track] img[alt="图片2"]')!
  await act(async () => failed.dispatchEvent(new window.Event('error')))
  const retry = document.querySelector<HTMLButtonElement>('[data-image-stage] button:not([aria-label])')!
  assert.ok(retry?.textContent?.includes('重新加载图片'), 'a failed current image exposes retry')
  const retryDown = Object.assign(new window.Event('pointerdown', { bubbles: true }), { pointerId: 5, clientX: 100, clientY: 100, pointerType: 'touch', buttons: 1 })
  await act(async () => retry.dispatchEvent(retryDown))
  assert.equal(captures.get(document.querySelector<HTMLElement>('[data-image-stage]')!)?.has(5) ?? false, false, 'retry does not start a stage gesture or capture its click')
  await act(async () => retry.click())
  const replacement = document.querySelector<HTMLImageElement>('[data-image-track] img[alt="图片2"]')!
  assert.notEqual(replacement, failed, 'retry creates a fresh image request')
  const nextAfterRetry = document.querySelector<HTMLImageElement>('[data-image-track] img[src="https://example.com/3.jpg"]')!
  await act(async () => nextAfterRetry.dispatchEvent(new window.Event('load')))
  await pointer('pointerdown', 250)
  await pointer('pointermove', 100)
  await pointer('pointerup', 100)
  assert.equal(selected(), '查看第 3 张图片')
  assert.equal(document.querySelector('[data-image-track] img[alt="图片3"]'), nextAfterRetry, 'retrying one image must not remount the next loaded slide')
} finally {
  await act(async () => root.unmount())
}
console.log('image-lightbox-view: ok')
