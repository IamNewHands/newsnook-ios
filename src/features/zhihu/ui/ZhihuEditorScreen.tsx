import { useEffect, useRef, useState } from 'react'
import {
  Bold,
  Check,
  Code2,
  Copy,
  Heading2,
  Italic,
  Link2,
  List,
  Loader2,
  ImagePlus,
  Quote,
  RotateCcw,
  Save,
  Send,
  Trash2,
} from 'lucide-react'

import { sanitizeArticleHtml } from '../../../lib/sanitize'
import type { ZhihuDraftStore } from '../editor/draftStore'
import type { ZhihuEditorService, ZhihuPublishResult } from '../editor/service'
import { createZhihuLocalId, type ZhihuDraftSnapshot } from '../editor/schema'
import type { ZhihuImageUploadService } from '../editor/upload'
import { canExecuteZhihuOperation } from '../protocol'
import type { ZhihuEntityRef } from '../types'

interface Props {
  accountId: string
  localDraftId: string
  store: ZhihuDraftStore
  service: ZhihuEditorService
  uploadService: ZhihuImageUploadService
  onOpenDraft: (localDraftId: string) => void
  onPublished: (ref: ZhihuEntityRef) => void
  onDeleted: () => void
}

function draftLabel(draft: ZhihuDraftSnapshot): string {
  if (draft.kind === 'answer') return `回答 · 问题 ${draft.targetId ?? '未知'}`
  return draft.title?.trim() ? `想法 · ${draft.title.trim()}` : '想法'
}

function stateLabel(draft: ZhihuDraftSnapshot): string {
  switch (draft.publishState) {
    case 'remote-draft': return '远端草稿已保存'
    case 'publishing': return '正在发布'
    case 'unknown': return '发布结果待确认'
    case 'published': return '已发布'
    case 'failed': return '上次发布失败'
    default: return '仅本机草稿'
  }
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function DraftManager({ accountId, store, onOpenDraft }: Pick<Props, 'accountId' | 'store' | 'onOpenDraft'>) {
  const [items, setItems] = useState<ZhihuDraftSnapshot[]>([])
  const [questionId, setQuestionId] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void store.list(accountId).then((value) => alive && setItems(value), (reason) => alive && setError(reason instanceof Error ? reason.message : '读取本机草稿失败'))
    return () => { alive = false }
  }, [accountId, store])

  const create = async (kind: 'answer' | 'pin') => {
    if (creating) return
    const target = kind === 'answer' ? questionId.trim() : undefined
    if (kind === 'answer' && !target) {
      setError('创建回答草稿需要问题 ID')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const draft = await store.create(accountId, kind, target)
      onOpenDraft(draft.localDraftId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建草稿失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      <div className="rounded-2xl border border-haze/70 bg-ink-raised/60 p-4">
        <h1 className="font-display text-[20px] font-semibold text-paper">创作与草稿</h1>
        <p className="mt-1 text-[11px] leading-5 text-paper-faint">继续已有草稿，或新建回答和想法。</p>
        {error && <div role="alert" className="mt-3 rounded-xl border border-cinnabar/30 bg-cinnabar/8 p-3 text-[11px] text-paper-muted">{error}</div>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={creating} onClick={() => void create('pin')} className="min-h-10 rounded-xl bg-cinnabar px-4 text-[12px] font-medium text-white disabled:opacity-45">新建想法</button>
          <div className="flex min-w-[240px] flex-1 gap-2">
            <input value={questionId} onChange={(event) => setQuestionId(event.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="问题 ID" className="min-w-0 flex-1 rounded-xl border border-haze/70 bg-ink px-3 text-[12px] text-paper outline-none focus:border-cinnabar/50" />
            <button type="button" disabled={creating || !questionId.trim()} onClick={() => void create('answer')} className="min-h-10 rounded-xl border border-haze/80 px-4 text-[12px] text-paper-muted disabled:opacity-40">写回答</button>
          </div>
        </div>
      </div>

      <section className="mt-4">
        <h2 className="mb-2 font-display text-[15px] font-semibold text-paper">本机草稿</h2>
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-haze/70 px-4 py-12 text-center text-[11px] text-paper-faint">还没有本机草稿</div>
        ) : (
          <div className="space-y-2">
            {items.map((draft) => (
              <button key={draft.localDraftId} type="button" onClick={() => onOpenDraft(draft.localDraftId)} className="flex w-full items-center gap-3 rounded-xl border border-haze/70 bg-ink-raised/45 p-3.5 text-left hover:border-cinnabar/35">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-paper">{draftLabel(draft)}</span>
                  <span className="mt-1 block truncate text-[10.5px] text-paper-faint">{draft.document.text.slice(0, 100) || '空草稿'}</span>
                </span>
                <span className="shrink-0 text-right font-mono text-[9px] text-paper-faint"><span className="block">{stateLabel(draft)}</span><span className="mt-1 block">{formatTime(draft.updatedAt)}</span></span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export function ZhihuEditorScreen(props: Props) {
  const { accountId, localDraftId, store, service, uploadService, onOpenDraft, onPublished, onDeleted } = props
  const [draft, setDraft] = useState<ZhihuDraftSnapshot | null>(null)
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(localDraftId !== 'new')
  const [saving, setSaving] = useState(false)
  const [remoteBusy, setRemoteBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [editVersion, setEditVersion] = useState(0)
  const [uploadingImage, setUploadingImage] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const loadedIdRef = useRef<string | null>(null)
  const remoteDraftWritable = Boolean(draft && canExecuteZhihuOperation(draft.kind === 'answer' ? 'draft.answer.save' : 'draft.pin.save'))
  const publishWritable = Boolean(draft && canExecuteZhihuOperation(draft.kind === 'answer' ? 'answer.publish' : 'pin.publish'))
  const imageWritable = canExecuteZhihuOperation('image.upload')
    && canExecuteZhihuOperation('image.oss.put')
    && canExecuteZhihuOperation('image.status.set')

  useEffect(() => {
    if (localDraftId === 'new') {
      setDraft(null)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    void store.get(accountId, localDraftId).then((value) => {
      if (!alive) return
      if (!value) {
        setError('这个草稿不存在，或属于另一个知乎账号')
        setDraft(null)
        return
      }
      setDraft(value)
      setTitle(value.title ?? '')
      loadedIdRef.current = null
    }, (reason) => {
      if (alive) setError(reason instanceof Error ? reason.message : '读取草稿失败')
    }).finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [accountId, localDraftId, store])

  useEffect(() => {
    if (!draft || !editorRef.current || loadedIdRef.current === draft.localDraftId) return
    editorRef.current.innerHTML = draft.document.html
    loadedIdRef.current = draft.localDraftId
  }, [draft])

  const readEditor = (): { html: string; text: string } => ({
    html: editorRef.current?.innerHTML ?? draft?.document.html ?? '',
    text: editorRef.current?.innerText ?? draft?.document.text ?? '',
  })

  const saveLocal = async (quiet = false): Promise<ZhihuDraftSnapshot | null> => {
    if (!draft) return null
    setSaving(true)
    if (!quiet) setError(null)
    try {
      const document = readEditor()
      const saved = await store.save({ ...draft, title: draft.kind === 'pin' ? title : undefined, document: { version: 1, ...document } })
      setDraft(saved)
      if (!quiet) setNotice('已保存到本机')
      return saved
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '本机草稿保存失败')
      return null
    } finally {
      setSaving(false)
    }
  }

  const uploadImage = async (file: File) => {
    if (uploadingImage || !draft || !imageWritable) return
    setUploadingImage(true)
    setError(null)
    setNotice(null)
    const assetId = createZhihuLocalId('asset')
    try {
      const saved = await saveLocal(true)
      if (!saved) return
      await store.putAssetBlob(accountId, saved.localDraftId, assetId, file, file.type, file.name)
      let withLocalAsset = await store.save({
        ...saved,
        assets: [
          ...saved.assets,
          { id: assetId, mediaType: file.type, fileName: file.name, uploadState: 'uploading' as const },
        ],
      })
      setDraft(withLocalAsset)
      try {
        const uploaded = await uploadService.upload(file, saved.kind === 'pin' ? 'pin' : 'article')
        const latest = await store.get(accountId, saved.localDraftId) ?? withLocalAsset
        withLocalAsset = await store.save({
          ...latest,
          assets: latest.assets.map((asset) => asset.id === assetId ? {
            ...asset,
            uploadState: 'ready' as const,
            remoteImageId: uploaded.imageId,
            remoteUrl: uploaded.url,
            remoteOriginalUrl: uploaded.originalUrl,
            remoteWatermarkUrl: uploaded.watermarkUrl,
            watermarkMode: uploaded.watermarkMode,
            width: uploaded.width,
            height: uploaded.height,
            error: undefined,
          } : asset),
        })
        setDraft(withLocalAsset)
        if (editorRef.current) {
          editorRef.current.focus()
          const safeUrl = uploaded.url
            .replaceAll('&', '&amp;')
            .replaceAll('"', '&quot;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
          document.execCommand('insertHTML', false, `<p><img src="${safeUrl}" data-image-id="${uploaded.imageId}" alt=""></p>`)
          setEditVersion((value) => value + 1)
        }
        setNotice('图片上传完成；原图仍保存在本机草稿资源中')
      } catch (reason) {
        const latest = await store.get(accountId, saved.localDraftId) ?? withLocalAsset
        const failed = await store.save({
          ...latest,
          assets: latest.assets.map((asset) => asset.id === assetId ? {
            ...asset,
            uploadState: 'failed' as const,
            error: reason instanceof Error ? reason.message : '图片上传失败',
          } : asset),
        })
        setDraft(failed)
        throw reason
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片上传失败')
    } finally {
      setUploadingImage(false)
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }

  // 输入后短延时事务保存；页面退出前还会由 blur/visibilitychange 再触发一次。
  useEffect(() => {
    if (!draft || loadedIdRef.current !== draft.localDraftId) return
    const timer = window.setTimeout(() => { void saveLocal(true) }, 450)
    return () => window.clearTimeout(timer)
    // saveLocal 故意不进依赖：它读取当前 editor DOM + 最新 draft state。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editVersion, title])

  useEffect(() => {
    const flush = () => { if (document.visibilityState === 'hidden') void saveLocal(true) }
    document.addEventListener('visibilitychange', flush)
    return () => document.removeEventListener('visibilitychange', flush)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, title])

  if (localDraftId === 'new') return <DraftManager accountId={accountId} store={store} onOpenDraft={onOpenDraft} />
  if (loading) return <div className="py-20 text-center font-mono text-[11px] text-paper-faint">正在恢复本机草稿…</div>
  if (!draft) return <div className="mx-auto max-w-xl px-5 py-16 text-center text-[12px] text-paper-muted">{error ?? '草稿不存在'}</div>

  const command = (name: string, value?: string) => {
    editorRef.current?.focus()
    document.execCommand(name, false, value)
    setEditVersion((version) => version + 1)
  }

  const addLink = () => {
    const value = window.prompt('链接地址（https://…）')?.trim()
    if (!value) return
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('bad scheme')
      command('createLink', url.href)
    } catch {
      setError('只允许 http/https 链接')
    }
  }

  const saveRemote = async () => {
    if (!remoteDraftWritable) {
      setError('当前版本暂不可保存远端草稿；本机草稿仍会正常保存。')
      return
    }
    setRemoteBusy(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await saveLocal(true)
      if (!saved) return
      const next = await service.saveRemoteDraft(saved)
      setDraft(next)
      setNotice('远端草稿已确认保存')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '远端草稿保存失败')
    } finally {
      setRemoteBusy(false)
    }
  }

  const publish = async () => {
    if (!publishWritable) {
      setError('当前版本暂不可发布；草稿仍会保留在本机。')
      return
    }
    setRemoteBusy(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await saveLocal(true)
      if (!saved) return
      const result: ZhihuPublishResult = await service.publish(saved)
      const latest = await store.get(accountId, saved.localDraftId)
      if (latest) setDraft(latest)
      if (result.status === 'confirmed') {
        setNotice('知乎已确认发布成功')
        onPublished({ kind: saved.kind === 'answer' ? 'answer' : 'pin', id: result.contentId })
      } else if (result.status === 'unknown') {
        setError(`发布请求已发出，但没有拿到可确认的最终结果。不会自动重发。操作号：${result.operationId}`)
      } else {
        setError(result.error)
      }
    } finally {
      setRemoteBusy(false)
    }
  }

  const copy = async () => {
    const saved = await saveLocal(true)
    if (!saved) return
    const next = await store.copy(accountId, saved.localDraftId)
    onOpenDraft(next.localDraftId)
  }

  const remove = async () => {
    if (!window.confirm('删除这个本机草稿及其本地媒体？此操作不会删除已经发布的知乎内容。')) return
    await store.delete(accountId, draft.localDraftId)
    onDeleted()
  }

  const sanitizedPreview = preview ? sanitizeArticleHtml(readEditor().html) : ''

  return (
    <div className="mx-auto w-full max-w-4xl px-3 pb-28 pt-4 sm:px-5">
      <div className="rounded-2xl border border-haze/70 bg-ink-raised/55 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-display text-[16px] font-semibold text-paper">{draft.kind === 'answer' ? `回答问题 ${draft.targetId}` : '发布想法'}</div>
            <div className="mt-0.5 font-mono text-[9px] text-paper-faint">revision {draft.localRevision} · {stateLabel(draft)}</div>
          </div>
          <button type="button" disabled={saving} onClick={() => void saveLocal(false)} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-haze/70 px-3 font-mono text-[10px] text-paper-muted"><Save size={13} />{saving ? '保存中' : '本机保存'}</button>
          <button type="button" disabled={remoteBusy || !remoteDraftWritable} onClick={() => void saveRemote()} title={remoteDraftWritable ? undefined : '当前版本暂不可保存远端草稿'} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-haze/70 px-3 font-mono text-[10px] text-paper-muted disabled:opacity-40"><RotateCcw size={13} />远端草稿</button>
          <button type="button" disabled={remoteBusy || !publishWritable} onClick={() => void publish()} title={publishWritable ? undefined : '当前版本暂不可发布'} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-cinnabar px-3 font-mono text-[10px] text-white disabled:opacity-45">{remoteBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}发布</button>
        </div>
        {notice && <div className="mt-3 flex items-center gap-2 rounded-xl border border-haze/60 bg-ink px-3 py-2 text-[10.5px] text-paper-muted"><Check size={13} className="text-cinnabar" />{notice}</div>}
        {error && <div role="alert" className="mt-3 rounded-xl border border-cinnabar/35 bg-cinnabar/8 px-3 py-2 text-[11px] leading-5 text-paper-muted">{error}</div>}
      </div>

      {draft.kind === 'pin' && <input value={title} onChange={(event) => { setTitle(event.target.value); setEditVersion((value) => value + 1) }} maxLength={100} placeholder="想法标题（可选）" className="mt-3 min-h-12 w-full rounded-xl border border-haze/70 bg-ink-raised/45 px-3 text-[15px] font-medium text-paper outline-none focus:border-cinnabar/50" />}

      <div className="sticky top-0 z-[5] mt-3 flex flex-wrap gap-1 rounded-xl border border-haze/70 bg-ink-raised/95 p-1.5">
        <button type="button" onClick={() => command('bold')} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="加粗"><Bold size={14} /></button>
        <button type="button" onClick={() => command('italic')} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="斜体"><Italic size={14} /></button>
        <button type="button" onClick={() => command('formatBlock', 'h2')} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="二级标题"><Heading2 size={14} /></button>
        <button type="button" onClick={() => command('formatBlock', 'blockquote')} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="引用"><Quote size={14} /></button>
        <button type="button" onClick={() => command('insertUnorderedList')} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="列表"><List size={14} /></button>
        <button type="button" onClick={() => command('formatBlock', 'pre')} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="代码块"><Code2 size={14} /></button>
        <button type="button" onClick={addLink} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="链接"><Link2 size={14} /></button>
        <button type="button" disabled={uploadingImage || !imageWritable} onClick={() => imageInputRef.current?.click()} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink disabled:opacity-40" title={imageWritable ? '上传图片' : '当前版本暂不可上传图片'}>{uploadingImage ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}</button>
        <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file) }} />
        <span className="mx-1 w-px bg-haze" />
        <button type="button" onClick={() => setPreview((value) => !value)} className="min-h-9 rounded-lg px-3 font-mono text-[10px] text-paper-muted hover:bg-ink">{preview ? '继续编辑' : '预览'}</button>
        <button type="button" onClick={() => void copy()} className="ml-auto flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="复制草稿"><Copy size={14} /></button>
        <button type="button" onClick={() => void remove()} className="flex size-9 items-center justify-center rounded-lg text-paper-faint hover:bg-ink hover:text-cinnabar" title="删除本机草稿"><Trash2 size={14} /></button>
      </div>

      {preview ? (
        <article className="article-content mt-3 min-h-[320px] rounded-2xl border border-haze/70 bg-ink-raised/35 px-4 py-5 text-paper" dangerouslySetInnerHTML={{ __html: sanitizedPreview }} />
      ) : (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-placeholder="开始写作…"
          onInput={() => { setEditVersion((value) => value + 1); setNotice(null) }}
          onBlur={() => void saveLocal(true)}
          className="article-content mt-3 min-h-[45vh] rounded-2xl border border-haze/70 bg-ink-raised/35 px-4 py-5 text-[14px] leading-7 text-paper outline-none focus:border-cinnabar/45 [&:empty:before]:content-[attr(data-placeholder)] [&:empty:before]:text-paper-faint"
        />
      )}
    </div>
  )
}
