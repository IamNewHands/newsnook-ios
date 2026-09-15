import assert from 'node:assert/strict'

import { loadActiveSiteId, saveActiveSiteId, type LayoutStorage } from '../src/features/sites/layoutState'
import { createZhihuRootFrame, reduceRoutes } from '../src/features/zhihu/navigation'
import type { RouteFrame } from '../src/features/zhihu/types'
import { SOURCES, findSource, findSite } from '../src/sources/registry'
import { allRegisteredSources } from '../src/sources/preferences/categoryPrefs'
import { parseSourcePayload } from '../src/lib/parseFeed'

const before: RouteFrame[] = [
  {
    route: { screen: 'entity', ref: { kind: 'answer', id: '1' } },
    anchor: 'comment-9',
    scrollTop: 860,
  },
]
const next = reduceRoutes(before, {
  type: 'push',
  frame: { route: { screen: 'entity', ref: { kind: 'people', id: 'u' } }, scrollTop: 0 },
})
assert.equal(next.length, 2)
assert.deepEqual(reduceRoutes(next, { type: 'back' }), before, '返回必须恢复原锚点/scrollTop')

const repeated = reduceRoutes(next, {
  type: 'push',
  frame: { route: { screen: 'entity', ref: { kind: 'people', id: 'u' } }, anchor: 'bio', scrollTop: 12 },
})
assert.equal(repeated.length, 2, '重复打开同一目标应 replace 而不是堆重复 route')
assert.equal(repeated.at(-1)?.anchor, 'bio')
assert.equal(repeated.at(-1)?.scrollTop, 12)

assert.deepEqual(reduceRoutes([], { type: 'back' }), [])
const root = [createZhihuRootFrame()]
assert.deepEqual(reduceRoutes(root, { type: 'back' }), root, '根栈退出由 App 宿主负责，reducer 不删除根 frame')

function memoryStorage(): LayoutStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

const storage = memoryStorage()
assert.equal(loadActiveSiteId(storage), null)
saveActiveSiteId('zhihu', storage)
assert.equal(loadActiveSiteId(storage), 'zhihu')
storage.setItem('newsnook:layout:active-site:v1', 'unknown-site')
assert.equal(loadActiveSiteId(storage), null, '未知持久化 site id 不能污染布局状态')
saveActiveSiteId(null, storage)
assert.equal(loadActiveSiteId(storage), null)

const daily = findSource('zhihu-daily')
const community = findSource('zhihu-community')
assert.equal(daily?.kind, 'zhihu', '知乎日报旧 kind 语义必须保持')
assert.equal(community?.kind, 'zhihu-community')
assert.equal(community?.workspaceOnly, true)
assert.ok(SOURCES.includes(community!))
assert.equal(allRegisteredSources().some((source) => source.id === 'zhihu-community'), false)
assert.equal(findSite('zhihu')?.sourceId, 'zhihu-community')
assert.throws(
  () => parseSourcePayload(community!, '{}'),
  /workspaceOnly source must be loaded by its dedicated site adapter/,
  '知乎社区源误走普通 Feed 解析时必须显式失败，不能落进 RSS/日报解析器',
)

console.log('zhihu navigation/layout contract ok')
