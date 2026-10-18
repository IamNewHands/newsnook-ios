import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import type { BrowserImageData, BrowserImageLoadRequest, BrowserImageSnapshot } from '../src/features/browser/browserImages'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
const observed = new Map<Element, (visible: boolean) => void>()
class Observer {
  private elements: Element[] = []
  constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
  observe(element: Element) { this.elements.push(element); observed.set(element, visible => this.callback([{ isIntersecting: visible }])) }
  disconnect() { for (const element of this.elements) observed.delete(element) }
}
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver, IntersectionObserver: Observer,
  React, IS_REACT_ACT_ENVIRONMENT: true,
})
window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 600 }) as DOMRect
window.HTMLElement.prototype.getClientRects = () => [{ width: 390, height: 600 }] as unknown as DOMRectList
window.HTMLElement.prototype.scrollTo = function (options: ScrollToOptions) { this.scrollLeft = options.left ?? 0 }
window.HTMLElement.prototype.hasPointerCapture = () => false
window.HTMLElement.prototype.releasePointerCapture = () => {}
window.getComputedStyle = () => ({ visibility: 'visible' }) as CSSStyleDeclaration
const { createRoot } = await import('react-dom/client')
const { BrowserImagesPanel } = await import('../src/features/browser/BrowserImagesPanel')
const root = createRoot(document.getElementById('root')!)
const snapshot: BrowserImageSnapshot = {
  tabId: 8, documentId: 'doc-a', requestId: 'scan-a', pageUrl: 'https://news.example/article',
  truncated: true, inaccessibleFrames: 1,
  items: Array.from({ length: 28 }, (_, index) => ({
    id: 'image-' + index, sourceUrl: 'https://cdn.example/' + index + '.jpg?sig=kept',
    pageUrl: 'https://news.example/article', alt: '图 ' + index, width: index === 27 ? 32 : 800,
    height: index === 27 ? 32 : 600, kinds: ['img'], content: index !== 27, transport: 'http',
  })),
}
const requests: BrowserImageLoadRequest[] = []
const cancelled: unknown[] = []
let scans = 0, closes = 0
let holdOriginal = false
const overlay = { current: null as (() => boolean) | null }
const props = {
  snapshot, scanning: false, error: null, privateMode: true, overlayCloserRef: overlay,
  onScan: () => { scans++ }, onClose: () => { closes++ },
  cancelImageRequests: async (request: unknown) => { cancelled.push(request) },
  loadImage: async (request: BrowserImageLoadRequest): Promise<BrowserImageData> => {
    requests.push(request)
    if (request.original && holdOriginal) await new Promise<void>(() => {})
    return { ...request, dataUrl: 'data:image/png;base64,AQID', mimeType: 'image/png',
      byteLength: 3, width: 1, height: 1, reduced: false }
  },
}
function button(label: string) {
  const element = [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label)
  assert.ok(element, '缺少按钮：' + label)
  return element
}
async function click(label: string) {
  await act(async () => { button(label).dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true })) })
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }

try {
  await act(async () => root.render(<React.StrictMode><BrowserImagesPanel {...props}/></React.StrictMode>))
  assert.equal(document.querySelectorAll('button[aria-label^="查看："]').length, 24, 'a grid page mounts at most 24 images')
  assert.equal(requests.length, 0, 'metadata alone does not start image requests before intersection')
  assert.ok(document.body.textContent?.includes('内容图片 27'))
  assert.ok(document.body.textContent?.includes('全部图片 28'))
  assert.ok(document.body.textContent?.includes('1 个跨站'))
  await act(async () => { for (const notify of [...observed.values()].slice(0, 2)) notify(true) })
  await flush()
  assert.equal(requests.filter(item => item.thumbnail).length, 2)
  assert.ok([...document.querySelectorAll('img')].every(img => img.getAttribute('src')?.startsWith('blob:')),
    'signed remote and page-origin URLs never become shell image src attributes')
  await click('下一页图片')
  assert.equal(document.querySelectorAll('button[aria-label^="查看："]').length, 3)
  await click('全部图片 28')
  assert.equal(document.querySelectorAll('button[aria-label^="查看："]').length, 24)
  await click('下一页图片')
  assert.equal(document.querySelectorAll('button[aria-label^="查看："]').length, 4, 'small decorative images remain reachable in all images')
  await click('上一页图片')
  await click('查看：图 1')
  await flush()
  assert.ok(document.querySelector('[aria-label="查看图片"]'), 'the existing ImageLightbox is used')
  const viewer = document.querySelector('[data-browser-image-viewer]')!
  assert.ok(viewer.textContent?.includes('隐私'), 'private identity remains visible inside the full-screen viewer')
  assert.ok(viewer.classList.contains('bg-ink') && !viewer.classList.contains('bg-ink/98'), 'browser viewer uses an opaque surface')
  assert.equal(viewer.querySelector('.font-mono'), null, 'browser image counters and labels use the interface font')
  assert.ok(viewer.querySelector('[aria-label="关闭"]')?.classList.contains('h-11'), 'close touch target is 44px')
  assert.equal(document.querySelectorAll('[data-image-track]').length, 1)
  assert.ok(document.querySelector('[aria-label="图片缩略图"]'))
  assert.ok(requests.filter(item => !item.thumbnail && !item.original).length <= 3, 'only current and adjacent full images load')
  await click('图片操作')
  await click('分享')
  assert.ok(document.querySelector('[aria-labelledby="browser-image-export-title"]'))
  assert.equal(requests.filter(item => item.original).length, 0, 'private export must not request original bytes before confirmation')
  assert.ok(!document.body.textContent?.includes('正在准备…') && !document.body.textContent?.includes('正在保存…'),
    'a confirmation dialog cannot appear above an already-busy action label')
  await act(async () => { assert.equal(overlay.current?.(), true) })
  await flush()
  assert.ok(!document.querySelector('[aria-labelledby="browser-image-export-title"]'))
  assert.equal(requests.filter(item => item.original).length, 0)
  assert.ok(document.querySelector('[aria-label="查看图片"]'), 'back first closes the confirmation')
  await act(async () => { assert.equal(overlay.current?.(), true) })
  assert.ok(document.querySelector('[aria-label="查看图片"]'), 'the next back closes the existing image action menu')
  await act(async () => { assert.equal(overlay.current?.(), true) })
  assert.ok(!document.querySelector('[aria-label="查看图片"]'), 'only then does back leave the lightbox')
  assert.equal(overlay.current?.(), false, 'the workspace owns closing the whole image panel')
  holdOriginal = true
  await click('查看：图 1')
  await click('图片操作')
  await click('保存到相册')
  assert.ok(!document.body.textContent?.includes('正在保存…'), 'save stays idle while asking to continue')
  assert.equal(requests.filter(item => item.original).length, 0)
  await click('继续保存')
  await flush()
  assert.equal(requests.filter(item => item.original).length, 1, 'original bytes are requested only after approval')
  assert.ok(document.body.textContent?.includes('正在保存…'), 'busy progress starts after confirmation')
  await act(async () => { assert.equal(overlay.current?.(), true) })
  await act(async () => { assert.equal(overlay.current?.(), true) })
  await flush()
  assert.ok(!document.querySelector('[aria-label="查看图片"]'), 'closing cancels the pending original read without exporting')
  await click('重新扫描图片')
  assert.equal(scans, 1)
  await act(async () => root.render(<BrowserImagesPanel {...props} snapshot={null} scanning/>))
  assert.ok(document.body.textContent?.includes('正在扫描当前网页的图片'))
  assert.ok(button('重新扫描图片').hasAttribute('disabled'))
  assert.ok(cancelled.some(item => (item as { documentId?: string }).documentId === 'doc-a'))
  await act(async () => root.render(<BrowserImagesPanel {...props} snapshot={{ ...snapshot, items: [], requestId: 'empty' }} error="扫描测试错误"/>))
  assert.ok(document.body.textContent?.includes('暂未发现可查看的图片'))
  assert.ok(document.body.textContent?.includes('扫描测试错误'))
  await click('重试扫描')
  assert.equal(scans, 2)
  await click('返回浏览器')
  assert.equal(closes, 1)

  const busySnapshot: BrowserImageSnapshot = {
    ...snapshot, requestId: 'busy-grid',
    items: Array.from({ length: 60 }, (_, index) => ({ ...snapshot.items[0], id: 'busy-' + index, alt: '慢速图片 ' + index })),
  }
  const busyReads: { request: BrowserImageLoadRequest; resolve: (data: BrowserImageData) => void; reject: (error: Error) => void }[] = []
  const busyCancelled: unknown[] = []
  const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#123456"/></svg>'
  const busyResponse = (request: BrowserImageLoadRequest): BrowserImageData => ({
    ...request, dataUrl: 'data:image/svg+xml;base64,' + Buffer.from(imageSvg).toString('base64'),
    mimeType: 'image/svg+xml', byteLength: Buffer.byteLength(imageSvg), width: 800, height: 600, reduced: false,
  })
  await act(async () => root.render(<BrowserImagesPanel {...props} snapshot={busySnapshot} privateMode={false}
    loadImage={request => new Promise((resolve, reject) => busyReads.push({ request, resolve, reject }))}
    cancelImageRequests={async request => { busyCancelled.push(request) }}/>))
  await act(async () => { for (const notify of observed.values()) notify(true) })
  await flush()
  await act(async () => {
    for (const read of busyReads.slice(0, 2)) read.resolve(busyResponse(read.request))
  })
  await flush()
  assert.ok(button('查看：慢速图片 0').querySelector('img'), 'a completed thumbnail remains viewable while other grid reads are slow')
  await click('下一页图片')
  await act(async () => { for (const notify of observed.values()) notify(true) })
  await flush()
  await click('上一页图片')
  await click('查看：慢速图片 0')
  await flush()
  const mainRead = busyReads.find(read => read.request.imageId === 'busy-0' && !read.request.thumbnail)
  assert.ok(mainRead, 'a real panel selection starts its main-image request even after grid paging filled the queue')
  assert.ok(busyCancelled.some(request => (request as BrowserImageLoadRequest).thumbnail),
    'the panel releases obsolete grid requests before displaying the current image')
  assert.ok(document.querySelector('[data-image-stage]')?.textContent?.includes('图片加载中'))
  await act(async () => mainRead.resolve(busyResponse(mainRead.request)))
  await flush()
  const mainImage = document.querySelector<HTMLImageElement>('[data-image-track] img[alt="慢速图片 0"]')!
  assert.ok(mainImage.getAttribute('src')?.startsWith('blob:'), 'native response bytes reach the selected image element')
  Object.defineProperties(mainImage, {
    naturalWidth: { value: 800, configurable: true }, naturalHeight: { value: 600, configurable: true },
    complete: { value: true, configurable: true },
  })
  await act(async () => mainImage.dispatchEvent(new window.Event('load')))
  assert.equal(mainImage.style.opacity, '1')
  assert.equal(button('调整图片').disabled, false, 'only the actual main-image load enables adjustments')
  assert.ok(!document.querySelector('[data-image-stage]')?.textContent?.includes('图片加载中'))
  const currentSource = mainImage.getAttribute('src')
  await act(async () => {
    for (const read of busyReads.filter(read => read.request.thumbnail)) read.resolve(busyResponse(read.request))
  })
  await flush()
  assert.equal(document.querySelector('[data-image-track] img[alt="慢速图片 0"]')?.getAttribute('src'), currentSource,
    'late cancelled thumbnail replies cannot replace or invalidate the loaded main image')
  console.log('Browser image panel: bounded lazy grid, saturated queue recovery, main-image loading, private export confirmation and layered back OK')
} finally { await act(async () => root.unmount()) }
