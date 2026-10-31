import assert from 'node:assert/strict'

import { markdownToSafeHtml } from '../src/lib/markdown'

console.log('--- markdownToSafeHtml ---')

const rich = markdownToSafeHtml(`## 变更
- **加粗** 项
- [链接](https://example.com/path)

普通段落`)
assert.match(rich, /<h2>/)
assert.match(rich, /<ul>/)
assert.match(rich, /<strong>/)
assert.match(rich, /href="https:\/\/example\.com\/path"/)
assert.match(rich, /<p>/)

const xss = markdownToSafeHtml(`你好 <script>alert(1)</script>
[坏链](javascript:alert(1))
<img src=x onerror=alert(1)>`)
assert.doesNotMatch(xss, /<script/i)
assert.doesNotMatch(xss, /javascript:/i)
assert.doesNotMatch(xss, /<img/i)
assert.doesNotMatch(xss, /onerror/i)

const table=markdownToSafeHtml('| 模型 | 状态 |\n|---|---|\n| Qwen | **可用** |\n\n~~旧版本~~')
assert.match(table, /<table>/)
assert.match(table, /<th>/)
assert.match(table, /<td>/)
assert.match(table, /<del>/)
assert.doesNotMatch(table, /onerror|onclick|<script/i)

assert.equal(markdownToSafeHtml('   '), '')

console.log('markdown-safe: ok')
