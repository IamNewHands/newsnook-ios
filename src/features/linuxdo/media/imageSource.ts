import { Capacitor } from '@capacitor/core'

import { fetchLinuxDoMedia } from '../session/native'

const LINUX_DO_HOST = 'linux.do'
const LINUX_DO_MEDIA_REFERER = 'https://linux.do/'
/** blob 缓存上限：一个帖子的正文图通常十几到几十张，超出的按插入顺序回收。 */
const CACHE_LIMIT = 96

interface CacheEntry {
  promise: Promise<string>
  blobUrl?: string
  released?: boolean
}

const cache = new Map<string, CacheEntry>()

/**
 * 只有 `linux.do` 主站的图片需要走会话通道：它的静态资源落在 Cloudflare 托管挑战
 * （`cf-mitigated: challenge`）后面，宿主 WebView 的跨站 `<img>` 与 CapacitorHttp 兜底
 * 都拿不到放行。CDN（`cdn.ldstatic.com`，头像等）是公开的，直连即可。
 */
export function isLinuxDoHostedMedia(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return parsed.hostname.toLowerCase() === LINUX_DO_HOST
  } catch {
    return false
  }
}

export function decodeLinuxDoMediaBase64(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer as ArrayBuffer
}

function releaseBlob(entry: CacheEntry): void {
  if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl)
  entry.blobUrl = undefined
}

/** 丢弃一条缓存：即使解析还在路上，落地后也会立刻撤销。 */
function disposeEntry(entry: CacheEntry): void {
  entry.released = true
  void entry.promise.then(() => releaseBlob(entry), () => undefined)
}

function remember(url: string, entry: CacheEntry): void {
  cache.set(url, entry)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (oldest.done || oldest.value === url) break
    const stale = cache.get(oldest.value)
    cache.delete(oldest.value)
    if (stale) disposeEntry(stale)
  }
}

/**
 * Linux.do 图片的可播放地址：主站图片由原生侧带会话 Cookie / 隐藏同源传输取回字节，
 * 转成 blob URL；非原生、非主站或取不到字节时一律回退原地址（WebView 再试一次，
 * 失败仍是正文里可见的「点按重试」占位）。
 */
export async function resolveLinuxDoImageSrc(url: string): Promise<string> {
  if (!url.startsWith('http')) return url
  if (!Capacitor.isNativePlatform()) return url
  if (!isLinuxDoHostedMedia(url)) return url

  const cached = cache.get(url)
  if (cached) return cached.promise

  const entry: CacheEntry = { promise: Promise.resolve(url) }
  entry.promise = (async () => {
    try {
      const response = await fetchLinuxDoMedia({ url, referer: LINUX_DO_MEDIA_REFERER })
      const contentType = response.contentType?.toLowerCase()
      const type = contentType?.startsWith('image/') ? contentType : 'image/jpeg'
      const buffer = decodeLinuxDoMediaBase64(response.base64 ?? '')
      if (buffer.byteLength === 0) throw new Error('Linux.do 媒体响应为空')
      const blobUrl = URL.createObjectURL(new Blob([buffer], { type }))
      if (entry.released) {
        URL.revokeObjectURL(blobUrl)
        return url
      }
      entry.blobUrl = blobUrl
      return blobUrl
    } catch {
      cache.delete(url)
      return url
    }
  })()
  remember(url, entry)
  return entry.promise
}

/** 退出登录 / 清空浏览器会话后调用：丢掉已解析的 blob，避免残留上一个会话的内容。 */
export function releaseLinuxDoImageCache(): void {
  for (const entry of cache.values()) disposeEntry(entry)
  cache.clear()
}
