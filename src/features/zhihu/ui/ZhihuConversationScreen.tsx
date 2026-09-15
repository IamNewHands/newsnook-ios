import { useEffect, useState } from 'react'
import { Loader2, MessageCircle, Send } from 'lucide-react'

import type {
  ZhihuMessagePeer,
  ZhihuNotificationService,
  ZhihuPrivateMessage,
} from '../notification/service'
import type { ZhihuMessageDraftStore } from '../notification/draftStore'
import { isZhihuOperationEnabled } from '../protocol'

interface Props {
  peerId: string
  accountId?: string
  service: ZhihuNotificationService
  draftStore: ZhihuMessageDraftStore
}

function messageTime(value?: number): string {
  if (!value) return ''
  const date = new Date(value < 10_000_000_000 ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ZhihuConversationScreen({ peerId, accountId, service, draftStore }: Props) {
  const sendWritable = isZhihuOperationEnabled('message.send')
  const [peer, setPeer] = useState<ZhihuMessagePeer | null>(null)
  const [items, setItems] = useState<ZhihuPrivateMessage[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftHydrated, setDraftHydrated] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void Promise.all([
      service.readPeer(peerId, controller.signal),
      service.conversation(peerId, undefined, controller.signal),
    ]).then(
      ([nextPeer, page]) => {
        if (controller.signal.aborted) return
        setPeer(nextPeer)
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setHasMore(page.hasMore)
      },
      (reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取私信失败')
      },
    ).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [peerId, service])

  useEffect(() => {
    let disposed = false
    setDraftHydrated(false)
    if (!accountId) {
      setDraft('')
      setDraftHydrated(true)
      return () => { disposed = true }
    }
    void draftStore.load(accountId, peerId).then(
      (content) => {
        if (disposed) return
        setDraft(content)
        setDraftHydrated(true)
      },
      () => {
        if (disposed) return
        setDraft('')
        setDraftHydrated(true)
      },
    )
    return () => { disposed = true }
  }, [accountId, draftStore, peerId])

  useEffect(() => {
    if (!draftHydrated || !accountId) return
    const timer = window.setTimeout(() => {
      void draftStore.save(accountId, peerId, draft).catch(() => undefined)
    }, 450)
    return () => window.clearTimeout(timer)
  }, [accountId, draft, draftHydrated, draftStore, peerId])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await service.conversation(peerId, nextCursor)
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.id))
        return [...prev, ...page.items.filter((item) => !seen.has(item.id))]
      })
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载更多私信失败')
    } finally {
      setLoadingMore(false)
    }
  }

  const send = async () => {
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    setError(null)
    try {
      const message = await service.sendMessage(peerId, content)
      setItems((prev) => prev.some((item) => item.id === message.id) ? prev : [message, ...prev])
      if (accountId) await draftStore.clear(accountId, peerId).catch(() => undefined)
      setDraft('')
    } catch (reason) {
      // 非幂等发送永不自动重试；输入必须保留，让用户明确决定是否再次发送。
      setError(reason instanceof Error ? reason.message : '私信发送失败；输入已保留')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-28 pt-5 sm:px-6">
      <header className="mb-4 flex items-center gap-3 rounded-2xl border border-haze/70 bg-ink-raised/55 p-3.5">
        {peer?.avatarUrl ? <img src={peer.avatarUrl} alt="" className="size-11 rounded-xl object-cover" /> : <div className="flex size-11 items-center justify-center rounded-xl bg-ink"><MessageCircle size={18} className="text-paper-faint" /></div>}
        <div className="min-w-0 flex-1"><h1 className="truncate font-display text-[18px] font-semibold text-paper">{peer?.name || '私信'}</h1>{peer?.headline && <p className="mt-0.5 truncate text-[11px] text-paper-faint">{peer.headline}</p>}</div>
      </header>
      {error && <div role="alert" className="mb-3 rounded-xl border border-cinnabar/35 bg-cinnabar/8 p-3 text-[12px] text-paper-muted">{error}</div>}
      {loading && <div className="py-16 text-center font-mono text-[11px] text-paper-faint">正在读取私信…</div>}
      <div className="space-y-2.5">
        {items.map((message) => {
          const mine = Boolean(accountId && message.sender?.id === accountId)
          return (
            <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 ${mine ? 'bg-cinnabar text-white' : 'border border-haze/70 bg-ink-raised text-paper'}`}>
                <div className="whitespace-pre-wrap break-words text-[12.5px] leading-6">{message.content}</div>
                <div className={`mt-1 font-mono text-[8.5px] ${mine ? 'text-white/65' : 'text-paper-faint'}`}>{messageTime(message.createdAt)}</div>
              </div>
            </div>
          )
        })}
      </div>
      {hasMore && <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-haze/70 font-mono text-[11px] text-paper-muted disabled:opacity-50">{loadingMore && <Loader2 size={13} className="animate-spin" />}{loadingMore ? '加载中…' : '加载更早消息'}</button>}
      <div className="sticky bottom-14 mt-4 flex items-end gap-2 border-t border-haze/70 bg-ink/95 py-3" style={{ paddingBottom: 'calc(var(--sab) + 0.5rem)' }}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={sending}
          rows={1}
          maxLength={10_000}
          placeholder="发私信"
          className="min-h-11 max-h-32 min-w-0 flex-1 resize-y rounded-xl border border-haze/70 bg-ink-raised px-3 py-2.5 text-[12.5px] leading-5 text-paper outline-none focus:border-cinnabar/50 disabled:opacity-60"
        />
        <button
          type="button"
          disabled={!sendWritable || sending || !draft.trim()}
          onClick={() => void send()}
          aria-label="发送私信"
          title={sendWritable ? undefined : '当前版本暂不可发送私信'}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-cinnabar text-white disabled:opacity-40"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
      {!sendWritable && <p className="-mt-2 pb-2 font-mono text-[9.5px] text-paper-faint">当前版本暂不可发送私信；输入会自动保存在本机草稿中。</p>}
    </div>
  )
}
