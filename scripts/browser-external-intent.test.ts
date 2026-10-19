import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shareTokenFromAppUrl } from '../src/lib/appDeepLink'
import { syncRouteFromAppUrl } from '../src/features/sync/nativeNotification'
import { BROWSER_OPEN_EVENT, openBrowserWithUrl, type BrowserOpenDetail } from '../src/features/browser/browserOpen'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

// 1. AndroidManifest.xml 验证：必须包含浏览器注册所需的 intent-filter
const manifestPath = path.join(rootDir, 'android/app/src/main/AndroidManifest.xml')
const manifestXml = fs.readFileSync(manifestPath, 'utf8')

// 验证必须包含 VIEW + DEFAULT + BROWSABLE + http/https
assert.ok(
  manifestXml.includes('android.intent.action.VIEW') &&
  manifestXml.includes('android.intent.category.BROWSABLE') &&
  manifestXml.includes('<data android:scheme="http" />') &&
  manifestXml.includes('<data android:scheme="https" />'),
  'AndroidManifest 必须声明处理通用 http/https 的 VIEW + BROWSABLE intent-filter'
)

// 验证必须包含 APP_BROWSER 分类
assert.ok(
  manifestXml.includes('android.intent.category.APP_BROWSER'),
  'AndroidManifest 必须声明 APP_BROWSER category 以供系统默认应用识别'
)

// 验证原有的 news.aizeek.com/a/ autoVerify intent-filter 依然保留
assert.ok(
  manifestXml.includes('android:host="news.aizeek.com"') &&
  manifestXml.includes('android:pathPrefix="/a/"'),
  '原有分享短链 autoVerify intent-filter 必须完好保留'
)

// 2. 验证 openBrowserWithUrl 事件分发机制
{
  const received: BrowserOpenDetail[] = []
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<BrowserOpenDetail>).detail
    received.push(detail)
  }

  // Node 环境下模拟 window
  const originalWindow = globalThis.window
  const mockWindow = {
    CustomEvent: globalThis.CustomEvent,
    dispatchEvent: (event: Event) => listener(event),
  }
  Object.defineProperty(globalThis, 'window', { value: mockWindow, configurable: true })

  try {
    openBrowserWithUrl('https://example.com/test')
    assert.equal(received.length, 1)
    assert.equal(received[0].url, 'https://example.com/test')

    openBrowserWithUrl()
    assert.equal(received.length, 2)
    assert.equal(received[1].url, undefined)
  } finally {
    Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true })
  }
}

// 3. 验证 deep link 分流逻辑与防抖
{
  let lastHandledUrl = ''
  let lastHandledAt = 0
  const actions: { kind: 'sync' | 'article' | 'browser'; url: string }[] = []

  const routeUrl = (url: string, now = Date.now()) => {
    const trimmed = url?.trim()
    if (!trimmed) return false
    if (trimmed === lastHandledUrl && now - lastHandledAt < 1500) return false
    lastHandledUrl = trimmed
    lastHandledAt = now

    if (syncRouteFromAppUrl(trimmed)) {
      actions.push({ kind: 'sync', url: trimmed })
      return true
    }

    const token = shareTokenFromAppUrl(trimmed)
    if (token) {
      actions.push({ kind: 'article', url: trimmed })
      return true
    }

    if (/^https?:\/\//i.test(trimmed)) {
      actions.push({ kind: 'browser', url: trimmed })
      return true
    }

    return false
  }

  // 通用网页链接分流到浏览器
  assert.ok(routeUrl('https://github.com/torvalds/linux', 1000))
  assert.equal(actions.length, 1)
  assert.equal(actions[0].kind, 'browser')
  assert.equal(actions[0].url, 'https://github.com/torvalds/linux')

  // 1500ms 内重复链接被防抖过滤
  assert.equal(routeUrl('https://github.com/torvalds/linux', 1500), false)
  assert.equal(actions.length, 1)

  // 超过 1500ms 后的相同链接允许再次处理
  assert.ok(routeUrl('https://github.com/torvalds/linux', 3000))
  assert.equal(actions.length, 2)

  // 站内分享短链优先分流到阅读器，不进通用浏览器
  assert.ok(routeUrl('https://news.aizeek.com/a/some-token-value', 4000))
  assert.equal(actions.length, 3)
  assert.equal(actions[2].kind, 'article')

  // 同步路由不进通用浏览器
  assert.ok(routeUrl('newsnook://sync/account-sync', 5000))
  assert.equal(actions.length, 4)
  assert.equal(actions[3].kind, 'sync')

  // 非 http/https 且非站内 scheme 的输入被忽略
  assert.equal(routeUrl('javascript:alert(1)', 6000), false)
  assert.equal(actions.length, 4)
}

console.log('Browser external intent registration & routing tests passed.')
