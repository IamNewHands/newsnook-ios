import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseHTML } from 'linkedom'

import {
  bodyScrollLockDepth,
  lockBodyScroll,
  resetBodyScrollLock,
} from '../src/lib/bodyScrollLock'
import {
  clearGestureCompositorStyles,
  recoverAppScrollAfterNavigation,
  recoverAppScrollSurfaces,
  SCROLL_SURFACE_ATTR,
} from '../src/lib/gestureStyles'

const { document } = parseHTML('<body><div id="surface"></div></body>')
;(globalThis as typeof globalThis & { document: Document }).document = document as unknown as Document
const surface = document.querySelector<HTMLElement>('#surface')
assert.ok(surface)

surface.style.transform = 'translate3d(0, 0, 0)'
surface.style.transition = 'transform 220ms ease'
surface.style.willChange = 'transform'
surface.dataset.swipeBackActive = 'true'

clearGestureCompositorStyles(surface)

assert.equal(surface.style.transform, '')
assert.equal(surface.style.transition, '')
assert.equal(surface.style.willChange, '')
assert.equal(surface.dataset.swipeBackActive, undefined)

resetBodyScrollLock()
document.body.style.overflow = 'auto'

const releaseA = lockBodyScroll()
assert.equal(document.body.style.overflow, 'hidden')
assert.equal(bodyScrollLockDepth(), 1)

const releaseB = lockBodyScroll()
assert.equal(bodyScrollLockDepth(), 2)

releaseA()
assert.equal(document.body.style.overflow, 'hidden')
assert.equal(bodyScrollLockDepth(), 1)

releaseB()
assert.equal(document.body.style.overflow, 'auto')
assert.equal(bodyScrollLockDepth(), 0)

// Out-of-order release must not leave overflow stuck on hidden.
const releaseC = lockBodyScroll()
const releaseD = lockBodyScroll()
releaseC()
releaseD()
assert.equal(document.body.style.overflow, 'auto')

const feed = document.createElement('div')
feed.setAttribute(SCROLL_SURFACE_ATTR, '')
feed.style.transform = 'translate3d(0, 12px, 0)'
document.body.appendChild(feed)
document.documentElement.classList.add('is-video-fullscreen')
document.body.style.overflow = 'hidden'
lockBodyScroll()

recoverAppScrollSurfaces()
assert.equal(feed.style.transform, '')
assert.equal(document.documentElement.classList.contains('is-video-fullscreen'), false)
assert.equal(document.body.style.overflow, 'hidden')

resetBodyScrollLock()
assert.equal(document.body.style.overflow, '')

recoverAppScrollAfterNavigation()
assert.equal(document.body.style.overflow, '')

// 右滑返回的样式契约：阅读器只关掉真正挂了毛玻璃的宿主，不再用 `X *` 在整棵
// 正文字树上广播重算；浮层表面在拖动期间也要关掉遮罩的毛玻璃。
const css = readFileSync('src/index.css', 'utf8')
assert.match(
  css,
  /\.reader-swipe-surface\[data-swipe-back-active='true'\] \[data-surface='reader-chrome'\]/,
  '阅读器顶栏的毛玻璃必须在拖动期间关掉，否则每帧都要重新采样背景',
)
assert.match(
  css,
  /\.reader-swipe-surface\[data-swipe-back-active='true'\] \[data-reader-float-nav\]/,
  '悬浮翻页手柄同样会跟着正文一起移动，其毛玻璃必须一并关掉',
)
assert.doesNotMatch(
  css,
  /\.reader-swipe-surface\[data-swipe-back-active='true'\] \*/,
  '不能用 `X *` 关闭整棵正文子树的毛玻璃：正文太长时起步会全量重算样式并重栅格化',
)
assert.match(
  css,
  /\.swipe-back-surface\[data-swipe-back-active='true'\] > \*/,
  '浮层遮罩（直接子元素）在拖动期间必须关掉毛玻璃，否则每帧都要重新采样身后的正文',
)
assert.doesNotMatch(
  css,
  /\.swipe-back-surface\s*\{[^}]*will-change/,
  '浮层根节点不能静态提升：那会让它变成自己的 backdrop root，抽屉遮罩的毛玻璃会失效',
)

// 「看跟帖」抽屉与阅读器各浮层都必须支持左缘右滑返回。
for (const file of [
  'src/features/comments/components/CommentsDrawer.tsx',
  'src/components/ReaderMoreMenu.tsx',
  'src/components/ShareArticleSheet.tsx',
  'src/components/TranslationChannelSheet.tsx',
  'src/components/EinkReaderMenu.tsx',
]) {
  const source = readFileSync(file, 'utf8')
  assert.match(source, /useSwipeDismiss\(/, `${file} 必须接入左缘右滑返回`)
  assert.match(source, /className="swipe-back-surface/, `${file} 的浮层根节点必须带上拖动表面标记`)
}

console.log('gesture-styles: ok')
