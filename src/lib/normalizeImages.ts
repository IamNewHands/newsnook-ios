import { parseHTML } from 'linkedom'

const PLACEHOLDER_RE = /(?:\/images\/v2\/t\.png|spacer\.gif|lazy\.png|placeholder|1x1)\b/i
/** 作者头像、蓝 V、表情等常见小图路径 */
const BADGE_URL_RE =
  /(?:\/(?:avatar|face|icon|emoji|emotion|sticker|badge|vip|verified|v-icon|userhead|headimg)(?:\/|[._-]|$)|(?:vip_?badge|verified_?badge|auth_?icon))/i
const BADGE_SIZE_MAX = 72
const LOADED_BADGE_MAX = 96
const LOADED_DECORATIVE_MAX = 8
/** 高清头像/台标常被源站用 CSS 缩成小图；正方形且不太大时按徽章处理 */
const LOADED_SQUARE_BADGE_MAX = 240

export type ReaderImageRole = 'content' | 'badge' | 'decorative'

function parsePxSize(raw: string | null | undefined): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed || /%|auto|vw|vh|em|rem/i.test(trimmed)) return null
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*px$/i) ?? trimmed.match(/^(\d+(?:\.\d+)?)$/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function readStylePx(style: string, prop: 'width' | 'height'): number | null {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i')
  const match = style.match(re)
  return match ? parsePxSize(match[1]) : null
}

/**
 * 根据源站 HTML 上的尺寸线索 / URL 判断是否为徽章类小图。
 * 消毒会剥掉 style/class，所以必须在 normalize 阶段打上 data-reader-role。
 */
export function inferImageDisplayRole(img: Element): ReaderImageRole {
  const widthAttr = parsePxSize(img.getAttribute('width'))
  const heightAttr = parsePxSize(img.getAttribute('height'))
  const style = img.getAttribute('style') || ''
  const widthStyle = readStylePx(style, 'width')
  const heightStyle = readStylePx(style, 'height')
  const dataW = parsePxSize(img.getAttribute('data-w') || img.getAttribute('data-width'))
  const dataH = parsePxSize(img.getAttribute('data-h') || img.getAttribute('data-height'))

  const sizes = [widthAttr, heightAttr, widthStyle, heightStyle, dataW, dataH].filter(
    (value): value is number => value != null,
  )
  if (sizes.some((value) => value > 0 && value <= BADGE_SIZE_MAX)) {
    // 任一边明确是小尺寸 → 徽章；避免把「宽 40、高 400」的异常图当正文通栏
    if (sizes.every((value) => value <= BADGE_SIZE_MAX * 2)) return 'badge'
  }

  const src =
    img.getAttribute('src') ||
    img.getAttribute('data-src') ||
    img.getAttribute('data-original') ||
    img.getAttribute('data-actualsrc') ||
    ''
  if (BADGE_URL_RE.test(src)) return 'badge'

  const alt = (img.getAttribute('alt') || '').trim()
  if (/^(?:认证|会员|vip|verified|v)$/i.test(alt)) return 'badge'

  return 'content'
}

/** 图片加载后按自然尺寸兜底分类（源站未声明尺寸时） */
export function classifyLoadedImage(naturalWidth: number, naturalHeight: number): ReaderImageRole {
  const max = Math.max(naturalWidth, naturalHeight)
  const min = Math.min(naturalWidth, naturalHeight)
  if (max <= LOADED_DECORATIVE_MAX) return 'decorative'
  if (max <= LOADED_BADGE_MAX) return 'badge'
  // 接近正方形的中等图（台标、头像、认证标）常被源站 CSS 缩到一行高
  if (max <= LOADED_SQUARE_BADGE_MAX && min > 0 && max / min <= 1.25) return 'badge'
  return 'content'
}

function pickImageUrl(img: Element, baseUrl: string): string | null {
  const attrs = [
    'data-original',
    'data-src',
    'data-lazy-src',
    'data-actualsrc',
    'data-url',
    'data-preview',
    'src',
  ]

  for (const name of attrs) {
    const raw = img.getAttribute(name)
    if (!raw) continue
    const resolved = resolveUrl(raw, baseUrl)
    if (!resolved) continue
    if (resolved.startsWith('data:image/')) return resolved
    if (PLACEHOLDER_RE.test(resolved)) continue
    return resolved
  }

  const advance = img.getAttribute('data-advance')
  if (advance) {
    try {
      const decoded = atob(advance)
      const parsed = JSON.parse(decoded) as Array<{ Url?: string; url?: string }>
      const first = parsed.find((item) => item.Url || item.url)
      const candidate = first?.Url || first?.url
      const resolved = candidate ? resolveUrl(candidate, baseUrl) : null
      if (resolved && !PLACEHOLDER_RE.test(resolved)) return resolved
    } catch {
      // ignore malformed advance payload
    }
  }

  return null
}

function resolveUrl(raw: string, baseUrl: string): string | null {
  const value = raw.trim()
  if (!value || value === '#' || value.startsWith('javascript:')) return null
  try {
    if (value.startsWith('//')) return `https:${value}`
    return new URL(value, baseUrl).toString()
  } catch {
    return null
  }
}

function absolutizeSrcset(srcset: string, baseUrl: string): string {
  return srcset
    .split(',')
    .map((part) => {
      const trimmed = part.trim()
      if (!trimmed) return ''
      const pieces = trimmed.split(/\s+/)
      const url = resolveUrl(pieces[0], baseUrl)
      if (!url || PLACEHOLDER_RE.test(url)) return ''
      return [url, ...pieces.slice(1)].join(' ')
    })
    .filter(Boolean)
    .join(', ')
}

/**
 * 在消毒前规范化正文图片：
 * - 提升 lazyload 真实地址（data-original / data-src / data-advance）
 * - 补全相对路径与协议相对路径
 * - Web 开发态可走 /api/image 代理，规避 CDN 防盗链
 * - Web 反代时可选 transformUrl 改写为包装地址
 */
export function normalizeContentImages(
  html: string,
  baseUrl: string,
  options?: {
    proxyImages?: boolean
    /** 优先于 /api/image；返回 falsy 则回退默认逻辑 */
    transformUrl?: (url: string) => string | null | undefined
  },
): string {
  const wrapped = `<div id="newsnook-root">${html}</div>`
  const { document } = parseHTML(wrapped)
  const root = document.getElementById('newsnook-root')
  if (!root) return html

  for (const img of Array.from(root.querySelectorAll('img'))) {
    const url = pickImageUrl(img, baseUrl)
    if (!url) {
      img.remove()
      continue
    }

    const transformed = options?.transformUrl?.(url)
    const finalUrl =
      transformed && transformed.length > 0
        ? transformed
        : options?.proxyImages && url.startsWith('http')
          ? `/api/image?url=${encodeURIComponent(url)}`
          : url

    const role = inferImageDisplayRole(img)

    img.setAttribute('src', finalUrl)
    img.setAttribute('loading', 'lazy')
    img.setAttribute('decoding', 'async')
    // 微信公众号 CDN（mmbiz.qpic.cn）按 Referer 防盗链：带 localhost/他站会返回「未经允许不可引用」占位图；去掉即可
    img.setAttribute('referrerpolicy', 'no-referrer')
    if (role === 'badge') img.setAttribute('data-reader-role', 'badge')
    else img.removeAttribute('data-reader-role')

    const srcset = img.getAttribute('srcset')
    if (srcset) {
      const absolute = absolutizeSrcset(srcset, baseUrl)
      if (absolute) img.setAttribute('srcset', absolute)
      else img.removeAttribute('srcset')
    }

    for (const name of [
      'data-original',
      'data-src',
      'data-lazy-src',
      'data-actualsrc',
      'data-advance',
      'data-preview',
      'data-url',
    ]) {
      img.removeAttribute(name)
    }
  }

  // 同步处理正文里的普通链接相对路径
  for (const anchor of Array.from(root.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href')
    const resolved = href ? resolveUrl(href, baseUrl) : null
    if (resolved) anchor.setAttribute('href', resolved)
  }

  return root.innerHTML
}
