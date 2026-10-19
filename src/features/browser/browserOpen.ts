export interface BrowserOpenDetail {
  url?: string
}

export const BROWSER_OPEN_EVENT = 'newsnook:open-browser'

/**
 * 唤起内置网页浏览器工作区。
 * 可选带入 url：若传入有效 http/https 网址，则打开后自动加载该网址；
 * 若未传或为空，则展示默认浏览器起始页。
 */
export function openBrowserWithUrl(url?: string): void {
  if (typeof window === 'undefined') return
  const EventCtor = (window.CustomEvent || CustomEvent) as typeof CustomEvent
  window.dispatchEvent(
    new EventCtor<BrowserOpenDetail>(BROWSER_OPEN_EVENT, {
      detail: url ? { url } : {},
    }),
  )
}
