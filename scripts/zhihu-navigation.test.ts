import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

// 移动端首页的布局切换器必须转发完整的共享配置。这里刻意守住整对象转发，
// 避免桌面端新增 siteItems/onSelectSite 后，移动端因逐字段传参再次漏掉第三方站点入口。
const workspaceSource = readFileSync(new URL('../src/features/zhihu/ui/ZhihuWorkspace.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(
  workspaceSource,
  /<header[^>]+paddingTop:\s*'var\(--sat\)'/,
  '知乎工作区挂在 AppShell 内，header 不能再次叠加顶部 safe-area',
)

const feedScreenSource = readFileSync(new URL('../src/screens/FeedScreen.tsx', import.meta.url), 'utf8')
assert.match(
  feedScreenSource,
  /presetSwitcher\?:\s*Omit<PresetSwitcherProps,\s*'variant'>/,
  '移动端 FeedScreen 必须复用 PresetSwitcher 的完整共享类型契约',
)
assert.match(
  feedScreenSource,
  /<PresetSwitcher\s+\{\.\.\.presetSwitcher\}\s*\/>/,
  '移动端布局切换器必须完整转发 siteItems/onSelectSite，不能逐字段漏传',
)

// 推荐传输策略是内部实现细节，不能再暴露成 Web/Android/混合/本地这类开发者选项。
const zhihuFeedScreenSource = readFileSync(new URL('../src/features/zhihu/ui/ZhihuFeedScreen.tsx', import.meta.url), 'utf8')
const zhihuWorkspaceSource = readFileSync(new URL('../src/features/zhihu/ui/ZhihuWorkspace.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(zhihuFeedScreenSource, /ZHIHU_RECOMMENDATION_MODES|recommendationMode|onRecommendationModeChange/)
assert.doesNotMatch(zhihuFeedScreenSource, />\s*(Web|Android|混合|本地)\s*</)
assert.match(zhihuWorkspaceSource, /useZhihuFeed\(service, mode, 'android', accountId\)/)
assert.match(zhihuWorkspaceSource, /<span>首页<\/span>/)
assert.match(zhihuWorkspaceSource, /<span>消息<\/span>/)
assert.match(zhihuWorkspaceSource, /<span>我的<\/span>/)
assert.doesNotMatch(zhihuWorkspaceSource, /ZHIHU WORKSPACE/, '生产 UI 不应暴露 workspace/debug 文案')
assert.doesNotMatch(zhihuFeedScreenSource, />\s*\{item\.ref\.kind\}\s*</, '信息流卡片不应把 answer/question 等协议类型显示给用户')
assert.doesNotMatch(zhihuFeedScreenSource, /recommendationSource/, '信息流卡片不应把 android/web 等传输来源显示给用户')

const zhihuContentSource = readFileSync(new URL('../src/features/zhihu/ui/ZhihuContentScreen.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(zhihuContentSource, /NewsNook 阅读|BookOpen/, '知乎正文必须直接在站点工作区渲染，不能要求二次进入 NewsNook Reader')
assert.match(zhihuContentSource, /previousAnswerIds/, '回答页应优先消费 pagination_info 的上一回答')
assert.match(zhihuContentSource, /nextAnswerIds/, '回答页应优先消费 pagination_info 的下一回答')

console.log('zhihu navigation/layout contract ok')
