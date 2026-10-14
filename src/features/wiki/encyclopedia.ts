/**
 * Encyclopedia sources share a minimal DTO. The reader never knows which API was used.
 * Only real Wikimedia endpoints are registered; other sources can be added as providers.
 */
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
      const original = term.trim()
      if (!original) throw new WikiNotFoundError(term)
      const resolved = language === 'en' ? await resolveEnglishTitle(original, signal) : original
      // Prefer an exact article; search is a fallback for non-title selections.
      const readSummary = async (title: string) => {
        const data = await getJson(summaryUrl(title), signal)
        if (!data.extract || data.type === 'disambiguation') return null
        return {
          query: original, title: data.title || title, description: data.description || '',
          summary: data.extract, thumbnail: data.thumbnail?.source,
          url: data.content_urls?.mobile?.page || pageUrl(data.title || title),
          providerId: id, language,
          related: [] as string[],
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
      // Plain extracts from a real MediaWiki API. Never synthesize full articles.
      const url = `${root}/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(entry.title)}&format=json&origin=*${language === 'zh' ? '&variant=zh-cn' : ''}`
      const data = await getJson(url, signal)
      const page = Object.values(data?.query?.pages || {})[0] as { extract?: string } | undefined
      if (!page?.extract?.trim()) throw new WikiNotFoundError(entry.title)
      return page.extract
    },
  }
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
  const key = `${source.id}:${normalized.toLocaleLowerCase()}`
  const existing = cache.get(key)
  if (existing && existing.until > Date.now()) return existing.value
  let entry: WikiEntry
  try {
    entry = await source.lookup(normalized, signal)
  } catch (error) {
    if (signal.aborted || !(error instanceof WikiNotFoundError) || !settings.fallbackEnglish || source.id !== 'wikipedia-zh') throw error
    entry = await getEncyclopediaProvider('wikipedia-en').lookup(normalized, signal)
  }
  cache.delete(key)
  cache.set(key, { value: entry, until: Date.now() + TTL })
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!)
  return entry
}
