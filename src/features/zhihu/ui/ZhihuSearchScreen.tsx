import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Search } from 'lucide-react'

import { ZhihuApiError } from '../api/errors'
import type {
  ZhihuSearchContentType,
  ZhihuSearchSort,
  ZhihuSearchTab,
  ZhihuSearchTimeRange,
} from '../api/endpoints'
import type { ZhihuFeedService } from '../feed/service'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'

interface Props {
  initialQuery: string
  service: ZhihuFeedService
  onQueryChange: (query: string) => void
  onOpen: (ref: ZhihuEntityRef) => void
}

export function ZhihuSearchScreen({ initialQuery, service, onQueryChange, onOpen }: Props) {
  const [input, setInput] = useState(initialQuery)
  const [query, setQuery] = useState(initialQuery)
  const [tab, setTab] = useState<ZhihuSearchTab>('general')
  const [sort, setSort] = useState<ZhihuSearchSort>('default')
  const [contentType, setContentType] = useState<ZhihuSearchContentType>('all')
  const [timeRange, setTimeRange] = useState<ZhihuSearchTimeRange>('all')
  const [items, setItems] = useState<ZhihuContentSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const epoch = useRef(0)

  useEffect(() => {
    if (!query.trim()) {
      setItems([])
      setNextCursor(undefined)
      setError(null)
      return
    }
    const request = ++epoch.current
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void service.search(query, undefined, controller.signal, { tab, sort, contentType, timeRange }).then(
      (page) => {
        if (request !== epoch.current) return
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setLoading(false)
      },
      (reason) => {
        if (controller.signal.aborted || request !== epoch.current) return
        const apiError = reason instanceof ZhihuApiError ? reason : null
        setError(apiError?.message ?? (reason instanceof Error ? reason.message : '搜索失败'))
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [contentType, query, service, sort, tab, timeRange])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = input.trim()
    setQuery(next)
    onQueryChange(next)
  }

  const loadMore = () => {
    if (!nextCursor || loadingMore || !query.trim()) return
    const cursor = nextCursor
    const request = epoch.current
    setLoadingMore(true)
    setError(null)
    void service.search(query, cursor, undefined, { tab, sort, contentType, timeRange }).then(
      (page) => {
        if (request !== epoch.current) return
        setItems((prev) => {
          const seen = new Set(prev.map((item) => `${item.ref.kind}:${item.ref.id}`))
          return [...prev, ...page.items.filter((item) => !seen.has(`${item.ref.kind}:${item.ref.id}`))]
        })
        setNextCursor(page.nextCursor)
        setLoadingMore(false)
      },
      (reason) => {
        if (request !== epoch.current) return
        setError(reason instanceof Error ? reason.message : '加载更多失败')
        setLoadingMore(false)
      },
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4 sm:px-6">
      <form onSubmit={submit} className="flex gap-2">
        <label className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-haze/80 bg-ink-raised px-3 focus-within:border-cinnabar/50">
          <Search size={16} className="shrink-0 text-paper-faint" />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="搜索问题、回答、用户…"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-paper outline-hidden placeholder:text-paper-faint"
          />
        </label>
        <button type="submit" className="min-h-11 rounded-xl bg-cinnabar px-4 font-mono text-[11px] font-medium text-white">
          搜索
        </button>
      </form>

      <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl border border-haze/70 bg-ink-raised/65 p-1">
        {([['general', '全站'], ['people', '用户'], ['topic', '话题']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`min-h-9 rounded-lg font-mono text-[10.5px] ${tab === value ? 'bg-cinnabar text-white' : 'text-paper-muted hover:bg-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="rounded-xl border border-haze/70 bg-ink-raised px-3 py-2">
            <span className="block font-mono text-[8.5px] tracking-wide text-paper-faint">排序</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as ZhihuSearchSort)} className="mt-1 w-full bg-transparent text-[11px] text-paper outline-none">
              <option value="default">综合排序</option>
              <option value="latest">最新发布</option>
              <option value="most-voted">最多赞同</option>
            </select>
          </label>
          <label className="rounded-xl border border-haze/70 bg-ink-raised px-3 py-2">
            <span className="block font-mono text-[8.5px] tracking-wide text-paper-faint">内容</span>
            <select value={contentType} onChange={(event) => setContentType(event.target.value as ZhihuSearchContentType)} className="mt-1 w-full bg-transparent text-[11px] text-paper outline-none">
              <option value="all">全部内容</option>
              <option value="answer">回答</option>
              <option value="article">文章</option>
            </select>
          </label>
          <label className="rounded-xl border border-haze/70 bg-ink-raised px-3 py-2">
            <span className="block font-mono text-[8.5px] tracking-wide text-paper-faint">时间</span>
            <select value={timeRange} onChange={(event) => setTimeRange(event.target.value as ZhihuSearchTimeRange)} className="mt-1 w-full bg-transparent text-[11px] text-paper outline-none">
              <option value="all">不限时间</option>
              <option value="day">一天内</option>
              <option value="week">一周内</option>
              <option value="month">一个月内</option>
              <option value="three-months">三个月内</option>
              <option value="half-year">半年内</option>
              <option value="year">一年内</option>
            </select>
          </label>
        </div>
      )}

      {loading && <div className="py-12 text-center font-mono text-[11px] text-paper-faint">正在搜索…</div>}
      {error && <div role="alert" className="mt-4 rounded-xl border border-cinnabar/35 bg-cinnabar/8 p-3 text-[12px] text-paper-muted">{error}</div>}
      {!loading && query && !error && items.length === 0 && (
        <div className="py-12 text-center text-[13px] text-paper-faint">没有找到可解析的结果</div>
      )}
      <div className="mt-4 space-y-2.5">
        {items.map((item) => (
          <button
            key={`${item.ref.kind}:${item.ref.id}`}
            type="button"
            onClick={() => onOpen(item.ref)}
            className="block w-full rounded-2xl border border-haze/70 bg-ink-raised/55 p-4 text-left hover:border-cinnabar/35"
          >
            <h2 className="font-display text-[16px] font-semibold leading-7 text-paper">{item.title}</h2>
            {item.excerpt && <p className="mt-1 line-clamp-2 text-[12.5px] leading-6 text-paper-muted">{item.excerpt}</p>}
            <div className="mt-2 font-mono text-[9.5px] uppercase tracking-wide text-paper-faint">{item.ref.kind}</div>
          </button>
        ))}
      </div>
      {nextCursor && items.length > 0 && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-4 min-h-11 w-full rounded-xl border border-haze/70 bg-ink-raised font-mono text-[11px] text-paper-muted disabled:opacity-50"
        >
          {loadingMore ? '正在加载…' : '加载更多'}
        </button>
      )}
    </div>
  )
}
