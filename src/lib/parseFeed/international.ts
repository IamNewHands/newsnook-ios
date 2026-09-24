/**
 * 国际媒体定制列表解析。
 *
 * 只处理公开列表元数据；正文仍交给 resolveBody / 原站访问控制。
 */

import type { NewsSource } from '../../sources/registry'
import type { Article } from '../types'
import { buildArticle, stripTags } from './shared'

function compactDate(raw: string): string {
  if (!/^\d{8}$/.test(raw)) return ''
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * BBC 中文简体首页。
 *
 * BBC 仍提供 https://www.bbc.com/zhongwen/simp ，但公开的 simp RSS 地址会 301 到
 * `zhongwen/trad/rss.xml`，因此不能再用 RSS 作为简体来源。首页自身是 Next.js SSR，
 * `__NEXT_DATA__` 中的 pageData.curations[].summaries[] 已包含标题、摘要、日期、图片和
 * `/simp` 正文链接，直接解析这份第一方结构化数据即可。
 */
export function parseBbcChinese(source: NewsSource, html: string, fetchedAt: number): Article[] {
  const script = html.match(
    /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  )
  if (!script?.[1]) return []

  let root: Record<string, unknown>
  try {
    const parsed = JSON.parse(script[1]) as unknown
    const record = asRecord(parsed)
    if (!record) return []
    root = record
  } catch {
    return []
  }

  const props = asRecord(root.props)
  const pageProps = asRecord(props?.pageProps)
  const pageData = asRecord(pageProps?.pageData)
  const curations = Array.isArray(pageData?.curations) ? pageData.curations : []
  const articles: Article[] = []

  for (const curationValue of curations) {
    const curation = asRecord(curationValue)
    const summaries = Array.isArray(curation?.summaries) ? curation.summaries : []

    for (const summaryValue of summaries) {
      const summary = asRecord(summaryValue)
      if (!summary || summary.type !== 'article') continue

      const title = stringValue(summary.title).trim()
      const link = stringValue(summary.link).trim()
      if (!title || !link) continue

      let articleUrl: URL
      try {
        articleUrl = new URL(link, source.siteUrl ?? source.url)
      } catch {
        continue
      }
      const hostname = articleUrl.hostname.toLowerCase()
      const isBbcHost =
        hostname === 'bbc.com' ||
        hostname.endsWith('.bbc.com') ||
        hostname === 'bbc.co.uk' ||
        hostname.endsWith('.bbc.co.uk')
      if (!isBbcHost) continue
      if (!articleUrl.pathname.startsWith('/zhongwen/') || !articleUrl.pathname.endsWith('/simp')) continue

      const description = stringValue(summary.description).trim()
      const firstPublished = stringValue(summary.firstPublished)
      const lastPublished = stringValue(summary.lastPublished)
      const rawImage = stringValue(summary.imageUrl)
      const image = rawImage ? rawImage.replace(/\{width\}/g, '976') : undefined

      const article = buildArticle(
        source,
        {
          title,
          link: articleUrl.href,
          html: '',
          summaryText: description || title,
          dateRaw: firstPublished || lastPublished,
          image,
        },
        fetchedAt,
      )
      if (article) articles.push(article)
    }
  }

  return articles
}

/**
 * 联合早报「国际」公开频道。
 *
 * 官网没有可用的第一方 RSS；列表页是服务端输出的 HTML。
 * 同一篇文章会同时出现图片链接和标题链接，因此按 origin URL 去重。
 */
export function parseZaobao(source: NewsSource, html: string, fetchedAt: number): Article[] {
  const articles: Article[] = []
  const seen = new Set<string>()
  const anchor = /<a\b[^>]*>/gi

  let match: RegExpExecArray | null
  while ((match = anchor.exec(html)) !== null) {
    const tag = match[0]
    const href = tag.match(/\bhref=["'](\/news\/world\/story(\d{8})-\d+[^"']*)["']/i)
    const label = tag.match(/\baria-label=["']([^"']+)["']/i)
    if (!href || !label) continue

    const path = href[1].replace(/&amp;/gi, '&')
    const link = new URL(path, 'https://www.zaobao.com.sg').href
    if (seen.has(link)) continue
    seen.add(link)

    const title = stripTags(label[1])
    if (!title) continue

    const article = buildArticle(
      source,
      {
        title,
        link,
        html: '',
        summaryText: title,
        dateRaw: compactDate(href[2]),
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}
