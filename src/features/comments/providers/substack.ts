import { fetchAbsoluteText } from '../../../lib/http'
import type {
  CommentItem,
  CommentProvider,
  CommentsQueryResult,
  CommentTab,
} from '../types'

/**
 * Substack 通用评论适配器。
 *
 * 覆盖来源：`*.substack.com` 以及用自有域名的 Substack 站点。接口（2026-09-22 取证）：
 *   1. `/api/v1/archive?sort=new&limit=20&offset=<n>`       列出文章（id / slug / comment_count）
 *   2. `/api/v1/post/<postId>/comments?all_comments=true`   取该文全部评论（含 children 嵌套回复）
 *
 * 实测：thezvi.substack.com(37) · interconnects.ai · oneusefulthing.org(71) ·
 * astralcodexten.com · magazine.sebastianraschka.com(66) · lastweekin.ai（offset 分页有效）。
 * `only_paid` 文章的评论接口返回空数组（未付费不可见），comment_count 仍是文章级真实值。
 *
 * 为什么用 archive 而不是 `/api/v1/posts`：后者 `limit=50` 的响应达 2.4 MB（含全文 HTML），
 * 实测会直接 fetch failed；archive 每 20 篇仅约 90–150 KB，且同样带 comment_count。
 *
 * 已知限制：单次评论响应返回全部评论（limit 参数不被采纳），故不分页；文章不在前 160 篇归档
 * 或站点网络不可达（如 sinocism.com 本机需代理）时返回 undefined —— 入口按「确知有评论」隐藏。
 */
const SUBSTACK_CUSTOM_HOSTS = new Set([
  'understandingai.org',
  'latent.space',
  'interconnects.ai',
  'oneusefulthing.org',
  'astralcodexten.com',
  'fabricatedknowledge.com',
  'construction-physics.com',
  'sinocism.com',
  'magazine.sebastianraschka.com',
  'lastweekin.ai',
])

const POSTS_PAGE_SIZE = 20
const POSTS_MAX_PAGES = 8
const RESOLVE_TTL_MS = 5 * 60 * 1000

interface SubstackPostRef {
  id: number
  commentCount?: number
}

interface ResolveCacheEntry extends SubstackPostRef {
  at: number
}

const resolveCache = new Map<string, ResolveCacheEntry>()

/**
 * 请求用主机名：保留 `www.`（必须用文章自身主机名请求 —— oneusefulthing.org 的 apex 不可达，
 * 只有 www.oneusefulthing.org 能通）。
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

/** 是否 Substack：`*.substack.com` 或已登记的自有域名 */
export function isSubstackHost(originUrl?: string): boolean {
  const key = hostKeyOf(originUrl)
  if (!key) return false
  return key.endsWith('.substack.com') || SUBSTACK_CUSTOM_HOSTS.has(key)
}

/** 文章地址 `.../p/<slug>` 的最后一段即 slug */
export function substackSlugFromUrl(originUrl?: string): string | undefined {
  if (!originUrl) return undefined
  try {
    const segments = new URL(originUrl).pathname.split('/').filter(Boolean)
    const last = segments[segments.length - 1]
    return last ? decodeURIComponent(last) : undefined
  } catch {
    return undefined
  }
}

interface RawSubstackPost {
  id?: number
  slug?: string
  comment_count?: number
}

/** `/api/v1/posts` 响应 → 文章索引（id / slug / 评论数） */
export function parseSubstackPosts(raw: string): Array<{ id: number; slug?: string; commentCount?: number }> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return (parsed as RawSubstackPost[])
      .filter((item): item is RawSubstackPost => typeof item?.id === 'number')
      .map((item) => ({
        id: item.id as number,
        slug: item.slug,
        commentCount: typeof item.comment_count === 'number' ? item.comment_count : undefined,
      }))
  } catch {
    return []
  }
}

interface RawSubstackComment {
  id?: number
  body?: string
  date?: string
  name?: string
  handle?: string
  photo_url?: string
  reaction_count?: number
  children?: RawSubstackComment[]
}

function formatCommentTime(raw?: string): string {
  if (!raw) return '刚刚'
  const timestamp = Date.parse(raw)
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

function flattenSubstackComments(list: RawSubstackComment[], out: CommentItem[]): void {
  for (const item of list) {
    if (typeof item?.id === 'number') {
      const content = (item.body || '').trim()
      if (content) {
        const reactions = typeof item.reaction_count === 'number' ? item.reaction_count : 0
        out.push({
          id: String(item.id),
          author: item.name || item.handle || '匿名读者',
          avatar: item.photo_url,
          content,
          createTimeRaw: item.date,
          createTimeFormatted: formatCommentTime(item.date),
          voteCount: reactions,
          isHot: reactions >= 10,
        })
      }
    }
    if (Array.isArray(item?.children) && item.children.length > 0) {
      flattenSubstackComments(item.children, out)
    }
  }
}

/** `/api/v1/post/<id>/comments` 响应 → 扁平评论列表（含 children 嵌套回复） */
export function parseSubstackComments(raw: string): CommentItem[] {
  try {
    const parsed = JSON.parse(raw) as { comments?: RawSubstackComment[] }
    const comments = parsed?.comments
    if (!Array.isArray(comments)) return []
    const out: CommentItem[] = []
    flattenSubstackComments(comments, out)
    return out
  } catch {
    return []
  }
}

function readResolveCache(host: string, slug: string): ResolveCacheEntry | undefined {
  const hit = resolveCache.get(`${host}/${slug}`)
  if (!hit) return undefined
  if (Date.now() - hit.at > RESOLVE_TTL_MS) {
    resolveCache.delete(`${host}/${slug}`)
    return undefined
  }
  return hit
}

/** 网络抖动容忍：单次失败后再试一次（Substack 偶发 DNS/TLS 失败） */
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

/** 用 slug 反查文章 id 与评论数（同一次响应即可拿到 comment_count，供入口门控使用） */
async function resolvePost(
  host: string,
  originUrl: string,
  signal?: AbortSignal,
): Promise<SubstackPostRef | undefined> {
  const slug = substackSlugFromUrl(originUrl)
  if (!slug) return undefined

  const cached = readResolveCache(host, slug)
  if (cached) return cached

  let previousFirst: string | undefined
  for (let page = 0; page < POSTS_MAX_PAGES; page += 1) {
    const url = `https://${host}/api/v1/archive?sort=new&limit=${POSTS_PAGE_SIZE}&offset=${page * POSTS_PAGE_SIZE}`
    const raw = await fetchJson(url, signal)
    if (!raw) return undefined
    const posts = parseSubstackPosts(raw)
    if (posts.length === 0) return undefined

    // offset 不被采纳时响应会与上一页完全相同，直接停止
    const firstSlug = posts[0]?.slug
    if (page > 0 && firstSlug && firstSlug === previousFirst) return undefined
    previousFirst = firstSlug

    const match = posts.find((post) => post.slug === slug)
    if (match) {
      const entry: ResolveCacheEntry = { id: match.id, commentCount: match.commentCount, at: Date.now() }
      resolveCache.set(`${host}/${slug}`, entry)
      return entry
    }
    if (posts.length < POSTS_PAGE_SIZE) return undefined
  }
  return undefined
}

export const substackCommentProvider: CommentProvider = {
  label: '评论',
  defaultTab: 'hot',
  // 站点文章评论区普遍存在但多数文章零评论：确知有评论才显示入口
  requiresCommentCount: true,

  canHandle(article) {
    return isSubstackHost(article.originUrl)
  },

  async getSummaryCount(article, signal): Promise<number | undefined> {
    const host = hostOf(article.originUrl)
    if (!host || !article.originUrl) return undefined
    try {
      const post = await resolvePost(host, article.originUrl, signal)
      return post?.commentCount
    } catch {
      return undefined
    }
  },

  async getComments(article, _tab, _offset, signal): Promise<CommentsQueryResult> {
    const tabs: CommentTab[] = [{ id: 'hot', label: '全部评论' }]
    const host = hostOf(article.originUrl)
    if (!host || !article.originUrl) {
      return { comments: [], totalCount: 0, availableTabs: [], hasMore: false }
    }

    try {
      const post = await resolvePost(host, article.originUrl, signal)
      if (!post) {
        return { comments: [], totalCount: 0, availableTabs: tabs, hasMore: false }
      }

      const url = `https://${host}/api/v1/post/${post.id}/comments?all_comments=true`
      const raw = await fetchJson(url, signal)
      if (!raw) {
        return { comments: [], totalCount: 0, availableTabs: tabs, hasMore: false }
      }
      const comments = parseSubstackComments(raw)

      return {
        comments,
        totalCount: post.commentCount ?? comments.length,
        availableTabs: tabs,
        hasMore: false,
      }
    } catch {
      return { comments: [], totalCount: 0, availableTabs: tabs, hasMore: false }
    }
  },
}
