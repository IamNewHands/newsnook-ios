import { ArrowLeft, Bookmark, Heart, ImagePlus, Loader2, MessageCircle, Pencil, Quote, Rocket, Send, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'

import { markdownToSafeHtml } from '../../../lib/markdown'
import {
  linuxDoDiscovery,
  linuxDoDrafts,
  linuxDoInteractions,
  linuxDoTopics,
  linuxDoUploads,
} from '../runtime'
import type {
  LinuxDoCategory,
  LinuxDoPost,
  LinuxDoSessionSnapshot,
  LinuxDoTag,
  LinuxDoTopic,
  LinuxDoTopicSummary,
} from '../types'
import { LinuxDoApiError } from '../types'
import { ago, avatar, compact, readableError } from './utils'

export function LinuxDoComposer({
  open,
  topic,
  session,
  onClose,
  onSent,
  initialRaw,
  replyToPostNumber,
  editPost,
  onEdited,
}: {
  open: boolean
  topic?: LinuxDoTopic
  session: LinuxDoSessionSnapshot
  onClose: () => void
  onSent: (post: LinuxDoPost, kind: 'reply' | 'create') => void
  initialRaw?: string
  replyToPostNumber?: number
  editPost?: LinuxDoPost
  onEdited?: (post: LinuxDoPost) => void
}) {
  const [title, setTitle] = useState('')
  const [raw, setRaw] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  const [categories, setCategories] = useState<LinuxDoCategory[]>([])
  const [tags, setTags] = useState<LinuxDoTag[]>([])
  const [categoryId, setCategoryId] = useState<number | undefined>()
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagQuery, setTagQuery] = useState('')
  const [draftSequence, setDraftSequence] = useState(0)
  const draftSequenceRef = useRef(0)
  const lastSavedDraftRef = useRef('')
  const [draftKey, setDraftKey] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) {
      setTitle('')
      setRaw('')
      setError('')
      setPreview(false)
      setCategoryId(undefined)
      setSelectedTags([])
      setTagQuery('')
      setDraftSequence(0)
      draftSequenceRef.current = 0
      lastSavedDraftRef.current = ''
      setDraftKey('')
      setUploadProgress(0)
      return
    }
    const action = editPost ? 'edit' : topic ? 'reply' : 'createTopic'
    const key = linuxDoDrafts.keyFor({ action, topicId: topic?.id, postId: editPost?.id })
    setDraftKey(key)
    if (initialRaw) setRaw((previous) => previous || initialRaw)
    if (session.authenticated) {
      void linuxDoDrafts.get(key).then((snapshot) => {
        setDraftSequence(snapshot.sequence)
        draftSequenceRef.current = snapshot.sequence
        if (snapshot.data) {
          setRaw((previous) => previous || snapshot.data?.reply || '')
          setTitle((previous) => previous || snapshot.data?.title || '')
          setCategoryId((previous) => previous ?? snapshot.data?.categoryId)
          setSelectedTags((previous) => previous.length ? previous : snapshot.data?.tags || [])
        }
      }).catch(() => undefined)
    }
    if (!topic) {
      void Promise.all([linuxDoDiscovery.categories(), linuxDoDiscovery.tags()]).then(([nextCategories, nextTags]) => {
        setCategories(nextCategories)
        setTags(nextTags)
      }).catch(() => undefined)
    }
  }, [open, topic, session.authenticated, initialRaw, editPost])

  useEffect(() => {
    if (!open || !session.authenticated || !draftKey || (!raw.trim() && !title.trim())) return
    const draftData = {
      reply: raw,
      action: editPost ? 'edit' as const : topic ? 'reply' as const : 'createTopic' as const,
      title: topic || editPost ? undefined : title,
      categoryId: topic || editPost ? undefined : categoryId,
      tags: topic || editPost ? undefined : selectedTags,
      postId: editPost?.id,
      reply_to_post_number: replyToPostNumber,
    }
    const fingerprint = JSON.stringify(draftData)
    if (fingerprint === lastSavedDraftRef.current) return
    const timer = window.setTimeout(() => {
      void linuxDoDrafts.save(
        draftKey,
        draftSequenceRef.current,
        draftData,
        'newsnook-linuxdo',
      ).then((nextSequence) => {
        draftSequenceRef.current = nextSequence
        setDraftSequence(nextSequence)
        lastSavedDraftRef.current = fingerprint
      }).catch((nextError) => {
        if (nextError instanceof LinuxDoApiError && nextError.status === 409) {
          setError('草稿已在其他设备更新。当前内容未被覆盖，请关闭后重新打开以加载服务端版本。')
        } else {
          setError(readableError(nextError))
        }
      })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [open, session.authenticated, draftKey, raw, title, categoryId, selectedTags, topic, editPost, replyToPostNumber])

  if (!open) return null

  const send = async () => {
    if (!session.authenticated) {
      setError('请先登录 Linux.do')
      return
    }
    if (!raw.trim() || (!topic && !title.trim())) return
    setSending(true)
    setError('')
    try {
      if (editPost) {
        const updated = await linuxDoTopics.editPost(editPost.id, raw.trim())
        onEdited?.(updated)
      } else if (topic) {
        const created = await linuxDoTopics.reply(topic.id, raw.trim(), replyToPostNumber)
        onSent(created, 'reply')
      } else {
        const created = await linuxDoTopics.createTopic({ title: title.trim(), raw: raw.trim(), category: categoryId, tags: selectedTags })
        onSent(created, 'create')
      }
      if (draftKey) await linuxDoDrafts.clear(draftKey, draftSequenceRef.current).catch(() => undefined)
      onClose()
    } catch (nextError) {
      setError(readableError(nextError))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/55 sm:items-center sm:justify-center">
      <div className="w-full rounded-t-[28px] border border-haze bg-ink-raised px-4 pb-[max(18px,var(--sab))] pt-3 shadow-2xl sm:max-w-2xl sm:rounded-[28px] sm:p-5">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-paper/15 sm:hidden" />
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[16px] font-semibold text-paper">{editPost ? '编辑帖子' : topic ? '回复主题' : '发布新主题'}</h3>
            <p className="mt-0.5 text-[10.5px] text-paper-faint">Markdown 编辑 · 写操作不会自动重试</p>
          </div>
          <button type="button" onClick={onClose} className="linuxdo-control grid h-9 w-9 place-items-center rounded-full bg-paper/6 text-paper-muted"><X size={16} /></button>
        </div>
        {!topic && !editPost ? (
          <>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="标题" className="mt-4 w-full rounded-2xl border border-haze bg-ink px-4 py-3 text-[14px] text-paper outline-none placeholder:text-paper-faint focus:border-cinnabar/50" />
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select value={categoryId ?? ''} onChange={(event) => setCategoryId(event.target.value ? Number(event.target.value) : undefined)} className="linuxdo-control rounded-2xl border border-haze bg-ink px-3 py-2.5 text-[11.5px] text-paper-muted outline-none focus:border-cinnabar/50">
                <option value="">选择分类</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <div className="rounded-2xl border border-haze bg-ink px-2 py-2">
                <input value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} placeholder="搜索标签" className="w-full bg-transparent px-1 pb-2 text-[11px] text-paper outline-none placeholder:text-paper-faint" />
                {selectedTags.length ? <div className="mb-2 flex flex-wrap gap-1.5">{selectedTags.map((name) => <button key={name} type="button" onClick={() => setSelectedTags((previous) => previous.filter((item) => item !== name))} className="linuxdo-control rounded-full bg-cinnabar/15 px-2.5 py-1 text-[10px] text-cinnabar-soft">#{name} ×</button>)}</div> : null}
                <div className="max-h-24 overflow-y-auto"><div className="flex flex-wrap gap-1.5">{tags.filter((tag) => !tagQuery.trim() || tag.name.toLowerCase().includes(tagQuery.trim().toLowerCase())).slice(0, 24).map((tag) => {
                  const active = selectedTags.includes(tag.name)
                  return <button key={tag.name} type="button" disabled={active || selectedTags.length >= 5} onClick={() => setSelectedTags((previous) => previous.concat(tag.name))} className="linuxdo-control rounded-full bg-paper/5 px-2.5 py-1 text-[10px] text-paper-faint disabled:opacity-35">#{tag.name}</button>
                })}</div></div>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-2xl bg-paper/[0.035] px-3.5 py-2.5 text-[12px] text-paper-muted">{editPost ? '编辑 #' + editPost.postNumber : '回复：' + topic?.title}</div>
        )}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex rounded-full bg-paper/5 p-1">
            <button type="button" onClick={() => setPreview(false)} className={'linuxdo-control rounded-full px-3 py-1 text-[10.5px] ' + (!preview ? 'bg-paper text-ink' : 'text-paper-muted')}>编辑</button>
            <button type="button" onClick={() => setPreview(true)} className={'linuxdo-control rounded-full px-3 py-1 text-[10.5px] ' + (preview ? 'bg-paper text-ink' : 'text-paper-muted')}>预览</button>
          </div>
          <span className="text-[10px] text-paper-faint">{draftSequence > 0 ? '草稿已同步 · Markdown' : 'Markdown'}</span>
        </div>
        {preview ? (
          <article className="reader-prose mt-3 min-h-[220px] rounded-2xl border border-haze bg-ink px-4 py-3 text-paper" dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(raw) }} />
        ) : (
          <textarea value={raw} onChange={(event) => setRaw(event.target.value)} placeholder={editPost ? '编辑帖子内容…' : topic ? '写下你的回复…' : '正文支持 Markdown…'} rows={9} className="mt-3 w-full resize-none rounded-2xl border border-haze bg-ink px-4 py-3 text-[13px] leading-6 text-paper outline-none placeholder:text-paper-faint focus:border-cinnabar/50" />
        )}
        <input ref={fileRef} type="file" className="hidden" accept="image/*,.pdf,.zip,.txt" onChange={(event) => {
          const file = event.target.files?.[0]
          event.currentTarget.value = ''
          if (!file) return
          setUploading(true)
          setError('')
          setUploadProgress(0)
          void linuxDoUploads.upload(file, setUploadProgress).then((uploaded) => {
            const markdown = linuxDoUploads.markdown(uploaded, file)
            setRaw((previous) => previous + (previous && !previous.endsWith('\n') ? '\n' : '') + markdown + '\n')
          }).catch((nextError) => setError(readableError(nextError))).finally(() => { setUploading(false); setUploadProgress(0) })
        }} />
        {error ? <p className="mt-2 text-[11px] text-cinnabar-soft">{error}</p> : null}
        <div className="mt-3 flex items-center justify-between gap-3">
          <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="linuxdo-control inline-flex items-center gap-1.5 rounded-full border border-haze px-3 py-2 text-[10.5px] text-paper-muted disabled:opacity-40">
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
            {uploading ? (uploadProgress < 0.8 ? '准备 ' + Math.round(uploadProgress * 100) + '%' : '正在上传') : '图片 / 附件'}
          </button>
          <button type="button" disabled={sending || uploading || !raw.trim() || (!topic && !editPost && !title.trim())} onClick={() => void send()} className="linuxdo-control inline-flex items-center gap-2 rounded-full bg-cinnabar px-4 py-2 text-[12px] font-medium text-white disabled:opacity-40">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {editPost ? '保存' : topic ? '回复' : '发布'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function LinuxDoBoostComposer({ post, onClose }: { post: LinuxDoPost; onClose: () => void }) {
  const [raw, setRaw] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const remaining = 16 - Array.from(raw).length

  const send = async () => {
    const text = raw.trim()
    if (!text || remaining < 0) return
    setSending(true)
    setError('')
    try {
      await linuxDoInteractions.boost(post.id, text)
      onClose()
    } catch (nextError) {
      setError(readableError(nextError))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-end bg-black/55 sm:items-center sm:justify-center">
      <div className="w-full rounded-t-[26px] border border-haze bg-ink-raised p-4 pb-[max(18px,var(--sab))] shadow-2xl sm:max-w-md sm:rounded-[26px]">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-paper"><Rocket size={15} className="text-cinnabar-soft" />Boost</h3>
            <p className="mt-1 text-[10.5px] text-paper-faint">对 #{post.postNumber} 留下最多 16 个字符的轻量回应</p>
          </div>
          <button type="button" onClick={onClose} className="linuxdo-control grid h-9 w-9 place-items-center rounded-full bg-paper/6 text-paper-muted"><X size={15} /></button>
        </div>
        <textarea
          autoFocus
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          rows={3}
          placeholder="写点简短的…"
          className="mt-4 w-full resize-none rounded-2xl border border-haze bg-ink px-4 py-3 text-[13px] leading-6 text-paper outline-none placeholder:text-paper-faint focus:border-cinnabar/50"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className={remaining < 0 ? 'text-[10px] text-cinnabar-soft' : 'text-[10px] text-paper-faint'}>{remaining} 字</span>
          <button type="button" disabled={sending || !raw.trim() || remaining < 0} onClick={() => void send()} className="linuxdo-control inline-flex items-center gap-2 rounded-full bg-cinnabar px-4 py-2 text-[11.5px] font-medium text-white disabled:opacity-40">
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
            Boost
          </button>
        </div>
        {error ? <p className="mt-2 text-[10.5px] text-cinnabar-soft">{error}</p> : null}
      </div>
    </div>
  )
}

export function LinuxDoTopicView({
  summary,
  session,
  onBack,
  onCompose,
  onBoost,
  onOpenUser,
  onEdit,
  targetPostNumber,
  postMutation,
  overlayBackHandlerRef,
}: {
  summary: LinuxDoTopicSummary
  session: LinuxDoSessionSnapshot
  onBack: () => void
  onCompose: (topic: LinuxDoTopic, options?: { initialRaw?: string; replyToPostNumber?: number }) => void
  onBoost: (post: LinuxDoPost) => void
  onOpenUser: (username: string) => void
  onEdit: (topic: LinuxDoTopic, post: LinuxDoPost) => void
  targetPostNumber?: number
  postMutation?: LinuxDoPost
  overlayBackHandlerRef: MutableRefObject<(() => boolean) | null>
}) {
  const [topic, setTopic] = useState<LinuxDoTopic | null>(null)
  const [posts, setPosts] = useState<LinuxDoPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [viewerSrc, setViewerSrc] = useState('')
  const [returnPostNumber, setReturnPostNumber] = useState<number | undefined>()

  useEffect(() => {
    overlayBackHandlerRef.current = () => {
      if (!viewerSrc) return false
      setViewerSrc('')
      return true
    }
    return () => { overlayBackHandlerRef.current = null }
  }, [overlayBackHandlerRef, viewerSrc])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await linuxDoTopics.get(summary.slug, summary.id, targetPostNumber)
      setTopic(next)
      setPosts(next.postStream.posts)
      const present = new Set(next.postStream.posts.map((post) => post.id))
      const missing = next.postStream.stream.filter((id) => !present.has(id))
      const firstBatch = missing.slice(0, 40)
      if (firstBatch.length) {
        const extra = await linuxDoTopics.loadPosts(next.id, firstBatch)
        setPosts((previous) => previous.concat(extra).sort((a, b) => a.postNumber - b.postNumber))
      }
    } catch (nextError) {
      setError(nextError)
    } finally {
      setLoading(false)
    }
  }, [summary.id, summary.slug, targetPostNumber])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!targetPostNumber || !posts.some((post) => post.postNumber === targetPostNumber)) return
    window.setTimeout(() => document.getElementById('linuxdo-post-' + targetPostNumber)?.scrollIntoView({ block: 'center' }), 60)
  }, [targetPostNumber, posts])

  useEffect(() => {
    if (!postMutation || (postMutation.topicId && postMutation.topicId !== topic?.id)) return
    setPosts((previous) => {
      const exists = previous.some((post) => post.id === postMutation.id)
      return (exists
        ? previous.map((post) => post.id === postMutation.id ? { ...post, ...postMutation } : post)
        : previous.concat(postMutation)).sort((a, b) => a.postNumber - b.postNumber)
    })
  }, [postMutation, topic?.id])

  const jumpToPost = useCallback(async (postNumber: number, fromPostNumber?: number) => {
    if (fromPostNumber) setReturnPostNumber(fromPostNumber)
    if (!posts.some((post) => post.postNumber === postNumber)) {
      try {
        const windowTopic = await linuxDoTopics.get(summary.slug, summary.id, postNumber)
        setPosts((previous) => {
          const byId = new Map(previous.map((post) => [post.id, post]))
          for (const post of windowTopic.postStream.posts) byId.set(post.id, post)
          return Array.from(byId.values()).sort((a, b) => a.postNumber - b.postNumber)
        })
      } catch (nextError) {
        setError(nextError)
        return
      }
    }
    window.setTimeout(() => document.getElementById('linuxdo-post-' + postNumber)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
  }, [posts, summary.id, summary.slug])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-haze/50 bg-ink/95 page-x py-2.5 backdrop-blur-xl">
        <button type="button" onClick={onBack} className="linuxdo-control grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper/6 text-paper-muted"><ArrowLeft size={17} /></button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-paper">{summary.title}</div>
          <div className="mt-0.5 text-[9.5px] text-paper-faint">{String(summary.replyCount) + ' 回复 · ' + compact(summary.views) + ' 浏览'}</div>
        </div>
        {topic && session.authenticated ? <select value={topic.details?.notificationLevel ?? 1} onChange={(event) => {
          const nextLevel = Number(event.target.value)
          const previous = topic.details?.notificationLevel ?? 1
          setTopic({ ...topic, details: { ...topic.details, notificationLevel: nextLevel } })
          void linuxDoTopics.setNotificationLevel(topic.id, nextLevel).catch((nextError) => {
            setTopic((current) => current ? { ...current, details: { ...current.details, notificationLevel: previous } } : current)
            setError(nextError)
          })
        }} className="linuxdo-control rounded-full border border-haze bg-ink px-2.5 py-1.5 text-[10px] text-paper-muted outline-none">
          <option value={0}>静音</option><option value={1}>普通</option><option value={2}>跟踪</option><option value={3}>关注</option>
        </select> : null}
        {topic ? <button type="button" onClick={() => onCompose(topic)} className="linuxdo-control inline-flex items-center gap-1.5 rounded-full bg-cinnabar px-3.5 py-2 text-[11.5px] font-medium text-white"><MessageCircle size={13} />回复</button> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain page-x pb-28" onScroll={(event) => {
        if (!topic || loadingPosts) return
        const node = event.currentTarget
        if (node.scrollHeight - node.scrollTop - node.clientHeight > 500) return
        const present = new Set(posts.map((post) => post.id))
        const remaining = topic.postStream.stream.filter((id) => !present.has(id)).slice(0, 40)
        if (!remaining.length) return
        setLoadingPosts(true)
        void linuxDoTopics.loadPosts(topic.id, remaining).then((extra) => setPosts((previous) => previous.concat(extra).sort((a, b) => a.postNumber - b.postNumber))).finally(() => setLoadingPosts(false))
      }}>
        {loading ? <div className="flex justify-center py-24 text-paper-faint"><Loader2 className="animate-spin" /></div> : null}
        {error ? <div className="py-24 text-center text-[13px] text-paper-muted">{readableError(error)}</div> : null}
        {topic ? (
          <>
            <header className="py-5">
              <h1 className="font-display text-[24px] font-semibold leading-[1.35] text-paper">{topic.title}</h1>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {topic.tags.map((name) => <span key={name} className="rounded-full border border-haze px-2.5 py-1 text-[10.5px] text-paper-muted">#{name}</span>)}
              </div>
            </header>
            <div className="space-y-3">
              {posts.map((post) => {
                const like = post.actions.find((action) => action.id === 2)
                return (
                  <article key={post.id} id={'linuxdo-post-' + post.postNumber} className="rounded-[22px] border border-haze/60 bg-ink-raised/40 px-4 py-4">
                    <header className="linuxdo-control flex items-center gap-3 select-none">
                      <button type="button" onClick={() => onOpenUser(post.username)} className="h-9 w-9 overflow-hidden rounded-full border border-haze bg-paper/5">{avatar(post.avatarTemplate, post.username)}</button>
                      <button type="button" onClick={() => onOpenUser(post.username)} className="min-w-0 flex-1 text-left">
                        <div className="truncate text-[12.5px] font-semibold text-paper">{post.name || post.username}</div>
                        <div className="mt-0.5 text-[9.5px] text-paper-faint">{'@' + post.username + ' · ' + ago(post.createdAt)}</div>
                      </button>
                      <span className="font-mono text-[10px] text-paper-faint">{'#' + post.postNumber}</span>
                    </header>
                    <div className="reader-prose linuxdo-post-prose mt-4 text-paper" onClick={(event) => {
                      const target = event.target as HTMLElement
                      if (target instanceof HTMLImageElement && target.src) {
                        setViewerSrc(target.src)
                        return
                      }
                      const link = target.closest('a') as HTMLAnchorElement | null
                      if (!link?.href) return
                      try {
                        const url = new URL(link.href, 'https://linux.do')
                        if (url.hostname !== 'linux.do') return
                        const match = url.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)\/(\d+)/)
                        if (!match || Number(match[1]) !== topic.id) return
                        event.preventDefault()
                        void jumpToPost(Number(match[2]), post.postNumber)
                      } catch {
                        // Leave non-topic links to the browser.
                      }
                    }} dangerouslySetInnerHTML={{ __html: post.cooked }} />
                    <footer className="linuxdo-control mt-4 flex items-center gap-1.5 border-t border-haze/40 pt-3 select-none">
                      <button type="button" disabled={!session.authenticated} onClick={async () => {
                        try {
                          if (like?.acted) {
                            await linuxDoInteractions.unlike(post.id)
                            setPosts((previous) => previous.map((candidate) => candidate.id === post.id ? { ...candidate, actions: candidate.actions.map((action) => action.id === 2 ? { ...action, acted: false, count: Math.max(0, (action.count ?? 1) - 1) } : action) } : candidate))
                          } else {
                            await linuxDoInteractions.like(post.id)
                            setPosts((previous) => previous.map((candidate) => candidate.id === post.id ? { ...candidate, actions: candidate.actions.some((action) => action.id === 2) ? candidate.actions.map((action) => action.id === 2 ? { ...action, acted: true, count: (action.count ?? 0) + 1 } : action) : candidate.actions.concat({ id: 2, acted: true, count: 1, canAct: true }) } : candidate))
                          }
                        } catch (nextError) { setError(nextError) }
                      }} className={'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10.5px] ' + (like?.acted ? 'bg-cinnabar/14 text-cinnabar-soft' : 'bg-paper/5 text-paper-muted')}>
                        <Heart size={12} fill={like?.acted ? 'currentColor' : 'none'} />{like?.count || '赞'}
                      </button>
                      <button type="button" disabled={!session.authenticated} onClick={() => topic && onCompose(topic, { replyToPostNumber: post.postNumber })} className="inline-flex items-center gap-1.5 rounded-full bg-paper/5 px-3 py-1.5 text-[10.5px] text-paper-muted"><MessageCircle size={12} />回复</button>
                      <button type="button" disabled={!session.authenticated} onClick={() => {
                        if (!topic) return
                        const text = new DOMParser().parseFromString(post.cooked, 'text/html').body.textContent?.trim().slice(0, 240) || ''
                        const quoted = '> @' + post.username + '：' + text + '\n\n'
                        onCompose(topic, { initialRaw: quoted, replyToPostNumber: post.postNumber })
                      }} className="inline-flex items-center gap-1.5 rounded-full bg-paper/5 px-3 py-1.5 text-[10.5px] text-paper-muted"><Quote size={12} />引用</button>
                      {post.canEdit ? <button type="button" onClick={() => topic && onEdit(topic, post)} className="inline-flex items-center gap-1.5 rounded-full bg-paper/5 px-3 py-1.5 text-[10.5px] text-paper-muted"><Pencil size={12} />编辑</button> : null}
                      {post.canDelete ? <button type="button" onClick={async () => {
                        if (!window.confirm('确定删除这条帖子吗？此操作将提交到 Linux.do。')) return
                        try {
                          await linuxDoTopics.deletePost(post.id)
                          setPosts((previous) => previous.filter((candidate) => candidate.id !== post.id))
                        } catch (nextError) {
                          setError(nextError)
                        }
                      }} className="inline-flex items-center gap-1.5 rounded-full bg-paper/5 px-3 py-1.5 text-[10.5px] text-paper-muted"><Trash2 size={12} />删除</button> : null}
                      <button type="button" disabled={!session.authenticated} onClick={async () => {
                        try {
                          if (post.bookmarked && post.bookmarkId) {
                            await linuxDoInteractions.deleteBookmark(post.bookmarkId)
                            setPosts((previous) => previous.map((candidate) => candidate.id === post.id ? { ...candidate, bookmarked: false, bookmarkId: undefined, bookmarkName: undefined, bookmarkReminderAt: undefined } : candidate))
                          } else {
                            const created = await linuxDoInteractions.bookmarkPost(post.id)
                            const bookmarkId = Number(created?.id ?? created?.bookmark?.id ?? 0)
                            setPosts((previous) => previous.map((candidate) => candidate.id === post.id ? { ...candidate, bookmarked: true, bookmarkId: bookmarkId > 0 ? bookmarkId : candidate.bookmarkId } : candidate))
                          }
                        } catch (nextError) {
                          setError(nextError)
                        }
                      }} className={'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10.5px] ' + (post.bookmarked ? 'bg-cinnabar/14 text-cinnabar-soft' : 'bg-paper/5 text-paper-muted')}><Bookmark size={12} fill={post.bookmarked ? 'currentColor' : 'none'} />{post.bookmarked ? '已收藏' : '书签'}</button>
                      <button type="button" disabled={!session.authenticated} onClick={() => onBoost(post)} className="inline-flex items-center gap-1.5 rounded-full bg-paper/5 px-3 py-1.5 text-[10.5px] text-paper-muted"><Rocket size={12} />Boost</button>
                    </footer>
                  </article>
                )
              })}
            </div>
          </>
        ) : null}
      </div>
      {returnPostNumber ? <button type="button" onClick={() => { const target = returnPostNumber; setReturnPostNumber(undefined); void jumpToPost(target) }} className="linuxdo-control absolute bottom-[calc(max(10px,var(--sab))+72px)] right-4 z-30 rounded-full border border-haze bg-ink-raised/95 px-3 py-2 text-[10.5px] text-paper shadow-xl">返回引用处 #{returnPostNumber}</button> : null}
      {viewerSrc ? <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setViewerSrc('')}><button type="button" className="linuxdo-control absolute right-4 top-[max(16px,var(--sat))] grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white"><X size={18} /></button><img src={viewerSrc} alt="" className="max-h-full max-w-full rounded-xl object-contain" /></div> : null}
    </div>
  )
}

