import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  DEFAULT_PREFERENCES,
  DEFAULT_UI_PREFS,
  normalizePreferences,
  normalizeUiPrefs,
  normalizeUiScale,
  resetUiPrefs,
  resolveUiFontOption,
  UI_FONT_OPTIONS,
  UI_FONT_WEIGHT_OPTIONS,
  UI_SCALE_OPTIONS,
  UI_SCALE_RANGE,
  updateUiPrefs,
  type UiFontFamilyId,
} from '../src/sources/preferences'

// 默认档：字体与字号都必须等于 index.css 的 :root 取值，升级后观感不变
assert.deepEqual(DEFAULT_PREFERENCES.ui, DEFAULT_UI_PREFS)
assert.equal(DEFAULT_UI_PREFS.fontFamily, 'system')
assert.equal(DEFAULT_UI_PREFS.scale, 1)
assert.equal(DEFAULT_UI_PREFS.weight, 'regular')

// 旧数据 / 空数据回落到默认档
assert.deepEqual(normalizePreferences({}).ui, DEFAULT_UI_PREFS)
assert.deepEqual(normalizePreferences(null).ui, DEFAULT_UI_PREFS)
assert.deepEqual(normalizeUiPrefs(undefined), DEFAULT_UI_PREFS)
assert.deepEqual(normalizeUiPrefs('nonsense'), DEFAULT_UI_PREFS)

// 合法字体族保留，未知值清洗回默认
for (const option of UI_FONT_OPTIONS) {
  assert.equal(normalizeUiPrefs({ fontFamily: option.id }).fontFamily, option.id)
}
assert.equal(normalizeUiPrefs({ fontFamily: 'comic-sans' }).fontFamily, 'system')
assert.equal(normalizeUiPrefs({ fontFamily: 42 }).fontFamily, 'system')

// 字号夹紧到允许区间；非数值回落到默认
assert.equal(normalizeUiScale(1.2), 1.2)
assert.equal(normalizeUiScale(0.1), UI_SCALE_RANGE.min)
assert.equal(normalizeUiScale(9), UI_SCALE_RANGE.max)
assert.equal(normalizeUiScale(Number.NaN), 1)
assert.equal(normalizeUiScale('1.2'), 1)

// setter：非法字号也走夹紧；无变化时保持引用
const bigger = updateUiPrefs(DEFAULT_PREFERENCES, { scale: 99 })
assert.equal(bigger.ui.scale, UI_SCALE_RANGE.max)
assert.equal(bigger.ui.fontFamily, DEFAULT_UI_PREFS.fontFamily)
assert.equal(updateUiPrefs(bigger, { scale: 99 }), bigger, '无变化应返回原对象')
assert.equal(updateUiPrefs(DEFAULT_PREFERENCES, { fontFamily: 'songti' }).ui.scale, 1)
assert.deepEqual(resetUiPrefs(bigger).ui, DEFAULT_UI_PREFS)

// 选项表自洽：id 唯一、含标准档、档位都在允许区间内
assert.equal(new Set(UI_FONT_OPTIONS.map((option) => option.id)).size, UI_FONT_OPTIONS.length)
assert.ok(
  UI_SCALE_OPTIONS.some((option) => option.value === 1),
  '必须有「标准」档，否则回不到原样',
)
for (const option of UI_SCALE_OPTIONS) {
  assert.ok(
    option.value >= UI_SCALE_RANGE.min && option.value <= UI_SCALE_RANGE.max,
    `${option.label} 超出允许区间`,
  )
}

// 字体栈必须自带通用兜底，缺字体时不能让整条声明失效
for (const option of UI_FONT_OPTIONS) {
  assert.match(option.body, /(sans-serif|serif)$/, `${option.id} 正文字体栈缺通用兜底`)
  assert.match(option.display, /(sans-serif|serif)$/, `${option.id} 标题字体栈缺通用兜底`)
  assert.ok(option.label.length > 0)
}

// 默认档的字体栈必须与 index.css 里的 :root 默认值逐字一致
assert.equal(UI_FONT_OPTIONS[0].id, 'system')
assert.equal(UI_FONT_OPTIONS[0].body, "'Noto Sans SC', 'PingFang SC', system-ui, sans-serif")
assert.equal(UI_FONT_OPTIONS[0].display, "'Noto Serif SC', 'Songti SC', serif")

// 未知 id 回落到默认档，保证 CSS 变量永远有值
assert.equal(resolveUiFontOption('nope' as UiFontFamilyId), UI_FONT_OPTIONS[0])

// 字重：合法档位保留，未知值清洗回标准
for (const option of UI_FONT_WEIGHT_OPTIONS) {
  assert.equal(normalizeUiPrefs({ weight: option.id }).weight, option.id)
}
assert.equal(normalizeUiPrefs({ weight: 'heavy' }).weight, 'regular')
assert.equal(normalizeUiPrefs({ weight: 700 }).weight, 'regular')
assert.equal(UI_FONT_WEIGHT_OPTIONS[0].id, 'regular', '标准档必须排在第一，作为回落值')
assert.equal(new Set(UI_FONT_WEIGHT_OPTIONS.map((o) => o.id)).size, UI_FONT_WEIGHT_OPTIONS.length)

// setter：字重变化要产生新对象，无变化保持引用
const heavier = updateUiPrefs(DEFAULT_PREFERENCES, { weight: 'bold' })
assert.equal(heavier.ui.weight, 'bold')
assert.notEqual(heavier, DEFAULT_PREFERENCES)
assert.equal(updateUiPrefs(heavier, { weight: 'bold' }), heavier, '无变化应返回原对象')
assert.deepEqual(resetUiPrefs(heavier).ui, DEFAULT_UI_PREFS)

// 回归：只改 floatReaderNav 也必须生效——空操作守卫曾漏掉该字段，导致开关「关不掉」。
assert.equal(DEFAULT_UI_PREFS.floatReaderNav, true, '悬浮翻页默认开启')
const navOff = updateUiPrefs(DEFAULT_PREFERENCES, { floatReaderNav: false })
assert.notEqual(navOff, DEFAULT_PREFERENCES, '只改 floatReaderNav 也要产生新对象')
assert.equal(navOff.ui.floatReaderNav, false)
assert.equal(navOff.ui.fontFamily, DEFAULT_UI_PREFS.fontFamily, '不该顺带改其它字段')
assert.equal(updateUiPrefs(navOff, { floatReaderNav: false }), navOff, '无变化应返回原对象')

/*
 * 关键不变量：非默认字重档位的 id 必须能在 index.css 里找到对应的
 * `:root[data-ui-weight='<id>']` 覆盖块——applyUiPrefs 只写属性，
 * 权重表在 CSS 里，两边对不上就会「选了没反应」。
 */
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
for (const option of UI_FONT_WEIGHT_OPTIONS) {
  if (option.id === 'regular') continue
  assert.ok(
    css.includes(`:root[data-ui-weight='${option.id}']`),
    `index.css 缺少 :root[data-ui-weight='${option.id}'] 覆盖块`,
  )
}
// 默认档不应有覆盖块：它必须完全等于 Tailwind 缺省值
assert.ok(!css.includes(":root[data-ui-weight='regular']"), '标准档不应该有覆盖块')

// 覆盖块必须真的抬升字重，而不是复制默认值
const boldBlock = css.slice(css.indexOf(":root[data-ui-weight='bold']"))
assert.match(boldBlock, /--font-weight-normal:\s*600/)
assert.match(boldBlock, /--font-weight-medium:\s*700/)

// 往返：配置备份 / 持久化都走 JSON，序列化后必须一致
const roundTrip = normalizePreferences(JSON.parse(JSON.stringify(bigger)))
assert.deepEqual(roundTrip.ui, bigger.ui)

console.log('ui-font prefs: ok')
