import assert from 'node:assert/strict'

import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
  setHomeFeedLayout,
} from '../src/sources/preferences'

// 全新安装：loadPreferences() 返回 null，必须直接进入新版双栏。
const fresh = normalizePreferences(null)
assert.equal(fresh.homeFeedLayout, 'cards', '全新安装应默认双栏卡片')

// 升级老安装/导入旧备份：已有偏好对象但缺少新字段，必须保持经典单栏。
const legacy = normalizePreferences({
  theme: 'dark',
  typography: { fontScale: 1, lineHeight: 1.9, paragraphGap: 1.1, fontFamily: 'sans' },
})
assert.equal(legacy.homeFeedLayout, 'classic', '历史偏好缺字段时必须保持经典列表')

// 新版持久化后的选择必须稳定往返。
assert.equal(DEFAULT_PREFERENCES.homeFeedLayout, 'cards')
assert.equal(normalizePreferences({ homeFeedLayout: 'cards' }).homeFeedLayout, 'cards')
assert.equal(normalizePreferences({ homeFeedLayout: 'classic' }).homeFeedLayout, 'classic')
assert.equal(
  normalizePreferences({ homeFeedLayout: 'unknown' }).homeFeedLayout,
  'classic',
  '已有但损坏的旧偏好应保守回落经典列表',
)

const classic = setHomeFeedLayout(fresh, 'classic')
assert.equal(classic.homeFeedLayout, 'classic')
assert.equal(setHomeFeedLayout(classic, 'classic'), classic, '重复选择同一布局应幂等')
assert.equal(setHomeFeedLayout(classic, 'cards').homeFeedLayout, 'cards')

console.log('home-feed-layout: ok')
