/**
 * Encyclopedia sources share a minimal DTO. The reader never knows which API was used.
 * Only real Wikimedia endpoints are registered; other sources can be added as providers.
 */
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
  lookup(term: string, signal: AbortSignal): Promise<WikiEntry>
  fullText?(entry: WikiEntry, signal: AbortSignal): Promise<string>
}
export class WikiNotFoundError extends Error {
  constructor(term: string) { super(`未找到“${term}”的百科词条`); this.name = 'WikiNotFoundError' }
}
export const WIKI_SETTINGS_KEY = 'newsnook.wiki.settings.v1'
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
    return { ...DEFAULT_WIKI_SETTINGS, ...data }
  } catch { return { ...DEFAULT_WIKI_SETTINGS } }
}
export function saveWikiSettings(settings: WikiSettings) {
  try { localStorage.setItem(WIKI_SETTINGS_KEY, JSON.stringify(settings)) } catch { /* storage unavailable */ }
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
      // Fetch full MediaWiki article extracts in HTML format (identical to wikilens_oil_ui.html)
      const url = `${root}/w/api.php?action=query&prop=extracts&redirects=1&titles=${encodeURIComponent(entry.title)}&format=json&origin=*${language === 'zh' ? '&variant=zh-cn' : ''}`
      const data = await getJson(url, signal)
      const page = Object.values(data?.query?.pages || {})[0] as { extract?: string } | undefined
      if (!page?.extract?.trim()) throw new WikiNotFoundError(entry.title)
      return page.extract
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

/**
 * Sanitizes rich HTML content for wiki cards and full articles,
 * preserving safe typographical tags (sup, sub, math, etc.) while stripping scripts and TeX annotation leaks.
 */
export function sanitizeWikiHtml(dirty: string): string {
  if (!dirty) return ''
  return dirty
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/\son[a-z]+=["'][^"']*["']/gi, '')
    .replace(/\son[a-z]+=[^\s>]+/gi, '')
    .replace(/<annotation\b[^<]*(?:(?!<\/annotation>)<[^<]*)*<\/annotation>/gi, '')
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

  const isHtml = /<(?:h[2-3]|p|ul|ol|blockquote|math|div)\b/i.test(raw)

  if (isHtml) {
    if (typeof DOMParser !== 'undefined') {
      try {
        const parser = new DOMParser()
        const doc = parser.parseFromString(`<div>${raw}</div>`, 'text/html')
        const root = doc.body.firstElementChild || doc.body
        root.querySelectorAll('script, style, .mw-empty-elt, .mw-editsection, annotation').forEach(el => el.remove())

        const parsedSections: WikiSection[] = []
        let currentSection: WikiSection = {
          id: 'sec-0',
          title: '词条导言与核心定义',
          paragraphs: [],
        }

        Array.from(root.children).forEach(node => {
          const tag = node.tagName ? node.tagName.toUpperCase() : ''
          const nodeText = (node.textContent || '').trim()
          if (!nodeText) return

          if (tag === 'H2' || tag === 'H3') {
            if (currentSection.paragraphs.length > 0) {
              parsedSections.push(currentSection)
            }
            currentSection = {
              id: `sec-${parsedSections.length}`,
              title: nodeText.replace(/\[编辑\]|\[edit\]/gi, '').trim(),
              paragraphs: [],
            }
          } else if (tag === 'P' || tag === 'UL' || tag === 'OL' || tag === 'BLOCKQUOTE' || tag === 'DIV') {
            const rawHtml = (node as Element).outerHTML || nodeText
            currentSection.paragraphs.push(formatScientificAndLatex(rawHtml))
          }
        })

        if (currentSection.paragraphs.length > 0) {
          parsedSections.push(currentSection)
        }

        if (parsedSections.length > 0) {
          return parsedSections
        }
      } catch {
        // Fallback to regex below
      }
    }

    // RegEx fallback for HTML when DOMParser is unavailable
    const sections: WikiSection[] = []
    const cleanedHtml = raw.replace(/<annotation\b[^<]*(?:(?!<\/annotation>)<[^<]*)*<\/annotation>/gi, '')
    const rawParts = cleanedHtml.split(/(<h[2-3][^>]*>[\s\S]*?<\/h[2-3]>)/i)
    let currentTitle = '词条导言与核心定义'
    let currentParagraphs: string[] = []

    for (let i = 0; i < rawParts.length; i++) {
      const part = rawParts[i].trim()
      if (!part) continue
      const headerMatch = part.match(/<h[2-3][^>]*>([\s\S]*?)<\/h[2-3]>/i)
      if (headerMatch) {
        if (currentParagraphs.length > 0) {
          sections.push({
            id: `sec-${sections.length}`,
            title: currentTitle,
            paragraphs: currentParagraphs,
          })
          currentParagraphs = []
        }
        currentTitle = headerMatch[1].replace(/<[^>]+>/g, '').replace(/\[编辑\]|\[edit\]/gi, '').trim()
      } else {
        const textOnly = part.replace(/<[^>]+>/g, '').trim()
        if (!textOnly) continue
        const pMatches = part.match(/<(?:p|ul|ol|blockquote)[^>]*>[\s\S]*?<\/(?:p|ul|ol|blockquote)>/gi)
        if (pMatches) {
          currentParagraphs.push(...pMatches.map(p => formatScientificAndLatex(p.trim())).filter(Boolean))
        } else {
          const clean = formatScientificAndLatex(part.trim())
          if (clean) currentParagraphs.push(clean)
        }
      }
    }
    if (currentParagraphs.length > 0) {
      sections.push({
        id: `sec-${sections.length}`,
        title: currentTitle,
        paragraphs: currentParagraphs,
      })
    }
    if (sections.length > 0) return sections
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
export function encyclopediaProviders() { return Array.from(registry.values()) }
export function getEncyclopediaProvider(id: string) { return registry.get(id) || registry.get(DEFAULT_WIKI_SETTINGS.providerId)! }
export async function lookupEncyclopedia(term: string, settings: WikiSettings, signal: AbortSignal, override?: string) {
  const normalized = term.trim().slice(0, 160)
  if (!normalized) throw new WikiNotFoundError(term)
  const source = getEncyclopediaProvider(override || settings.providerId)
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
