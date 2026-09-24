import assert from 'node:assert/strict'

import { CATEGORIES } from '../src/sources/categories'
import {
  DEFAULT_PREFERENCES,
  isCategoryVisible,
  settingsCategories,
  toggleCategoryVisible,
} from '../src/sources/preferences'

const visible = new Set(['cn-headlines', 'mix'])
const prefs = {
  ...DEFAULT_PREFERENCES,
  categoryOrder: ['cn-dialogue', 'cn-external', 'cn-headlines', 'mix'],
  hiddenCategoryIds: CATEGORIES.map((category) => category.id).filter((id) => !visible.has(id)),
}

const ordered = settingsCategories(prefs)
const firstHidden = ordered.findIndex((category) => !isCategoryVisible(category.id, prefs))

assert.ok(firstHidden > 0)
assert.ok(
  ordered.slice(0, firstHidden).every((category) => isCategoryVisible(category.id, prefs)),
)
assert.ok(
  ordered.slice(firstHidden).every((category) => !isCategoryVisible(category.id, prefs)),
)
assert.deepEqual(
  ordered.slice(0, 2).map((category) => category.id),
  ['cn-headlines', 'mix'],
  '启用分类应保持原有相对顺序并排在最前面',
)
assert.deepEqual(
  ordered.slice(firstHidden, firstHidden + 2).map((category) => category.id),
  ['cn-dialogue', 'cn-external'],
  '显式排序的停用分类应保持原有相对顺序并领先于其余停用分类',
)

const enabledAgain = toggleCategoryVisible(prefs, 'cn-dialogue')
assert.equal(settingsCategories(enabledAgain)[0].id, 'cn-dialogue')

console.log('category settings order: ok')
