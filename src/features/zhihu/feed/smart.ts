import { log } from '../../../lib/logger'
import { ZhihuApiError } from '../api/errors'
import type { Page, ZhihuContentSummary } from '../types'
import {
  loadZhihuSmartCandidatePool,
  mergeZhihuSmartCandidatePool,
  zhihuSmartEntityKey,
} from './candidatePool'
import { rankZhihuSmartRecommendations } from './recommendation'

export type ZhihuSmartRecallSource = 'android' | 'web' | 'hot' | 'following'

export interface ZhihuSmartRecallClient {
  fetch(
    source: ZhihuSmartRecallSource,
    cursor: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Page<ZhihuContentSummary>>
}

interface SmartSession {
  accountScope: string
  ordered: ZhihuContentSummary[]
  publicCandidates: ZhihuContentSummary[]
  privateCandidates: ZhihuContentSummary[]
  cursors: Partial<Record<ZhihuSmartRecallSource, string>>
}

interface RecallResult {
  source: ZhihuSmartRecallSource
  page: Page<ZhihuContentSummary>
}

const PAGE_SIZE = 20
const MIN_INITIAL_FRESH = 30
const MIN_INITIAL_POOL = 60
const SOURCES_PUBLIC: readonly ZhihuSmartRecallSource[] = ['android', 'web', 'hot']

function accountScope(accountId?: string | null): string {
  return accountId?.trim() || 'guest'
}

function smartCursor(offset: number): string {
  return `smart:${offset}`
}

function parseSmartCursor(cursor?: string): number {
  if (!cursor) return 0
  const match = /^smart:(\d+)$/.exec(cursor)
  if (!match) throw new ZhihuApiError('invalid-response', '智能推荐游标格式无效')
  return Math.max(0, Number(match[1]))
}

function uniqueItems(items: readonly ZhihuContentSummary[]): ZhihuContentSummary[] {
  const seen = new Set<string>()
  const result: ZhihuContentSummary[] = []
  for (const item of items) {
    const key = zhihuSmartEntityKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function hasCursor(session: SmartSession): boolean {
  return Object.values(session.cursors).some(Boolean)
}

export class ZhihuSmartRecommendationCoordinator {
  private readonly recall: ZhihuSmartRecallClient
  private readonly sessions = new Map<string, SmartSession>()

  constructor(recall: ZhihuSmartRecallClient) {
    this.recall = recall
  }

  async list(
    cursor: string | undefined,
    signal: AbortSignal | undefined,
    accountId?: string | null,
  ): Promise<Page<ZhihuContentSummary>> {
    const scope = accountScope(accountId)
    const offset = parseSmartCursor(cursor)
    let session = this.sessions.get(scope)

    if (!cursor || !session) {
      session = await this.createSession(scope, accountId, signal)
      this.sessions.set(scope, session)
    }

    if (session.accountScope !== scope) {
      session = await this.createSession(scope, accountId, signal)
      this.sessions.set(scope, session)
    }

    if (session.ordered.length - offset < PAGE_SIZE && hasCursor(session)) {
      await this.topUpSession(session, accountId, signal)
    }

    const items = session.ordered.slice(offset, offset + PAGE_SIZE)
    const nextOffset = offset + items.length
    const more = nextOffset < session.ordered.length || hasCursor(session)

    return {
      items,
      nextCursor: more ? smartCursor(nextOffset) : undefined,
      hasMore: more,
    }
  }

  reset(accountId?: string | null): void {
    this.sessions.delete(accountScope(accountId))
  }

  private enabledSources(accountId?: string | null): ZhihuSmartRecallSource[] {
    return accountId
      ? [...SOURCES_PUBLIC, 'following']
      : [...SOURCES_PUBLIC]
  }

  private async fetchRound(
    requests: Array<{ source: ZhihuSmartRecallSource; cursor?: string }>,
    signal: AbortSignal | undefined,
  ): Promise<{ successes: RecallResult[]; failures: unknown[] }> {
    const settled = await Promise.allSettled(
      requests.map(async ({ source, cursor }) => ({
        source,
        page: await this.recall.fetch(source, cursor, signal),
      })),
    )
    const successes: RecallResult[] = []
    const failures: unknown[] = []
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        successes.push(result.value)
      } else {
        failures.push(result.reason)
      }
    }
    return { successes, failures }
  }

  private mergeRecall(
    session: SmartSession,
    results: readonly RecallResult[],
    previousCursors: Partial<Record<ZhihuSmartRecallSource, string>> = {},
  ): ZhihuContentSummary[] {
    const publicItems: ZhihuContentSummary[] = []
    const privateItems: ZhihuContentSummary[] = []

    for (const { source, page } of results) {
      const previous = previousCursors[source]
      const next = page.hasMore && page.nextCursor && page.nextCursor !== previous
        ? page.nextCursor
        : undefined

      if (next) session.cursors[source] = next
      else delete session.cursors[source]

      if (source === 'following') {
        privateItems.push(...page.items)
      } else {
        publicItems.push(...page.items)
      }
    }

    if (publicItems.length > 0) {
      session.publicCandidates = uniqueItems([...session.publicCandidates, ...publicItems])
      mergeZhihuSmartCandidatePool(publicItems)
    }

    if (privateItems.length > 0) {
      session.privateCandidates = uniqueItems([
        ...session.privateCandidates,
        ...privateItems,
      ])
    }

    return uniqueItems([...publicItems, ...privateItems])
  }

  private rankedCandidates(
    session: SmartSession,
    accountId?: string | null,
  ): ZhihuContentSummary[] {
    const publicPool = uniqueItems([
      ...session.publicCandidates,
      ...loadZhihuSmartCandidatePool().map((record) => record.item),
    ])
    // 关注动态只驻留当前内存会话，不进入公共 localStorage。放在前面可让重复实体保留
    // “following”来源语义，同时依旧受本地曝光疲劳与多样性重排约束。
    return rankZhihuSmartRecommendations(
      uniqueItems([...session.privateCandidates, ...publicPool]),
      accountId,
    )
  }

  private async createSession(
    scope: string,
    accountId: string | null | undefined,
    signal: AbortSignal | undefined,
  ): Promise<SmartSession> {
    const session: SmartSession = {
      accountScope: scope,
      ordered: [],
      publicCandidates: [],
      privateCandidates: [],
      cursors: {},
    }
    const sources = this.enabledSources(accountId)
    const first = await this.fetchRound(sources.map((source) => ({ source })), signal)

    if (first.successes.length === 0 && loadZhihuSmartCandidatePool().length === 0) {
      const cause = first.failures[0]
      if (cause instanceof Error) throw cause
      throw new ZhihuApiError('network', '智能推荐候选读取失败')
    }

    const fresh = this.mergeRecall(session, first.successes)
    const poolSize = uniqueItems([
      ...session.publicCandidates,
      ...loadZhihuSmartCandidatePool().map((record) => record.item),
      ...session.privateCandidates,
    ]).length

    // 冷启动或上游第一页高度重复时，只做一轮有界补池。正常情况下不会发生第二轮请求。
    if ((fresh.length < MIN_INITIAL_FRESH || poolSize < MIN_INITIAL_POOL) && hasCursor(session)) {
      const requests = Object.entries(session.cursors)
        .map(([source, next]) => ({ source: source as ZhihuSmartRecallSource, cursor: next }))
      const previous = { ...session.cursors }
      const second = await this.fetchRound(requests, signal)
      this.mergeRecall(session, second.successes, previous)
      for (const failure of second.failures) {
        log.feed.debug('zhihu smart recall top-up failed', failure)
      }
    }

    for (const failure of first.failures) {
      log.feed.debug('zhihu smart recall source failed', failure)
    }

    session.ordered = this.rankedCandidates(session, accountId)
    return session
  }

  private async topUpSession(
    session: SmartSession,
    accountId: string | null | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const requests = Object.entries(session.cursors)
      .map(([source, next]) => ({ source: source as ZhihuSmartRecallSource, cursor: next }))
    if (requests.length === 0) return

    const previous = { ...session.cursors }
    const round = await this.fetchRound(requests, signal)
    this.mergeRecall(session, round.successes, previous)

    for (const failure of round.failures) {
      log.feed.debug('zhihu smart recall pagination source failed', failure)
    }

    const existing = new Set(session.ordered.map(zhihuSmartEntityKey))
    const additions = this.rankedCandidates(session, accountId)
      .filter((item) => !existing.has(zhihuSmartEntityKey(item)))

    // 已经显示过的稳定前缀永不重排；新增候选只追加到尾部。
    session.ordered.push(...additions)
  }
}
