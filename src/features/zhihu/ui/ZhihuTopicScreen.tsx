import { useEffect, useState } from 'react'

import type { ZhihuTopicDetail, ZhihuTopicService } from '../topic/service'
import type { ZhihuInteractionService } from '../interaction/service'
import { canExecuteZhihuOperation } from '../protocol'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'

interface Props {
  topicId: string
  service: ZhihuTopicService
  onOpen: (ref: ZhihuEntityRef) => void
  interaction: ZhihuInteractionService
  authenticated: boolean
}

export function ZhihuTopicScreen({ topicId, service, onOpen, interaction, authenticated }: Props) {
  const [detail, setDetail] = useState<ZhihuTopicDetail | null>(null)
  const [items, setItems] = useState<ZhihuContentSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [followBusy, setFollowBusy] = useState(false)
  const followWritable = canExecuteZhihuOperation(detail?.isFollowing ? 'follow.topic.clear' : 'follow.topic.set')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void Promise.all([
      service.read(topicId, controller.signal),
      service.listHot(topicId, undefined, controller.signal),
    ]).then(
      ([nextDetail, page]) => {
        if (controller.signal.aborted) return
        setDetail(nextDetail)
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setLoading(false)
      },
      (reason) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : '读取话题失败')
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [service, topicId])

  const loadMore = () => {
    if (!nextCursor || loadingMore) return
    const cursor = nextCursor
    setLoadingMore(true)
    void service.listHot(topicId, cursor).then(
      (page) => {
        setItems((prev) => {
          const seen = new Set(prev.map((item) => `${item.ref.kind}:${item.ref.id}`))
          return [...prev, ...page.items.filter((item) => !seen.has(`${item.ref.kind}:${item.ref.id}`))]
        })
        setNextCursor(page.nextCursor)
        setLoadingMore(false)
      },
      (reason) => {
        setError(reason instanceof Error ? reason.message : '加载更多失败')
        setLoadingMore(false)
      },
    )
  }

  const toggleFollow = async () => {
    if (!detail || !authenticated || followBusy) return
    const target = !detail.isFollowing
    setFollowBusy(true)
    setError(null)
    try {
      await interaction.setFollowing('topic', detail.id, target)
      setDetail((prev) => prev ? {
        ...prev,
        isFollowing: target,
        followersCount: typeof prev.followersCount === 'number'
          ? Math.max(0, prev.followersCount + (target ? 1 : -1))
          : prev.followersCount,
      } : prev)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '关注话题失败')
    } finally {
      setFollowBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      {detail && (
        <header className="mb-5 rounded-2xl border border-haze/70 bg-ink-raised/55 p-4">
          <div className="flex items-start gap-3">
            {detail.avatarUrl ? <img src={detail.avatarUrl} alt="" className="size-14 rounded-xl object-cover" loading="lazy" /> : null}
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[9.5px] tracking-[0.14em] text-cinnabar">TOPIC</div>
              <h1 className="mt-1 font-display text-[22px] font-semibold text-paper">{detail.name}</h1>
            </div>
            {authenticated && (
              <button type="button" disabled={followBusy || !followWritable} onClick={() => void toggleFollow()} title={followWritable ? undefined : '当前版本暂不可关注话题'} className={`min-h-9 shrink-0 rounded-xl px-3 font-mono text-[10.5px] ${detail.isFollowing ? 'border border-haze text-paper-muted' : 'bg-cinnabar text-white'} disabled:opacity-45`}>
                {followBusy ? '处理中…' : detail.isFollowing ? '已关注' : '关注话题'}
              </button>
            )}
          </div>
          {detail.excerpt && <p className="mt-3 text-[12.5px] leading-6 text-paper-muted">{detail.excerpt}</p>}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] text-paper-faint">
            {typeof detail.followersCount === 'number' && <span>{detail.followersCount} 关注者</span>}
            {typeof detail.questionsCount === 'number' && <span>{detail.questionsCount} 问题</span>}
            {typeof detail.discussCount === 'number' && <span>{detail.discussCount} 讨论</span>}
          </div>
        </header>
      )}
      <h2 className="mb-3 font-display text-[17px] font-semibold text-paper">热门讨论</h2>
      {loading && <div className="py-14 text-center font-mono text-[11px] text-paper-faint">正在读取话题…</div>}
      {error && <div role="alert" className="mb-3 rounded-xl border border-cinnabar/35 bg-cinnabar/8 p-3 text-[12px] text-paper-muted">{error}</div>}
      <div className="space-y-2.5">
        {items.map((item) => (
          <button key={`${item.ref.kind}:${item.ref.id}`} type="button" onClick={() => onOpen(item.ref)} className="block w-full rounded-xl border border-haze/70 bg-ink-raised/55 p-3.5 text-left hover:border-cinnabar/35">
            <div className="font-display text-[16px] font-semibold leading-7 text-paper">{item.title}</div>
            {item.excerpt && <p className="mt-1 line-clamp-3 text-[12.5px] leading-6 text-paper-muted">{item.excerpt}</p>}
          </button>
        ))}
      </div>
      {nextCursor && <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-4 min-h-11 w-full rounded-xl border border-haze/70 bg-ink-raised font-mono text-[11px] text-paper-muted disabled:opacity-50">{loadingMore ? '正在加载…' : '加载更多'}</button>}
    </div>
  )
}
