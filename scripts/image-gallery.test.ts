import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { collectImageGallery } from '../src/lib/imageGallery'

const { document } = parseHTML(`<div id="body">
  <img src="https://example.com/one.jpg" alt="第一张">
  <img src="https://example.com/logo.png" data-reader-role="badge">
  <img src="https://example.com/two.jpg" alt="第二张">
  <img src="https://example.com/one.jpg">
  <img src="https://example.com/related.jpg" data-reader-role="related-image">
  <button data-reader-deferred><img data-deferred-src="https://example.com/locked.jpg"></button>
  <img src="https://example.com/three.jpg" alt="第三张">
</div>`)
const root = document.querySelector('#body')!
const gallery = collectImageGallery(root, { src: 'https://example.com/two.jpg', alt: '第二张' })
assert.deepEqual(gallery.items.map((item) => item.src), [
  'https://example.com/one.jpg', 'https://example.com/two.jpg', 'https://example.com/three.jpg',
])
assert.equal(gallery.index, 1, 'open at the clicked image in document order')
assert.equal(gallery.items[1].alt, '第二张')
const cover = collectImageGallery(root, { src: 'https://example.com/cover.jpg', alt: '封面' })
assert.equal(cover.items.length, 4)
assert.equal(cover.items[0].src, 'https://example.com/cover.jpg')
assert.equal(cover.index, 0)
assert.equal(collectImageGallery(null, { src: 'https://example.com/only.jpg', alt: '' }).items.length, 1)
console.log('image-gallery: ok')
