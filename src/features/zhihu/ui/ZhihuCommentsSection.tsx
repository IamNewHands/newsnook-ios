import { useEffect, useState } from 'react'
import { ChevronDown, MessageCircle } from 'lucide-react'

import { normalizeZhihuContentHtml } from '../content/normalize'
import type { ZhihuCommentsService } from '../comments/service'
import type { ZhihuCommentNode } from '../comments/types'
import type { ZhihuEntityRef } from '../types'

interface Props {
  refValue: ZhihuEntityRef
  service: ZhihuCommentsService
  onNavigate: (ref: ZhihuEntityRef, sourceAnchor?: string) => void
  restoreAnchor?: string
}

function mergeComments(current: ZhihuCommentNode[], incoming: ZhihuCommentNode[]): ZhihuCommentNode[] {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !seen.has(item.id))]
}

function CommentItem({
  comment,
  service,
  onNavigate,
}: {
  comment: ZhihuCommentNode
  service: ZhihuCommentsService
  onNavigate: Props['onNavigate']
}) {
  const cached = service.cachedChildren(comment.id)
  const initialChildren = cached?.items ?? comment.children
  const [children, setChildren] = useState(initialChildren)
  const [nextCursor, setNextCursor] = useState<string | undefined>(cached?.nextCursor)
  const [expanded, setExpanded] = useState(initialChildren.length > 0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        <span className="shrink-0 font-mono text-[10px] text-paper-faint">{comment.likeCount} 赞</span>
      </div>
      {comment.replyToAuthor && (
        <div className="mt-1 text-[10.5px] text-paper-faint">回复 {comment.replyToAuthor.name}</div>
      )}
      <div
        className="article-body mt-1.5 text-[13px] leading-6 text-paper-muted"
        dangerouslySetInnerHTML={{ __html: normalizeZhihuContentHtml(comment.contentHtml) }}
      />

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
                <CommentItem key={child.id} comment={child} service={service} onNavigate={onNavigate} />
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

export function ZhihuCommentsSection({ refValue, service, onNavigate, restoreAnchor }: Props) {
  const initialCache = service.cachedRoot(refValue)
  const [opened, setOpened] = useState(Boolean(initialCache?.items.length || restoreAnchor))
  const [items, setItems] = useState<ZhihuCommentNode[]>(initialCache?.items ?? [])
  const [nextCursor, setNextCursor] = useState<string | undefined>(initialCache?.nextCursor)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const cached = service.cachedRoot(refValue)
    setOpened(Boolean(cached?.items.length || restoreAnchor))
    setItems(cached?.items ?? [])
    setNextCursor(cached?.nextCursor)
    setLoading(false)
    setError(null)
  }, [refValue, restoreAnchor, service])

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
    void service.listRoot(refValue).then(
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
  }, [error, items.length, loading, refValue, restoreAnchor, service])

  const load = () => {
    if (loading) return
    setOpened(true)
    setLoading(true)
    setError(null)
    void service.listRoot(refValue, nextCursor).then(
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

  return (
    <section className="mt-8 border-t border-haze/60 pt-5" aria-label="知乎评论">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[18px] font-semibold text-paper">
          <MessageCircle size={17} /> 评论
        </h2>
        {!opened && (
          <button type="button" onClick={load} className="min-h-9 rounded-lg border border-haze/70 px-3 font-mono text-[10.5px] text-paper-muted hover:border-cinnabar/40 hover:text-cinnabar">
            读取评论
          </button>
        )}
      </div>

      <div className="mt-3 rounded-xl border border-haze/60 bg-ink-raised/40 px-3 py-2 text-[10.5px] leading-5 text-paper-faint">
        评论发送、点赞与删除属于账号写操作；当前协议只有源码证据，未通过授权实网写入/读回，因此保持禁用。
      </div>

      {opened && loading && items.length === 0 && <div className="py-8 text-center font-mono text-[10.5px] text-paper-faint">正在读取评论…</div>}
      {error && <div role="alert" className="mt-3 rounded-lg border border-cinnabar/30 bg-cinnabar/8 p-2.5 text-[11px] text-paper-muted">{error}</div>}
      {opened && !loading && !error && items.length === 0 && <div className="py-8 text-center text-[11px] text-paper-faint">暂无可解析评论</div>}
      {items.length > 0 && (
        <div className="mt-2">
          {items.map((comment) => <CommentItem key={comment.id} comment={comment} service={service} onNavigate={onNavigate} />)}
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
