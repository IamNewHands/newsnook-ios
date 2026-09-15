import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import type { ZhihuCollectionDetail, ZhihuCollectionService } from '../collection/service'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'

interface Props {
  collectionId: string
  service: ZhihuCollectionService
  onOpen: (ref: ZhihuEntityRef) => void
}

export function ZhihuCollectionScreen({ collectionId, service, onOpen }: Props) {
  const [detail, setDetail] = useState<ZhihuCollectionDetail | null>(null)
  const [items, setItems] = useState<ZhihuContentSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void Promise.all([
      service.read(collectionId, controller.signal),
      service.items(collectionId, undefined, controller.signal),
    ]).then(
      ([nextDetail, page]) => {
        if (controller.signal.aborted) return
        setDetail(nextDetail)
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setHasMore(page.hasMore)
      },
      (reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取收藏夹失败')
      },
    ).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [collectionId, service])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const page = await service.items(collectionId, nextCursor)
      setItems((previous) => {
        const seen = new Set(previous.map((item) => `${item.ref.kind}:${item.ref.id}`))
        return [...previous, ...page.items.filter((item) => !seen.has(`${item.ref.kind}:${item.ref.id}`))]
      })
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载收藏夹更多内容失败')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      {detail && (
        <header className="mb-5 rounded-2xl border border-haze/70 bg-ink-raised/55 p-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-cinnabar">COLLECTION</div>
          <h1 className="mt-1 font-display text-[24px] font-semibold leading-9 text-paper">{detail.title}</h1>
          {detail.creator?.name && <div className="mt-1 text-[11.5px] text-paper-faint">{detail.creator.name}</div>}
          {detail.description && <p className="mt-3 whitespace-pre-wrap text-[12.5px] leading-6 text-paper-muted">{detail.description}</p>}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-paper-faint">
            {typeof detail.itemCount === 'number' && <span>{detail.itemCount} 条内容</span>}
            {typeof detail.followerCount === 'number' && <span>{detail.followerCount} 关注者</span>}
            {typeof detail.viewCount === 'number' && <span>{detail.viewCount} 浏览</span>}
            <span>{detail.isPublic ? '公开' : '非公开'}</span>
          </div>
        </header>
      )}

      {loading && <div className="py-16 text-center font-mono text-[11px] text-paper-faint">正在读取收藏夹…</div>}
      {error && <div role="alert" className="mb-3 rounded-xl border border-cinnabar/35 bg-cinnabar/8 p-3 text-[12px] text-paper-muted">{error}</div>}
      <div className="space-y-2.5">
        {items.map((item) => (
          <button
            key={`${item.ref.kind}:${item.ref.id}`}
            type="button"
            onClick={() => onOpen(item.ref)}
            className="block w-full rounded-2xl border border-haze/70 bg-ink-raised/55 p-4 text-left hover:border-cinnabar/35"
          >
            <h2 className="font-display text-[16px] font-semibold leading-7 text-paper">{item.title}</h2>
            {item.excerpt && <p className="mt-1 line-clamp-3 text-[12.5px] leading-6 text-paper-muted">{item.excerpt}</p>}
            <div className="mt-2 flex gap-3 font-mono text-[9.5px] text-paper-faint">
              {item.author?.name && <span>{item.author.name}</span>}
              {typeof item.voteupCount === 'number' && <span>{item.voteupCount} 赞同</span>}
              <span>{item.ref.kind}</span>
            </div>
          </button>
        ))}
      </div>
      {hasMore && nextCursor && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => void loadMore()}
          className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-haze/70 font-mono text-[11px] text-paper-muted disabled:opacity-50"
        >
          {loadingMore && <Loader2 size={13} className="animate-spin" />}
          {loadingMore ? '正在加载…' : '加载更多'}
        </button>
      )}
    </div>
  )
}
