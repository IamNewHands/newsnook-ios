import { parseHTML } from 'linkedom'

import { fetchAbsoluteText } from '../../../lib/http'
import type { CommentItem, CommentProvider, CommentsQueryResult, CommentTab } from '../types'

/**
 * 知识分子（zhishifenzi.com）评论适配器（A 级：免登录、纯 HTTP、服务端直出）。
 *
 * 实测（2026-09-22）：评论直接渲染在文章页里，不需要单独的接口。
 *   计数：`<div class="no"><span>1</span> 条评论</div>`
 *   列表：`<div class="comments_content"> <ul> <li class="heng"> … </li> </ul> … </div>`
 *   单条：
 *     <li class="heng">
 *       <div class="col-md-1"><a class="release_box_face"><img src="…"></a></div>
 *       <div class="col-md-11">
 *         <div><span style="color:#1788c4"><a href='/u/50.html'>叶水送</a></span>
 *              <span style="color:#777">2018/09/05</span></div>
 *         <p>挺不错的一个技术，日本学者。</p>
 *         <div ip="…"><a level='1' pid='197' …>回复</a></div>
 *       </div>
 *     </li>
 *
 * 二级回复由 `查看更多回复` 按钮另行拉取（服务端不直出），因此这里只取一层；
 * 站点本身评论量很低，多数文章计数为 0，入口按「确知有条数」门控。
 *
 * 取数代价：计数与列表都在文章页里，取一次页面即可（正文解析取的是同一个 URL，
 * 原生端 NSURLSession 会命中 HTTP 缓存）。
 */
function hostOf(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

function textOf(element: Element | null | undefined): string {
  if (!element) return ''
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** `<div class="no"><span>1</span> 条评论</div>` → 1；没有该节点时按 0 */
export function parseZhishifenziCommentCount(html: string): number {
  const { document } = parseHTML(html)
  for (const node of document.querySelectorAll('.no')) {
    const match = textOf(node).match(/(\d+)\s*条评论/)
    if (match) return Number(match[1])
  }
  return 0
}

function formatZhishifenziTime(raw: string): string {
  const match = raw.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/)
  if (!match) return raw || '时间未知'
  const at = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
  ).getTime()
  if (!Number.isFinite(at)) return raw
  const diff = Math.max(0, Date.now() - at)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`
  if (diff < day) return `${Math.floor(diff / hour)}小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)}天前`
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

export function parseZhishifenziComments(html: string): CommentItem[] {
  const { document } = parseHTML(html)
  const comments: CommentItem[] = []

  for (const item of document.querySelectorAll('.comments_content li.heng')) {
    const body = item.querySelector('.col-md-11') ?? item
    const header = body.querySelector('div')
    const spans = header ? Array.from(header.querySelectorAll('span')) : []
    const timeRaw = spans.map((span) => textOf(span)).find((text) => /\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(text)) ?? ''
    const author =
      textOf(body.querySelector('a[href^="/u/"]')) ||
      textOf(spans[0]) ||
      '匿名'
    // 头像在左侧的 .col-md-1 列里，是正文列的兄弟节点，要从整条 li 上取
    const avatar = item.querySelector('img')?.getAttribute('src') ?? undefined
    const contentHtml = body.querySelector('p')?.innerHTML ?? ''
    const content = contentHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim()
    if (!content) continue

    const replyLink = body.querySelector('a[pid]')
    const id = replyLink?.getAttribute('pid') || `${author}-${timeRaw}-${comments.length}`

    comments.push({
      id,
      author,
      avatar,
      content,
      createTimeRaw: timeRaw || undefined,
      createTimeFormatted: formatZhishifenziTime(timeRaw),
      voteCount: 0,
    })
  }

  return comments
}

/** 网络抖动容忍：单次失败后再试一次 */
async function fetchPage(url: string, signal?: AbortSignal): Promise<string | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchAbsoluteText(url, { accept: 'text/html', signal })
    } catch (err) {
      if (signal?.aborted) throw err
      if (attempt === 1) return undefined
    }
  }
  return undefined
}

export const zhishifenziCommentProvider: CommentProvider = {
  label: '评论',
  defaultTab: 'latest',
  // 站点评论量低，绝大多数文章 0 条：确知有条数才显示入口
  requiresCommentCount: true,

  canHandle(article) {
    if (article.sourceId === 'zhishifenzi') return true
    return hostOf(article.originUrl).endsWith('zhishifenzi.com')
  },

  async getSummaryCount(article, signal): Promise<number | undefined> {
    if (!article.originUrl) return undefined
    const html = await fetchPage(article.originUrl, signal)
    return html ? parseZhishifenziCommentCount(html) : undefined
  },

  async getComments(article, _tab, _offset, signal): Promise<CommentsQueryResult> {
    const tabs: CommentTab[] = [{ id: 'latest', label: '全部评论' }]
    if (!article.originUrl) {
      return { comments: [], totalCount: 0, availableTabs: [], hasMore: false }
    }
    const html = await fetchPage(article.originUrl, signal)
    if (!html) {
      return { comments: [], totalCount: 0, availableTabs: tabs, hasMore: false }
    }
    const comments = parseZhishifenziComments(html)
    return {
      comments,
      totalCount: comments.length,
      availableTabs: tabs,
      // 二级回复要另行请求，这里不做分页
      hasMore: false,
    }
  },
}
