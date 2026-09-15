import { useEffect, useState } from 'react'
import { Bookmark, Check, Loader2, Plus, X } from 'lucide-react'

import type { ZhihuCollectionSummary, ZhihuInteractionService } from '../interaction/service'
import { canExecuteZhihuOperation } from '../protocol'
import type { ZhihuEntityRef } from '../types'

interface Props {
  refValue: ZhihuEntityRef
  service: ZhihuInteractionService
  authenticated: boolean
}

export function ZhihuCollectionPicker({ refValue, service, authenticated }: Props) {
  const supported = refValue.kind === 'answer' || refValue.kind === 'article'
  const membershipWritable = canExecuteZhihuOperation('collection.membership')
  const createWritable = canExecuteZhihuOperation('collection.create')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ZhihuCollectionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')

  useEffect(() => {
    if (!open || !authenticated || !supported) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void service.listContentCollections(refValue, controller.signal).then(
      (next) => {
        if (!controller.signal.aborted) setItems(next)
      },
      (reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取收藏夹失败')
      },
    ).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [authenticated, open, refValue, service, supported])

  if (!supported) return null

  const toggle = async (collection: ZhihuCollectionSummary) => {
    if (busyId) return
    setBusyId(collection.id)
    setError(null)
    const nextIncluded = !collection.isFavorited
    try {
      await service.setCollectionMembership(refValue, collection.id, nextIncluded)
      setItems((prev) => prev.map((item) => item.id === collection.id ? { ...item, isFavorited: nextIncluded } : item))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '收藏操作失败')
    } finally {
      setBusyId(null)
    }
  }

  const createAndAdd = async () => {
    const title = newTitle.trim()
    if (!title || busyId) return
    setBusyId('__new__')
    setError(null)
    try {
      const created = await service.createCollection(title)
      await service.setCollectionMembership(refValue, created.id, true)
      setItems((prev) => [{ ...created, isFavorited: true }, ...prev.filter((item) => item.id !== created.id)])
      setNewTitle('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建收藏夹失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={!authenticated || !membershipWritable}
        onClick={() => setOpen((value) => !value)}
        title={!authenticated ? '登录后可收藏' : !membershipWritable ? '当前版本暂不可收藏' : '收藏到知乎收藏夹'}
        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-haze/80 bg-ink-raised px-3.5 font-mono text-[11px] text-paper-muted disabled:opacity-40"
      >
        <Bookmark size={14} />收藏
      </button>
      {open && authenticated && (
        <div className="absolute left-0 top-12 z-30 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-haze/80 bg-ink-raised p-3 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="font-display text-[15px] font-semibold text-paper">收藏到</div>
            <button type="button" onClick={() => setOpen(false)} className="flex size-8 items-center justify-center rounded-lg text-paper-faint hover:bg-ink"><X size={14} /></button>
          </div>
          {error && <div className="mt-2 rounded-lg border border-cinnabar/30 bg-cinnabar/8 px-2.5 py-2 text-[10.5px] text-paper-muted">{error}</div>}
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {loading && <div className="py-6 text-center font-mono text-[10px] text-paper-faint">正在读取收藏夹…</div>}
            {!loading && items.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => void toggle(item)}
                className="flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 text-left hover:bg-ink disabled:opacity-50"
              >
                <span className={`flex size-5 items-center justify-center rounded border ${item.isFavorited ? 'border-cinnabar bg-cinnabar text-white' : 'border-haze text-transparent'}`}><Check size={12} /></span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-paper">{item.title}</span>
                {busyId === item.id && <Loader2 size={13} className="animate-spin text-paper-faint" />}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2 border-t border-haze/60 pt-2">
            <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={80} placeholder="新建收藏夹" className="min-w-0 flex-1 rounded-lg border border-haze/70 bg-ink px-2.5 text-[11px] text-paper outline-none focus:border-cinnabar/50" />
            <button type="button" disabled={!createWritable || !membershipWritable || !newTitle.trim() || Boolean(busyId)} onClick={() => void createAndAdd()} title={createWritable && membershipWritable ? undefined : '当前版本暂不可创建收藏夹'} className="flex size-9 items-center justify-center rounded-lg bg-cinnabar text-white disabled:opacity-40" aria-label="新建并收藏">{busyId === '__new__' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}</button>
          </div>
        </div>
      )}
    </div>
  )
}
