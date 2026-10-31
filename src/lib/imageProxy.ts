const NETEASE_HOST_RE = /(?:^|\.)(?:126\.net|163\.com|netease\.com)$/i
const WECHAT_IMAGE_HOST_RE = /(?:^|\.)(?:mmbiz\.qpic\.cn|mmecoa\.qpic\.cn|qlogo\.cn)$/i
const BILIBILI_IMAGE_HOST_RE = /(?:^|\.)hdslb\.com$/i
const JIQIZHIXIN_IMAGE_HOST_RE = /(?:^|\.)image\.jiqizhixin\.com$/i
const ZHIHU_IMAGE_HOST_RE = /(?:^|\.)zhimg\.com$/i

function httpUrl(raw: string): URL | null {
  try {
    const value = raw.trim()
    const parsed = new URL(value.startsWith('//') ? `https:${value}` : value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}

export function isNeteaseImageUrl(raw: string): boolean {
  const parsed = httpUrl(raw)
  return Boolean(parsed && NETEASE_HOST_RE.test(parsed.hostname))
}

/** 网易列表接口仍会返回 http 图链；统一升级，避免 HTTPS WebView 的混合内容拦截。 */
export function normalizeListImageUrl(raw: string): string {
  const parsed = httpUrl(raw)
  if (!parsed) return raw
  if (parsed.protocol === 'http:' && NETEASE_HOST_RE.test(parsed.hostname)) {
    parsed.protocol = 'https:'
  }
  return parsed.href
}

export function imageProxyUrl(raw: string): string {
  return `/api/image?url=${encodeURIComponent(normalizeListImageUrl(raw))}`
}

/** Web 对已知必拦直链的网易图片直接代理；其他图床保留客户端直连，失败后再代理。 */
export function initialListImageUrl(raw: string, native: boolean): string {
  const normalized = normalizeListImageUrl(raw)
  return !native && isNeteaseImageUrl(normalized) ? imageProxyUrl(normalized) : normalized
}

/**
 * 图片 CDN 的防盗链来源必须是发布站点，而不一定是图片 CDN 本身。
 * Android 字节请求、Web /api/image 与开发代理共用同一策略，避免环境间行为分叉。
 * 微信图床不带 Referer，否则可能返回防盗链占位图。
 */
export function imageReferer(raw: string): string | undefined {
  const parsed = httpUrl(raw)
  if (!parsed) return undefined
  if (NETEASE_HOST_RE.test(parsed.hostname)) return 'https://www.163.com/'
  if (WECHAT_IMAGE_HOST_RE.test(parsed.hostname)) return undefined
  if (BILIBILI_IMAGE_HOST_RE.test(parsed.hostname)) return 'https://www.bilibili.com/'
  if (ZHIHU_IMAGE_HOST_RE.test(parsed.hostname)) return 'https://www.zhihu.com/'
  if (JIQIZHIXIN_IMAGE_HOST_RE.test(parsed.hostname)) return 'https://www.jiqizhixin.com/'
  return `${parsed.origin}/`
}
