import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Pencil, Tag, Trash2, X } from 'lucide-react'

import { useHardwareBackLayer } from '../../../hooks/useHardwareBackLayer'
import type { ZhihuAuthor } from '../types'
import { ZhihuRemarkStore, zhihuRemarkIdentity } from '../remarks/store'
import { ZhihuRemarkContext, useZhihuUserRemark, type ZhihuRemarkContextValue } from '../remarks/context'

/** Keep the original Zhihu nickname visible; show personal notes beside it. */
export function ZhihuRemarkBadge({ author, compact = false }: { author: ZhihuAuthor; compact?: boolean }) {
  const remark = useZhihuUserRemark(author)
  if (!remark) return null
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 align-middle" title="仅保存在本机的知乎用户备注">
      {remark.name && (
        <span className="inline-block max-w-32 truncate rounded-md bg-sky-500/10 px-1.5 py-0.5 font-sans text-[10.5px] font-medium leading-tight text-sky-600 dark:text-sky-400">
          {remark.name}
        </span>
      )}
      {!compact && remark.tags.map((tag) => (
        <span key={tag} className="inline-block max-w-24 truncate rounded-md border border-haze/65 bg-paper/5 px-1.5 py-0.5 font-sans text-[10px] leading-tight text-paper-muted">
          {tag}
        </span>
      ))}
      {compact && !remark.name && remark.tags[0] && (
        <span className="inline-block max-w-24 truncate rounded-md bg-paper/5 px-1.5 py-0.5 font-sans text-[10px] leading-tight text-paper-muted">{remark.tags[0]}</span>
      )}
    </span>
  )
}

/** Separate control: author avatar and nickname retain their existing profile navigation. */
export function ZhihuRemarkEditButton({ author, className = '', showLabel = false }: { author: ZhihuAuthor; className?: string; showLabel?: boolean }) {
  const context = useContext(ZhihuRemarkContext)
  const remark = useZhihuUserRemark(author)
  if (!context || !zhihuRemarkIdentity(author)) return null
  return (
    <button
      type="button"
      onClick={() => context.edit(author)}
      aria-label={`${remark ? '编辑' : '添加'} ${author.name} 的本地备注`}
      title={remark ? '修改本地备注' : '添加本地备注'}
      className={`inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-lg px-1.5 font-sans text-[11px] text-paper-faint transition-colors hover:bg-paper/7 hover:text-sky-500 focus-visible:outline-2 focus-visible:outline-sky-500 ${className}`}
    >
      <Pencil size={13} strokeWidth={1.7} />
      {showLabel && <span>{remark ? '编辑备注' : '备注'}</span>}
    </button>
  )
}

function RemarkEditor({ author, store, onClose }: { author: ZhihuAuthor; store: ZhihuRemarkStore; onClose: () => void }) {
  const identity = zhihuRemarkIdentity(author)
  const original = store.get(identity)
  const [name, setName] = useState(original?.name ?? '')
  const [tags, setTags] = useState(original?.tags.join('，') ?? '')
  const [error, setError] = useState<string | null>(null)
  useHardwareBackLayer(true, () => { onClose(); return true })
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const persist = (clear = false) => {
    try {
      store.save(identity, clear ? {} : { name, tags: tags.split(/[,，、;；\n]+/) })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本地备注保存失败')
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="zhihu-remark-heading" className="w-full max-w-sm rounded-2xl border border-haze bg-ink p-5 text-paper shadow-2xl">
        <div className="flex items-center justify-between gap-2">
          <h2 id="zhihu-remark-heading" className="font-sans text-[16px] font-semibold">本地用户备注</h2>
          <button type="button" aria-label="关闭备注编辑" onClick={onClose} className="flex size-9 items-center justify-center rounded-lg text-paper-faint hover:bg-paper/7 hover:text-paper"><X size={17} /></button>
        </div>
        <p className="mt-1.5 truncate font-sans text-[12px] text-paper-muted">知乎昵称：{author.name}</p>
        <p className="mt-1 text-[11px] text-paper-faint">仅当前知乎身份在本机可见，不修改昵称，也不会上传同步。</p>
        <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); persist() }}>
          <label className="block text-[12px] text-paper-muted">
            <span>备注名</span>
            <input autoFocus type="text" value={name} maxLength={64} onChange={(event) => setName(event.target.value)} placeholder="例如：技术答主" className="mt-1.5 block min-h-11 w-full rounded-xl border border-haze bg-ink-raised px-3 text-[13px] text-paper outline-none focus:border-sky-500/60" />
          </label>
          <label className="block text-[12px] text-paper-muted">
            <span className="flex items-center gap-1"><Tag size={12} /> 标签（最多 3 个）</span>
            <input type="text" value={tags} maxLength={100} onChange={(event) => setTags(event.target.value)} placeholder="专业、关注、营销" className="mt-1.5 block min-h-11 w-full rounded-xl border border-haze bg-ink-raised px-3 text-[13px] text-paper outline-none focus:border-sky-500/60" />
            <span className="mt-1 block text-[10.5px] text-paper-faint">用逗号分隔，不填则仅保存备注名。</span>
          </label>
          {error && <p role="alert" className="text-[12px] text-cinnabar">{error}</p>}
          <div className="flex items-center justify-between gap-2 pt-2">
            {original ? (
              <button type="button" onClick={() => persist(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-2 text-[12px] text-paper-faint hover:text-cinnabar"><Trash2 size={14} /> 清除</button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="min-h-10 rounded-xl px-3 text-[12px] text-paper-muted">取消</button>
              <button type="submit" className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-sky-500 px-4 text-[12px] font-medium text-white hover:bg-sky-600"><Check size={14} /> 保存</button>
            </div>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  )
}

export function ZhihuRemarkProvider({ accountId, children }: { accountId?: string; children: ReactNode }) {
  const store = useMemo(() => new ZhihuRemarkStore(accountId), [accountId])
  const [editing, setEditing] = useState<ZhihuAuthor | null>(null)
  const edit = useCallback((author: ZhihuAuthor) => setEditing(author), [])
  const close = useCallback(() => setEditing(null), [])
  const value = useMemo<ZhihuRemarkContextValue>(() => ({ store, edit }), [store, edit])
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === store.storageKey) store.reload()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [store])
  return (
    <ZhihuRemarkContext.Provider value={value}>
      {children}
      {editing && <RemarkEditor key={zhihuRemarkIdentity(editing)} author={editing} store={store} onClose={close} />}
    </ZhihuRemarkContext.Provider>
  )
}
