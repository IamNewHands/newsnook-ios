import { useEffect, useState } from 'react'

import type { ZhihuPeopleProfile, ZhihuPeopleService } from '../people/service'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'

interface Props {
  token: string
  service: ZhihuPeopleService
  onOpen: (ref: ZhihuEntityRef) => void
}

type Tab = 'answers' | 'articles' | 'questions' | 'pins'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'answers', label: '回答' },
  { id: 'articles', label: '文章' },
  { id: 'questions', label: '提问' },
  { id: 'pins', label: '想法' },
]

export function ZhihuPeopleScreen({ token, service, onOpen }: Props) {
  const [profile, setProfile] = useState<ZhihuPeopleProfile | null>(null)
  const [tab, setTab] = useState<Tab>('answers')
  const [items, setItems] = useState<ZhihuContentSummary[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setItems([])
    setNextOffset(null)
    void Promise.all([
      service.read(token, controller.signal),
      service.listContent(token, tab, 0, controller.signal),
    ]).then(
      ([nextProfile, page]) => {
        if (controller.signal.aborted) return
        setProfile(nextProfile)
        setItems(page.items)
        setNextOffset(page.hasMore ? 20 : null)
        setLoading(false)
      },
      (reason) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : '读取用户页失败')
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [service, tab, token])

  const loadMore = () => {
    if (nextOffset == null || loadingMore) return
    const offset = nextOffset
    setLoadingMore(true)
    void service.listContent(token, tab, offset).then(
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
      {profile && (
        <header className="mb-5 rounded-2xl border border-haze/70 bg-ink-raised/55 p-4">
          <div className="flex items-start gap-3">
            {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" className="size-14 rounded-xl object-cover" loading="lazy" /> : null}
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-[22px] font-semibold text-paper">{profile.name}</h1>
              {profile.headline && <p className="mt-1 text-[12.5px] leading-6 text-paper-muted">{profile.headline}</p>}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] text-paper-faint">
            {typeof profile.followerCount === 'number' && <span>{profile.followerCount} 关注者</span>}
            {typeof profile.answerCount === 'number' && <span>{profile.answerCount} 回答</span>}
            {typeof profile.articleCount === 'number' && <span>{profile.articleCount} 文章</span>}
            {typeof profile.questionCount === 'number' && <span>{profile.questionCount} 提问</span>}
          </div>
          {profile.description && <p className="mt-3 whitespace-pre-wrap text-[12.5px] leading-6 text-paper-muted">{profile.description}</p>}
        </header>
      )}

      <div className="mb-3 grid grid-cols-4 gap-1 rounded-xl border border-haze/70 bg-ink-raised/70 p-1">
        {TABS.map((item) => (
          <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`min-h-9 rounded-lg font-mono text-[10.5px] ${tab === item.id ? 'bg-cinnabar text-white' : 'text-paper-muted hover:bg-ink'}`}>{item.label}</button>
        ))}
      </div>

      {loading && <div className="py-14 text-center font-mono text-[11px] text-paper-faint">正在读取用户内容…</div>}
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
