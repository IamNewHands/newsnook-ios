import { useEffect, useState } from 'react'
import { Bookmark, Loader2, Plus, Trash2 } from 'lucide-react'

import type { ZhihuCollectionSummary, ZhihuInteractionService } from '../interaction/service'
import { canExecuteZhihuOperation } from '../protocol'

interface Props {
  urlToken: string
  service: ZhihuInteractionService
  onOpenCollection: (collectionId: string) => void
}

function mergeCollections(previous: ZhihuCollectionSummary[], incoming: ZhihuCollectionSummary[]) {
  const seen = new Set(previous.map((item) => item.id))
  return [...previous, ...incoming.filter((item) => !seen.has(item.id))]
}

export function ZhihuAccountCollectionsScreen({ urlToken, service, onOpenCollection }: Props) {
  const [items, setItems] = useState<ZhihuCollectionSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [error, setError] = useState<string | null>(null)

  const createWritable = canExecuteZhihuOperation('collection.create')
  const deleteWritable = canExecuteZhihuOperation('collection.delete')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setItems([])
    setNextCursor(undefined)
    void service.listAccountCollections(urlToken, undefined, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return
        setItems(page.items)
        setNextCursor(page.nextCursor)
      },
      (reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取收藏夹失败')
      },
    ).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [service, urlToken])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const page = await service.listAccountCollections(urlToken, nextCursor)
      setItems((prev) => mergeCollections(prev, page.items))
      setNextCursor(page.nextCursor)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载更多收藏夹失败')
    } finally {
      setLoadingMore(false)
    }
  }

  const create = async () => {
    const title = newTitle.trim()
    if (!title || !createWritable || busyId) return
    setBusyId('__create__')
    setError(null)
    try {
      const created = await service.createCollection(title)
      setItems((prev) => [created, ...prev.filter((item) => item.id !== created.id)])
      setNewTitle('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建收藏夹失败')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (collection: ZhihuCollectionSummary) => {
    if (!deleteWritable || collection.isDefault || busyId) return
    if (!window.confirm(`删除收藏夹“${collection.title}”？此操作不会删除其中的知乎内容。`)) return
    setBusyId(collection.id)
    setError(null)
    try {
      await service.deleteCollection(collection)
      setItems((prev) => prev.filter((item) => item.id !== collection.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除收藏夹失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      <header className="rounded-2xl border border-haze/70 bg-ink-raised/55 p-4">
        <div className="flex items-center gap-2">
          <Bookmark size={18} className="text-cinnabar" />
          <h1 className="font-display text-[20px] font-semibold text-paper">我的收藏夹</h1>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-paper-faint">创建、查看和管理你的知乎收藏夹。</p>
        <div className="mt-3 flex gap-2">
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            disabled={!createWritable}
            maxLength={80}
            placeholder={createWritable ? '新收藏夹名称' : '当前版本暂不可创建'}
            className="min-h-10 min-w-0 flex-1 rounded-xl border border-haze/70 bg-ink px-3 text-[12px] text-paper outline-none focus:border-cinnabar/50 disabled:opacity-45"
          />
          <button
            type="button"
            disabled={!createWritable || !newTitle.trim() || Boolean(busyId)}
            onClick={() => void create()}
            title={createWritable ? undefined : '当前版本暂不可创建收藏夹'}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-cinnabar px-3 text-[11px] text-white disabled:opacity-40"
          >
            {busyId === '__create__' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}新建
          </button>
        </div>
      </header>

      {error && <div role="alert" className="mt-3 rounded-xl border border-cinnabar/35 bg-cinnabar/8 p-3 text-[11px] text-paper-muted">{error}</div>}
      {loading && <div className="py-14 text-center font-mono text-[10.5px] text-paper-faint">正在读取收藏夹…</div>}
      {!loading && items.length === 0 && !error && <div className="py-14 text-center text-[11px] text-paper-faint">没有可读取的收藏夹</div>}

      <div className="mt-3 space-y-2">
        {items.map((collection) => (
          <div key={collection.id} className="flex items-center gap-2 rounded-xl border border-haze/70 bg-ink-raised/50 p-3">
            <button type="button" onClick={() => onOpenCollection(collection.id)} className="min-w-0 flex-1 text-left">
              <div className="truncate text-[13px] font-medium text-paper">{collection.title}</div>
              <div className="mt-1 flex flex-wrap gap-2 font-mono text-[9px] text-paper-faint">
                {collection.isDefault && <span>默认</span>}
                <span>{collection.isPublic ? '公开' : '私密'}</span>
                {typeof collection.itemCount === 'number' && <span>{collection.itemCount} 项</span>}
              </div>
              {collection.description && <p className="mt-1 line-clamp-2 text-[10.5px] leading-5 text-paper-muted">{collection.description}</p>}
            </button>
            {!collection.isDefault && (
              <button
                type="button"
                disabled={!deleteWritable || Boolean(busyId)}
                onClick={() => void remove(collection)}
                title={deleteWritable ? '删除收藏夹' : '当前版本暂不可删除收藏夹'}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-paper-faint hover:bg-ink hover:text-cinnabar disabled:opacity-30"
                aria-label={`删除收藏夹 ${collection.title}`}
              >
                {busyId === collection.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
            )}
          </div>
        ))}
      </div>
      {nextCursor && (
        <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="mt-4 min-h-11 w-full rounded-xl border border-haze/70 bg-ink-raised font-mono text-[10.5px] text-paper-muted disabled:opacity-50">
          {loadingMore ? '正在加载…' : '加载更多收藏夹'}
        </button>
      )}
    </div>
  )
}
