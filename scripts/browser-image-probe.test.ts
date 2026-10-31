import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { parseHTML } from 'linkedom'

const source = readFileSync(new URL('../android/app/src/main/assets/browser-image-probe.js', import.meta.url), 'utf8')
type Owner = Record<string, any>
let fetches = 0
class Reader {
  result = ''
  onload?: () => void
  onerror?: () => void
  async readAsDataURL(blob: Blob) {
    this.result = 'data:' + blob.type + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64')
    this.onload?.()
  }
  abort() {}
}
function owner(html: string, url = 'https://news.example/article?source=1'): Owner {
  const { document } = parseHTML('<html><body>' + html + '</body></html>')
  Object.defineProperty(document, 'baseURI', { value: url })
  return {
    document, location: { href: url }, URL, AbortController, Blob, FileReader: Reader,
    fetch: async (url: string) => { fetches++; return fetch(url.startsWith('blob:') ? 'data:image/png;base64,AQID' : url) },
    getComputedStyle: (node: Element) => ({ backgroundImage: node.getAttribute('data-test-bg') || 'none' }),
  }
}
function scan(window: Owner, scanId = 'scan') {
  const script = source.replace('__NEWSNOOK_IMAGE_KEY__', JSON.stringify('__testImages'))
    .replace('__NEWSNOOK_IMAGE_SCAN__', JSON.stringify(scanId))
  return JSON.parse(runInNewContext(script, { window, location: window.location, Date, URL }))
}
const window = owner(
  '<img id="hero" src="/fallback.jpg" srcset="/small.jpg?w=400 400w, /large.jpg?w=1200 1200w" width="800" height="600">' +
  '<main><picture><source srcset="/p1.webp 1x, /p2.webp 2x"><img src="/picture.jpg" width="800" height="600"></picture>' +
  '<img data-src="/lazy.jpg?signature=one" data-original="/lazy.jpg?signature=two" data-srcset="/lazy-large.jpg 2x" width="900" height="700">' +
  '<img src="data:image/png;base64,AQID" width="120" height="120"><img src="blob:https://news.example/page-image" width="400" height="300">' +
  '<svg><image href="/vector-texture.png" width="300" height="200"/></svg></main>' +
  '<img class="avatar" src="/avatar.png" width="40" height="40">' +
  '<div width="500" height="300" data-test-bg="url(&quot;/background.jpg?a=1&amp;b=2&quot;)"></div>' +
  '<iframe id="accessible"></iframe><iframe id="cross-origin"></iframe>')
Object.defineProperty(window.document.querySelector('#hero'), 'currentSrc', { value: 'https://cdn.example/current.jpg?token=keep&size=large' })
const frame = owner('<img src="/frame.jpg" width="400" height="300">', 'https://news.example/frame')
Object.defineProperty(window.document.querySelector('#accessible'), 'contentWindow', { value: frame })
Object.defineProperty(window.document.querySelector('#cross-origin'), 'contentWindow', { get: () => { throw new Error('SecurityError') } })
const beforeClick = window.document.querySelector('#hero').onclick
const result = scan(window)
const urls = result.items.map((item: Owner) => item.sourceUrl)
for (const expected of [
  'https://cdn.example/current.jpg?token=keep&size=large', 'https://news.example/fallback.jpg',
  'https://news.example/small.jpg?w=400', 'https://news.example/large.jpg?w=1200',
  'https://news.example/p1.webp', 'https://news.example/p2.webp', 'https://news.example/picture.jpg',
  'https://news.example/lazy.jpg?signature=one', 'https://news.example/lazy.jpg?signature=two',
  'https://news.example/lazy-large.jpg', 'https://news.example/vector-texture.png',
  'https://news.example/background.jpg?a=1&b=2', 'https://news.example/frame.jpg',
  'blob:https://news.example/page-image', 'data:',
]) assert.ok(urls.includes(expected), 'missing image source ' + expected)
assert.equal(result.items.find((item: Owner) => item.sourceUrl.endsWith('/avatar.png')).content, false,
  'decorative avatars remain available under all images')
assert.ok(result.items.find((item: Owner) => item.sourceUrl.includes('lazy.jpg')).content)
assert.equal(result.inaccessibleFrames, 1)
assert.equal(fetches, 0, 'scanning only reads metadata; it does not fetch all images')
assert.equal(window.document.querySelector('#hero').onclick, beforeClick, 'the website image click behavior stays intact')
assert.ok(!JSON.stringify(result).includes('AQID'), 'data image bytes stay inside the source page until selected')
const embedded = result.items.find((item: Owner) => item.sourceUrl === 'data:')
const blob = result.items.find((item: Owner) => item.sourceUrl.startsWith('blob:'))
async function receive(token: string, session = window.__testImages): Promise<{ bytes?: Buffer; error?: string; chunks?: number }> {
  const buffers: Buffer[] = []
  for (let iteration = 0; iteration < 2000; iteration++) {
    const response = session.read(token)
    if (response.pending) { await new Promise(resolve => setTimeout(resolve, 1)); continue }
    if (response.error) return { error: response.error }
    if (response.chunk) { buffers.push(Buffer.from(response.chunk, 'base64')); continue }
    if (response.done) {
      const bytes = Buffer.concat(buffers)
      assert.equal(bytes.length, response.byteLength)
      return { bytes, chunks: buffers.length }
    }
    throw new Error('Unexpected page transfer packet')
  }
  throw new Error('Page-owned image never completed')
}
assert.ok(window.__testImages.start(embedded.id, 'load-one', 1024).started)
assert.ok(window.__testImages.start(blob.id, 'load-two', 1024).started)
assert.deepEqual((await receive('load-one')).bytes, Buffer.from([1, 2, 3]))
assert.deepEqual((await receive('load-two')).bytes, Buffer.from([1, 2, 3]))
assert.equal(fetches, 2, 'page-origin blob/data bytes are copied only on request')
const retired = window.__testImages
scan(window, 'new-scan')
assert.ok(retired.start(embedded.id, 'stale', 1024).error, 'rescan invalidates the retired page export registry')
const duplicates = scan(owner('<img src="/x.jpg?sig=a"><img src="/x.jpg?sig=a"><img src="/x.jpg?sig=b">'))
assert.equal(duplicates.items.length, 2, 'exact URLs dedupe without stripping signed query strings')
const capped = scan(owner(Array.from({ length: 500 }, (_, index) => '<img src="/' + index + '.jpg">').join('')))
assert.equal(capped.items.length, 240)
assert.equal(capped.truncated, true)
assert.ok(!source.includes('addEventListener'), 'manual scanner never hooks site clicks or scroll')
const oversized = owner('<img src="blob:https://news.example/large">')
let aborted = false
oversized.fetch = async (_url: string, options: { signal: AbortSignal }) => {
  options.signal.addEventListener('abort', () => { aborted = true })
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2048)); controller.close() } }),
    { headers: { 'content-type': 'image/png' } })
}
const largeImage = scan(oversized).items[0]
oversized.__testImages.start(largeImage.id, 'bounded', 1024)
assert.ok((await receive('bounded', oversized.__testImages)).error, 'an unknown-length blob is bounded during stream read')
assert.equal(aborted, true, 'an over-budget blob transfer is aborted before it crosses into native')

// A true >6MB blob goes over the native boundary in 192KiB chunks, never one giant data URL.
const bigger = owner('<img src="blob:https://news.example/high-resolution" width="1600" height="1200">')
const content = Buffer.alloc(7 * 1024 * 1024 + 817, 0x5a)
bigger.fetch = async () => new Response(new Blob([content], { type: 'image/png' }),
  { headers: { 'content-type': 'image/png' } })
const biggerImage = scan(bigger, 'big').items[0]
assert.ok(bigger.__testImages.start(biggerImage.id, 'big-data', 128 * 1024 * 1024).started)
const large = await receive('big-data', bigger.__testImages)
assert.deepEqual(large.bytes, content, 'transferred bytes must be exact, ordered, and complete')
assert.ok((large.chunks ?? 0) > 30, 'large file cannot cross native in one response')
assert.equal(bigger.__testImages.read('big-data').error, '图片读取已取消', 'completed transfers leave no retained Blob')

// Backpressure: WebView must not read all upstream bytes while native is idle.
const controlled = owner('<img src="blob:https://news.example/pull" width="1200" height="1200">')
const singleChunk = new Uint8Array(600 * 1024).fill(0x3b)
let reads = 0
controlled.fetch = async () => ({
  ok: true, headers: new Headers({ 'content-type': 'image/png' }),
  body: { getReader: () => ({
    read: async () => ++reads === 1 ? { done: false, value: singleChunk } : { done: true },
    cancel: () => {},
  }) },
})
const controlledImage = scan(controlled, 'controlled').items[0]
controlled.__testImages.start(controlledImage.id, 'controlled', 16 * 1024 * 1024)
await new Promise(resolve => setTimeout(resolve, 10))
assert.equal(reads, 0, 'no upstream read before native requests its first chunk')
const controlledResult = await receive('controlled', controlled.__testImages)
assert.deepEqual(controlledResult.bytes, Buffer.from(singleChunk))
assert.equal(reads, 2, 'one 600KB upstream chunk must be split without extra stream reads')
assert.ok((controlledResult.chunks ?? 0) >= 4, 'native receives at most 192KB per bridge callback')
console.log('Browser image probe: currentSrc, srcset, picture/lazy, CSS, SVG, reachable frames, all/content, page bytes and bounds OK')
