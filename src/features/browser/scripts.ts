/** User-installed source code stays local to this device and is never synced to NewsNook Cloud. */
export interface UserScript {
  id: string
  name: string
  version: string
  source: string
  enabled: boolean
  matches: string[]
  includes: string[]
  excludes: string[]
  excludeMatches: string[]
  grants: string[]
  connects: string[]
  requires: string[]
  runAt: 'document-start' | 'document-end' | 'document-idle'
  createdAt: number
}

const KEY = 'newsnook:userscripts:v1'
const MARKER = /^\s*\/\/\s*@([^\s]+)\s*(.*)$/
const CAP = 400_000
function metadata(code: string): Map<string, string[]> {
  const meta = new Map<string, string[]>()
  let active = false
  let ended = false
  for (const line of code.split(/\r?\n/)) {
    if (/^\s*\/\/\s*==UserScript==\s*$/.test(line)) { active = true; continue }
    if (/^\s*\/\/\s*==\/UserScript==\s*$/.test(line)) { ended = true; break }
    if (!active) continue
    const match = MARKER.exec(line)
    if (match) meta.set(match[1], [...(meta.get(match[1]) ?? []), match[2].trim()])
  }
  if (!active || !ended) throw new Error('缺少完整的 UserScript 元信息头')
  return meta
}
function single(meta: Map<string, string[]>, key: string, fallback = ''): string {
  return meta.get(key)?.[0] || fallback
}
export function installUserScript(source: string, old?: UserScript): UserScript {
  if (source.length === 0 || source.length > CAP) throw new Error('脚本大小不得超过 400 KB')
  const meta = metadata(source)
  const name = single(meta, 'name')
  if (!name) throw new Error('脚本缺少 @name')
  const matches = meta.get('match') ?? []
  const includes = meta.get('include') ?? []
  if (!matches.length && !includes.length) throw new Error('请添加 @match 或 @include 以限定网站')
  const runAt = single(meta, 'run-at', 'document-end')
  const runAtSafe = runAt === 'document-start' || runAt === 'document-end' || runAt === 'document-idle' ? runAt : 'document-end'
  return {
    id: old?.id ?? `us-${globalThis.crypto?.randomUUID?.() ?? String(Date.now())}`,
    name, version: single(meta, 'version', '1.0'), source, enabled: old?.enabled ?? true,
    matches, includes, excludes: meta.get('exclude') ?? [], excludeMatches: meta.get('exclude-match') ?? [],
    grants: meta.get('grant') ?? [], connects: meta.get('connect') ?? [], requires: meta.get('require') ?? [],
    runAt: runAtSafe, createdAt: old?.createdAt ?? Date.now(),
  }
}
function wildcard(p: string): RegExp {
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}
function matchPattern(pattern: string, url: URL): boolean {
  const m = /^(\*|https?|file):\/\/(\*|\*\.[^/]+|[^/]+)(\/.*)$/.exec(pattern)
  if (!m) return false
  if (m[1] !== '*' && m[1] !== url.protocol.slice(0, -1)) return false
  if (m[1] === '*' && !['http:', 'https:'].includes(url.protocol)) return false
  const hostPattern = m[2]
  if (hostPattern !== '*' && !(
    hostPattern.startsWith('*.') ? (url.hostname === hostPattern.slice(2) || url.hostname.endsWith(`.${hostPattern.slice(2)}`)) : url.hostname === hostPattern
  )) return false
  return wildcard(m[3]).test(`${url.pathname}${url.search}${url.hash}`)
}
function includePattern(pattern: string, url: URL): boolean {
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
    try { return new RegExp(pattern.slice(1, -1)).test(url.href) } catch { return false }
  }
  return wildcard(pattern).test(url.href)
}
export function matchesUserScript(script: UserScript, address: string): boolean {
  let url: URL
  try { url = new URL(address) } catch { return false }
  if (!['https:', 'http:'].includes(url.protocol)) return false
  if (!script.matches.some((m) => matchPattern(m, url)) && !script.includes.some((m) => includePattern(m, url))) return false
  if (script.excludeMatches.some((m) => matchPattern(m, url))) return false
  return !script.excludes.some((m) => includePattern(m, url))
}
export function loadUserScripts(): UserScript[] {
  try {
    const raw = localStorage.getItem(KEY)
    const result: unknown = raw && JSON.parse(raw)
    if (!Array.isArray(result)) return []
    return result.filter((it): it is UserScript => it && typeof it.id === 'string' && typeof it.source === 'string' && typeof it.enabled === 'boolean' && Array.isArray(it.matches) && Array.isArray(it.includes) && it.source.length < CAP)
  } catch { return [] }
}
export function saveUserScripts(items: UserScript[]): void {
  if (items.length > 128) throw new Error('最多安装 128 个脚本')
  localStorage.setItem(KEY, JSON.stringify(items))
}
