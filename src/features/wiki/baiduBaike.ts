import { parseHTML } from 'linkedom'
import { Capacitor } from '@capacitor/core'
import { WikiNotFoundError, isRelevantWikiTitle, type EncyclopediaProvider, type WikiEntry } from './encyclopedia'

const ROOT = 'https://baike.baidu.com'
const CONTENT = '.main-content, [class^="mainContent_"], [class*=" mainContent_"], [class^="lemmaContent_"]'
const SUMMARY = '.lemma-summary, [class^="lemmaSummary_"], [class*=" lemmaSummary_"]'
const PARAGRAPH = '.para, [class^="para_"], [class*=" para_"]'
const EXCLUDED = 'nav, aside, footer, header, [role="navigation"], .basic-info, [class^="basicInfo_"], [class*=" basicInfo_"], .reference-list, .lemma-reference, [class^="reference_"], [class*=" reference_"], .lemmaWgt-promotion, [class*="catalog"], [class*="Catalog"], [class*="recommend"], [class*="Recommend"], [class*="promotion"], [class*="Promotion"]'

/** Only accept substantial introductory prose after the article title and before its first chapter. */
function introductoryParagraphs(root: Element): Element[] {
  const intro: Element[] = []
  let afterTitle = !root.querySelector('h1')
  for (const node of Array.from(root.querySelectorAll(`h1, h2, h3, p, ${PARAGRAPH}`))) {
    if (node.closest(EXCLUDED)) continue
    if (node.localName === 'h1') { afterTitle = true; continue }
    if (!afterTitle) continue
    if (node.matches('h2, h3')) {
      if (node.previousElementSibling?.localName === 'h1') continue
      break
    }
    if (!node.querySelector(`p, ${PARAGRAPH}`) && node.textContent?.trim()) intro.push(node)
    if (intro.length === 3) break
  }
  return intro.map(node => node.textContent?.trim() || '').join('').length >= 60 ? intro : []
}

function itemUrl(value: string): string | undefined {
  try {
    const url = new URL(value, ROOT)
    if (url.origin === ROOT && url.pathname.startsWith('/item/') && !url.username && !url.password) return url.href
  } catch { /* Invalid upstream metadata. */ }
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Rebuild a tiny markup allowlist; never pass upstream attributes or active HTML to the reader. */
function inlineHtml(node: Node): string {
  if (node.nodeType === 3) return escapeText(node.textContent || '')
  const tag = (node as Element).localName
  if (['script', 'style', 'iframe', 'form', 'button', 'img', 'svg'].includes(tag)) return ''
  const content = Array.from(node.childNodes).map(inlineHtml).join('')
  if (tag === 'br') return '<br>'
  return ['sup', 'sub', 'b', 'strong', 'i', 'em'].includes(tag) ? `<${tag}>${content}</${tag}>` : content
}

function extractPage(html: string, term: string, url: string): { entry: WikiEntry; fullText: string } {
  const { document } = parseHTML(html)
  if (/百度安全验证|访问验证/.test(document.title) || document.querySelector('#captcha, #verify')) {
    throw new Error('百度百科需要安全验证，请稍后重试或切换百科源')
  }
  if (/页面不存在|词条不存在|尚未收录/.test(document.title + (document.querySelector('h1')?.textContent || ''))) {
    throw new WikiNotFoundError(term)
  }
  const root = document.querySelector(CONTENT)
  const title = [root?.querySelector('h1')?.textContent, document.querySelector('h1')?.textContent,
    document.querySelector('meta[property="og:title"]')?.getAttribute('content'), document.title]
    .map(value => (value || '').trim().replace(/\s*[_|—–-]\s*百度百科.*$/u, ''))
    .find(value => value && value !== '百度百科')
  const summaryNode = root?.querySelector(SUMMARY)
  const intro = root && !summaryNode?.textContent?.trim() ? introductoryParagraphs(root) : []
  if (!root || !title || (!summaryNode?.textContent?.trim() && intro.length === 0)) {
    throw new Error('百度百科页面结构暂不支持，无法提取词条，请切换百科源')
  }
  if (title !== term && !isRelevantWikiTitle(term, title)) throw new WikiNotFoundError(term)
  root.querySelectorAll('script, style, .reference-list, .lemma-reference, [class^="reference_"], .lemmaWgt-promotion').forEach(node => node.remove())
  const paragraphs = (container: Element) => Array.from(container.querySelectorAll(PARAGRAPH))
    .filter(node => !node.querySelector(PARAGRAPH))
  const summary = summaryNode?.textContent?.trim()
    ? paragraphs(summaryNode).map(node => `<p>${inlineHtml(node).trim()}</p>`).join('') || `<p>${inlineHtml(summaryNode).trim()}</p>`
    : intro.map(node => `<p>${inlineHtml(node).trim()}</p>`).join('')
  const full: string[] = summaryNode?.textContent?.trim() ? [summary] : []
  // Normalize Baike's nested heading/paragraph wrappers to the reader's flat section contract.
  for (const node of Array.from(root.querySelectorAll(`h2, h3, p, ${PARAGRAPH}`))) {
    if (node.closest(EXCLUDED) || summaryNode?.contains(node) || node.querySelector(`p, ${PARAGRAPH}`)) continue
    if (node.matches('h2, h3')) {
      // The subtitle directly following h1 describes the entry, not a chapter.
      if (node.previousElementSibling?.localName === 'h1') continue
      const text = node.textContent?.trim()
      if (text) full.push(`<${node.localName}>${escapeText(text)}</${node.localName}>`)
    } else if (node.textContent?.trim()) full.push(`<p>${inlineHtml(node).trim()}</p>`)
  }
  const facts = Array.from(root.querySelectorAll('.basic-info dt, [class^="basicInfo_"] dt')).flatMap(node => {
    const value = node.nextElementSibling
    return value?.localName === 'dd' ? [{ label: (node.textContent || '').replace(/\s+/g, ''), value: value.textContent?.trim() || '' }] : []
  }).filter(fact => fact.label && fact.value)
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href')
  const image = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
  let thumbnail: string | undefined
  try { const parsed = new URL(image || '', ROOT); if (image && parsed.protocol === 'https:') thumbnail = parsed.href } catch { /* Ignore invalid thumbnails. */ }
  return {
    entry: {
      query: term, title, description: root.querySelector('h1 + h2')?.textContent?.trim() || '',
      summary, thumbnail, url: (canonical && itemUrl(canonical)) || url,
      providerId: 'baidu-baike', language: 'zh', related: [], isLiveApi: false,
      structuredFacts: facts,
    },
    fullText: full.join('\n'),
  }
}

async function readPage(url: string, term: string, signal: AbortSignal) {
  signal.throwIfAborted()
  try {
    const { readBaiduPage } = await import('./baiduBrowser')
    const page = await readBaiduPage(url, signal)
    signal.throwIfAborted()
    return extractPage(page.html, term, page.url)
  } catch (error) {
    if (signal.aborted) throw signal.reason
    if (error instanceof Error && /^HTTP 404$/.test(error.message)) throw new WikiNotFoundError(term)
    if (error instanceof Error && /^HTTP (403|429)$/.test(error.message)) {
      throw new Error('百度百科访问受限或需要安全验证，请稍后重试或切换百科源')
    }
    throw error
  }
}

export function baiduBaikeProvider(): EncyclopediaProvider {
  // Keep the parsed document with its lookup entry; expanding it must not navigate again.
  // Entries are owned by the existing bounded lookup cache and the active reader.
  const documents = new WeakMap<WikiEntry, string>()
  return {
    id: 'baidu-baike', name: '百度百科', language: 'zh',
    isAvailable: () => Capacitor.getPlatform() === 'android',
    async lookup(term, signal) {
      const query = term.trim()
      if (!query) throw new WikiNotFoundError(term)
      const start = Date.now()
      const document = await readPage(`${ROOT}/item/${encodeURIComponent(query)}`, query, signal)
      const entry = { ...document.entry, latencyMs: Math.max(1, Date.now() - start) }
      documents.set(entry, document.fullText)
      return entry
    },
    async fullText(entry, signal) {
      signal.throwIfAborted()
      const url = itemUrl(entry.url)
      if (!url) throw new Error('百度百科词条地址无效')
      const existing = documents.get(entry)
      if (existing !== undefined) return existing
      const document = await readPage(url, entry.title, signal)
      documents.set(entry, document.fullText)
      return document.fullText
    },
  }
}
