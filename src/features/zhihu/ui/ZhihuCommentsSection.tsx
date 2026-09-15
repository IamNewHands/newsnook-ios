import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Clock3, Flame, Heart, Loader2, MessageCircle, RefreshCw, Reply, Send, Trash2 } from 'lucide-react'

import { normalizeZhihuContentHtml } from '../content/normalize'
import type { ZhihuCommentSort, ZhihuCommentsService } from '../comments/service'
import type { ZhihuCommentDraftStore } from '../comments/draftStore'
import type { ZhihuCommentNode } from '../comments/types'
import type { ZhihuEntityRef } from '../types'
import { canExecuteZhihuOperation } from '../protocol'
import { ZhihuEmptyState, ZhihuErrorBanner, ZhihuSectionHeader } from './ZhihuUi'
import { formatZhihuCount } from './ZhihuUiUtils'

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
    <article id={`zhihu-comment-${comment.id}`} className="scroll-mt-20 border-b border-haze/50 py-4 first:pt-1 last:border-b-0">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onNavigate(
            { kind: 'people', id: comment.author.token ?? comment.author.id },
            `zhihu-comment-${comment.id}`,
          )}
          className="flex size-8 shrink-0 items-center justify-center rounded-full border border-haze/70 bg-ink-raised/55 font-display text-[12px] text-paper-muted transition-colors hover:border-cinnabar/35 hover:text-cinnabar-soft"
          aria-label={`查看 ${comment.author.name} 的主页`}
        >
          {comment.author.name.slice(0, 1)}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate(
                { kind: 'people', id: comment.author.token ?? comment.author.id },
                `zhihu-comment-${comment.id}`,
              )}
              className="min-w-0 truncate text-left text-[12.5px] font-medium text-paper transition-colors hover:text-cinnabar-soft"
            >
              {comment.author.name}
            </button>
            {comment.replyToAuthor && (
              <span className="truncate text-[10.5px] text-paper-faint">回复 {comment.replyToAuthor.name}</span>
            )}
          </div>
          <div
            className="zhihu-comment-body mt-1.5 text-[13px] leading-[1.7] text-paper-muted"
            dangerouslySetInnerHTML={{ __html: normalizeZhihuContentHtml(comment.contentHtml) }}
          />

          <div className="mt-2 flex min-h-8 items-center gap-0.5">
            <button
              type="button"
              disabled={!authenticated || mutationBusy || !likeWritable}
              onClick={() => void toggleLike()}
              title={!authenticated ? '登录后可点赞' : liked ? '取消点赞' : '点赞'}
              aria-label={liked ? '取消点赞' : '点赞'}
              className={`inline-flex min-h-8 items-center gap-1 rounded-lg px-2 font-mono text-[10px] transition-colors disabled:opacity-35 ${liked ? 'text-cinnabar-soft' : 'text-paper-faint hover:bg-paper/5 hover:text-paper-muted'}`}
            >
              <Heart size={13} strokeWidth={1.6} fill={liked ? 'currentColor' : 'none'} />
              {likeCount > 0 && <span>{formatZhihuCount(likeCount)}</span>}
            </button>
            <button
              type="button"
              disabled={!authenticated || mutationBusy || !replyWritable}
              onClick={() => setReplying((value) => !value)}
              title={!authenticated ? '登录后可回复' : '回复'}
              aria-label="回复"
              className="flex size-8 items-center justify-center rounded-lg text-paper-faint transition-colors hover:bg-paper/5 hover:text-paper-muted disabled:opacity-35"
            >
              <Reply size={13} strokeWidth={1.6} />
            </button>
            {comment.canDelete && (
              <button
                type="button"
                disabled={!authenticated || mutationBusy || !deleteWritable}
                onClick={() => void remove()}
                title="删除评论"
                aria-label="删除评论"
                className="flex size-8 items-center justify-center rounded-lg text-paper-faint transition-colors hover:bg-cinnabar/8 hover:text-cinnabar-soft disabled:opacity-35"
              >
                <Trash2 size={13} strokeWidth={1.6} />
              </button>
            )}
          </div>

          {replying && (
            <div className="mt-2 flex items-end gap-2 rounded-xl border border-haze/70 bg-ink-raised/35 p-2.5 focus-within:border-cinnabar/35">
              <textarea
                value={replyDraft.value}
                onChange={(event) => replyDraft.setValue(event.target.value)}
                rows={2}
                maxLength={5000}
                placeholder={`回复 ${comment.author.name}`}
                className="min-h-14 min-w-0 flex-1 resize-y bg-transparent text-[12.5px] leading-relaxed text-paper outline-none placeholder:text-paper-faint/65"
              />
              <button
                type="button"
                disabled={mutationBusy || !replyDraft.ready || !replyDraft.value.trim()}
                onClick={() => void submitReply()}
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-cinnabar/45 bg-cinnabar/12 text-cinnabar-soft disabled:opacity-35"
                aria-label="发送回复"
              >
                {mutationBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          )}

          {comment.childCount > 0 && (
            <div className="mt-1.5">
              {!expanded || children.length < comment.childCount || nextCursor ? (
                <button
                  type="button"
                  onClick={loadChildren}
                  disabled={loading}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] text-cinnabar-soft transition-colors hover:bg-cinnabar/8 disabled:opacity-45"
                >
                  {loading ? <Loader2 size={13} className="animate-spin" /> : <ChevronDown size={13} strokeWidth={1.6} />}
                  <span>{loading ? '正在读取' : expanded ? '更多回复' : `${comment.childCount} 条回复`}</span>
                </button>
              ) : null}
              {error && <div className="mt-1"><ZhihuErrorBanner>{error}</ZhihuErrorBanner></div>}
              {expanded && children.length > 0 && (
                <div className="ml-2 mt-1 border-l border-haze/65 pl-3">
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
        </div>
      </div>
    </article>
  )
}

export function ZhihuCommentsSection({ refValue, service, onNavigate, restoreAnchor, authenticated, accountId, draftStore }: Props) {
  const [sort, setSort] = useState<ZhihuCommentSort>('score')
  const initialCache = service.cachedRoot(refValue, 'score')
  const [items, setItems] = useState<ZhihuCommentNode[]>(initialCache?.items ?? [])
  const [nextCursor, setNextCursor] = useState<string | undefined>(initialCache?.nextCursor)
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(Boolean(initialCache))
  const [error, setError] = useState<string | null>(null)
  const rootDraft = useCommentDraft(draftStore, accountId, refValue)
  const [sending, setSending] = useState(false)
  const commentWritable = canExecuteZhihuOperation('comment.create')

  useEffect(() => {
    const cached = service.cachedRoot(refValue, sort)
    setItems(cached?.items ?? [])
    setNextCursor(cached?.nextCursor)
    setLoadedOnce(Boolean(cached))
    setLoading(false)
    setError(null)
  }, [refValue, service, sort])

  useEffect(() => {
    if (loadedOnce || loading) return
    let disposed = false
    setLoading(true)
    setError(null)
    void service.listRoot(refValue, undefined, undefined, sort).then(
      (page) => {
        if (disposed) return
        setItems(page.items)
        setNextCursor(page.hasMore ? page.nextCursor : undefined)
        setLoadedOnce(true)
        setLoading(false)
      },
      (reason) => {
        if (disposed) return
        setError(reason instanceof Error ? reason.message : '评论读取失败')
        setLoadedOnce(true)
        setLoading(false)
      },
    )
    return () => { disposed = true }
  }, [loadedOnce, loading, refValue, service, sort])

  useEffect(() => {
    if (!restoreAnchor || items.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(restoreAnchor)?.scrollIntoView({ block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [items, restoreAnchor])

  const refresh = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const page = await service.listRoot(refValue, undefined, undefined, sort)
      setItems(page.items)
      setNextCursor(page.hasMore ? page.nextCursor : undefined)
      setLoadedOnce(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '评论读取失败')
    } finally {
      setLoading(false)
    }
  }

  const loadMore = async () => {
    if (loading || !nextCursor) return
    setLoading(true)
    setError(null)
    try {
      const page = await service.listRoot(refValue, nextCursor, undefined, sort)
      setItems((prev) => mergeComments(prev, page.items))
      setNextCursor(page.hasMore ? page.nextCursor : undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '评论读取失败')
    } finally {
      setLoading(false)
    }
  }

  const submitRoot = async () => {
    if (!authenticated || sending || !rootDraft.value.trim()) return
    setSending(true)
    setError(null)
    try {
      const created = await service.create(refValue, rootDraft.value)
      setItems((prev) => [created, ...prev.filter((item) => item.id !== created.id)])
      setLoadedOnce(true)
      await rootDraft.clear()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '评论发送失败')
    } finally {
      setSending(false)
    }
  }

  const sortControl = (
    <div className="flex items-center gap-0.5 rounded-lg border border-haze/70 bg-ink-raised/45 p-0.5" aria-label="评论排序">
      <button
        type="button"
        disabled={loading}
        onClick={() => setSort('score')}
        aria-label="按热度排序"
        title="按热度排序"
        className={`flex size-8 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${sort === 'score' ? 'bg-cinnabar/18 text-cinnabar-soft' : 'text-paper-faint hover:bg-paper/5 hover:text-paper-muted'}`}
      >
        <Flame size={14} strokeWidth={1.65} />
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => setSort('time')}
        aria-label="按时间排序"
        title="按时间排序"
        className={`flex size-8 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${sort === 'time' ? 'bg-cinnabar/18 text-cinnabar-soft' : 'text-paper-faint hover:bg-paper/5 hover:text-paper-muted'}`}
      >
        <Clock3 size={14} strokeWidth={1.65} />
      </button>
    </div>
  )

  return (
    <section className="mt-9 border-t border-haze/55 pt-5" aria-label="知乎评论">
      <ZhihuSectionHeader
        icon={<MessageCircle size={17} />}
        title="评论"
        detail={items.length > 0 ? `${items.length} 条已载入` : undefined}
        action={(
          <div className="flex items-center gap-1.5">
            {sortControl}
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="刷新评论"
              title="刷新评论"
              className="flex size-9 items-center justify-center rounded-lg border border-haze/70 bg-ink-raised/45 text-paper-faint transition-colors hover:bg-ink-raised hover:text-paper-muted disabled:opacity-35"
            >
              <RefreshCw size={14} strokeWidth={1.65} className={loading ? 'animate-spin text-cinnabar-soft' : ''} />
            </button>
          </div>
        )}
      />

      {authenticated && commentWritable ? (
        <div className="flex items-end gap-2 rounded-2xl border border-haze/70 bg-ink-raised/35 p-3 shadow-[var(--shadow-lift)] transition-colors focus-within:border-cinnabar/35">
          <textarea
            value={rootDraft.value}
            onChange={(event) => rootDraft.setValue(event.target.value)}
            rows={2}
            maxLength={5000}
            placeholder="写下你的评论…"
            className="min-h-16 min-w-0 flex-1 resize-y bg-transparent text-[13px] leading-[1.65] text-paper outline-none placeholder:text-paper-faint/65"
          />
          <button
            type="button"
            disabled={sending || !rootDraft.ready || !rootDraft.value.trim()}
            onClick={() => void submitRoot()}
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-cinnabar/50 bg-cinnabar/12 text-cinnabar-soft transition-colors hover:bg-cinnabar/20 disabled:opacity-35"
            aria-label="发送评论"
            title="发送评论"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} strokeWidth={1.7} />}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-haze/60 bg-ink-raised/35 px-3.5 py-2.5 text-[11px] leading-relaxed text-paper-faint">
          {!authenticated ? '登录知乎后可发表评论、回复和点赞。' : '当前会话暂不可发表评论。'}
        </div>
      )}

      {error && <div className="mt-3"><ZhihuErrorBanner>{error}</ZhihuErrorBanner></div>}
      {loading && items.length === 0 && (
        <div className="flex min-h-28 items-center justify-center gap-2 font-mono text-[10.5px] text-paper-faint">
          <Loader2 size={14} className="animate-spin text-cinnabar-soft" />
          <span>正在读取评论…</span>
        </div>
      )}
      {!loading && loadedOnce && !error && items.length === 0 && (
        <ZhihuEmptyState icon={<MessageCircle size={26} />} title="还没有评论" description="这里会显示这条内容下的讨论。" />
      )}

      {items.length > 0 && (
        <div className="mt-3 rounded-2xl border border-haze/70 bg-ink-raised/25 px-3.5 sm:px-4">
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

      {nextCursor && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loading}
          aria-label="加载更多评论"
          title="加载更多评论"
          className="mx-auto mt-3 flex size-10 items-center justify-center rounded-xl border border-haze/70 bg-ink-raised/40 text-paper-faint transition-colors hover:border-cinnabar/30 hover:bg-paper/5 hover:text-cinnabar-soft disabled:opacity-45"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={15} strokeWidth={1.6} />}
        </button>
      )}
    </section>
  )
}
