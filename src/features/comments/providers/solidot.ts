import { parseHTML } from 'linkedom'

import { fetchAbsoluteText } from '../../../lib/http'
import type { CommentItem, CommentProvider, CommentQuote, CommentsQueryResult, CommentTab } from '../types'

/**
 * 奇客 Solidot 评论适配器（A 级：免登录、纯 HTTP、服务端直出）。
 *
 * 实测（2026-09-22）：
 *   GET https://www.solidot.org/story?sid=<sid>
 * 评论就渲染在文章页 `<!-- comments start --> … <!-- comments end -->` 之间，
 * 计数同样在页内：`<div class="statement">…<b>1</b>条评论</div>`；
 * 零评论的文章该区间为空（页面上没有 statement 块）→ 计数按 0 处理。
 *
 * 单条评论结构：
 *   <li id="tree_296690"><div id="comment_296690" class="list_com">
 *     <h2>很正常(得分:1 )</h2>
 *     <div class="talk_time"><a class="same_the" href="/~Craynic">Craynic</a>(18046)
 *       <span>发表于2026年07月27日 13时22分 星期一</span></div>
 *     <div class="p_text">没有沟通需要的语言就会慢慢消亡</div>
 *   </div></li>
 *
 * 回复通过嵌套的 `ul.reply_ul` 表达（`mode=nested` 是站点默认），这里按嵌套深度
 * 还原成一层引用（quotes），与其它 provider 的盖楼展示保持一致。
 */
function extractSolidotSid(article: { sourceId?: string; originUrl?: string }): string | undefined {
  const match = article.originUrl?.match(/solidot\.org\/story\?[^#]*\bsid=(\d+)/i)
  return match?.[1]
}

/** 文章页地址：评论与计数都在这一页里，取一次即可 */
export function solidotStoryUrl(sid: string): string {
  return `https://www.solidot.org/story?sid=${sid}`
}

function textOf(element: Element | null | undefined): string {
  if (!element) return ''
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** `<b>1</b>条评论` → 1；零评论的文章该区间为空，按 0 处理 */
export function parseSolidotCommentCount(html: string): number {
  const { document } = parseHTML(html)
  for (const node of document.querySelectorAll('.statement')) {
    const match = textOf(node).match(/(\d+)\s*条评论/)
    if (match) return Number(match[1])
  }
  return 0
}

/** `2026年07月27日 13时22分` → 相对时间；解析不了就原样返回 */
function formatSolidotTime(raw: string): string {
  const match = raw.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})时(\d{1,2})分/)
  if (!match) return raw || '时间未知'
  const at = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
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

export function parseSolidotComments(html: string): CommentItem[] {
  const { document } = parseHTML(html)
  const blocks = Array.from(document.querySelectorAll('div.list_com'))
  const comments: CommentItem[] = []
  /** 栈里是「当前层最后一条评论」，用于把嵌套回复挂到它的引用上 */
  const stack: { id: string; author: string; content: string }[] = []

  for (const block of blocks) {
    const depth = (() => {
      let count = 0
      let node: Element | null = block.parentElement
      while (node) {
        if (node.tagName === 'UL' && node.classList?.contains('reply_ul')) count += 1
        node = node.parentElement
      }
      return count
    })()

    const id = (block.getAttribute('id') ?? '').replace(/^comment_/, '') || `solidot-${comments.length}`
    const title = textOf(block.querySelector('h2'))
    const scoreMatch = title.match(/得分[:：]\s*(\d+)/)
    const author =
      textOf(block.querySelector('a.same_the')) ||
      (block.querySelector('.talk_time')?.textContent ?? '').trim().split('(')[0] ||
      '匿名'
    // talk_time 里第一个 span 是心情图标（无文本），日期要按格式挑出来
    const timeRaw =
      Array.from(block.querySelectorAll('.talk_time span'))
        .map(textOf)
        .find((text) => /\d{4}年\d{1,2}月\d{1,2}日/.test(text)) ?? ''
    const contentHtml = block.querySelector('.p_text')?.innerHTML ?? ''
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

    // 标题里的「(得分:N )」只是分数，清掉后剩下的才是真正的标题
    const cleanTitle = title.replace(/\(?得分[:：]\s*\d+\s*\)?/g, '').trim()

    const quotes: CommentQuote[] = []
    if (depth > 1 && stack.length) {
      const parent = stack[Math.min(depth - 2, stack.length - 1)]
      if (parent) {
        quotes.push({ id: parent.id, author: parent.author, content: parent.content })
      }
    }

    const item: CommentItem = {
      id,
      author,
      content: cleanTitle ? `${cleanTitle}\n${content}` : content,
      createTimeRaw: timeRaw || undefined,
      createTimeFormatted: formatSolidotTime(timeRaw),
      voteCount: scoreMatch ? Number(scoreMatch[1]) : 0,
      ...(quotes.length ? { quotes } : {}),
    }
    comments.push(item)

    stack.length = Math.max(0, depth - 1)
    stack.push({ id, author, content })
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

export const solidotCommentProvider: CommentProvider = {
  label: '评论',
  defaultTab: 'hot',
  // 多数新闻零评论：确知有条数才显示入口
  requiresCommentCount: true,

  canHandle(article) {
    if (article.sourceId === 'solidot') return true
    return Boolean(extractSolidotSid(article))
  },

  async getSummaryCount(article, signal): Promise<number | undefined> {
    const sid = extractSolidotSid(article)
    if (!sid) return undefined
    const html = await fetchPage(solidotStoryUrl(sid), signal)
    return html ? parseSolidotCommentCount(html) : undefined
  },

  async getComments(article, _tab, _offset, signal): Promise<CommentsQueryResult> {
    const tabs: CommentTab[] = [{ id: 'hot', label: '全部评论' }]
    const sid = extractSolidotSid(article)
    if (!sid) {
      return { comments: [], totalCount: 0, availableTabs: [], hasMore: false }
    }
    const html = await fetchPage(solidotStoryUrl(sid), signal)
    if (!html) {
      return { comments: [], totalCount: 0, availableTabs: tabs, hasMore: false }
    }
    const comments = parseSolidotComments(html)
    return {
      comments,
      totalCount: comments.length,
      availableTabs: tabs,
      // 站点一次直出当前显示模式下的全部评论，无分页参数可用
      hasMore: false,
    }
  },
}
