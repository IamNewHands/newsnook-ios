import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'

const { window } = parseHTML('<html><body></body></html>')
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true })
window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as any
window.cancelAnimationFrame = clearTimeout as any
const { createRoot } = await import('react-dom/client')
const { UserProfileView } = await import('../src/features/linuxdo/ui/UserProfileView')
const { ProfileSectionView } = await import('../src/features/linuxdo/ui/ProfileSectionView')
const { LinuxDoComposer } = await import('../src/features/linuxdo/ui/ThreadViews')
const { linuxDoApi, linuxDoPeople, linuxDoProfileSections, linuxDoDrafts, linuxDoDiscovery } = await import('../src/features/linuxdo/runtime')
const host = document.createElement('div'); document.body.append(host)
const root = createRoot(host)
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const session: any = { authenticated: true, authMode: 'browser-session', currentUser: { id: 1, username: 'reader' } }
const opened: Array<[number, number | undefined]> = []
const props = { session, onOpenTopic: (topic: any, floor?: number) => opened.push([topic.id, floor]) }
const render = async (view: React.ReactNode) => { await act(async () => { root.render(view); await flush() }) }
const click = async (label: string) => {
  const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent === label || item.getAttribute('aria-label') === label)
  assert.ok(button, `missing ${label}`)
  await act(async () => { button.dispatchEvent(new window.Event('click', { bubbles: true })); await flush() })
}
// Keep the real people service here: the regression is at the JSON-to-view boundary.
const originalGetJson = linuxDoApi.getJson
let brokenBadges = false
linuxDoApi.getJson = async (url: string) => {
  const badge = { id: 7, name: '关联徽章', description: '<a href="/badges/7">授予</a>来自独立定义的徽章&amp;特权', badge_type_id: 1 }
  if (url.includes('/summary.json')) return {
    topics: [{ id: 42, title: '关联话题', slug: 'top' }, { id: 43, title: '关联回复', slug: 'reply' }],
    badges: [badge],
    user_summary: { topic_ids: [42], replies: [{ topic_id: 43, post_number: 7 }], badges: [{ id: 70, badge_id: 7 }] },
  }
  if (url.includes('/user-badges/')) return brokenBadges
    ? { user_badges: [{ id: 70, badge_id: 7 }] }
    : { badges: [badge], user_badges: [{ id: 70, badge_id: 7, is_favorite: true }] }
  return { user: { id: 1, username: 'reader', featured_user_badge_ids: [70] } }
}
await render(<UserProfileView username="reader" onOpenUser={() => {}} {...props} />)
assert.ok(host.textContent?.includes('关联话题'), 'sideloaded top topics must be visible')
assert.ok(host.textContent?.includes('关联回复'), 'sideloaded replies must be visible')
assert.ok(!host.textContent?.includes('暂无公开的高信号话题'))
const openSummaryCard = async (title: string) => {
  const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes(title))
  assert.ok(button)
  await act(async () => { button.dispatchEvent(new window.Event('click', { bubbles: true })); await flush() })
}
await openSummaryCard('关联话题')
assert.deepEqual(opened.at(-1), [42, undefined])
await openSummaryCard('关联回复')
assert.deepEqual(opened.at(-1), [43, 7], 'summary reply opens at the referenced floor')
await click('徽章')
assert.ok(host.textContent?.includes('1 枚公开徽章'))
assert.ok(host.textContent?.includes('关联徽章'))
assert.ok(host.textContent?.includes('展示中'))
assert.ok(host.textContent?.includes('授予来自独立定义的徽章&特权'))
assert.ok(!host.textContent?.includes('<a href='))
assert.ok(host.textContent?.includes('金牌'))
assert.ok(!host.textContent?.includes('该用户没有公开徽章'))
await click('清单列表视图')
assert.ok(host.textContent?.includes('关联徽章'))
assert.ok(host.textContent?.includes('金牌'))
await click('展柜网格视图')
assert.ok(host.textContent?.includes('关联徽章'))
brokenBadges = true
await click('刷新徽章')
assert.ok(host.textContent?.includes('完整徽章列表加载失败'))
assert.ok(host.textContent?.includes('关联徽章'), 'keep summary badges when the full response is malformed')
await act(async () => { root.render(null); await flush() })
linuxDoApi.getJson = originalGetJson

linuxDoPeople.profile = async username => ({ id: 1, username, featuredUserBadgeIds: [], draftCount: 2, pendingPostsCount: 1 })
linuxDoPeople.summary = async () => ({ topics: [], replies: [], links: [], mostLikedByUsers: [], mostLikedUsers: [], mostRepliedToUsers: [], topCategories: [], badges: [] })
const originalList = linuxDoProfileSections.list.bind(linuxDoProfileSections)
let reads = 0
linuxDoProfileSections.list = async () => { reads++; return { items: [] } }
await render(<UserProfileView username="reader" onOpenUser={() => {}} {...props} />)
const tabs = () => Array.from(host.querySelectorAll('[role="tab"]')).map(node => node.textContent)
for (const label of ['话题', '回复', '已读', '草稿 (2)', '待处理 (1)', '赞', '书签', '已指定', 'Boosts', '回应', '投票', '已解决']) assert.ok(tabs().includes(label), label)
await click('回应')
assert.equal(reads, 1, 'reaction tab uses plugin endpoint, not user_actions filter 6')
await act(flush)
assert.equal(reads, 1, 'an empty result must not cause repeated requests')
await render(<UserProfileView username="other" onOpenUser={() => {}} {...props} />)
for (const label of ['已读', '草稿 (2)', '待处理 (1)', '书签']) assert.ok(!tabs().includes(label), `other user must not expose ${label}`)
await render(<UserProfileView username="reader" onOpenUser={() => {}} {...props} session={{ ...session, currentUser: { ...session.currentUser, canAssignGlobally: false } }} />)
assert.ok(!tabs().includes('已指定'), 'honor official assignment permission')

linuxDoProfileSections.list = originalList
let rejectPage = true
linuxDoApi.getJson = async (url: string) => {
  if (url.includes('offset=20')) {
    if (rejectPage) throw new Error('第二页断网')
    return { user_solved_posts: [{ post_id: 21, topic_id: 42, topic_title: 'Next answer', post_number: 8 }] }
  }
  return { user_solved_posts: Array.from({ length: 20 }, (_, i) => ({ post_id: i + 1, topic_id: 42, topic_title: 'Answer ' + (i + 1), post_number: i + 2 })) }
}
await render(<ProfileSectionView section="solved" username="reader" {...props} />)
await click('Answer 1')
assert.deepEqual(opened.at(-1), [42, 2], 'accepted answer opens at the answer floor')
await click('加载更多')
assert.ok(host.textContent?.includes('Answer 1'))
assert.ok(host.querySelector('[role="alert"]')?.textContent?.includes('第二页断网'))
rejectPage = false
await click('重试')
assert.ok(host.textContent?.includes('Next answer'))
assert.equal(host.querySelectorAll('article').length, 21)

let resolveOld: (value: any) => void = () => {}
let oldSignal: AbortSignal | undefined
linuxDoApi.getJson = async (url: string, options: any) => {
  if (url.includes('reactions.json')) { oldSignal = options.signal; return new Promise(resolve => { resolveOld = resolve }) }
  return { topic_list: { topics: [{ id: 5, title: 'Other account vote', slug: 'vote' }] } }
}
await render(<ProfileSectionView section="reactions" username="reader" {...props} />)
await render(<ProfileSectionView section="votes" username="other" {...props} session={{ ...session, currentUser: { id: 2, username: 'other' } }} />)
assert.equal(oldSignal?.aborted, true)
await act(async () => { resolveOld([{ id: 1, post: { topic_id: 1, topic: { title: 'Late private data' } } }]); await flush() })
assert.ok(host.textContent?.includes('Other account vote'))
assert.ok(!host.textContent?.includes('Late private data'))
await render(<ProfileSectionView section="drafts" username="reader" {...props} session={{ authenticated: false, authMode: 'none' }} />)
assert.ok(host.textContent?.includes('仅本人登录后可查看'))
assert.equal(host.querySelectorAll('article').length, 0)

linuxDoDiscovery.categories = async () => [{ id: 4, name: 'Test category', slug: 'test' }]
linuxDoDiscovery.tags = async () => [{ id: 'test', name: 'test' }]
let unexpectedDraftReads = 0
linuxDoDrafts.get = async () => { unexpectedDraftReads++; return { data: null, sequence: 0 } }
const saved: any[] = []
linuxDoDrafts.save = async (key, sequence, data) => { saved.push({ key, sequence, data }); return sequence + 1 }
const resumedDraft: any = { key: 'new_topic_7', sequence: 4, data: { action: 'createTopic', title: 'PWA draft title', reply: 'Unpublished body from PWA', categoryId: 4, tags: ['test'] } }
let closed = false
await render(<LinuxDoComposer open session={session} resumedDraft={resumedDraft} onClose={() => { closed = true }} onSent={() => {}} />)
assert.equal(host.querySelector('textarea')?.value, resumedDraft.data.reply)
assert.equal(host.querySelector('input[placeholder="输入标题，清楚说明你想讨论什么"]')?.value, resumedDraft.data.title)
assert.ok(host.textContent?.includes('Test category'))
assert.ok(host.textContent?.includes('test'))
assert.equal(unexpectedDraftReads, 0, 'resumed snapshot must not be replaced by the default new_topic draft')
await click('关闭编辑器')
const confirm = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '保存并关闭')
assert.ok(confirm)
await act(async () => { confirm.dispatchEvent(new window.Event('click', { bubbles: true })); await flush() })
assert.equal(closed, true)
assert.equal(saved.at(-1)?.key, 'new_topic_7')
assert.equal(saved.at(-1)?.sequence, 4)
assert.deepEqual(saved.at(-1)?.data.tags, ['test'])
assert.equal(saved.at(-1)?.data.categoryId, 4)

// Test site admin (Neo) ActivityCard and Hero adaptations
linuxDoPeople.activity = async () => ({
  actions: [
    {
      actionType: 5,
      username: 'Neo',
      avatarTemplate: 'https://cdn.linux.do/user_avatar/neo/96/1.png',
      title: '论坛发帖逻辑不合理',
      excerpt: '这集神了佬友们...',
      createdAt: '2026-10-15T00:00:00Z',
    },
    {
      actionType: 5,
      username: 'normal_user',
      avatarTemplate: 'https://cdn.linux.do/user_avatar/normal/96/1.png',
      title: '普通用户的回复',
      excerpt: '这是普通回复...',
      createdAt: '2026-10-15T01:00:00Z',
    },
  ],
  topics: [],
  offset: 0,
  hasMore: false,
})
await render(<UserProfileView username="Neo" initialTab="replies" onOpenUser={() => {}} {...props} />)

// Hero header test
const heroHeader = host.querySelector('section')
assert.ok(heroHeader, 'Hero header rendered')
assert.ok(heroHeader.querySelector('h2')?.className.includes('text-[#0088ff]'), 'Hero username is blue')
assert.ok(heroHeader.querySelector('svg[aria-label="站长认证"]'), 'Hero has shield certification')
assert.ok(heroHeader.querySelector('.rounded-\\[16px\\]'), 'Hero avatar container is square rounded-[16px]')

// Activity cards test
const articles = Array.from(host.querySelectorAll('article'))
const neoActivity = articles.find(a => a.textContent?.includes('论坛发帖逻辑不合理'))
assert.ok(neoActivity, 'Neo reply activity rendered')
assert.ok(neoActivity.querySelector('[data-linuxdo-site-admin-badge]'), 'Neo activity card has battery corner badge')
assert.ok(neoActivity.querySelector('.rounded-\\[7px\\]'), 'Neo activity avatar container is square rounded-[7px]')
assert.ok(neoActivity.querySelector('button')?.className.includes('rounded-[7px]'), 'Neo activity button is square')
assert.ok(neoActivity.querySelector('button[class*="text-[#0088ff]"]'), 'Neo activity username button is blue')
assert.ok(neoActivity.querySelector('svg[aria-label="站长认证"]'), 'Neo activity card has shield icon')

const normalActivity = articles.find(a => a.textContent?.includes('普通用户的回复'))
assert.ok(normalActivity, 'Normal reply activity rendered')
assert.equal(normalActivity.querySelector('[data-linuxdo-site-admin-badge]'), null, 'Normal user has no battery badge')
assert.ok(normalActivity.querySelector('button')?.className.includes('rounded-full'), 'Normal user avatar button is rounded-full')
assert.equal(normalActivity.querySelector('svg[aria-label="站长认证"]'), null, 'Normal user has no shield')

await act(async () => { root.unmount(); await flush() })
console.log('linuxdo-profile-sections-view: ok')
