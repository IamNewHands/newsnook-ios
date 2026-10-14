import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'

const paper = readFileSync(resolve('src/styles/settings-paper.css'), 'utf8')
const toggle = readFileSync(resolve('src/components/ToggleSwitch.tsx'), 'utf8')

// 设置页面外壳不可直接给所有按钮设定最小高度；ToggleSwitch 本体仅 22px 高。
assert.doesNotMatch(paper, /\.paper-settings-shell\s+button\s*\{[^}]*\bmin-height\s*:/s)
assert.doesNotMatch(paper, /\.paper-settings-shell\s+button\s*\{[^}]*\bheight\s*:/s)
assert.match(toggle, /h-\[22px\]\s+w-\[38px\]/)
assert.match(toggle, /role="switch"/)
assert.match(toggle, /aria-checked=\{checked\}/)
assert.match(toggle, /onChange\(\)/)

// 实际渲染两种状态。不能只检查 aria-checked：轨道变色而圆点不动就是这次回归。
;(globalThis as typeof globalThis & { React: typeof React }).React = React
const { ToggleSwitch } = await import('../src/components/ToggleSwitch')

function renderSwitch(checked: boolean, disabled = false) {
  const markup = renderToStaticMarkup(React.createElement(ToggleSwitch, {
    checked,
    disabled,
    label: '分类开关',
    onChange: () => {},
  }))
  const { document } = parseHTML(markup)
  const button = document.querySelector('button[role="switch"]')
  const thumb = button?.querySelector('span')
  assert.ok(button, '开关须保留语义化 switch 控件')
  assert.ok(thumb, '开关必须有独立可移动滑块')
  return { button, thumb }
}

const off = renderSwitch(false)
const on = renderSwitch(true)
assert.equal(off.button.getAttribute('aria-checked'), 'false')
assert.equal(on.button.getAttribute('aria-checked'), 'true')
assert.match(off.thumb.getAttribute('style') ?? '', /transform:translate3d\(0, 0, 0\)/)
assert.match(on.thumb.getAttribute('style') ?? '', /transform:translate3d\(16px, 0, 0\)/)
assert.match(on.button.className, /h-\[22px\].*w-\[38px\]/)
assert.ok(!on.thumb.className.includes('translate-x-'), '滑块位置不再依赖 Tailwind 独立 translate 属性')
assert.ok(renderSwitch(true, true).button.hasAttribute('disabled'))

let changes = 0
ToggleSwitch({ checked: false, label: '开关', onChange: () => { changes += 1 } }).props.onClick()
assert.equal(changes, 1, '点击仍触发真实业务 onChange')
ToggleSwitch({ checked: true, label: '禁用开关', disabled: true, onChange: () => { changes += 1 } }).props.onClick()
assert.equal(changes, 1, '禁用状态不可触发 onChange')

console.log('settings paper toggle regression: states, thumb position, click and disabled OK')
