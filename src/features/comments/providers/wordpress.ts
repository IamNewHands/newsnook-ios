import { fetchAbsoluteText } from '../../../lib/http'
import type {
  CommentItem,
  CommentProvider,
  CommentQuote,
  CommentsQueryResult,
  CommentTab,
} from '../types'

/**
 * WordPress REST 通用评论适配器。
 *
 * 覆盖来源：内置源里跑标准 WordPress（含 REST API）的站点。它们共用一套接口：
 *   1. `/wp-json/wp/v2/posts?slug=<slug>&_fields=id`      由文章地址解析 post id
 *   2. `/wp-json/wp/v2/comments?post=<id>&per_page=20&page=<n>`  分页拉评论
 *
 * 只登记**实测返回 JSON** 的主机（2026-09-22 取证）：
 *   pretty = `/wp-json/wp/v2/*`；query = `/?rest_route=/wp/v2/*`（站点未开固定链接）
 * 返回 404 / HTML 外壳的主机（sspai、ithome、huxiu、uisdc、tmtpost、leiphone、gcores、
 * zhishifenzi 等）**不在此列**，它们走各自站点适配或保持不显示。
 *
 * 已知限制：评论总数响应头 `X-WP-Total` 拿不到（lib/http 只回正文），
 * 因此计数用 `per_page=100` 的 id 列表长度近似，上限 100。
 */
const WP_PAGE_SIZE = 20
const WP_COUNT_CAP = 100

type RestStyle = 'pretty' | 'query'

const WP_HOSTS: Record<string, RestStyle> = {
  'marktechpost.com': 'pretty',
  'qbitai.com': 'pretty',
  'pansci.asia': 'pretty',
  'syncedreview.com': 'pretty',
  'jack-clark.net': 'pretty',
  'theue.me': 'pretty',
  'themarginalian.org': 'pretty',
  'aiera.com.cn': 'pretty',
  'zhidx.com': 'pretty',
  'woshipm.com': 'query',
  'huanqiukexue.com': 'query',
}

/**
 * 请求用主机名：保留 `www.`（必须用文章自身的主机名请求 —— 有的站点 apex 域名不可达，
 * 例如 oneusefulthing.org 只有 www 能通）。
 */
function hostOf(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/** 登记表查表键：去 `www.` 归一 */
function hostKeyOf(url?: string): string | undefined {
  return hostOf(url)?.replace(/^www\./, '')
}

/** 命中已登记的 WordPress 主机时返回其 REST 风格 */
export function wordpressRestStyleFor(originUrl?: string): RestStyle | undefined {
  const key = hostKeyOf(originUrl)
  return key ? WP_HOSTS[key] : undefined
}

/** 从文章地址取 slug（最后一段路径），用于反查 post id */
export function wordpressSlugFromUrl(originUrl?: string): string | undefined {
  if (!originUrl) return undefined
  try {
    const { pathname } = new URL(originUrl)
    const segments = pathname.split('/').filter(Boolean)
    const last = segments[segments.length - 1]
    return last ? decodeURIComponent(last) : undefined
  } catch {
    return undefined
  }
}

/**
 * slug 候选：部分站点文章地址带 `.html`（如 qbitai.com/2026/09/493865.html），
 * 而 WordPress 的 post_name 不含后缀，因此按「原样 → 去后缀」依次尝试。
 */
export function wordpressSlugCandidates(originUrl?: string): string[] {
  const slug = wordpressSlugFromUrl(originUrl)
  if (!slug) return []
  const stripped = slug.replace(/\.(?:html?|php|shtml)$/i, '')
  return stripped && stripped !== slug ? [slug, stripped] : [slug]
}

export function wordpressEndpoint(
  host: string,
  style: RestStyle,
  route: string,
  params: Record<string, string | number>,
): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) query.set(key, String(value))
  const suffix = query.toString()
  return style === 'query'
    ? `https://${host}/?rest_route=/wp/v2/${route}&${suffix}`
    : `https://${host}/wp-json/wp/v2/${route}?${suffix}`
}

/** `/wp/v2/posts?slug=`（数组）或 `/wp/v2/posts/<id>`（单对象）的响应里取 post id */
export function parseWordpressPostId(raw: string): number | undefined {
  try {
    const parsed = JSON.parse(raw) as Array<{ id?: number }> | { id?: number }
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    const id = first?.id
    return typeof id === 'number' && id > 0 ? id : undefined
  } catch {
    return undefined
  }
}

/** 地址末段是纯数字时（qbitai 等：slug 为中文标题，URL 数字段就是 post id）直接按 id 取文 */
export function wordpressNumericIdFromUrl(originUrl?: string): string | undefined {
  const slug = wordpressSlugFromUrl(originUrl)
  if (!slug) return undefined
  const digits = slug.replace(/\.(?:html?|php|shtml)$/i, '')
  return /^\d{3,}$/.test(digits) ? digits : undefined
}

function stripHtml(html?: string): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8216;/g, '\u2018')
    .replace(/&#8220;/g, '\u201c')
    .replace(/&#8221;/g, '\u201d')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function formatCommentTime(raw?: string): string {
  if (!raw) return '刚刚'
  const timestamp = Date.parse(raw.includes('T') ? raw : raw.replace(/-/g, '/'))
  if (Number.isNaN(timestamp)) return raw
  const diff = Math.max(0, Date.now() - timestamp)
  const minute = 60000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`
  if (diff < day) return `${Math.floor(diff / hour)}小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`
  return raw.slice(0, 10)
}

interface WpRawComment {
  id?: number
  parent?: number
  author_name?: string
  date?: string
  content?: { rendered?: string }
  author_avatar_urls?: Record<string, string>
}

function avatarOf(raw: WpRawComment): string | undefined {
  const avatars = raw.author_avatar_urls
  if (!avatars) return undefined
  return avatars['96'] || avatars['48'] || avatars['24']
}

/** 解析 `/wp/v2/comments` 一页评论；同一页内的 parent 关系转成盖楼引用 */
export function parseWordpressComments(raw: string): CommentItem[] {
  let list: WpRawComment[]
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    list = parsed as WpRawComment[]
  } catch {
    return []
  }

  const byId = new Map<number, WpRawComment>()
  for (const item of list) {
    if (typeof item?.id === 'number') byId.set(item.id, item)
  }

  const comments: CommentItem[] = []
  for (const item of list) {
    if (typeof item?.id !== 'number') continue
    const content = stripHtml(item.content?.rendered)
    if (!content) continue

    const quotes: CommentQuote[] = []
    const parent = typeof item.parent === 'number' && item.parent > 0 ? byId.get(item.parent) : undefined
    if (parent) {
      const parentContent = stripHtml(parent.content?.rendered)
      if (parentContent) {
        quotes.push({
          id: String(parent.id ?? item.parent),
          author: parent.author_name || '匿名',
          content: parentContent,
        })
      }
    }

    comments.push({
      id: String(item.id),
      author: item.author_name || '匿名读者',
      avatar: avatarOf(item),
      content,
      createTimeRaw: item.date,
      createTimeFormatted: formatCommentTime(item.date),
      voteCount: 0,
      quotes: quotes.length > 0 ? quotes : undefined,
    })
  }
  return comments
}

/** 用 id 列表长度近似评论总数（无法读 X-WP-Total 响应头），上限 100 */
export function parseWordpressCommentCount(raw: string): number | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.length : undefined
  } catch {
    return undefined
  }
}

/** 网络抖动容忍：单次失败后再试一次（上游多为境外站点，偶发 DNS/TLS 失败） */
async function fetchJson(url: string, signal?: AbortSignal): Promise<string | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchAbsoluteText(url, { accept: 'application/json', signal })
    } catch (err) {
      if (signal?.aborted) throw err
      if (attempt === 1) return undefined
    }
  }
  return undefined
}

async function resolvePostId(
  host: string,
  style: RestStyle,
  originUrl: string,
  signal?: AbortSignal,
): Promise<number | undefined> {
  for (const slug of wordpressSlugCandidates(originUrl)) {
    const raw = await fetchJson(wordpressEndpoint(host, style, 'posts', { slug, _fields: 'id' }), signal)
    if (!raw) continue
    const postId = parseWordpressPostId(raw)
    if (postId) return postId
  }

  // 数字段直取：qbitai 等站点 slug 是中文标题，URL 末段数字即 post id
  const numericId = wordpressNumericIdFromUrl(originUrl)
  if (numericId) {
    const raw = await fetchJson(
      wordpressEndpoint(host, style, `posts/${numericId}`, { _fields: 'id' }),
      signal,
    )
    if (raw) {
      const postId = parseWordpressPostId(raw)
      if (postId) return postId
    }
  }
  return undefined
}

export const wordpressCommentProvider: CommentProvider = {
  label: '评论',
  defaultTab: 'latest',
  // WordPress 站点大量文章零评论：必须确知有评论才显示入口
  requiresCommentCount: true,

  canHandle(article) {
    return Boolean(wordpressRestStyleFor(article.originUrl))
  },

  async getSummaryCount(article, signal): Promise<number | undefined> {
    const style = wordpressRestStyleFor(article.originUrl)
    const host = hostOf(article.originUrl)
    if (!style || !host || !article.originUrl) return undefined

    const postId = await resolvePostId(host, style, article.originUrl, signal)
    if (!postId) return undefined

    const url = wordpressEndpoint(host, style, 'comments', {
      post: postId,
      per_page: WP_COUNT_CAP,
      _fields: 'id',
    })
    const raw = await fetchJson(url, signal)
    return raw ? parseWordpressCommentCount(raw) : undefined
  },

  async getComments(article, _tab, offset = 0, signal): Promise<CommentsQueryResult> {
    const style = wordpressRestStyleFor(article.originUrl)
    const host = hostOf(article.originUrl)
    const tabs: CommentTab[] = [{ id: 'latest', label: '最新评论' }]
    if (!style || !host || !article.originUrl) {
      return { comments: [], totalCount: 0, availableTabs: [], hasMore: false }
    }

    try {
      const postId = await resolvePostId(host, style, article.originUrl, signal)
      if (!postId) {
        return { comments: [], totalCount: 0, availableTabs: tabs, hasMore: false }
      }

      const pageIndex = Math.max(0, Number(offset) || 0)
      const url = wordpressEndpoint(host, style, 'comments', {
        post: postId,
        per_page: WP_PAGE_SIZE,
        page: pageIndex + 1,
        orderby: 'date',
        order: 'desc',
        _fields: 'id,parent,author_name,author_avatar_urls,date,content',
      })
      const raw = await fetchJson(url, signal)
      if (!raw) {
        return { comments: [], totalCount: 0, availableTabs: tabs, hasMore: false }
      }
      const comments = parseWordpressComments(raw)

      return {
        comments,
        totalCount: comments.length,
        availableTabs: tabs,
        hasMore: comments.length >= WP_PAGE_SIZE,
        nextOffset: pageIndex + 1,
      }
    } catch {
      return { comments: [], totalCount: 0, availableTabs: tabs, hasMore: false }
    }
  },
}
