import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import type { Article } from '../src/lib/types'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
const data = new Map<string, string>()
const idle = new Map<number, () => void>()
let idleId = 0
Object.assign(window, {
  requestIdleCallback: (callback: () => void) => { idle.set(++idleId, callback); return idleId },
  cancelIdleCallback: (id: number) => idle.delete(id),
})
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, String(value)),
    removeItem: (key: string) => data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size },
  },
})
const { createRoot } = await import('react-dom/client')
const { useLaterArticles } = await import('../src/hooks/useLaterArticles')
const { saveCachedBody, loadCachedBody, hasCachedBody, bodyCacheStats } = await import('../src/lib/bodyCache')
const { loadLaterArticles } = await import('../src/lib/storage')
let clock = 1_800_000_000_000
const realDateNow = Date.now
Date.now = () => ++clock
const article = (id: string): Article => ({
  id, title: id, summary: 'Summary', publishedAt: clock, hasRealDate: true,
  sourceId: 'test', sourceName: 'Test', sourceLabel: 'Test', sourceGroup: 'custom',
  originUrl: `https://example.org/${id}`, contentType: 'article',
})
const favorite = article('favorite')
const ordinary = article('ordinary')
const incoming = article('incoming')
const body = `<p>${'正文'.repeat(300_000)}</p>`
let later!: ReturnType<typeof useLaterArticles>
let notifications = 0
const notify = () => { notifications++ }
function Harness() {
  later = useLaterArticles(notify)
  return <button onClick={() => later.toggleLater(favorite)}>{later.later.length ? 'Unsave' : 'Save'}</button>
}
const root = createRoot(document.getElementById('root')!)
try {
  assert.equal(saveCachedBody(favorite, { html: body, bodySource: 'readability' }), true)
  assert.equal(saveCachedBody(ordinary, { html: body, bodySource: 'readability' }), true)
  await act(async () => root.render(<React.StrictMode><Harness /></React.StrictMode>))
  await act(async () => document.querySelector('button')!.dispatchEvent(new window.Event('click', { bubbles: true })))
  assert.deepEqual(later.later.map(item => item.id), [favorite.id])
  assert.ok(idle.size > 0, 'the explicit action completes while idle persistence is still queued')
  // No idle callback has run. A concurrent body write must evict the ordinary
  // article, even though the just-saved favorite is older and otherwise first in LRU.
  assert.equal(saveCachedBody(incoming, { html: body, bodySource: 'readability' }), true)
  assert.equal(hasCachedBody(favorite.id), true, 'an explicit save must protect its cached body before idle maintenance')
  assert.equal(hasCachedBody(ordinary.id), false, 'the unpinned body is the eviction candidate')
  assert.equal(loadCachedBody(favorite.id)?.html, body, 'the saved article remains readable offline')
  assert.equal(bodyCacheStats().pinned, 1)

  for (const callback of idle.values()) callback()
  idle.clear()
  assert.deepEqual(loadLaterArticles().map(item => item.id), [favorite.id], 'the existing local persistence contract is retained')

  await act(async () => later.removeLater(favorite.id))
  assert.deepEqual(later.later, [])
  assert.equal(bodyCacheStats().pinned, 0, 'removal releases a cached body immediately')
  assert.equal(notifications, 1)
  await act(async () => { later.toggleLater(favorite); later.toggleLater(favorite) })
  assert.deepEqual(later.later, [], 'same-turn toggles use the latest ref and cannot add duplicates')
  assert.equal(bodyCacheStats().pinned, 0)
  console.log('Later pinning: explicit save survives pre-idle eviction, persistence and immediate removal passed')
} finally {
  await act(async () => root.unmount())
  Date.now = realDateNow
}
