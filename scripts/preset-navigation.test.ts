import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defaultFeedCategoryId, DEFAULT_PREFERENCES, visibleCategories } from '../src/sources/preferences'
import {
  BUILTIN_DEFAULT_ID,
  BUILTIN_DEPTH_ID,
  applySnapshotToPrefs,
  findBuiltinPreset,
} from '../src/sources/presets'

function firstCategory(presetId: string): string {
  const preset = findBuiltinPreset(presetId)
  assert.ok(preset, `缺少预设 ${presetId}`)
  return defaultFeedCategoryId(
    visibleCategories(applySnapshotToPrefs(DEFAULT_PREFERENCES, preset.snapshot)),
  )
}

assert.equal(firstCategory(BUILTIN_DEFAULT_ID), 'cn-headlines')
assert.equal(firstCategory(BUILTIN_DEPTH_ID), 'depth-reporting')

const appSource = readFileSync(resolve('src/App.tsx'), 'utf8')

const presetResetEffect = appSource.match(
  /useLayoutEffect\(\(\) => \{[\s\S]*?prevPresetIdRef\.current === activePresetId[\s\S]*?\}, \[activePresetFirstCategoryId, activePresetId\]\)/,
)?.[0]

assert.ok(presetResetEffect, 'App 必须监听活动预设变化')
assert.match(
  presetResetEffect,
  /setCategoryId\(activePresetFirstCategoryId\)/,
  '切换预设必须无条件回到新预设首个普通分类',
)
assert.doesNotMatch(
  presetResetEffect,
  /categoryId === RECOMMEND_CATEGORY_ID/,
  '不能仅在旧分类为推荐栏时才重置',
)
assert.match(
  appSource,
  /<FeedScreen\s+key=\{`preset:\$\{activePresetId\}`\}/,
  '切换预设必须重建信息流，清除旧布局的分类滚动位置',
)

console.log('preset-navigation.test.ts: ok')
