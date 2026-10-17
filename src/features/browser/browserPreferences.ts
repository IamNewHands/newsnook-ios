export type BrowserSearchChoice = 'bing' | 'google' | 'baidu' | 'duckduckgo'

export const BROWSER_KEYS = {
  history: 'newsnook:browser:history:v1',
  bookmarks: 'newsnook:browser:bookmarks:v1',
  search: 'newsnook:browser:search:v1',
  addressPosition: 'newsnook:browser:address-position:v1',
  hiddenHosts: 'newsnook:browser:hidden-hosts:v1',
  shortcuts: 'newsnook:browser:shortcuts:v1',
} as const

export const BROWSER_ENGINES: Record<BrowserSearchChoice, { name: string; url: string }> = {
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  baidu: { name: '百度', url: 'https://www.baidu.com/s?wd=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
}

export function readBrowserPreference(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

export function readBrowserList(key: string): unknown {
  try { return JSON.parse(readBrowserPreference(key) || 'null') } catch { return null }
}

/** Write first. Callers only update visible state after persistence succeeds. */
export function writeBrowserPreference(key: string, value: unknown, raw = false): void {
  try {
    localStorage.setItem(key, raw ? String(value) : JSON.stringify(value))
  } catch {
    throw new Error('保存失败，请释放存储空间后重试')
  }
}

export function browserHostLabel(address: string): string {
  if (!address || address === 'about:blank') return '主页'
  try { return new URL(address).hostname.replace(/^www\./, '') } catch { return address }
}

export function resolveBrowserAddress(text: string, engine: BrowserSearchChoice): string | null {
  const input = text.trim()
  if (!input) return null
  const explicitWeb = /^https?:\/\//i.test(input)
  const hostLike = /^(?:localhost|\[[\da-f:]+\]|[^\s/:.]+(?:\.[^\s/:.]+)+)(?::\d+)?(?:[/?#]|$)/iu.test(input)
  if (explicitWeb || hostLike) {
    try {
      const url = new URL(explicitWeb ? input : 'https://' + input)
      return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname && !url.username && !url.password ? url.href : null
    } catch { return null }
  }
  const searchOperator = /^(?:site|intitle|allintitle|inurl|allinurl|intext|allintext|filetype|ext|related|cache|define|before|after):/i.test(input)
  if (!searchOperator && /^[a-z][a-z\d+.-]*:/i.test(input)) return null
  return BROWSER_ENGINES[engine].url + encodeURIComponent(input)
}
