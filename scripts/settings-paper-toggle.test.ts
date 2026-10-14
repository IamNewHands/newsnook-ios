import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const paper = readFileSync(resolve('src/styles/settings-paper.css'), 'utf8')
const toggle = readFileSync(resolve('src/components/ToggleSwitch.tsx'), 'utf8')

// 设置页面外壳不可直接给所有按钮设定最小高度；ToggleSwitch 本体仅 22px 高。
assert.doesNotMatch(paper, /\.paper-settings-shell\s+button\s*\{[^}]*\bmin-height\s*:/s)
assert.doesNotMatch(paper, /\.paper-settings-shell\s+button\s*\{[^}]*\bheight\s*:/s)
assert.match(toggle, /h-\[22px\]\s+w-\[38px\]/)
assert.match(toggle, /role="switch"/)
assert.match(toggle, /aria-checked=\{checked\}/)
assert.match(toggle, /onChange\(\)/)
console.log('settings paper toggle regression: ok')
