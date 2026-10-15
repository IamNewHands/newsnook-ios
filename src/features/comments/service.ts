import { eastmoneyCommentProvider } from './providers/eastmoney'
import { gcoresCommentProvider } from './providers/gcores'
import { hackerNewsCommentProvider } from './providers/hackerNews'
import { jandanCommentProvider } from './providers/jandan'
import { neteaseCommentProvider } from './providers/netease'
import { solidotCommentProvider } from './providers/solidot'
import { substackCommentProvider } from './providers/substack'
import { v2exCommentProvider } from './providers/v2ex'
import { wordpressCommentProvider } from './providers/wordpress'
import { zhishifenziCommentProvider } from './providers/zhishifenzi'
import { zhihuCommentProvider } from './providers/zhihu'
import type {
  CommentProvider,
  CommentsQueryResult,
  CommentTabId,
} from './types'

const PROVIDERS: CommentProvider[] = [
  // 东财须先于网易：误写的 neteaseDocId / 数字 id 不能被网易拦截
  eastmoneyCommentProvider,
  neteaseCommentProvider,
  zhihuCommentProvider,
  // 站点专属适配（按主机/来源匹配）
  gcoresCommentProvider,
  v2exCommentProvider,
  solidotCommentProvider,
  zhishifenziCommentProvider,
  // 平台族通用适配：按主机匹配，不与上面的站点专属重叠
  wordpressCommentProvider,
  substackCommentProvider,
  jandanCommentProvider,
  hackerNewsCommentProvider,
]

export function findCommentProvider(article: {
  sourceId?: string
  originUrl?: string
  neteaseDocId?: string
}): CommentProvider | undefined {
  return PROVIDERS.find((p) => p.canHandle(article))
}

export function supportsComments(article: {
  sourceId?: string
  originUrl?: string
  neteaseDocId?: string
}): boolean {
  return Boolean(findCommentProvider(article))
}

/** 该来源对评论的称呼（跟贴 / 评论 / 回复 / 讨论 / 吐槽 / 留言），用于 UI 取词。 */
export function commentsLabelFor(article: {
  sourceId?: string
  originUrl?: string
  neteaseDocId?: string
}): string {
  return findCommentProvider(article)?.label ?? '评论'
}

/** 该来源默认展开的评论分类。 */
export function commentsDefaultTabFor(article: {
  sourceId?: string
  originUrl?: string
  neteaseDocId?: string
}): CommentTabId {
  return findCommentProvider(article)?.defaultTab ?? 'hot'
}

/**
 * 是否渲染评论入口。
 * - 无适配来源 → 不渲染（现状：没有就不展示）
 * - 标记 requiresCommentCount 的来源（WordPress / Substack 等）→ 只有确知评论数 > 0 才渲染，
 *   避免给大量零评论文章渲染空入口
 * - 其余来源 → 立即渲染（评论数只用于文案，取不到不影响入口）
 */
export function shouldShowCommentEntry(
  article: { sourceId?: string; originUrl?: string; neteaseDocId?: string },
  commentCount: number | undefined,
): boolean {
  const provider = findCommentProvider(article)
  if (!provider) return false
  if (provider.requiresCommentCount) return typeof commentCount === 'number' && commentCount > 0
  return true
}

export async function fetchArticleComments(
  article: { id: string; sourceId?: string; originUrl?: string; neteaseDocId?: string },
  tab?: CommentTabId,
  offset?: number | string,
  signal?: AbortSignal,
): Promise<CommentsQueryResult> {
  const provider = findCommentProvider(article)
  if (!provider) {
    return {
      comments: [],
      totalCount: 0,
      availableTabs: [],
      hasMore: false,
    }
  }
  return provider.getComments(article, tab, offset, signal)
}

export async function fetchCommentCount(
  article: { id: string; sourceId?: string; originUrl?: string; neteaseDocId?: string },
  signal?: AbortSignal,
): Promise<number | undefined> {
  const provider = findCommentProvider(article)
  if (!provider?.getSummaryCount) return undefined
  return provider.getSummaryCount(article, signal)
}
