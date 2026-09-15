import { useEffect, useState } from 'react'
import { Browser } from '@capacitor/browser'
import { Bell, CheckCheck, Loader2, MessageCircle } from 'lucide-react'

import { parseZhihuLink, parseZhihuMessagePeerId } from '../content/links'
import type {
  ZhihuNotificationCategory,
  ZhihuNotificationItem,
  ZhihuNotificationService,
} from '../notification/service'
import { mergeZhihuNotificationItems } from '../notification/service'
import type { ZhihuEntityRef } from '../types'
import { canExecuteZhihuOperation } from '../protocol'

interface Props {
  service: ZhihuNotificationService
  onOpen: (ref: ZhihuEntityRef) => void
  onMessage: (peerId: string) => void
}

const CATEGORIES: Array<{ id: ZhihuNotificationCategory; label: string }> = [
  { id: 'comment', label: '评论转发@' },
  { id: 'like', label: '赞同喜欢' },
  { id: 'favlist_me', label: '收藏了我' },
  { id: 'follow', label: '关注订阅' },
]

function notificationTime(value?: number): string {
  if (!value) return ''
  const date = new Date(value < 10_000_000_000 ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ZhihuNotificationScreen({ service, onOpen, onMessage }: Props) {
  const readAllWritable = canExecuteZhihuOperation('notification.readall')
  const [activeCategory, setActiveCategory] = useState<ZhihuNotificationCategory | null>(null)
  const [items, setItems] = useState<ZhihuNotificationItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [unread, setUnread] = useState<Record<ZhihuNotificationCategory, number>>({ comment: 0, like: 0, favlist_me: 0, follow: 0 })
  const [messageUnread, setMessageUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [marking, setMarking] = useState<ZhihuNotificationCategory | 'all' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        if (activeCategory) {
          const page = await service.timeline(activeCategory, undefined, controller.signal)
          if (controller.signal.aborted) return
          setItems(page.items)
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
          return
        }
        const page = await service.overview(undefined, controller.signal)
        if (controller.signal.aborted) return
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setHasMore(page.hasMore)
        setUnread(page.unread)
        setMessageUnread(page.messageUnread)
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取知乎通知失败')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [activeCategory, service])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const page = activeCategory
        ? await service.timeline(activeCategory, nextCursor)
        : await service.overview(nextCursor)
      setItems((prev) => mergeZhihuNotificationItems(prev, page.items))
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载更多通知失败')
    } finally {
      setLoadingMore(false)
    }
  }

  const markCategory = async (category: ZhihuNotificationCategory) => {
    if (marking) return
    setMarking(category)
    setError(null)
    try {
      await service.markCategoryRead(category)
      setUnread((prev) => ({ ...prev, [category]: 0 }))
      if (activeCategory === category) setItems((prev) => prev.map((item) => ({ ...item, unread: false })))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '标记已读失败')
    } finally {
      setMarking(null)
    }
  }

  const markAll = async () => {
    if (marking) return
    setMarking('all')
    setError(null)
    try {
      for (const category of CATEGORIES) {
        if (unread[category.id] > 0) {
          await service.markCategoryRead(category.id)
          setUnread((prev) => ({ ...prev, [category.id]: 0 }))
        }
      }
      setItems((prev) => prev.map((item) => ({ ...item, unread: false })))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '标记全部已读失败')
    } finally {
      setMarking(null)
    }
  }

  const openItem = (item: ZhihuNotificationItem) => {
    const peerId = item.targetUrl ? parseZhihuMessagePeerId(item.targetUrl) : null
    if (peerId) {
      onMessage(peerId)
      return
    }
    const ref = item.targetUrl ? parseZhihuLink(item.targetUrl) : null
    if (ref) {
      onOpen(ref)
      return
    }
    if (item.author?.id) {
      onOpen({ kind: 'people', id: item.author.token || item.author.id })
      return
    }
    if (item.targetUrl) void Browser.open({ url: item.targetUrl }).catch(() => undefined)
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-semibold text-paper">通知</h1>
          <p className="mt-1 font-mono text-[10px] text-paper-faint">评论、赞同、关注与私信</p>
        </div>
        <button type="button" disabled={!readAllWritable || Boolean(marking)} onClick={() => void markAll()} title={readAllWritable ? undefined : '当前版本暂不可标记已读'} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-haze/70 px-3 font-mono text-[10px] text-paper-muted disabled:opacity-40">
          {marking === 'all' ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={13} />}全部已读
        </button>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setActiveCategory(null)}
          className={`min-w-[76px] rounded-xl border p-3 text-left ${activeCategory == null ? 'border-cinnabar/50 bg-cinnabar/8' : 'border-haze/70 bg-ink-raised/55'}`}
        >
          <span className="block text-[11px] text-paper-muted">全部</span>
          <span className="mt-1 block font-mono text-[15px] text-paper">{Object.values(unread).reduce((sum, value) => sum + value, 0)}</span>
        </button>
        {CATEGORIES.map((category) => (
          <button key={category.id} type="button" onClick={() => setActiveCategory(category.id)} className={`min-w-[102px] rounded-xl border p-3 text-left ${activeCategory === category.id ? 'border-cinnabar/50 bg-cinnabar/8' : 'border-haze/70 bg-ink-raised/55'}`}>
            <span className="block text-[11px] text-paper-muted">{category.label}</span>
            <span className="mt-1 block font-mono text-[15px] text-paper">{unread[category.id]}</span>
          </button>
        ))}
      </div>

      {activeCategory && unread[activeCategory] > 0 && (
        <div className="mb-3 flex justify-end">
          <button type="button" disabled={!readAllWritable || Boolean(marking)} onClick={() => void markCategory(activeCategory)} title={readAllWritable ? undefined : '当前版本暂不可标记已读'} className="min-h-9 rounded-xl border border-haze/70 px-3 font-mono text-[10px] text-paper-muted disabled:opacity-40">
            {marking === activeCategory ? '正在标记…' : '标记当前分类已读'}
          </button>
        </div>
      )}

      {messageUnread > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-cinnabar/25 bg-cinnabar/5 px-3 py-2 text-[11px] text-paper-muted">
          <MessageCircle size={14} className="text-cinnabar" />有 {messageUnread} 条私信未读，点击下方私信条目即可进入会话。
        </div>
      )}
      {error && <div role="alert" className="mb-3 rounded-xl border border-cinnabar/35 bg-cinnabar/8 p-3 text-[12px] text-paper-muted">{error}</div>}
      {loading && <div className="py-16 text-center font-mono text-[11px] text-paper-faint">正在读取知乎通知…</div>}
      {!loading && items.length === 0 && (
        <div className="py-16 text-center text-paper-faint"><Bell size={24} className="mx-auto mb-2 opacity-60" /><p className="text-[12px]">暂无通知</p></div>
      )}
      <div className="space-y-2.5">
        {items.map((item) => (
          <button key={item.id} type="button" onClick={() => openItem(item)} className="flex w-full gap-3 rounded-xl border border-haze/70 bg-ink-raised/55 p-3.5 text-left hover:border-cinnabar/35">
            {item.author?.avatarUrl ? <img src={item.author.avatarUrl} alt="" className="size-10 shrink-0 rounded-lg object-cover" loading="lazy" /> : <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ink"><Bell size={15} className="text-paper-faint" /></div>}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[12.5px] font-medium text-paper">{item.title}</span>
                {item.unread && <span className="size-1.5 shrink-0 rounded-full bg-cinnabar" />}
                <span className="ml-auto shrink-0 font-mono text-[9px] text-paper-faint">{notificationTime(item.createdAt)}</span>
              </span>
              {item.text && <span className="mt-1 block line-clamp-3 text-[11.5px] leading-5 text-paper-muted">{item.text}</span>}
            </span>
          </button>
        ))}
      </div>
      {hasMore && <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-haze/70 font-mono text-[11px] text-paper-muted disabled:opacity-50">{loadingMore && <Loader2 size={13} className="animate-spin" />}{loadingMore ? '加载中…' : '加载更多'}</button>}
    </div>
  )
}
