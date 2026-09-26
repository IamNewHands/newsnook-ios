import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { imageActionSources } from '../src/lib/imageActions'

// blob 优先：Linux.do 的原图地址在 CapacitorHttp 里会被 Cloudflare 403，页面里已经
// 拿到的字节必须先用；拿不到 blob 时才退回原始地址。
assert.deepEqual(
  imageActionSources('blob:capacitor://localhost/abc', 'https://linux.do/uploads/default/original/1X/a.png'),
  ['blob:capacitor://localhost/abc', 'https://linux.do/uploads/default/original/1X/a.png'],
  'blob 与原始地址都要保留，且 blob 在前',
)
assert.deepEqual(
  imageActionSources('https://cdn.example/a.jpg', 'https://cdn.example/a-original.jpg'),
  ['https://cdn.example/a-original.jpg'],
  '普通 http 图仍只用原始地址',
)
assert.deepEqual(
  imageActionSources('https://cdn.example/a.jpg'),
  ['https://cdn.example/a.jpg'],
  '没有 actionSrc 时用显示地址',
)
assert.deepEqual(
  imageActionSources('https://cdn.example/a.jpg', 'https://cdn.example/a.jpg'),
  ['https://cdn.example/a.jpg'],
  '显示地址与原始地址相同时不重复',
)
assert.deepEqual(imageActionSources('blob:x'), ['blob:x'], '只有 blob 时也要有可用源')
assert.deepEqual(imageActionSources('blob:x', 'blob:x'), ['blob:x'], 'blob 与 actionSrc 相同不重复')
// 小图现在由会话通道以 data: URL 承载（WKWebView 对 blob: 的加载依赖 capacitor:// 方案），
// 灯箱动作必须同样优先用页面里已有的字节，不能回退到会被 403 的原始地址。
assert.deepEqual(
  imageActionSources('data:image/png;base64,AAAA', 'https://linux.do/uploads/default/original/1X/a.png'),
  ['data:image/png;base64,AAAA', 'https://linux.do/uploads/default/original/1X/a.png'],
  'data URL 与原始地址都要保留，且 data 在前',
)
assert.deepEqual(imageActionSources('data:image/png;base64,AAAA'), ['data:image/png;base64,AAAA'], '只有 data URL 时也要有可用源')

const source = readFileSync('src/lib/imageActions.ts', 'utf8')
assert.match(
  source,
  /if \(url\.startsWith\('data:'\)\) \{[\s\S]{0,240}图片数据为空/,
  'fetchImageBytes 必须先处理 data:（WebView 直接读本地字节，不再发请求）',
)
assert.match(
  source,
  /if \(url\.startsWith\('blob:'\)\) \{[\s\S]{0,240}response\.blob\(\)/,
  'fetchImageBytes 必须先处理 blob:（WebView 直接读本地字节，不再发请求）',
)

const lightbox = readFileSync('src/components/ImageLightbox.tsx', 'utf8')
assert.match(
  lightbox,
  /for \(const source of imageActionSources\(src, actionSrc\)\)/,
  '灯箱动作必须按 imageActionSources 逐个尝试',
)
assert.match(
  lightbox,
  /if \(\/cancel\|abort\|dismiss\/i\.test\(message\)\) throw error/,
  '用户取消后不能再试下一个源，否则会二次弹出系统面板',
)

console.log('image actions tests passed')
