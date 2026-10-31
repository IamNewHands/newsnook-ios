import assert from 'node:assert/strict'
import { BROWSER_KEYS } from '../src/features/browser/browserPreferences'
import {
  loadBrowserBookmarks, saveBrowserBookmarks, toggleBrowserBookmark,
  advancePrivateBookmarkTap, type PrivateBookmarkTap,
} from '../src/features/browser/browserBookmarks'

const storage = new Map<string, string>()
let failingKey: string | null = null
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (key === failingKey) throw new Error('Storage unavailable')
    storage.set(key, value)
  },
} })

const publicVisit = {url:'https://public.example/article',title:'Public bookmark',time:1000}
const privateVisit = {url:'https://private.example/secret',title:'Private bookmark',time:2000}
assert.equal(BROWSER_KEYS.bookmarks, 'newsnook:browser:bookmarks:v1', 'existing bookmark key must not migrate')
assert.ok(BROWSER_KEYS.privateBookmarks !== BROWSER_KEYS.bookmarks, 'private bookmarks cannot share a normal storage key')
saveBrowserBookmarks('normal', [publicVisit])
saveBrowserBookmarks('private', [privateVisit])
assert.deepEqual(loadBrowserBookmarks('normal'), [{...publicVisit,url:'https://public.example/article'}])
assert.deepEqual(loadBrowserBookmarks('private'), [{...privateVisit,url:'https://private.example/secret'}])
assert.equal(storage.get(BROWSER_KEYS.bookmarks)?.includes('private.example'), false)
assert.equal(storage.get(BROWSER_KEYS.privateBookmarks)?.includes('public.example'), false)

const refreshed = toggleBrowserBookmark(loadBrowserBookmarks('private'), privateVisit.url, 'Updated private bookmark', 3000)
assert.equal(refreshed.added, false, 'toggling the private bookmark must remove it from only its own scope')
assert.equal(refreshed.entries.length, 0)
assert.equal(loadBrowserBookmarks('normal').length, 1)
const created = toggleBrowserBookmark(refreshed.entries, privateVisit.url, privateVisit.title, 4000)
assert.equal(created.added, true)
assert.equal(created.entries.length, 1)
assert.equal(toggleBrowserBookmark(created.entries, 'javascript:alert(1)', 'Invalid', 5000).entries, created.entries,
  'invalid URL never enters bookmark storage')

failingKey = BROWSER_KEYS.privateBookmarks
const untouched = storage.get(failingKey)
assert.throws(() => saveBrowserBookmarks('private', []), /保存失败/)
assert.equal(storage.get(failingKey), untouched, 'failed private persistence must not wipe the existing collection')
failingKey = null
storage.set(BROWSER_KEYS.privateBookmarks, '{broken json')
assert.deepEqual(loadBrowserBookmarks('private'), [], 'corrupted private payload must not leak or break normal bookmarks')
assert.equal(loadBrowserBookmarks('normal').length, 1)

const initial: PrivateBookmarkTap = {count: 0, lastAt: 0}
let state = initial
for (let index = 1; index <= 4; index++) {
  const next = advancePrivateBookmarkTap(state, 1000 + index * 100)
  assert.equal(next.activated, false)
  state = next.state
}
const fifth = advancePrivateBookmarkTap(state, 1500)
assert.equal(fifth.activated, true, 'the fifth consecutive tap unlocks exactly once')
assert.equal(fifth.state.count, 0, 'completed gesture resets its counter')
state = advancePrivateBookmarkTap(initial, 1000).state
state = advancePrivateBookmarkTap(state, 1100).state
state = advancePrivateBookmarkTap(state, 2200).state
assert.equal(state.count, 1, 'a delay starts a new streak')
state = advancePrivateBookmarkTap(state, 2300).state
state = advancePrivateBookmarkTap(state, 2400).state
assert.equal(advancePrivateBookmarkTap(state, 2500).activated, false,
  'an expired sequence cannot unlock on the fifth aggregate tap')
assert.equal(advancePrivateBookmarkTap(initial, 500).state.count, 1)

console.log('Private/normal bookmark storage boundaries and five-tap reveal contract passed')
