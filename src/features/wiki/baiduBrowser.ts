import { Capacitor, registerPlugin } from '@capacitor/core'
import { resolveProxyTransport } from '../proxy/transport'

interface BrowserPage { html: string; url: string }
interface EncyclopediaPagePlugin {
  read(options: { id: string; url: string }): Promise<BrowserPage>
  cancel(options: { id: string }): Promise<void>
}
const nativePage = registerPlugin<EncyclopediaPagePlugin>('EncyclopediaPage')

function isItemUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.origin === 'https://baike.baidu.com' && url.pathname.startsWith('/item/') && !url.username && !url.password
  } catch { return false }
}

export async function readBaiduBrowserPage(url: string, signal: AbortSignal): Promise<BrowserPage> {
  signal.throwIfAborted()
  if (!isItemUrl(url)) throw new Error('百度百科词条地址无效')
  const id = crypto.randomUUID()
  const page = await new Promise<BrowserPage>((resolve, reject) => {
    const abort = () => {
      void nativePage.cancel({ id }).catch(() => { /* The read may already have finished. */ })
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    nativePage.read({ id, url }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
  signal.throwIfAborted()
  if (!isItemUrl(page.url) || typeof page.html !== 'string' || page.html.length > 4 * 1024 * 1024) {
    throw new Error('百度百科浏览器返回的页面无效')
  }
  return page
}

export async function readBaiduPage(url: string, signal: AbortSignal): Promise<BrowserPage> {
  signal.throwIfAborted()
  const { fetchAbsoluteText, getRuntimeProxyPrefs } = await import('../../lib/http')
  const android = Capacitor.getPlatform() === 'android'
  const transport = resolveProxyTransport(url, undefined, getRuntimeProxyPrefs(), { native: android, dev: false })
  // A WebView uses the device network. Never silently bypass a user-selected tunnel or wrapper.
  if (android && transport.kind === 'direct') return readBaiduBrowserPage(url, signal)
  const html = await fetchAbsoluteText(url, { signal, accept: 'text/html', maxBytes: 4 * 1024 * 1024 })
  return { html, url }
}
