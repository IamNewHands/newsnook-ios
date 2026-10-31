import assert from 'node:assert/strict'
import { mock } from 'node:test'

const operations: string[] = []
let directoryExists = false
let shouldFailCopy = false
let shouldCancelShare = false
const forwardedFiles: string[] = []
const timers: (() => void)[] = []

mock.module('@capacitor/core', { namedExports: {
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  CapacitorHttp: {},
} })
mock.module('@capacitor/filesystem', { namedExports: {
  Directory: { Cache: 'CACHE' },
  Filesystem: {
    async mkdir({path}: {path: string}) {
      operations.push('mkdir:' + path)
      if (directoryExists) throw new Error('already exists')
      directoryExists = true
    },
    async stat({path}: {path: string}) { operations.push('stat:' + path); return {type:'directory'} },
    async copy({from,to}: {from: string; to: string}) {
      operations.push('copy:' + from + ':' + to)
      if (shouldFailCopy) throw new Error('copy failed')
      return {uri: 'file:///data/user/0/cache/' + to}
    },
    async getUri({path}: {path: string}) { return {uri:'file:///data/user/0/cache/' + path} },
    async deleteFile({path}: {path: string}) { operations.push('delete:' + path) },
  },
} })
mock.module('@capacitor/share', { namedExports: {
  Share: { async share({files}: {files:string[]}) {
    forwardedFiles.push(...files)
    if (shouldCancelShare) throw new DOMException('cancelled', 'AbortError')
  } },
} })
mock.module('@capacitor-community/media', { namedExports: {
  Media: {
    async getAlbumsPath() { return {path:'/storage/emulated/0/Android/media'} },
    async getAlbums() { return {albums:[{name:'有所闻',identifier:'/storage/emulated/0/Android/media/有所闻'}]} },
    async createAlbum() {},
    async savePhoto({path}: {path:string}) { operations.push('save:' + path) },
  },
} })

const { saveImageFileUri, shareImageFileUri } = await import('../src/lib/imageActions')
const raw = 'file:///data/user/0/com.aizeek.newsnook/cache/browser-image-session/export-original.jpg'
const originalTimer = globalThis.setTimeout
;(globalThis as {setTimeout: typeof setTimeout}).setTimeout =
  ((callback: () => void) => { timers.push(callback); return 0 }) as typeof setTimeout
try {
  assert.equal(await saveImageFileUri(raw, 'photo.jpg'), 'saved')
  assert.ok(operations.includes('save:' + raw), 'saving original directly from file URI avoids Base64')

  assert.equal(await shareImageFileUri(raw, 'photo.jpg', '图片'), 'shared')
  assert.ok(operations.some(item => item.includes('copy:' + raw + ':browser-image-share/photo.jpg')))
  assert.deepEqual(forwardedFiles, ['file:///data/user/0/cache/browser-image-share/photo.jpg'])
  assert.equal(timers.length, 1, 'a granted URI must outlive chooser completion')
  timers.shift()!()
  await Promise.resolve()
  assert.ok(operations.includes('delete:browser-image-share/photo.jpg'))

  assert.equal(await shareImageFileUri(raw, 'second.jpg', '图片'), 'shared',
    'existing share directory must not cause subsequent shares to fail')
  assert.ok(operations.includes('stat:browser-image-share'))
  timers.shift()!()

  shouldFailCopy = true
  await assert.rejects(shareImageFileUri(raw, 'failed.jpg', '图片'), /copy failed/)
  await Promise.resolve()
  assert.ok(operations.includes('delete:browser-image-share/failed.jpg'),
    'partial copies must be cleaned even if the copy API fails')

  shouldFailCopy = false
  shouldCancelShare = true
  assert.equal(await shareImageFileUri(raw, 'cancelled.jpg', '图片'), 'cancelled')
  timers.shift()!()
  await Promise.resolve()
  assert.ok(operations.includes('delete:browser-image-share/cancelled.jpg'))
} finally {
  globalThis.setTimeout = originalTimer
}
console.log('Browser image file actions: native file-only save/share, existing directory, cancelled share and cleanup OK')
