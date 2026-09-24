import assert from 'node:assert/strict'

import { findCategory } from '../src/sources/categories'
import {
  DEFAULT_PREFERENCES,
  addCustomCategory,
  categorySourceIds,
  sourceUsageByOtherCategories,
} from '../src/sources/preferences'

console.log('Testing sourceUsageByOtherCategories...')

// Default preset: editing 国内要闻 must not report its own source as occupied elsewhere.
const headlineDefaults = categorySourceIds('cn-headlines', DEFAULT_PREFERENCES)
assert.ok(headlineDefaults.includes('netease'))
const defaultMap = sourceUsageByOtherCategories(DEFAULT_PREFERENCES, 'cn-headlines')
assert.equal(defaultMap.netease, undefined)

// Force an overlap into 公共议题: editing 国内要闻 should point at the other visible category.
const prefsWithOverlap = {
  ...DEFAULT_PREFERENCES,
  categorySources: {
    ...DEFAULT_PREFERENCES.categorySources,
    'cn-public': [...categorySourceIds('cn-public', DEFAULT_PREFERENCES), 'netease'],
  },
}
const headlineEditMap = sourceUsageByOtherCategories(prefsWithOverlap, 'cn-headlines')
assert.deepEqual(headlineEditMap.netease, ['公共议题'])

// Editing 公共议题 excludes itself but still sees 国内要闻.
const publicEditMap = sourceUsageByOtherCategories(prefsWithOverlap, 'cn-public')
assert.deepEqual(publicEditMap.netease, ['国内要闻'])
assert.ok(!publicEditMap.netease?.includes('公共议题'))

for (const labels of Object.values(headlineEditMap)) {
  assert.ok(!labels.includes('综合'))
}

const { nextPrefs: prefsWithCustom, newCategoryId } = addCustomCategory(prefsWithOverlap, {
  label: '我的专栏',
  short: '专栏',
  sourceIds: ['netease'],
})
const newCategoryMap = sourceUsageByOtherCategories(prefsWithCustom)
assert.ok(newCategoryMap.netease?.includes('国内要闻'))
assert.ok(newCategoryMap.netease?.includes('公共议题'))
assert.ok(newCategoryMap.netease?.includes('我的专栏'))

const editingCustomMap = sourceUsageByOtherCategories(prefsWithCustom, newCategoryId)
assert.ok(editingCustomMap.netease?.includes('国内要闻'))
assert.ok(!editingCustomMap.netease?.includes('我的专栏'))

const headlineLabel = findCategory('cn-headlines').label
assert.equal(newCategoryMap.netease?.[0], headlineLabel)

const prefsPublicHidden = {
  ...prefsWithOverlap,
  hiddenCategoryIds: [...DEFAULT_PREFERENCES.hiddenCategoryIds, 'cn-public'],
}
const hiddenPublicMap = sourceUsageByOtherCategories(prefsPublicHidden, 'cn-headlines')
assert.equal(hiddenPublicMap.netease, undefined)

const { nextPrefs: prefsSameLabel } = addCustomCategory(prefsWithOverlap, {
  label: '国内要闻',
  short: '要闻2',
  sourceIds: ['netease'],
})
const sameLabelMap = sourceUsageByOtherCategories(prefsSameLabel, 'cn-public')
assert.equal(sameLabelMap.netease?.filter((label) => label === '国内要闻').length, 2)

console.log('sourceUsageByOtherCategories: ok')
