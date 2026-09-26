import { Capacitor } from '@capacitor/core'

import { fetchLinuxDoMedia } from '../session/native'

const LINUX_DO_HOST = 'linux.do'
const LINUX_DO_MEDIA_REFERER = 'https://linux.do/'
/** blob 缓存上限：一个帖子的正文图通常十几到几十张，超出的按插入顺序回收。 */
const CACHE_LIMIT = 96
/**
 * 小于这个字节数就用 data: URL 承载（见 resolveLinuxDoImageSrc 里的说明）。
 * 上限是为了不让 base64 字符串把内存放大几倍；更大的图仍走 blob:。
 */
const DATA_URL_MAX_BYTES = 1_500_000

interface CacheEntry {
  promise: Promise<string>
  blobUrl?: string
  released?: boolean
}

const cache = new Map<string, CacheEntry>()

/**
 * 需要走会话通道的 Linux.do 图片：主站（`linux.do`）及其任意子域。它们的静态资源落在
 * Cloudflare 托管挑战（`cf-mitigated: challenge`）后面，宿主 WebView 的跨站 `<img>` 与
 * CapacitorHttp 兜底都拿不到放行。CDN（`cdn.ldstatic.com`，头像等）是公开的，直连即可。
 */
export function isLinuxDoHostedMedia(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return host === LINUX_DO_HOST || host.endsWith(`.${LINUX_DO_HOST}`)
  } catch {
    return false
  }
}

/** 原生侧理论上已经剥掉 `data:` 前缀；这里再兜一次，避免把整串 data URL 丢给 atob。 */
export function stripDataUrlPrefix(value: string): string {
  if (!value.startsWith('data:')) return value
  const comma = value.indexOf(',')
  return comma >= 0 ? value.slice(comma + 1) : value
}

export function decodeLinuxDoMediaBase64(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer as ArrayBuffer
}

/**
 * 常见图片格式的魔数。Cloudflare 托管挑战页与 Discourse 的登录页会以 2xx 返回 HTML，
 * 光看状态码会把它们当成图片；这里按字节判定，只有真图片才认。
 */
export function looksLikeLinuxDoImageBytes(bytes: Uint8Array): boolean {
  const at = (index: number) => bytes[index] ?? -1
  if (bytes.length < 4) return false
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return true // PNG
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return true // JPEG
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return true // GIF
  if (at(0) === 0x42 && at(1) === 0x4d) return true // BMP
  if (at(0) === 0x00 && at(1) === 0x00 && at(2) === 0x01 && at(3) === 0x00) return true // ICO
  if (at(0) === 0x49 && at(1) === 0x49 && at(2) === 0x2a) return true // TIFF (little endian)
  if (at(0) === 0x4d && at(1) === 0x4d && at(2) === 0x00 && at(3) === 0x2a) return true // TIFF (big endian)
  if (bytes.length < 12) return false
  // RIFF....WEBP：'WEBP' fourcc 在偏移 8，不在 4。
  if (
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return true // WEBP
  }
  const brand = String.fromCharCode(at(4), at(5), at(6), at(7))
  return brand === 'ftyp' // AVIF / HEIC 容器
}

function releaseBlob(entry: CacheEntry): void {
  if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl)
  entry.blobUrl = undefined
}

/**
 * 诊断用：最近一次取字节失败的原因（按 URL 记录）。真机上没有日志面板，失败占位会把这行
 * 文案显示出来（`data-reader-image-error`），一眼就能看出断在哪一步：原生/浏览器传输的
 * HTTP 状态、传输标签、非图片响应，或插件 reject 的错误码与消息。
 */
const statusNotes = new Map<string, string>()
const STATUS_NOTE_LIMIT = 64

function noteStatus(url: string, note: string): void {
  statusNotes.set(url, note)
  while (statusNotes.size > STATUS_NOTE_LIMIT) {
    const oldest = statusNotes.keys().next()
    if (oldest.done) break
    statusNotes.delete(oldest.value)
  }
}

/** 取字节成功、但 WebView 最终仍加载失败时写这条（用于区分「通道没取到」和「取到了不能用」）。 */
function noteResolved(url: string, note: string): void {
  noteStatus(url, note)
}

/**
 * 失败占位展示的原因：取字节在哪一步断的。三种形态：
 * - `MEDIA_HTTP 媒体请求失败（HTTP 403）` 等 → 会话通道没取到字节；
 * - `已取字节（data 42KB）但加载失败` → 取到了，但 WebView 用不了这个地址；
 * - 没有记录 → 这个地址根本没走会话通道（见 hook 里的兜底文案）。
 */
export function linuxDoMediaStatusNote(url: string): string | undefined {
  return statusNotes.get(url)
}

function describeMediaError(error: unknown): string {
  const rawCode = (error as { code?: unknown } | undefined)?.code
  const code = typeof rawCode === 'string' ? rawCode.replace(/^LINUXDO_/, '') : ''
  const message = error instanceof Error ? error.message : String(error ?? '')
  const detail = message.replace(/^Linux\.do\s*/, '').trim().slice(0, 44)
  return [code, detail].filter(Boolean).join(' ') || '取字节失败'
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
 * 转成 data: / blob: URL；非原生、非主站或取不到字节时一律回退原地址（WebView 再试一次，
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
      const contentType = response.contentType?.toLowerCase() ?? ''
      const transport = response.transport ?? 'native'
      const base64 = stripDataUrlPrefix(response.base64 ?? '')
      const buffer = decodeLinuxDoMediaBase64(base64)
      if (buffer.byteLength === 0) {
        throw new Error(`媒体响应为空：${response.status} ${transport}`)
      }
      const bytes = new Uint8Array(buffer)
      // 2xx 不等于图片：Cloudflare 挑战页、登录页都是 2xx 的 HTML。把它当图片返回，
      // 调用方会误判「解析成功」而放弃后续候选，整张图永久失败。所以这里按字节
      // （SVG 按 content-type）判定，不是图片就抛错走原地址回退。
      if (!contentType.startsWith('image/svg') && !looksLikeLinuxDoImageBytes(bytes)) {
        throw new Error(
          `媒体响应不是图片：${response.status} ${transport} ${contentType || '无类型'} ${bytes.byteLength}B`,
        )
      }
      const type = contentType.startsWith('image/') ? contentType : 'image/jpeg'
      const size = `${Math.max(1, Math.round(bytes.byteLength / 1024))}KB`
      // 小图直接用 data: URL：WKWebView 的 origin 是 capacitor://，blob: 的加载依赖该方案
      // 的实现，data: 最稳。大图仍走 blob:，避免 base64 字符串把内存翻几倍。
      if (bytes.byteLength <= DATA_URL_MAX_BYTES) {
        noteResolved(url, `已取字节（data ${size}）但加载失败`)
        entry.blobUrl = undefined
        return `data:${type};base64,${base64}`
      }
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type }))
      if (entry.released) {
        URL.revokeObjectURL(blobUrl)
        return url
      }
      noteResolved(url, `已取字节（blob ${size}）但加载失败`)
      entry.blobUrl = blobUrl
      return blobUrl
    } catch (error) {
      noteStatus(url, describeMediaError(error))
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
  statusNotes.clear()
}
