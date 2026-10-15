/**
 * Encyclopedia sources share a minimal DTO. The reader never knows which API was used.
 * Providers own their API or HTML extraction; the reader consumes the same entry contract.
 */
import { baiduBaikeProvider } from './baiduBaike'
import { parseHTML } from 'linkedom'
import { saveWikiSettingsValue, WIKI_SETTINGS_STORAGE_KEY } from '../../lib/storage'

export interface WikiFact {
  label: string
  value: string
}
export interface WikiSection {
  id: string
  title: string
  paragraphs: string[]
}
export interface WikiEntry {
  query: string
  title: string
  description: string
  summary: string
  thumbnail?: string
  url: string
  providerId: string
  language: string
  related: string[]
  pageId?: number | string
  latencyMs?: number
  isLiveApi?: boolean
  structuredFacts?: WikiFact[]
}
export interface EncyclopediaProvider {
  id: string
  name: string
  language: string
  isAvailable?(): boolean
  lookup(term: string, signal: AbortSignal): Promise<WikiEntry>
  fullText?(entry: WikiEntry, signal: AbortSignal): Promise<string>
}
export class WikiNotFoundError extends Error {
  constructor(term: string) { super(`未找到“${term}”的百科词条`); this.name = 'WikiNotFoundError' }
}
export const WIKI_SETTINGS_KEY = WIKI_SETTINGS_STORAGE_KEY
export interface WikiSettings {
  enabled: boolean
  providerId: string
  directLookup: boolean
  fallbackEnglish: boolean
}
export const DEFAULT_WIKI_SETTINGS: WikiSettings = {
  enabled: true, providerId: 'wikipedia-zh', directLookup: false, fallbackEnglish: true,
}
export function loadWikiSettings(): WikiSettings {
  try {
    const data = JSON.parse(localStorage.getItem(WIKI_SETTINGS_KEY) || '{}') as Partial<WikiSettings>
    const settings = { ...DEFAULT_WIKI_SETTINGS, ...data }
    const provider = registry.get(settings.providerId)
    if (!provider || provider.isAvailable?.() === false) {
      settings.providerId = DEFAULT_WIKI_SETTINGS.providerId
      saveWikiSettings(settings)
    }
    return settings
  } catch { return { ...DEFAULT_WIKI_SETTINGS } }
}
export function saveWikiSettings(settings: WikiSettings) {
  saveWikiSettingsValue(settings)
}
const TTL = 10 * 60 * 1000
const MAX_CACHE = 100
const cache = new Map<string, { value: WikiEntry; until: number }>()
async function getJson(url: string, signal: AbortSignal): Promise<any> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`百科服务请求失败 (HTTP ${response.status})`)
  return response.json()
}
/** Search APIs can return related but incorrect titles. Reject those candidates. */
export function isRelevantWikiTitle(query: string, title: string): boolean {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase()
    .replace(/[\s_·•.,，。、:：!?！？()（）《》【】“”‘’-]/g, '')
  const wanted = normalize(query).replace(/[的了着呢啊]$/u, '')
  const candidate = normalize(title)
  return wanted.length >= 2 && candidate.includes(wanted)
}
async function resolveEnglishTitle(term: string, signal: AbortSignal): Promise<string> {
  if (!/[\u3400-\u9fff]/.test(term)) return term
  try {
    const base = 'https://www.wikidata.org/w/api.php'
    const search = await getJson(`${base}?action=wbsearchentities&search=${encodeURIComponent(term)}&language=zh&limit=1&format=json&origin=*`, signal)
    const id = search?.search?.[0]?.id
    const label = search?.search?.[0]?.label
    if (!id || !/^Q[0-9]+$/.test(id) || !isRelevantWikiTitle(term, label || '')) return term
    const response = await getJson(`${base}?action=wbgetentities&ids=${id}&props=sitelinks&sitefilter=enwiki&format=json&origin=*`, signal)
    return response?.entities?.[id]?.sitelinks?.enwiki?.title || term
  } catch (error) {
    if (signal.aborted) throw error
    return term
  }
}
function wikiProvider(language: 'zh' | 'en'): EncyclopediaProvider {
  const id = `wikipedia-${language}`
  const host = `${language}.wikipedia.org`
  const root = `https://${host}`
  const summaryUrl = (title: string) => `${root}/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  const pageUrl = (title: string) => `${root}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
  return {
    id, name: language === 'zh' ? '中文维基百科' : 'Wikipedia (English)', language,
    async lookup(term, signal) {
      const start = Date.now()
      const original = term.trim()
      if (!original) throw new WikiNotFoundError(term)
      const resolved = language === 'en' ? await resolveEnglishTitle(original, signal) : original
      // Prefer an exact article; search is a fallback for non-title selections.
      const readSummary = async (title: string) => {
        const data = await getJson(summaryUrl(title), signal)
        if (!data.extract || data.type === 'disambiguation') return null
        const latencyMs = Math.max(1, Date.now() - start)
        const pageId = data.pageid
        const summaryHtml = formatScientificAndLatex(data.extract_html || data.extract)
        return {
          query: original, title: data.title || title, description: data.description || '',
          summary: summaryHtml, thumbnail: data.thumbnail?.source,
          url: data.content_urls?.mobile?.page || pageUrl(data.title || title),
          providerId: id, language,
          related: [] as string[],
          pageId,
          latencyMs,
          isLiveApi: true,
          structuredFacts: [
            ...(pageId ? [{ label: '词条 PAGEID', value: `#${pageId}` }] : []),
            { label: '实时接口', value: `${host} REST v1` },
          ],
        }
      }
      try {
        const exact = await readSummary(resolved)
        if (exact) return exact
      } catch (error) {
        if (signal.aborted) throw error
      }
      const search = await getJson(`${root}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(resolved)}&srlimit=5&format=json&origin=*`, signal)
      const hits = (search?.query?.search || []) as Array<{ title: string }>
      const matched = hits.find(hit => isRelevantWikiTitle(original, hit.title))
      if (!matched) throw new WikiNotFoundError(original)
      const found = await readSummary(matched.title)
      if (!found) throw new WikiNotFoundError(original)
      return { ...found, related: hits.filter(hit => hit.title !== matched.title).map(hit => hit.title) }
    },
    async fullText(entry, signal) {
      // TextExtracts strips images and some formulas even in HTML mode.
      const url = `${root}/w/api.php?action=parse&prop=text&redirects=1&page=${encodeURIComponent(entry.title)}&format=json&formatversion=2&origin=*${language === 'zh' ? '&variant=zh-cn' : ''}`
      const data = await getJson(url, signal)
      if (data?.error && data.error.code !== 'missingtitle') throw new Error('百科正文请求失败')
      const html = data?.parse?.text
      if (typeof html !== 'string' || !html.trim()) throw new WikiNotFoundError(entry.title)
      return sanitizeWikiHtml(html, pageUrl(entry.title))
    },
  }
}

/**
 * Converts LaTeX sub/superscripts, chemical formulas, and scientific notations
 * e.g. {}_{6}^{12}{\mbox{C}} -> <sub>6</sub><sup>12</sup>C, 1023 -> 10<sup>23</sup>
 */
export function formatScientificAndLatex(str: string): string {
  if (!str) return ''
  let s = str
  // 1. Math/Chemical sub and superscripts from LaTeX residuals like {}_{6}^{12}{\mbox{C}} or {}_6^{12}C
  s = s.replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>')
  s = s.replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>')
  s = s.replace(/\\(?:mbox|text|mathrm)\{([^{}]+)\}/g, '$1')
  s = s.replace(/\{\}/g, '')
  s = s.replace(/\{([a-zA-Z0-9+-=])\}/g, '$1')

  // 2. Scientific notation numbers like 1023 -> 10^23 when not already inside tags
  s = s.replace(/([×x·]\s*10)(2[0-9]|1[0-9]|[3-9][0-9]|-?\d{2,3})\b/g, '$1<sup>$2</sup>')

  return s
}

/**
 * Converts common LaTeX math expressions into natural readable Unicode math representations.
 */
export function formatTexMath(tex: string): string {
  let s = tex.trim()

  const map: Array<[RegExp, string]> = [
    [/\\mapsto/g, ' ↦ '],
    [/\\to|\\rightarrow/g, ' → '],
    [/\\leftarrow/g, ' ← '],
    [/\\Rightarrow/g, ' ⇒ '],
    [/\\Leftarrow/g, ' ⇐ '],
    [/\\leftrightarrow/g, ' ↔ '],
    [/\\iff/g, ' ⇔ '],
    [/\\cdot/g, ' · '],
    [/\\times/g, ' × '],
    [/\\div/g, ' ÷ '],
    [/\\pm/g, ' ± '],
    [/\\mp/g, ' ∓ '],
    [/\\leq|\\le/g, ' ≤ '],
    [/\\geq|\\ge/g, ' ≥ '],
    [/\\neq|\\ne/g, ' ≠ '],
    [/\\approx/g, ' ≈ '],
    [/\\equiv/g, ' ≡ '],
    [/\\in/g, ' ∈ '],
    [/\\notin/g, ' ∉ '],
    [/\\subset/g, ' ⊂ '],
    [/\\subseteq/g, ' ⊆ '],
    [/\\cap/g, ' ∩ '],
    [/\\cup/g, ' ∪ '],
    [/\\forall/g, ' ∀ '],
    [/\\exists/g, ' ∃ '],
    [/\\infty/g, ' ∞ '],
    [/\\emptyset/g, ' ∅ '],
    [/\\sum/g, ' ∑ '],
    [/\\prod/g, ' ∏ '],
    [/\\int/g, ' ∫ '],
    [/\\mathbb\{R\}/g, 'ℝ'],
    [/\\mathbb\{N\}/g, 'ℕ'],
    [/\\mathbb\{Z\}/g, 'ℤ'],
    [/\\mathbb\{Q\}/g, 'ℚ'],
    [/\\mathbb\{C\}/g, 'ℂ'],
    [/\\mathbf\{([^}]+)\}/g, '$1'],
    [/\\mathit\{([^}]+)\}/g, '$1'],
    [/\\mathrm\{([^}]+)\}/g, '$1'],
    [/\\text\{([^}]+)\}/g, '$1'],
    [/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1 / $2)'],
    [/\\sqrt\{([^{}]+)\}/g, '√($1)'],
    [/\\{/g, '{'],
    [/\\}/g, '}'],
    [/\\,/g, ' '],
    [/\\;/g, ' '],
    [/\\!/g, ''],
    [/\\ /g, ' '],
  ]

  for (const [pattern, repl] of map) {
    s = s.replace(pattern, repl)
  }

  s = s.replace(/,(?!\s)/g, ', ')
  s = s.replace(/\s*=\s*/g, ' = ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

/**
 * Cleans vertical MathML residual artifacts caused by MediaWiki plaintext extraction
 * and resolves {\displaystyle ...} into natural readable math expressions.
 */
export function cleanWikiMathAndLayout(text: string): string {
  const markerRegex = /\{\\(?:displaystyle|textstyle|scriptstyle)\b/g
  let match: RegExpExecArray | null
  let result = ''
  let lastIndex = 0

  while ((match = markerRegex.exec(text)) !== null) {
    const markerStart = match.index
    let depth = 1
    let markerEnd = -1
    for (let i = markerStart + match[0].length; i < text.length; i++) {
      if (text[i] === '\\' && i + 1 < text.length) {
        i++
        continue
      }
      if (text[i] === '{') depth++
      else if (text[i] === '}') {
        depth--
        if (depth === 0) {
          markerEnd = i + 1
          break
        }
      }
    }

    if (markerEnd === -1) continue

    const prefix = text.slice(lastIndex, markerStart)
    const lines = prefix.split('\n')
    let residueLineCount = 0
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line) {
        residueLineCount++
        continue
      }
      if (line.length <= 6 || /^[a-zA-Z0-9+\-=/*,.;:()[\]{}|↦→←≤≥≠≈]+$/.test(line)) {
        residueLineCount++
      } else {
        break
      }
    }

    let cleanPrefix = prefix
    if (residueLineCount >= 1) {
      const keptLines = lines.slice(0, lines.length - residueLineCount)
      cleanPrefix = keptLines.join('\n').replace(/\n\s*$/, '')
    }

    // Swallow trailing blank lines/whitespace following closing formula brace
    let forwardIndex = markerEnd
    const forwardMatch = text.slice(markerEnd).match(/^(\s*\n)+/)
    if (forwardMatch) {
      forwardIndex = markerEnd + forwardMatch[0].length
    }

    result += cleanPrefix

    const fullFormula = text.slice(markerStart, markerEnd)
    const innerTex = fullFormula.replace(/^\{\\(?:displaystyle|textstyle|scriptstyle)\s*/, '').replace(/\}$/, '')
    const readable = formatTexMath(innerTex)

    const trimmedCleanPrefix = cleanPrefix.trimEnd()
    const hasPunctuation = /[。！？.!?；;]$/u.test(trimmedCleanPrefix)

    if (!hasPunctuation && trimmedCleanPrefix.length > 0) {
      result += ` ${readable} `
    } else {
      result += `\n${readable}\n`
    }

    lastIndex = forwardIndex
    markerRegex.lastIndex = forwardIndex
  }

  result += text.slice(lastIndex)
  return result
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([，。、；：,.;:）\]}])/g, '$1')
}

function splitCleanParagraphs(content: string): string[] {
  const rawLines = content.split('\n').map(b => b.trim()).filter(Boolean)
  const merged: string[] = []
  for (const line of rawLines) {
    if (merged.length > 0 && /^[，。、；：,.;:）\]}]/u.test(line)) {
      merged[merged.length - 1] += line
    } else {
      merged.push(line)
    }
  }
  return merged
}

function normalizeWikiLayout(root: Element): void {
  // Portal badges decorate navigation links; keep the label without treating the icon as article media.
  root.querySelectorAll('.portalbox-image').forEach(icon => icon.remove())
  const punctuationOnly = /^[\s，。、；：！？,.!?:;）】》」』”’]+$/u
  for (const paragraph of root.querySelectorAll('p')) {
    if (!punctuationOnly.test(paragraph.textContent || '') || paragraph.querySelector('img, math, br')) continue
    const previous = paragraph.previousElementSibling
    if (!previous) continue
    const target = previous.tagName === 'DL' ? previous.querySelector('dd:last-child') : previous
    if (!target) continue
    target.append(...Array.from(paragraph.childNodes))
    paragraph.remove()
  }
  for (const row of root.querySelectorAll('dd')) {
    if (!row.querySelector('math')) continue
    const remaining = row.cloneNode(true) as Element
    remaining.querySelectorAll('math, annotation, img').forEach(el => el.remove())
    const text = (remaining.textContent || '').trim()
    if (!text || punctuationOnly.test(text)) row.classList.add('wiki-equation')
  }
  for (const formula of root.querySelectorAll('.mwe-math-element-display, .wiki-math-display')) {
    const next = formula.nextSibling
    if (next?.nodeType !== 3) continue
    const text = next.textContent || ''
    const punctuation = text.match(/^\s*([，。、；：！？,.!?:;）】》」』”’]+)/u)
    if (!punctuation) continue
    formula.append(punctuation[1])
    next.textContent = text.slice(punctuation[0].length)
  }
}

/**
 * Sanitizes rich HTML content for wiki cards and full articles,
 * preserving safe typographical tags (sup, sub, math, etc.) while stripping scripts and TeX annotation leaks.
 */
export function sanitizeWikiHtml(dirty: string, baseUrl = 'https://zh.wikipedia.org'): string {
  if (!dirty) return ''
  const { document } = parseHTML('<html><body></body></html>')
  document.body.innerHTML = dirty
  document.querySelectorAll('script, style, iframe, object, embed, form, input, button, link, meta, annotation, annotation-xml, .mw-editsection, .mw-empty-elt, .noteTA, .toc, .navbox').forEach(el => el.remove())
  normalizeWikiLayout(document.body)

  // Use local MathML rendering: upstream hides it and shows a remote SVG instead.
  for (const formula of document.querySelectorAll('.mwe-math-element')) {
    if (formula.querySelector('math')) {
      formula.querySelectorAll('img').forEach(img => img.remove())
    }
  }
  const allowedTags = new Set(('p div span section h2 h3 h4 h5 h6 a b strong i em u s small sup sub br hr ul ol li dl dt dd blockquote figure figcaption img table caption thead tbody tfoot tr th td math semantics mrow mi mn mo ms mtext mspace msqrt mroot mfrac msup msub msubsup munder mover munderover mtable mtr mtd menclose mpadded mphantom mfenced mstyle mmultiscripts mprescripts none').split(' '))
  const allowedAttrs = new Set(('href src alt title width height colspan rowspan xmlns display mathvariant displaystyle scriptlevel stretchy fence separator lspace rspace mathsize mathcolor mathbackground linethickness accent accentunder columnalign rowalign columnspacing rowspacing encoding').split(' '))
  const resourceUrl = (value: string): string | null => {
    try {
      const url = new URL(value, baseUrl)
      return /^https?:$/.test(url.protocol) ? url.href : null
    } catch { return null }
  }
  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    if (!allowedTags.has(element.localName.toLowerCase())) {
      element.replaceWith(...Array.from(element.childNodes))
      continue
    }
    const isDisplayMath = element.classList.contains('mwe-math-element-display') || element.classList.contains('wiki-math-display')
    const isEquation = element.classList.contains('wiki-equation')
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase()
      if (!allowedAttrs.has(name)) element.removeAttribute(attr.name)
      else if (name === 'src' || name === 'href') {
        const url = resourceUrl(attr.value)
        if (url) element.setAttribute(name, url)
        else element.removeAttribute(name)
      }
    }
    if (isDisplayMath) element.setAttribute('class', 'wiki-math-display')
    if (isEquation) element.classList.add('wiki-equation')
    if (element.localName === 'img') {
      element.setAttribute('loading', 'lazy')
      element.setAttribute('referrerpolicy', 'no-referrer')
    }
  }
  return document.body.innerHTML
}

/**
 * Robust section parser supporting HTML extracts, Wiki Markup (== Chapter ==), and plain text.
 */
export function parseWikiSections(rawText: string, summaryFallback = ''): WikiSection[] {
  const raw = (rawText || '').trim()
  if (!raw && summaryFallback) {
    return [{
      id: 'sec-0',
      title: '词条导言与核心定义',
      paragraphs: [summaryFallback.trim()],
    }]
  }
  if (!raw) return []

  const isHtml = /<(?:h[2-6]|p|ul|ol|blockquote|math|div|dl|figure|img|table|section)\b/i.test(raw)

  if (isHtml) {
    const { document } = parseHTML('<html><body></body></html>')
    document.body.innerHTML = raw
    document.querySelectorAll('script, style, .mw-empty-elt, .mw-editsection, annotation, .noteTA, .toc, .navbox').forEach(el => el.remove())
    normalizeWikiLayout(document.body)
    const sections: WikiSection[] = []
    let current: WikiSection = { id: 'sec-0', title: '词条导言与核心定义', paragraphs: [] }
    const visit = (node: Element) => {
      const tag = node.tagName.toUpperCase()
      if (/^H[2-6]$/.test(tag)) {
        if (current.paragraphs.length) sections.push(current)
        current = { id: `sec-${sections.length}`, title: (node.textContent || '').replace(/\[编辑\]|\[edit\]/gi, '').trim(), paragraphs: [] }
      } else if (node.querySelector('h2, h3, h4, h5, h6') || node.classList.contains('mw-parser-output') || tag === 'SECTION') {
        Array.from(node.children).forEach(visit)
      } else if ((node.textContent || '').trim() || node.matches('img, math') || node.querySelector('img, math')) {
        current.paragraphs.push(node.outerHTML)
      }
    }
    Array.from(document.body.children).forEach(visit)
    if (current.paragraphs.length) sections.push(current)
    if (sections.length) return sections
  }

  // Plaintext or Wiki Markup fallback: Clean stacked math artifacts first
  const sections: WikiSection[] = []
  const text = cleanWikiMathAndLayout(raw).trim()

  if (/(?:^|\n)\s*==+\s*[^=\n]+?\s*==+/.test(text)) {
    const lines = text.split('\n')
    let currentTitle = '词条导言与核心定义'
    let currentLines: string[] = []

    for (const rawLine of lines) {
      const line = rawLine.trim()
      const headerMatch = line.match(/^==+\s*([^=\n]+?)\s*==+$/)
      if (headerMatch) {
        if (currentLines.length > 0) {
          const paras = splitCleanParagraphs(currentLines.join('\n\n'))
          if (paras.length > 0) {
            sections.push({
              id: `sec-${sections.length}`,
              title: currentTitle,
              paragraphs: paras,
            })
          }
          currentLines = []
        }
        currentTitle = headerMatch[1].trim()
      } else if (line) {
        currentLines.push(line)
      }
    }
    if (currentLines.length > 0) {
      const paras = splitCleanParagraphs(currentLines.join('\n\n'))
      if (paras.length > 0) {
        sections.push({
          id: `sec-${sections.length}`,
          title: currentTitle,
          paragraphs: paras,
        })
      }
    }
  } else if (text) {
    const paragraphs = splitCleanParagraphs(text)
    sections.push({
      id: 'sec-0',
      title: '词条导言与核心定义',
      paragraphs: paragraphs.length > 0 ? paragraphs : [text],
    })
  }

  if (sections.length === 0 && summaryFallback) {
    sections.push({
      id: 'sec-0',
      title: '词条导言与核心定义',
      paragraphs: [summaryFallback.trim()],
    })
  } else if (sections.length > 0 && sections[0].paragraphs.length === 0 && summaryFallback) {
    sections[0].paragraphs = [summaryFallback.trim()]
  }

  return sections.filter(sec => sec.paragraphs.length > 0)
}
const registry = new Map<string, EncyclopediaProvider>()
export function registerEncyclopediaProvider(provider: EncyclopediaProvider) {
  if (!provider.id || registry.has(provider.id)) throw new Error('百科源 ID 无效或重复')
  registry.set(provider.id, provider)
}
registerEncyclopediaProvider(wikiProvider('zh'))
registerEncyclopediaProvider(wikiProvider('en'))
registerEncyclopediaProvider(baiduBaikeProvider())
export function encyclopediaProviders() { return Array.from(registry.values()).filter(provider => provider.isAvailable?.() !== false) }
export function getEncyclopediaProvider(id: string) { return registry.get(id) || registry.get(DEFAULT_WIKI_SETTINGS.providerId)! }
export async function lookupEncyclopedia(term: string, settings: WikiSettings, signal: AbortSignal, override?: string) {
  const normalized = term.trim().slice(0, 160)
  if (!normalized) throw new WikiNotFoundError(term)
  const source = getEncyclopediaProvider(override || settings.providerId)
  if (source.isAvailable?.() === false) throw new Error(`当前平台暂不支持${source.name}，请切换百科源`)
  // Fallback policy belongs to the lookup identity: disabling English fallback must
  // never reuse an English result cached by an earlier Chinese lookup.
  const allowEnglishFallback = settings.fallbackEnglish && source.id === 'wikipedia-zh'
  const key = `${source.id}:${allowEnglishFallback ? 'fallback-en' : 'strict'}:${normalized.toLocaleLowerCase()}`
  const existing = cache.get(key)
  if (existing && existing.until > Date.now()) return existing.value
  let entry: WikiEntry
  try {
    entry = await source.lookup(normalized, signal)
  } catch (error) {
    if (signal.aborted || !(error instanceof WikiNotFoundError) || !allowEnglishFallback) throw error
    entry = await getEncyclopediaProvider('wikipedia-en').lookup(normalized, signal)
  }
  cache.delete(key)
  cache.set(key, { value: entry, until: Date.now() + TTL })
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!)
  return entry
}
