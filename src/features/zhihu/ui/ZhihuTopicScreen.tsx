import { useEffect, useState } from 'react'

import type { ZhihuTopicDetail, ZhihuTopicService } from '../topic/service'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'

interface Props {
  topicId: string
  service: ZhihuTopicService
  onOpen: (ref: ZhihuEntityRef) => void
}

export function ZhihuTopicScreen({ topicId, service, onOpen }: Props) {
  const [detail, setDetail] = useState<ZhihuTopicDetail | null>(null)
  const [items, setItems] = useState<ZhihuContentSummary[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void Promise.all([
      service.read(topicId, controller.signal),
      service.listHot(topicId, 0, controller.signal),
    ]).then(
      ([nextDetail, page]) => {
        if (controller.signal.aborted) return
        setDetail(nextDetail)
        setItems(page.items)
        setNextOffset(page.hasMore ? 20 : null)
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
    if (nextOffset == null || loadingMore) return
    const offset = nextOffset
    setLoadingMore(true)
    void service.listHot(topicId, offset).then(
      (page) => {
        setItems((prev) => {
          const seen = new Set(prev.map((item) => `${item.ref.kind}:${item.ref.id}`))
          return [...prev, ...page.items.filter((item) => !seen.has(`${item.ref.kind}:${item.ref.id}`))]
        })
        setNextOffset(page.hasMore ? offset + 20 : null)
        setLoadingMore(false)
      },
      (reason) => {
        setError(reason instanceof Error ? reason.message : '加载更多失败')
        setLoadingMore(false)
      },
    )
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
      {nextOffset != null && <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-4 min-h-11 w-full rounded-xl border border-haze/70 bg-ink-raised font-mono text-[11px] text-paper-muted disabled:opacity-50">{loadingMore ? '正在加载…' : '加载更多'}</button>}
    </div>
  )
}
