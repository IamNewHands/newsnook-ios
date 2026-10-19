import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import { mock } from 'node:test'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
const storage = new Map<string, string>()
let failStorage = false
let viewportHeight = 400
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, HTMLImageElement: window.HTMLImageElement,
  DOMParser: window.DOMParser, NodeFilter: window.NodeFilter, React,
  MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { if (failStorage) throw new Error('Storage full'); storage.set(key, value) },
  },
})
window.getComputedStyle = (() => ({ overflowY: 'auto', getPropertyValue: () => '' })) as any
window.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0) as any
window.cancelAnimationFrame = clearTimeout as any
window.HTMLElement.prototype.scrollTop = 0
window.HTMLElement.prototype.getBoundingClientRect = function () {
  const root = this.closest('[data-linuxdo-topic-scroller]') as HTMLElement | null
  const articles = root ? Array.from(root.querySelectorAll('article[data-linuxdo-post-number]')) : []
  const index = articles.indexOf(this)
  const top = index >= 0 ? 180 + index * 120 - (root?.scrollTop ?? 0) : 0
  const height = index >= 0 ? 120 : viewportHeight
  return { x: 0, y: top, top, bottom: top + height, left: 0, right: 390, width: 390, height, toJSON() {} }
}
window.HTMLElement.prototype.scrollIntoView = function () {
  const root = this.closest('[data-linuxdo-topic-scroller]') as HTMLElement
  root.scrollTop = Math.max(0, root.scrollTop + this.getBoundingClientRect().top)
}
const { createRoot } = await import('react-dom/client')
const { LinuxDoTopicView } = await import('../src/features/linuxdo/ui/ThreadViews')
const { linuxDoTopics } = await import('../src/features/linuxdo/runtime')
const { captureLinuxDoTopicPosition, restoreLinuxDoTopicPosition } = await import('../src/features/linuxdo/topic/readingPosition')
const { linuxDoReadingMode } = await import('../src/features/linuxdo/topic/readingMode')
const makePost = (postNumber: number, replyToPostNumber?: number) => ({
  id: 1000 + postNumber, postNumber, replyToPostNumber, username: `user${postNumber}`,
  createdAt: '', cooked: postNumber === 2 ? '<p>Discussion</p><iframe src="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD"></iframe>'
    : postNumber === 3 ? '<p>Another discussion</p><aside data-linuxdo-role="quote" data-linuxdo-post-number="7"><button data-linuxdo-role="quote-header">引用 #7</button></aside>' : '<p>Reply</p>',
  actions: [],
})
const initial = [makePost(1), makePost(2), makePost(3), makePost(4, 2), makePost(5, 2), makePost(6, 3), makePost(7, 4), makePost(9, 8), makePost(10, 9)]
const topic = { id: 100, slug: 'test', title: 'Threaded reading', postsCount: 11, views: 1, likeCount: 0, createdAt: '', lastPostedAt: '', tags: [],
  postStream: { stream: Array.from({ length: 11 }, (_, i) => 1001 + i), posts: initial }, details: { createdBy: { username: 'user1' } } }
linuxDoTopics.get = async () => topic
linuxDoTopics.loadPosts = async () => []
const noop = () => {}
const props: any = { summary: { ...topic, replyCount: 10, posters: [] }, session: { authenticated: false, authMode: 'none' },
  categoriesById: { 1: { id: 1, name: 'Test' } }, overlayBackHandlerRef: { current: null },
  onBack: noop, onCompose: noop, onBoost: noop, onOpenUser: noop, onOpenTopic: noop, onOpenTag: noop, onEdit: noop }
const host = document.createElement('div'); document.body.append(host)
const root = createRoot(host)
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const render = async (extra: any = {}) => { await act(async () => { root.render(<LinuxDoTopicView {...props} {...extra} />); await flush() }) }
const click = async (selector: string) => {
  const button = host.querySelector(selector)
  assert.ok(button, selector)
  await act(async () => { button.dispatchEvent(new window.Event('click', { bubbles: true })); await flush() })
}
const numbers = () => Array.from(host.querySelectorAll<HTMLElement>('article[data-linuxdo-post-number]')).map(el => Number(el.dataset.linuxdoPostNumber))
const scroller = () => host.querySelector('[data-linuxdo-topic-scroller]') as HTMLElement
mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100000 })
try {
  assert.equal(linuxDoReadingMode(), 'floors')
  storage.set('newsnook:linuxdo-reading-mode:v1', 'bad-value')
  assert.equal(linuxDoReadingMode(), 'floors', 'invalid preferences fall back to existing UI')
  await render()
  assert.deepEqual(numbers(), [1, 2, 3, 4, 5, 6, 7, 9, 10])
  const iframe = host.querySelector('iframe')
  scroller().scrollTop = 600
  const before = captureLinuxDoTopicPosition(scroller())
  await click('[data-linuxdo-reading-mode="threaded"]')
  assert.deepEqual(numbers(), [1, 2, 4, 7, 5, 3, 6, 9, 10])
  assert.deepEqual(captureLinuxDoTopicPosition(scroller()), before, 'switch preserves the visible post and offset')
  assert.equal(host.querySelector('iframe'), iframe, 'mode switch must not recreate embedded media')
  assert.equal(host.querySelector('[data-linuxdo-reading-mode="threaded"]')?.getAttribute('aria-pressed'), 'true')
  assert.equal(host.querySelector('[data-linuxdo-reading-mode="threaded"]')?.getAttribute('aria-label'), '楼中楼视图')
  assert.equal(host.querySelector('[data-linuxdo-reading-mode="threaded"]')?.textContent, '', 'compact controls use icons with accessible names')
  assert.equal(linuxDoReadingMode(), 'threaded')
  assert.match(host.textContent ?? '', /已加载 9 \/ 11/)
  assert.ok(host.querySelector('[data-linuxdo-post-number="9"] [data-linuxdo-parent-link]'), 'missing parent has a usable jump target without a username')
  assert.match(host.querySelector('[data-linuxdo-post-number="4"] [data-linuxdo-parent-link]')?.textContent ?? '', /回复 user2#2/, 'relationship identifies the parent floor even when an author posts repeatedly')
  assert.equal(host.querySelector('[data-linuxdo-post-number="2"] [data-linuxdo-floor-owner]')?.textContent, '层主', 'floor author with replies has floor owner badge')
  assert.equal(host.querySelector('[data-linuxdo-post-number="1"] [data-linuxdo-floor-owner]'), null, 'topic owner displays 楼主 rather than 层主')
  assert.equal(host.querySelector('[data-linuxdo-post-number="4"] [data-linuxdo-floor-owner]'), null, 'replier who is not floor author has no floor owner badge')
  console.log('PASS mode switch retains viewport and media; partial threads expose missing parents and floor owners')

  await click('[data-linuxdo-thread-toggle="2"]')
  assert.deepEqual(numbers(), [1, 2, 3, 6, 9, 10])
  assert.equal(host.querySelector('[data-linuxdo-thread-toggle="2"]')?.getAttribute('aria-expanded'), 'false')
  await click('[data-linuxdo-post-number="3"] [data-linuxdo-role="quote-header"]')
  await act(async () => { mock.timers.tick(100); await flush() })
  assert.ok(numbers().includes(7), 'jump to a collapsed reply must expand its discussion')
  assert.match(host.textContent ?? '', /返回引用处 #3/)
  console.log('PASS collapse and quote navigation reveal the targeted discussion')

  let rejectBatch = true
  linuxDoTopics.loadPosts = async (_topicId, ids) => {
    if (rejectBatch) throw new Error('Offline')
    return [makePost(8, 2), makePost(11, 10)].filter(post => ids.includes(post.id))
  }
  await click('[data-linuxdo-load-direction="gap"]')
  assert.match(host.textContent ?? '', /回复加载失败/)
  assert.deepEqual(numbers(), [1, 2, 4, 7, 5, 3, 6, 9, 10], 'failed loading retains the current discussion')
  rejectBatch = false
  await click('[data-linuxdo-load-direction="gap"]')
  await click('[data-linuxdo-load-direction="after"]')
  assert.deepEqual(numbers(), [1, 2, 4, 7, 5, 8, 9, 10, 11, 3, 6])
  assert.equal(host.querySelector('[data-linuxdo-post-number="9"]')?.getAttribute('data-linuxdo-thread-depth'), '2')
  console.log('PASS failed batches can retry and loaded parents merge existing branches')

  await render({ postMutation: { ...makePost(12, 5), username: 'user2', topicId: 100 } })
  assert.ok(numbers().includes(12), 'newly posted replies join their branch')
  assert.equal(host.querySelector('[data-linuxdo-post-number="12"] [data-linuxdo-floor-owner]')?.textContent, '层主', 'floor owner replying in their sub-thread is marked as 层主')
  await click('[data-linuxdo-reading-mode="floors"]')
  assert.deepEqual(numbers(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  assert.equal(host.querySelector('[data-linuxdo-post-number="2"] [data-linuxdo-floor-owner]'), null, 'floor owner badge is not shown in floors mode')
  failStorage = true
  await click('[data-linuxdo-reading-mode="threaded"]')
  assert.match(host.textContent ?? '', /阅读方式未能保存/)
  assert.equal(linuxDoReadingMode(), 'floors', 'save failure must not pretend persistence succeeded')
  failStorage = false
  await click('[data-linuxdo-reading-mode="floors"]')
  await click('[data-linuxdo-reading-mode="threaded"]')
  await act(async () => { root.render(null); await flush() })
  await render()
  assert.equal(host.querySelector('[data-linuxdo-reading-mode="threaded"]')?.getAttribute('aria-pressed'), 'true')
  console.log('PASS new replies, storage failures and persisted mode after reopening')

  const reported: number[][] = []
  linuxDoTopics.reportTimings = async (_topic, _time, timings) => { reported.push(Object.keys(timings).map(Number)) }
  viewportHeight = 2000
  scroller().scrollTop = 0
  await render({ session: { authenticated: true, authMode: 'browser-session', currentUser: { id: 9, username: 'reader' } } })
  await click('[data-linuxdo-thread-toggle="2"]')
  Object.defineProperty(host.querySelector('[data-linuxdo-reading-toolbar]')!, 'offsetHeight', { value: 60 })
  scroller().scrollTop = 260
  await act(async () => { mock.timers.tick(0); await flush() })
  await act(async () => { mock.timers.tick(5000); await flush() })
  assert.ok(reported.length, 'authenticated reading must still report visible floors')
  assert.ok(reported.flat().includes(2))
  assert.ok(!reported.flat().includes(1), 'posts occluded by the sticky toolbar must not count as visible')
  assert.ok(!reported.flat().some(number => [4, 5, 7].includes(number)), 'collapsed replies must never be marked read')
  console.log('PASS collapsed descendants are excluded from authenticated read timings')

  restoreLinuxDoTopicPosition(scroller(), { postNumber: 2, offset: 0, alignBelowToolbar: true })
  assert.equal(host.querySelector('[data-linuxdo-post-number="2"]')!.getBoundingClientRect().top, 60,
    'opening an explicit floor must leave its author visible beneath the sticky toolbar')
  assert.equal(captureLinuxDoTopicPosition(scroller())?.postNumber, 2,
    'a post hidden behind the compact toolbar must not become the mode-switch anchor')
  console.log('PASS explicit floor alignment accounts for the sticky reading toolbar')

  // Test site admin (Neo) hallmark features and exclusive adaptation
  await render({
    session: { authenticated: true, authMode: 'browser-session', currentUser: { id: 9, username: 'reader' } },
    postMutation: {
      ...makePost(13),
      username: 'Neo',
      name: 'Neo',
      userTitle: '岂日无衣？ 🍭',
      topicId: 100,
    },
  })
  const neoPost = host.querySelector('[data-linuxdo-post-number="13"]')
  assert.ok(neoPost, 'Neo post is rendered')
  assert.ok(neoPost.querySelector('[data-linuxdo-site-admin-badge]'), 'Neo has the corner battery badge')
  assert.ok(neoPost.querySelector('button[title*="查看 @Neo"]')?.className.includes('rounded-[7px]'), 'Neo has unique square avatar')
  assert.ok(neoPost.querySelector('button[title*="(@Neo)"]')?.className.includes('text-[#0088ff]'), 'Neo name is blue')
  assert.ok(neoPost.querySelector('svg[aria-label="站长认证"]'), 'Neo has blue shield certification')
  assert.match(neoPost.textContent ?? '', /岂日无衣？ 🍭/, 'Neo flair/userTitle is displayed')

  const regularPost = host.querySelector('[data-linuxdo-post-number="2"]')
  assert.ok(regularPost, 'regular post is rendered')
  assert.equal(regularPost.querySelector('[data-linuxdo-site-admin-badge]'), null, 'regular user has no corner battery badge')
  assert.ok(regularPost.querySelector('button[title*="查看 @user2"]')?.className.includes('rounded-full'), 'regular user has rounded avatar')
  assert.equal(regularPost.querySelector('svg[aria-label="站长认证"]'), null, 'regular user has no shield icon')

  // Test reply capsule to Neo has square mini avatar and blue text
  await render({
    session: { authenticated: true, authMode: 'browser-session', currentUser: { id: 9, username: 'reader' } },
    postMutation: {
      ...makePost(14, 13),
      username: 'user_replying_to_neo',
      topicId: 100,
    },
  })
  const replyToNeoPost = host.querySelector('[data-linuxdo-post-number="14"]')
  assert.ok(replyToNeoPost, 'post replying to Neo is rendered')
  const capsule = replyToNeoPost.querySelector('[data-linuxdo-parent-link]')
  assert.ok(capsule, 'reply capsule is present')
  assert.ok(capsule.querySelector('span.overflow-hidden')?.className.includes('rounded-[3px]'), 'capsule avatar for Neo is square')
  assert.ok(capsule.querySelector('b')?.className.includes('text-[#0088ff]'), 'capsule reply text to Neo is blue')

  console.log('PASS site admin (Neo) exclusive badge, square avatar, blue name and shield adaptation')
} finally {
  failStorage = false
  await act(async () => { root.unmount(); await flush() })
  mock.timers.reset()
}
