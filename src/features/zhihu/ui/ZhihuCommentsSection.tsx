import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Heart, MessageCircle, Reply, Send, Trash2 } from 'lucide-react'

import { normalizeZhihuContentHtml } from '../content/normalize'
import type { ZhihuCommentSort, ZhihuCommentsService } from '../comments/service'
import type { ZhihuCommentDraftStore } from '../comments/draftStore'
import type { ZhihuCommentNode } from '../comments/types'
import type { ZhihuEntityRef } from '../types'
import { canExecuteZhihuOperation } from '../protocol'

interface Props {
  refValue: ZhihuEntityRef
  service: ZhihuCommentsService
  onNavigate: (ref: ZhihuEntityRef, sourceAnchor?: string) => void
  restoreAnchor?: string
  authenticated: boolean
  accountId?: string
  draftStore: ZhihuCommentDraftStore
}

function mergeComments(current: ZhihuCommentNode[], incoming: ZhihuCommentNode[]): ZhihuCommentNode[] {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !seen.has(item.id))]
}

function useCommentDraft(
  store: ZhihuCommentDraftStore,
  accountId: string | undefined,
  refValue: ZhihuEntityRef,
  replyToCommentId?: string,
) {
  const stableRef = useMemo<ZhihuEntityRef>(
    () => ({ kind: refValue.kind, id: refValue.id }),
    [refValue.id, refValue.kind],
  )
  const [value, setValue] = useState('')
  const [ready, setReady] = useState(false)
  const latest = useRef({ value: '', ready: false })
  latest.current = { value, ready }

  useEffect(() => {
    let disposed = false
    setValue('')
    setReady(false)
    if (!accountId) return () => { disposed = true }
    void store.load(accountId, stableRef, replyToCommentId).then(
      (content) => {
        if (disposed) return
        setValue(content)
        setReady(true)
      },
      () => {
        if (!disposed) setReady(true)
      },
    )
    return () => { disposed = true }
  }, [accountId, replyToCommentId, stableRef, store])

  useEffect(() => {
    if (!accountId || !ready) return
    const timer = window.setTimeout(() => {
      void store.save(accountId, stableRef, replyToCommentId, value).catch(() => undefined)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [accountId, ready, replyToCommentId, stableRef, store, value])

  useEffect(() => () => {
    if (!accountId || !latest.current.ready) return
    void store.save(accountId, stableRef, replyToCommentId, latest.current.value).catch(() => undefined)
  }, [accountId, replyToCommentId, stableRef, store])

  const clear = async () => {
    setValue('')
    if (accountId) await store.clear(accountId, stableRef, replyToCommentId)
  }
  return { value, setValue, clear, ready }
}

function CommentItem({
  comment,
  service,
  onNavigate,
  authenticated,
  accountId,
  draftStore,
  rootRef,
  onDeleted,
}: {
  comment: ZhihuCommentNode
  service: ZhihuCommentsService
  onNavigate: Props['onNavigate']
  authenticated: boolean
  accountId?: string
  draftStore: ZhihuCommentDraftStore
  rootRef: ZhihuEntityRef
  onDeleted: (commentId: string) => void
}) {
  const likeWritable = canExecuteZhihuOperation(comment.liked ? 'comment.like.clear' : 'comment.like.set')
  const replyWritable = canExecuteZhihuOperation('comment.create')
  const deleteWritable = canExecuteZhihuOperation('comment.delete')
  const cached = service.cachedChildren(comment.id)
  const initialChildren = cached?.items ?? comment.children
  const [children, setChildren] = useState(initialChildren)
  const [nextCursor, setNextCursor] = useState<string | undefined>(cached?.nextCursor)
  const [expanded, setExpanded] = useState(initialChildren.length > 0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liked, setLiked] = useState(comment.liked)
  const [likeCount, setLikeCount] = useState(comment.likeCount)
  const [mutationBusy, setMutationBusy] = useState(false)
  const [replying, setReplying] = useState(false)
  const replyDraft = useCommentDraft(draftStore, accountId, rootRef, comment.id)

  useEffect(() => {
    setLiked(comment.liked)
    setLikeCount(comment.likeCount)
  }, [comment.id, comment.likeCount, comment.liked])

  const loadChildren = () => {
    if (loading) return
    setLoading(true)
    setError(null)
    void service.listChildren(comment.id, nextCursor).then(
      (page) => {
        setChildren((prev) => mergeComments(prev, page.items))
        setNextCursor(page.hasMore ? page.nextCursor : undefined)
        setExpanded(true)
        setLoading(false)
      },
      (reason) => {
        setError(reason instanceof Error ? reason.message : '读取回复失败')
        setLoading(false)
      },
    )
  }

  const toggleLike = async () => {
    if (!authenticated || mutationBusy) return
    const target = !liked
    setMutationBusy(true)
    setError(null)
    try {
      await service.setLiked(comment.id, target)
      setLiked(target)
      setLikeCount((count) => Math.max(0, count + (target ? 1 : -1)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '评论点赞失败')
    } finally {
      setMutationBusy(false)
    }
  }

  const submitReply = async () => {
    if (!authenticated || mutationBusy || !replyDraft.value.trim()) return
    setMutationBusy(true)
    setError(null)
    try {
      const created = await service.create(rootRef, replyDraft.value, comment.id)
      setChildren((prev) => [created, ...prev.filter((item) => item.id !== created.id)])
      setExpanded(true)
      await replyDraft.clear()
      setReplying(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '回复发送失败')
    } finally {
      setMutationBusy(false)
    }
  }

  const remove = async () => {
    if (!authenticated || !comment.canDelete || mutationBusy) return
    setMutationBusy(true)
    setError(null)
    try {
      await service.delete(comment.id)
      onDeleted(comment.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '评论删除失败')
      setMutationBusy(false)
    }
  }

  return (
    <article id={`zhihu-comment-${comment.id}`} className="scroll-mt-20 border-b border-haze/50 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onNavigate(
            { kind: 'people', id: comment.author.token ?? comment.author.id },
            `zhihu-comment-${comment.id}`,
          )}
          className="min-w-0 truncate text-left text-[12px] font-medium text-paper hover:text-cinnabar"
        >
          {comment.author.name}
        </button>
        <span className="shrink-0 font-mono text-[10px] text-paper-faint">{likeCount} 赞</span>
      </div>
      {comment.replyToAuthor && (
        <div className="mt-1 text-[10.5px] text-paper-faint">回复 {comment.replyToAuthor.name}</div>
      )}
      <div
        className="article-body mt-1.5 text-[13px] leading-6 text-paper-muted"
        dangerouslySetInnerHTML={{ __html: normalizeZhihuContentHtml(comment.contentHtml) }}
      />

      {authenticated && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <button type="button" disabled={mutationBusy || !likeWritable} onClick={() => void toggleLike()} title={likeWritable ? undefined : '当前版本暂不可点赞评论'} className={`inline-flex min-h-8 items-center gap-1 rounded-lg px-2 font-mono text-[10px] disabled:opacity-40 ${liked ? 'text-cinnabar' : 'text-paper-faint hover:text-cinnabar'}`}>
            <Heart size={13} fill={liked ? 'currentColor' : 'none'} />{liked ? '已赞' : '赞'}
          </button>
          <button type="button" disabled={mutationBusy || !replyWritable} onClick={() => setReplying((value) => !value)} title={replyWritable ? undefined : '当前版本暂不可回复'} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 font-mono text-[10px] text-paper-faint hover:text-cinnabar disabled:opacity-40">
            <Reply size={13} />回复
          </button>
          {comment.canDelete && (
            <button type="button" disabled={mutationBusy || !deleteWritable} onClick={() => void remove()} title={deleteWritable ? undefined : '当前版本暂不可删除评论'} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 font-mono text-[10px] text-paper-faint hover:text-cinnabar disabled:opacity-40">
              <Trash2 size={13} />删除
            </button>
          )}
        </div>
      )}
      {replying && (
        <div className="mt-2 flex gap-2">
          <textarea value={replyDraft.value} onChange={(event) => replyDraft.setValue(event.target.value)} rows={2} maxLength={5000} placeholder={`回复 ${comment.author.name}`} className="min-h-16 flex-1 resize-y rounded-xl border border-haze/70 bg-ink px-3 py-2 text-[12px] text-paper outline-none focus:border-cinnabar/50" />
          <button type="button" disabled={mutationBusy || !replyDraft.ready || !replyDraft.value.trim()} onClick={() => void submitReply()} className="flex w-10 items-center justify-center rounded-xl bg-cinnabar text-white disabled:opacity-40" aria-label="发送回复"><Send size={15} /></button>
        </div>
      )}

      {comment.childCount > 0 && (
        <div className="mt-2">
          {!expanded || children.length < comment.childCount || nextCursor ? (
            <button
              type="button"
              onClick={loadChildren}
              disabled={loading}
              className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 font-mono text-[10px] text-cinnabar hover:bg-cinnabar/8 disabled:opacity-50"
            >
              <ChevronDown size={13} />
              {loading ? '正在读取…' : expanded ? '加载更多回复' : `展开 ${comment.childCount} 条回复`}
            </button>
          ) : null}
          {error && <div className="mt-1 text-[10.5px] text-cinnabar">{error}</div>}
          {expanded && children.length > 0 && (
            <div className="ml-3 mt-1 border-l border-haze/70 pl-3">
              {children.map((child) => (
                <CommentItem
                  key={child.id}
                  comment={child}
                  service={service}
                  onNavigate={onNavigate}
                  authenticated={authenticated}
                  accountId={accountId}
                  draftStore={draftStore}
                  rootRef={rootRef}
                  onDeleted={(id) => setChildren((prev) => prev.filter((item) => item.id !== id))}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

export function ZhihuCommentsSection({ refValue, service, onNavigate, restoreAnchor, authenticated, accountId, draftStore }: Props) {
  const [sort, setSort] = useState<ZhihuCommentSort>('score')
  const initialCache = service.cachedRoot(refValue, 'score')
  const [opened, setOpened] = useState(Boolean(initialCache?.items.length || restoreAnchor))
  const [items, setItems] = useState<ZhihuCommentNode[]>(initialCache?.items ?? [])
  const [nextCursor, setNextCursor] = useState<string | undefined>(initialCache?.nextCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootDraft = useCommentDraft(draftStore, accountId, refValue)
  const [sending, setSending] = useState(false)
  const commentWritable = canExecuteZhihuOperation('comment.create')

  useEffect(() => {
    const cached = service.cachedRoot(refValue, sort)
    setOpened(Boolean(cached?.items.length || restoreAnchor))
    setItems(cached?.items ?? [])
    setNextCursor(cached?.nextCursor)
    setLoading(false)
    setError(null)
  }, [refValue, restoreAnchor, service, sort])

  useEffect(() => {
    if (!restoreAnchor || !opened) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(restoreAnchor)?.scrollIntoView({ block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [items, opened, restoreAnchor])

  useEffect(() => {
    if (!restoreAnchor || items.length > 0 || loading || error) return
    // 没有缓存时至少重拉首屏；如果锚点不在首屏，用户仍可继续“加载更多评论”，
    // 但不会把一个不存在的 DOM 锚点当作已恢复成功。
    setOpened(true)
    setLoading(true)
    void service.listRoot(refValue, undefined, undefined, sort).then(
      (page) => {
        setItems(page.items)
        setNextCursor(page.hasMore ? page.nextCursor : undefined)
        setLoading(false)
      },
      (reason) => {
        setError(reason instanceof Error ? reason.message : '评论读取失败')
        setLoading(false)
      },
    )
  }, [error, items.length, loading, refValue, restoreAnchor, service, sort])

  const load = () => {
    if (loading) return
    setOpened(true)
    setLoading(true)
    setError(null)
    void service.listRoot(refValue, nextCursor, undefined, sort).then(
      (page) => {
        setItems((prev) => mergeComments(prev, page.items))
        setNextCursor(page.hasMore ? page.nextCursor : undefined)
        setLoading(false)
      },
      (reason) => {
        setError(reason instanceof Error ? reason.message : '评论读取失败')
        setLoading(false)
      },
    )
  }

  const submitRoot = async () => {
    if (!authenticated || sending || !rootDraft.value.trim()) return
    setSending(true)
    setError(null)
    try {
      const created = await service.create(refValue, rootDraft.value)
      setItems((prev) => [created, ...prev.filter((item) => item.id !== created.id)])
      setOpened(true)
      await rootDraft.clear()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '评论发送失败')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="mt-8 border-t border-haze/60 pt-5" aria-label="知乎评论">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[18px] font-semibold text-paper">
          <MessageCircle size={17} /> 评论
        </h2>
        <div className="flex items-center gap-2">
          {opened && (
            <div className="flex rounded-lg border border-haze/70 bg-ink-raised p-0.5" aria-label="评论排序">
              {([['score', '热度'], ['time', '时间']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  disabled={loading}
                  onClick={() => setSort(value)}
                  className={`min-h-8 rounded-md px-2.5 font-mono text-[10px] disabled:opacity-45 ${sort === value ? 'bg-cinnabar text-white' : 'text-paper-faint'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {!opened && (
            <button type="button" onClick={load} className="min-h-9 rounded-lg border border-haze/70 px-3 font-mono text-[10.5px] text-paper-muted hover:border-cinnabar/40 hover:text-cinnabar">
              读取评论
            </button>
          )}
        </div>
      </div>

      {authenticated && commentWritable ? (
        <div className="mt-3 flex gap-2">
          <textarea value={rootDraft.value} onChange={(event) => rootDraft.setValue(event.target.value)} rows={2} maxLength={5000} placeholder="写下你的评论…" className="min-h-16 flex-1 resize-y rounded-xl border border-haze/70 bg-ink-raised/50 px-3 py-2 text-[12px] text-paper outline-none focus:border-cinnabar/50" />
          <button type="button" disabled={sending || !rootDraft.ready || !rootDraft.value.trim()} onClick={() => void submitRoot()} className="flex w-11 items-center justify-center rounded-xl bg-cinnabar text-white disabled:opacity-40" aria-label="发送评论"><Send size={16} /></button>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-haze/60 bg-ink-raised/40 px-3 py-2 text-[10.5px] leading-5 text-paper-faint">
          {!authenticated ? '登录知乎后即可发表评论、回复和点赞。' : '当前版本暂不可发表评论。'}
        </div>
      )}

      {opened && loading && items.length === 0 && <div className="py-8 text-center font-mono text-[10.5px] text-paper-faint">正在读取评论…</div>}
      {error && <div role="alert" className="mt-3 rounded-lg border border-cinnabar/30 bg-cinnabar/8 p-2.5 text-[11px] text-paper-muted">{error}</div>}
      {opened && !loading && !error && items.length === 0 && <div className="py-8 text-center text-[11px] text-paper-faint">暂无可解析评论</div>}
      {items.length > 0 && (
        <div className="mt-2">
          {items.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              service={service}
              onNavigate={onNavigate}
              authenticated={authenticated}
              accountId={accountId}
              draftStore={draftStore}
              rootRef={refValue}
              onDeleted={(id) => setItems((prev) => prev.filter((item) => item.id !== id))}
            />
          ))}
        </div>
      )}
      {opened && nextCursor && (
        <button type="button" onClick={load} disabled={loading} className="mt-3 min-h-10 w-full rounded-xl border border-haze/70 bg-ink-raised font-mono text-[10.5px] text-paper-muted disabled:opacity-50">
          {loading ? '正在加载…' : '加载更多评论'}
        </button>
      )}
    </section>
  )
}
