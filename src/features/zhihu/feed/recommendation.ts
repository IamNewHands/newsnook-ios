import type {
  ZhihuContentSummary,
  ZhihuEntityKind,
  ZhihuRecommendationMode,
} from '../types'

const PROFILE_VERSION = 1
const PROFILE_PREFIX = 'newsnook:zhihu:local-recommendation:v1:'
const MODE_KEY = 'newsnook:zhihu:recommendation-mode:v1'
const MAX_SEEN = 500

export const ZHIHU_RECOMMENDATION_MODES: ReadonlyArray<{
  id: ZhihuRecommendationMode
  label: string
  description: string
}> = [
  { id: 'web', label: 'Web', description: '知乎网页端推荐流' },
  { id: 'android', label: 'Android', description: '知乎 Android 协议推荐流' },
  { id: 'mixed', label: '混合', description: 'Web 与 Android 两路独立翻页并在本机去重合并' },
  { id: 'local', label: '本地', description: '抓取公开候选后只在本机按你的阅读/互动信号排序' },
]

export type ZhihuRecommendationAction = 'open' | 'vote-up' | 'collect' | 'follow-author'

interface ZhihuRecommendationProfile {
  version: number
  updatedAt: number
  totalSignals: number
  kindScores: Partial<Record<ZhihuEntityKind, number>>
  authorScores: Record<string, number>
  /** entity key -> last opened unix ms */
  seen: Record<string, number>
}

export function loadZhihuRecommendationMode(
  storage: ZhihuRecommendationStorage | null = browserStorage(),
): ZhihuRecommendationMode {
  try {
    const value = storage?.getItem(MODE_KEY)
    return value === 'web' || value === 'android' || value === 'mixed' || value === 'local'
      ? value
      : 'mixed'
  } catch {
    return 'mixed'
  }
}

export function saveZhihuRecommendationMode(
  mode: ZhihuRecommendationMode,
  storage: ZhihuRecommendationStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(MODE_KEY, mode)
  } catch {
    // 偏好保存失败不影响当前会话切换。
  }
}

export interface ZhihuRecommendationStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(): ZhihuRecommendationStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function scopeId(accountId?: string | null): string {
  return (accountId?.trim() || 'guest').replace(/[^a-zA-Z0-9._-]/g, '_')
}

function profileKey(accountId?: string | null): string {
  return `${PROFILE_PREFIX}${scopeId(accountId)}`
}

function emptyProfile(): ZhihuRecommendationProfile {
  return {
    version: PROFILE_VERSION,
    updatedAt: Date.now(),
    totalSignals: 0,
    kindScores: {},
    authorScores: {},
    seen: {},
  }
}

function finiteScore(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function loadZhihuRecommendationProfile(
  accountId?: string | null,
  storage: ZhihuRecommendationStorage | null = browserStorage(),
): ZhihuRecommendationProfile {
  if (!storage) return emptyProfile()
  try {
    const raw = storage.getItem(profileKey(accountId))
    if (!raw) return emptyProfile()
    const value = JSON.parse(raw) as Partial<ZhihuRecommendationProfile>
    if (value.version !== PROFILE_VERSION) return emptyProfile()
    const profile = emptyProfile()
    profile.updatedAt = finiteScore(value.updatedAt) ?? profile.updatedAt
    profile.totalSignals = Math.max(0, finiteScore(value.totalSignals) ?? 0)
    if (value.kindScores && typeof value.kindScores === 'object') {
      for (const [kind, score] of Object.entries(value.kindScores)) {
        const normalized = finiteScore(score)
        if (normalized !== undefined) profile.kindScores[kind as ZhihuEntityKind] = normalized
      }
    }
    if (value.authorScores && typeof value.authorScores === 'object') {
      for (const [author, score] of Object.entries(value.authorScores)) {
        const normalized = finiteScore(score)
        if (normalized !== undefined && author) profile.authorScores[author] = normalized
      }
    }
    if (value.seen && typeof value.seen === 'object') {
      const seenEntries = Object.entries(value.seen)
        .map(([key, timestamp]) => [key, finiteScore(timestamp)] as const)
        .filter((entry): entry is readonly [string, number] => entry[1] !== undefined)
        .sort((left, right) => right[1] - left[1])
        .slice(0, MAX_SEEN)
      profile.seen = Object.fromEntries(seenEntries)
    }
    return profile
  } catch {
    return emptyProfile()
  }
}

function saveProfile(
  accountId: string | null | undefined,
  profile: ZhihuRecommendationProfile,
  storage: ZhihuRecommendationStorage | null,
): void {
  if (!storage) return
  try {
    storage.setItem(profileKey(accountId), JSON.stringify(profile))
  } catch {
    // 推荐画像属于增强功能；存储配额或隐私模式不能阻断阅读。
  }
}

function entityKey(item: Pick<ZhihuContentSummary, 'ref'>): string {
  return `${item.ref.kind}:${item.ref.id}`
}

const ACTION_WEIGHT: Record<ZhihuRecommendationAction, number> = {
  open: 1,
  'vote-up': 3,
  collect: 4,
  'follow-author': 5,
}

export function recordZhihuRecommendationSignal(
  accountId: string | null | undefined,
  item: Pick<ZhihuContentSummary, 'ref' | 'author'>,
  action: ZhihuRecommendationAction,
  storage: ZhihuRecommendationStorage | null = browserStorage(),
  now = Date.now(),
): void {
  if (!storage) return
  const profile = loadZhihuRecommendationProfile(accountId, storage)
  const weight = ACTION_WEIGHT[action]
  profile.totalSignals += 1
  profile.updatedAt = now
  profile.kindScores[item.ref.kind] = (profile.kindScores[item.ref.kind] ?? 0) + weight
  const authorId = item.author?.token ?? item.author?.id
  if (authorId) profile.authorScores[authorId] = (profile.authorScores[authorId] ?? 0) + weight
  if (action === 'open') profile.seen[entityKey(item)] = now
  const seenEntries = Object.entries(profile.seen).sort((left, right) => right[1] - left[1]).slice(0, MAX_SEEN)
  profile.seen = Object.fromEntries(seenEntries)
  saveProfile(accountId, profile, storage)
}

export function clearZhihuRecommendationProfile(
  accountId?: string | null,
  storage: ZhihuRecommendationStorage | null = browserStorage(),
): void {
  try {
    storage?.removeItem(profileKey(accountId))
  } catch {
    // 同上：画像清理失败不阻断其它站点能力。
  }
}

function freshnessScore(createdAt: number | undefined, nowSeconds: number): number {
  if (!createdAt) return 1
  const ageHours = Math.max(0, nowSeconds - createdAt) / 3600
  if (ageHours < 12) return 1.08
  if (ageHours < 48) return 1
  if (ageHours < 168) return 0.92
  return 0.82
}

function kindLabel(kind: ZhihuEntityKind): string {
  switch (kind) {
    case 'answer': return '回答'
    case 'article': return '文章'
    case 'pin': return '想法'
    case 'question': return '问题'
    default: return '这类内容'
  }
}

export function rankZhihuLocalRecommendations(
  candidates: readonly ZhihuContentSummary[],
  accountId?: string | null,
  storage: ZhihuRecommendationStorage | null = browserStorage(),
  now = Date.now(),
): ZhihuContentSummary[] {
  const profile = loadZhihuRecommendationProfile(accountId, storage)
  const maxKind = Math.max(1, ...Object.values(profile.kindScores).filter((value): value is number => typeof value === 'number'))
  const maxAuthor = Math.max(1, ...Object.values(profile.authorScores))
  const nowSeconds = now / 1000
  const deduped = new Map<string, ZhihuContentSummary>()
  for (const item of candidates) if (!deduped.has(entityKey(item))) deduped.set(entityKey(item), item)

  return [...deduped.values()]
    .map((item, index) => {
      const kindAffinity = (profile.kindScores[item.ref.kind] ?? 0) / maxKind
      const authorId = item.author?.token ?? item.author?.id
      const authorAffinity = authorId ? (profile.authorScores[authorId] ?? 0) / maxAuthor : 0
      const popularity = Math.min(1.5, Math.log10(Math.max(0, item.voteupCount ?? 0) + 1) / 3)
      const seenAt = profile.seen[entityKey(item)]
      const seenPenalty = seenAt ? (now - seenAt < 24 * 60 * 60 * 1000 ? 0.32 : 0.72) : 1
      const freshness = freshnessScore(item.createdAt, nowSeconds)
      // 原始候选顺序仍保留微弱先验，避免相同分数时完全打乱上游质量排序。
      const upstreamPrior = Math.max(0.8, 1 - index * 0.002)
      const score = (1 + kindAffinity * 0.45 + authorAffinity * 0.7 + popularity * 0.15) * freshness * seenPenalty * upstreamPrior
      const reason = authorAffinity >= 0.35 && item.author?.name
        ? `本地推荐 · 你常读 ${item.author.name} 的内容`
        : kindAffinity >= 0.3
          ? `本地推荐 · 你近期更常读${kindLabel(item.ref.kind)}`
          : popularity >= 0.65
            ? '本地推荐 · 候选中讨论度较高'
            : '本地推荐 · 来自公开候选并在本机排序'
      return {
        item: { ...item, recommendationSource: 'local' as const, recommendationReason: reason },
        score,
        index,
      }
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => item)
}

