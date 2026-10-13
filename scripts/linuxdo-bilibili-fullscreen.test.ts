import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { installLinuxDoEmbeddedVideoFullscreen } from '../src/features/linuxdo/ui/embeddedVideoFullscreen'
import { addLinuxDoVideoFullscreenControls } from '../src/features/linuxdo/content/videoFullscreen'
import { dismissTopHardwareBackLayer, hardwareBackLayerCount } from '../src/lib/hardwareBackStack'

const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis, { window, document, Element: window.Element, HTMLElement: window.HTMLElement })
const root = document.getElementById('root') as HTMLElement
root.innerHTML = addLinuxDoVideoFullscreenControls(
  '<iframe data-reader-role="trusted-video-embed" src="https://player.bilibili.com/player.html?bvid=BV1wpWw6zEiX" allowfullscreen></iframe>',
)
const iframe = root.querySelector('iframe')!
const host = root.querySelector<HTMLElement>('[data-linuxdo-video-fullscreen]')!
const button = root.querySelector<HTMLButtonElement>('[data-linuxdo-video-fullscreen-toggle]')!
const nativeCalls: boolean[] = []
Object.assign(window, { NewsNookNative: { setEmbeddedVideoFullscreen: (active: boolean) => nativeCalls.push(active) } })
let fullRequestCount = 0
Object.assign(host, {
  requestFullscreen: () => {
    fullRequestCount++
    return Promise.resolve()
  },
})
const dispose = installLinuxDoEmbeddedVideoFullscreen(root)
button.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }))
await Promise.resolve()
assert.equal(fullRequestCount, 1, 'one click should synchronously request native HTML fullscreen')
assert.equal(root.querySelector('iframe'), iframe, 'fullscreen must reuse the active player DOM node')
assert.deepEqual(nativeCalls, [], 'native CSS fallback is unnecessary when standard API succeeds')

Object.assign(host, { requestFullscreen: () => Promise.reject(new Error('fullscreen disabled')) })
button.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }))
await new Promise((resolve) => setTimeout(resolve, 0))
assert.ok(host.classList.contains('is-fullscreen-fallback'), 'failed Web API should still expose fullscreen')
assert.equal(root.querySelector('iframe'), iframe, 'fallback must not detach or restart Bilibili iframe')
assert.deepEqual(nativeCalls, [true])
assert.equal(button.getAttribute('aria-label'), '退出 Bilibili 视频全屏')
button.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }))
assert.ok(!host.classList.contains('is-fullscreen-fallback'), 'toggle should exit fallback fullscreen')
assert.deepEqual(nativeCalls, [true, false])
assert.equal(button.getAttribute('aria-label'), '全屏播放 Bilibili 视频')
assert.equal(hardwareBackLayerCount(), 0)
button.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }))
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(hardwareBackLayerCount(), 1, 'CSS fallback should register a prioritized Android back handler')
assert.equal(dismissTopHardwareBackLayer(), true, 'Android Back should dismiss fullscreen, not leave Linux.do')
assert.equal(hardwareBackLayerCount(), 0, 'exiting fullscreen must unregister the transient layer')
assert.equal(root.querySelector('iframe'), iframe)
dispose()
assert.equal(root.querySelector('iframe'), iframe)
console.log('linuxdo-bilibili-fullscreen: HTML fullscreen, native fallback, exit and iframe persistence OK')
