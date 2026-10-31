import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'

import { ZhihuRemarkStore, zhihuRemarkIdentity } from '../src/features/zhihu/remarks/store'
import type { ZhihuAuthor } from '../src/features/zhihu/types'

const values = new Map<string, string>()
let failWrites = false
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (failWrites) throw new Error('QuotaExceededError')
    values.set(key, value)
  },
}

const author: ZhihuAuthor = { id: 'stable-member-id', token: 'profile-url-token', name: '原知乎昵称' }
assert.equal(zhihuRemarkIdentity(author), 'stable-member-id')
assert.equal(zhihuRemarkIdentity({ id: '', token: 'url-token' }), 'url-token')
assert.equal(zhihuRemarkIdentity({ id: '', token: '' }), null)
assert.equal(zhihuRemarkIdentity({ id: '0' }), null, 'anonymous user ids must not share a note')
assert.throws(() => new ZhihuRemarkStore('test', storage).save('  ', { name: 'invalid' }), /身份/)
const guest = new ZhihuRemarkStore(undefined, storage)
const account = new ZhihuRemarkStore('account-a', storage)
const otherAccount = new ZhihuRemarkStore('account-b', storage)
let notified = 0
const unsubscribe = account.subscribe(() => { notified++ })
account.save(zhihuRemarkIdentity(author), { name: '  熟悉的技术答主  ', tags: ['专业', '关注', '专业', '内容创作者', '第4个'] })
assert.deepEqual(account.get(author.id), { name: '熟悉的技术答主', tags: ['专业', '关注', '内容创作者'] })
assert.equal(notified, 1)
assert.equal(guest.get(author.id), undefined, 'logged-out notes are isolated')
assert.equal(otherAccount.get(author.id), undefined, 'different Zhihu accounts cannot read each other notes')
assert.equal(new ZhihuRemarkStore('account-a', storage).get(author.id)?.name, '熟悉的技术答主', 'notes survive reload')
assert.equal(account.get(zhihuRemarkIdentity({ ...author, name: '昵称已修改' }))?.name, '熟悉的技术答主', 'notes follow stable Zhihu id, not nickname')
failWrites = true
assert.throws(() => account.save(author.id, { name: '不能丢失' }), /本机存储失败/)
assert.equal(account.get(author.id)?.name, '熟悉的技术答主', 'failed storage writes do not alter visible notes')
assert.equal(notified, 1, 'failed storage writes do not emit changes')
failWrites = false
account.save(author.id, { tags: ['待观察', '高仿号'] })
assert.deepEqual(account.get(author.id), { name: '', tags: ['待观察', '高仿号'] })
account.save(author.id, {})
assert.equal(account.get(author.id), undefined, 'clearing a note deletes the persisted entry')
assert.equal(new ZhihuRemarkStore('account-a', storage).get(author.id), undefined)
unsubscribe()
values.set(account.storageKey, 'not-json')
assert.equal(new ZhihuRemarkStore('account-a', storage).get(author.id), undefined, 'corrupt stored data is ignored')
values.set(account.storageKey, JSON.stringify({ version: 0, entries: [[author.id, { name: 'stale' }]] }))
assert.equal(new ZhihuRemarkStore('account-a', storage).get(author.id), undefined, 'unknown persisted versions must not be displayed')
values.delete(account.storageKey)

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.defineProperty(window.document, 'oninput', { configurable: true, value: null })
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
  React, IS_REACT_ACT_ENVIRONMENT: true,
})
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
const { createRoot } = await import('react-dom/client')
const { dismissTopHardwareBackLayer } = await import('../src/lib/hardwareBackStack')
const { ZhihuRemarkProvider, ZhihuRemarkBadge, ZhihuRemarkEditButton } = await import('../src/features/zhihu/ui/ZhihuUserRemark')
const root = createRoot(document.getElementById('root')!)

function view(accountId: string, nickname = author.name) {
  const user = { ...author, name: nickname }
  return (
    <ZhihuRemarkProvider key={accountId} accountId={accountId}>
      <div data-location="answer">{user.name}<ZhihuRemarkBadge author={user} /><ZhihuRemarkEditButton author={user} showLabel /></div>
      <div data-location="comment">{user.name}<ZhihuRemarkBadge author={user} compact /></div>
    </ZhihuRemarkProvider>
  )
}
async function clickByLabel(part: string) {
  const node = [...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label')?.includes(part))
  assert.ok(node, 'button labelled ' + part)
  await act(async () => node.click())
}
async function fill(placeholder: string, next: string) {
  const node = [...document.querySelectorAll('input')].find((input) => input.getAttribute('placeholder') === placeholder) as HTMLInputElement
  assert.ok(node, 'input ' + placeholder)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(node, next)
    else node.value = next
    node.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}
async function submit() {
  const form = document.querySelector('[role="dialog"] form') as HTMLFormElement
  assert.ok(form)
  await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })) })
}
try {
  await act(async () => root.render(view('account-a')))
  assert.equal(document.body.textContent?.includes('熟悉的技术答主'), false)
  await clickByLabel('添加 原知乎昵称 的本地备注')
  assert.ok(document.querySelector('[role="dialog"][aria-modal="true"]'))
  await fill('例如：技术答主', '行业专家')
  await fill('专业、关注、营销', '专业，关注')
  await submit()
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.ok(document.querySelector('[data-location="answer"]')?.textContent?.includes('原知乎昵称'))
  assert.ok(document.querySelector('[data-location="answer"]')?.textContent?.includes('行业专家'))
  assert.ok(document.querySelector('[data-location="answer"]')?.textContent?.includes('专业'))
  assert.ok(document.querySelector('[data-location="comment"]')?.textContent?.includes('行业专家'), 'answer and comment update without navigation')
  assert.equal(document.querySelector('[data-location="comment"]')?.textContent?.includes('专业'), false, 'compact labels remain compact')
  await clickByLabel('编辑 原知乎昵称 的本地备注')
  assert.equal((document.querySelector('input[placeholder="例如：技术答主"]') as HTMLInputElement).value, '行业专家')
  await act(async () => { assert.equal(dismissTopHardwareBackLayer(), true) })
  assert.equal(document.querySelector('[role="dialog"]'), null, 'Android hardware back closes editor, not workspace')
  await act(async () => root.render(view('account-a', '新的知乎昵称')))
  assert.ok(document.body.textContent?.includes('新的知乎昵称'))
  assert.ok(document.body.textContent?.includes('行业专家'), 'nickname change does not remove note')
  await act(async () => root.render(view('account-b')))
  assert.equal(document.body.textContent?.includes('行业专家'), false, 'switching accounts hides previous notes')
  await act(async () => root.render(view('account-a')))
  assert.ok(document.body.textContent?.includes('行业专家'), 'switching back restores persisted account notes')
  await clickByLabel('编辑 原知乎昵称 的本地备注')
  await act(async () => {
    const node = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim().includes('清除'))
    assert.ok(node)
    node.click()
  })
  assert.equal(document.body.textContent?.includes('行业专家'), false, 'clear removes all visible notes')
} finally {
  await act(async () => root.unmount())
}
console.log('zhihu local user remarks: ok')
