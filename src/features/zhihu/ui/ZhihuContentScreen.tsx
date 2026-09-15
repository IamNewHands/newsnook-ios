import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { Browser } from '@capacitor/browser'
import { BookOpen, ExternalLink } from 'lucide-react'

import type { Article } from '../../../lib/types'
import type { ZhihuCommentsService } from '../comments/service'
import type { ZhihuContentDetail } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import { toNewsArticle } from '../content/bridge'
import { parseZhihuLink } from '../content/links'
import { normalizeZhihuContentHtml } from '../content/normalize'
import type { ZhihuContentService } from '../content/service'
import type { ZhihuFeedService } from '../feed/service'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'
import { ZhihuCommentsSection } from './ZhihuCommentsSection'

interface Props {
  refValue: ZhihuEntityRef
  contentService: ZhihuContentService
  feedService: ZhihuFeedService
  commentsService: ZhihuCommentsService
  onNavigate: (ref: ZhihuEntityRef, sourceAnchor?: string) => void
  onOpenArticle: (article: Article) => void
  restoreAnchor?: string
}

async function openExternal(url: string): Promise<void> {
  try {
    await Browser.open({ url })
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export function ZhihuContentScreen({ refValue, contentService, feedService, commentsService, onNavigate, onOpenArticle, restoreAnchor }: Props) {
  const [detail, setDetail] = useState<ZhihuContentDetail | null>(null)
  const [answers, setAnswers] = useState<ZhihuContentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setAnswers([])
    setLoading(true)
    setError(null)
    void contentService.read(refValue, controller.signal).then(
      async (value) => {
        if (controller.signal.aborted) return
        setDetail(value)
        if (refValue.kind === 'question') {
          try {
            const page = await feedService.questionAnswers(refValue.id, 0, controller.signal)
            if (!controller.signal.aborted) setAnswers(page.items)
          } catch {
            // 问题正文仍然可读；回答列表失败独立降级，不抹掉已加载详情。
          }
        }
        if (!controller.signal.aborted) setLoading(false)
      },
      (reason) => {
        if (controller.signal.aborted) return
        const apiError = reason instanceof ZhihuApiError ? reason : null
        setError(apiError?.message ?? (reason instanceof Error ? reason.message : '读取正文失败'))
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [contentService, feedService, refValue])

  const handleBodyClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    const anchor = target?.closest('a[href]') as HTMLAnchorElement | null
    if (!anchor?.href) return
    event.preventDefault()
    const ref = parseZhihuLink(anchor.href)
    if (ref) onNavigate(ref)
    else void openExternal(anchor.href)
  }

  if (loading) {
    return <div className="py-16 text-center font-mono text-[12px] text-paper-faint">正在读取正文…</div>
  }
  if (error || !detail) {
    return <div role="alert" className="mx-auto mt-6 max-w-3xl rounded-xl border border-cinnabar/35 bg-cinnabar/8 p-4 text-[13px] leading-6 text-paper-muted">{error ?? '正文不可用'}</div>
  }

  const article = toNewsArticle(detail)
  return (
    <article className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      <div className="mb-5 border-b border-haze/60 pb-4">
        <div className="mb-2 font-mono text-[10px] tracking-[0.16em] text-cinnabar">{detail.ref.kind.toUpperCase()}</div>
        <h1 className="font-display text-[25px] font-semibold leading-[1.35] text-paper sm:text-[30px]">{detail.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-paper-faint">
          {detail.author?.name && <span>{detail.author.name}</span>}
          {typeof detail.voteupCount === 'number' && <span>{detail.voteupCount} 赞同</span>}
          {typeof detail.commentCount === 'number' && <span>{detail.commentCount} 评论</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {article && (
            <button
              type="button"
              onClick={() => onOpenArticle(article)}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-cinnabar px-3.5 font-mono text-[11px] font-medium text-white"
            >
              <BookOpen size={14} /> NewsNook 阅读
            </button>
          )}
          <button
            type="button"
            onClick={() => void openExternal(detail.url)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-haze/80 bg-ink-raised px-3.5 font-mono text-[11px] text-paper-muted"
          >
            <ExternalLink size={14} /> 原站
          </button>
        </div>
      </div>

      {detail.contentHtml ? (
        <div
          className="article-body text-paper"
          onClick={handleBodyClick}
          dangerouslySetInnerHTML={{ __html: normalizeZhihuContentHtml(detail.contentHtml) }}
        />
      ) : detail.excerpt ? (
        <p className="text-[15px] leading-8 text-paper-muted">{detail.excerpt}</p>
      ) : null}

      {refValue.kind === 'question' && answers.length > 0 && (
        <section className="mt-8 border-t border-haze/60 pt-5">
          <h2 className="mb-3 font-display text-[18px] font-semibold text-paper">回答</h2>
          <div className="space-y-2.5">
            {answers.map((answer) => (
              <button
                key={`${answer.ref.kind}:${answer.ref.id}`}
                type="button"
                onClick={() => onNavigate(answer.ref)}
                className="block w-full rounded-xl border border-haze/70 bg-ink-raised/55 p-3.5 text-left hover:border-cinnabar/35"
              >
                <div className="font-medium leading-6 text-paper">{answer.author?.name ?? answer.title}</div>
                {answer.excerpt && <p className="mt-1 line-clamp-3 text-[12.5px] leading-6 text-paper-muted">{answer.excerpt}</p>}
              </button>
            ))}
          </div>
        </section>
      )}

      {['answer', 'article', 'pin', 'question'].includes(refValue.kind) && (
        <ZhihuCommentsSection
          refValue={refValue}
          service={commentsService}
          onNavigate={onNavigate}
          restoreAnchor={restoreAnchor}
        />
      )}
    </article>
  )
}
