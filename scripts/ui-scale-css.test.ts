import assert from 'node:assert/strict'

import { applyUiScale } from './ui-scale-css.ts'

// `{` 开头：包成 calc，并保留原始 px 作为旧内核兜底
assert.equal(
  applyUiScale('.text-\\[11px\\]{font-size:11px}'),
  '.text-\\[11px\\]{font-size:11px;font-size:calc(11px * var(--ui-scale, 1))}',
)

// `;` 开头 + 冒号后空格 + 小数
assert.equal(
  applyUiScale('.a{color:red; font-size: 10.5px}'),
  '.a{color:red; font-size:10.5px;font-size:calc(10.5px * var(--ui-scale, 1))}',
)

// 未压缩产物里的换行缩进
assert.equal(
  applyUiScale('.a {\n  font-size: 13px;\n}'),
  '.a {\n  font-size:13px;font-size:calc(13px * var(--ui-scale, 1));\n}',
)

// 同一个规则里多条字号都要处理
assert.equal(
  applyUiScale('.a{font-size:10px}.b{font-size:11px}'),
  '.a{font-size:10px;font-size:calc(10px * var(--ui-scale, 1))}' +
    '.b{font-size:11px;font-size:calc(11px * var(--ui-scale, 1))}',
)

// !important 必须落在两条声明上，否则兜底那条会输掉优先级
assert.equal(
  applyUiScale('.a{font-size:9px!important}'),
  '.a{font-size:9px!important;font-size:calc(9px * var(--ui-scale, 1))!important}',
)

// 自定义属性不能被误伤：阅读排版有自己的旋钮，且正文不含 px
const reader = ':root{--reader-font-size:15.5px;--ui-scale:1}'
assert.equal(applyUiScale(reader), reader)

// 非 px 字号一律不动
for (const value of ['100%', '1.2em', '1rem', 'var(--reader-font-size)', 'inherit', '0']) {
  const css = `.a{font-size:${value}}`
  assert.equal(applyUiScale(css), css, `不应改写 font-size:${value}`)
}

// 幂等：重复调用不会把 calc() 叠成两层
const once = applyUiScale('.a{font-size:12px}')
assert.equal(applyUiScale(once), once)
assert.equal(once.match(/var\(--ui-scale/g)?.length, 1)

// 属性名大小写不敏感，但产物统一小写；大写写法原样放过，不做半吊子替换
assert.equal(applyUiScale('.a{FONT-SIZE:11px}'), '.a{FONT-SIZE:11px}')

console.log('ui-scale css: ok')
