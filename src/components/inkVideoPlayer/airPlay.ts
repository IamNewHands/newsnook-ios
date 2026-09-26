/**
 * AirPlay：DLNA 之外的第二条投屏路径。
 *
 * iOS 上这条路**不需要任何原生代码**——WKWebView 里的 `HTMLMediaElement` 自带
 * `webkitShowPlaybackTargetPicker()`，调它就是弹出系统 AirPlay 选择器，而且路由的是
 * **这个 video 元素**本身。这比原生 `AVRoutePickerView` 更准：后者只影响 App 的音频
 * 会话，管不到 WebView 内部的媒体播放。
 *
 * 前提是 video 元素声明了 `x-webkit-airplay="allow"`（见 `InkVideoPlayer` 的
 * `<video>` 标签），否则 iOS 不会为它提供 AirPlay 目标。
 */

export interface AirPlayCapableVideo extends HTMLVideoElement {
  /** WebKit 私有但长期稳定的 API，Safari / WKWebView 都有。 */
  webkitShowPlaybackTargetPicker?: () => void
  /** 当前是否已经通过无线（AirPlay）在放。 */
  webkitCurrentPlaybackTargetIsWireless?: boolean
}

export function isAirPlaySupported(): boolean {
  if (typeof document === 'undefined') return false
  const probe = document.createElement('video') as AirPlayCapableVideo
  return typeof probe.webkitShowPlaybackTargetPicker === 'function'
}

export function isAirPlayActive(video: HTMLVideoElement | null): boolean {
  const capable = video as AirPlayCapableVideo | null
  return Boolean(capable?.webkitCurrentPlaybackTargetIsWireless)
}

/** 返回是否真的弹出了选择器；false 表示这个 WebView 不提供该 API，调用方据此提示。 */
export function showAirPlayPicker(video: HTMLVideoElement | null): boolean {
  const capable = video as AirPlayCapableVideo | null
  if (!capable || typeof capable.webkitShowPlaybackTargetPicker !== 'function') return false
  capable.webkitShowPlaybackTargetPicker()
  return true
}
