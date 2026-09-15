import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { Browser } from '@capacitor/browser'
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, Loader2, ThumbsDown, ThumbsUp, UserPlus } from 'lucide-react'

import type { Article } from '../../../lib/types'
import type { ZhihuCommentDraftStore } from '../comments/draftStore'
import type { ZhihuCommentsService } from '../comments/service'
import type { ZhihuContentDetail } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import { toNewsArticle } from '../content/bridge'
import { parseZhihuLink } from '../content/links'
import { normalizeZhihuContentHtml } from '../content/normalize'
import type { ZhihuContentService } from '../content/service'
import type { ZhihuFeedService } from '../feed/service'
import type { ZhihuInteractionService, ZhihuVoteState } from '../interaction/service'
import { canExecuteZhihuOperation } from '../protocol'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'
import type { ZhihuQuestionAnswerOrder } from '../api/endpoints'
import { ZhihuCollectionPicker } from './ZhihuCollectionPicker'
import { ZhihuCommentsSection } from './ZhihuCommentsSection'

interface Props {
  refValue: ZhihuEntityRef
  contentService: ZhihuContentService
  feedService: ZhihuFeedService
  commentsService: ZhihuCommentsService
  onNavigate: (ref: ZhihuEntityRef, sourceAnchor?: string) => void
  onOpenArticle: (article: Article) => void
  restoreAnchor?: string
  authenticated: boolean
  accountId?: string
  commentDraftStore: ZhihuCommentDraftStore
  interaction: ZhihuInteractionService
  onWriteAnswer: (questionId: string) => void
}

async function openExternal(url: string): Promise<void> {
  try {
    await Browser.open({ url })
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export function ZhihuContentScreen({ refValue, contentService, feedService, commentsService, onNavigate, onOpenArticle, restoreAnchor, authenticated, accountId, commentDraftStore, interaction, onWriteAnswer }: Props) {
  const [detail, setDetail] = useState<ZhihuContentDetail | null>(null)
  const [answers, setAnswers] = useState<ZhihuContentSummary[]>([])
  const [answerOrder, setAnswerOrder] = useState<ZhihuQuestionAnswerOrder>('default')
  const [answersCursor, setAnswersCursor] = useState<string | undefined>()
  const [answersHasMore, setAnswersHasMore] = useState(false)
  const [answersLoadingMore, setAnswersLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [voteState, setVoteState] = useState<ZhihuVoteState>('neutral')
  const [voteCount, setVoteCount] = useState<number | undefined>()
  const [following, setFollowing] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setAnswers([])
    setAnswersCursor(undefined)
    setAnswersHasMore(false)
    setLoading(true)
    setError(null)
    void contentService.read(refValue, controller.signal).then(
      async (value) => {
        if (controller.signal.aborted) return
        setDetail(value)
        setVoteState(value.voteState)
        setVoteCount(value.voteupCount)
        setFollowing(value.isFollowing)
        if (refValue.kind === 'question') {
          try {
            const page = await feedService.questionAnswers(refValue.id, answerOrder, undefined, controller.signal)
            if (!controller.signal.aborted) {
              setAnswers(page.items)
              setAnswersCursor(page.nextCursor)
              setAnswersHasMore(page.hasMore)
            }
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
  }, [answerOrder, contentService, feedService, refValue])

  useEffect(() => {
    if (refValue.kind !== 'answer' || !detail?.questionId) return
    const questionId = detail.questionId
    const controller = new AbortController()
    void (async () => {
      try {
        let cursor: string | undefined
        let collected: ZhihuContentSummary[] = []
        // 回答详情必须能给出同一问题的上/下一个回答。当前回答可能不在回答列表首屏，
        // 因此按服务端顺序向后寻找；找到后若它恰好是页尾，再多取一页以得到“下一个”。
        for (let pageIndex = 0; pageIndex < 10 && !controller.signal.aborted; pageIndex += 1) {
          const page = await feedService.questionAnswers(questionId, 'default', cursor, controller.signal)
          const seen = new Set(collected.map((item) => `${item.ref.kind}:${item.ref.id}`))
          collected = [...collected, ...page.items.filter((item) => !seen.has(`${item.ref.kind}:${item.ref.id}`))]
          const currentIndex = collected.findIndex((item) => item.ref.kind === 'answer' && item.ref.id === refValue.id)
          if (currentIndex >= 0) {
            if (currentIndex === collected.length - 1 && page.hasMore && page.nextCursor) {
              const nextPage = await feedService.questionAnswers(questionId, 'default', page.nextCursor, controller.signal)
              const currentSeen = new Set(collected.map((item) => `${item.ref.kind}:${item.ref.id}`))
              collected = [...collected, ...nextPage.items.filter((item) => !currentSeen.has(`${item.ref.kind}:${item.ref.id}`))]
            }
            break
          }
          if (!page.hasMore || !page.nextCursor) break
          cursor = page.nextCursor
        }
        if (!controller.signal.aborted) setAnswers(collected)
      } catch {
        // 正文已经可读时，回答队列失败只影响上/下一个导航，不抹掉正文。
      }
    })()
    return () => controller.abort()
  }, [detail?.questionId, feedService, refValue.id, refValue.kind])

  const loadMoreAnswers = async () => {
    if (refValue.kind !== 'question' || !answersCursor || answersLoadingMore) return
    setAnswersLoadingMore(true)
    try {
      const page = await feedService.questionAnswers(refValue.id, answerOrder, answersCursor)
      setAnswers((prev) => {
        const seen = new Set(prev.map((item) => `${item.ref.kind}:${item.ref.id}`))
        return [...prev, ...page.items.filter((item) => !seen.has(`${item.ref.kind}:${item.ref.id}`))]
      })
      setAnswersCursor(page.nextCursor)
      setAnswersHasMore(page.hasMore)
    } finally {
      setAnswersLoadingMore(false)
    }
  }

  const toggleDownVote = async () => {
    if (!authenticated || actionBusy || refValue.kind !== 'answer') return
    const previous = voteState
    const target: ZhihuVoteState = previous === 'down' ? 'neutral' : 'down'
    setActionBusy(true)
    setActionError(null)
    try {
      const result = await interaction.setVote(refValue, target)
      setVoteState(result.state)
      if (typeof result.voteupCount === 'number') setVoteCount(result.voteupCount)
      else if (previous === 'up' && target === 'down') {
        setVoteCount((count) => typeof count === 'number' ? Math.max(0, count - 1) : count)
      }
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '反对操作失败')
    } finally {
      setActionBusy(false)
    }
  }

  const toggleVote = async () => {
    if (!authenticated || actionBusy || (refValue.kind !== 'answer' && refValue.kind !== 'article')) return
    const target: ZhihuVoteState = voteState === 'up' ? 'neutral' : 'up'
    setActionBusy(true)
    setActionError(null)
    try {
      const result = await interaction.setVote(refValue, target)
      setVoteState(result.state)
      if (typeof result.voteupCount === 'number') setVoteCount(result.voteupCount)
      else setVoteCount((count) => typeof count === 'number' ? Math.max(0, count + (target === 'up' ? 1 : -1)) : count)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '赞同操作失败')
    } finally {
      setActionBusy(false)
    }
  }

  const toggleQuestionFollow = async () => {
    if (!authenticated || actionBusy || refValue.kind !== 'question') return
    const target = !following
    setActionBusy(true)
    setActionError(null)
    try {
      await interaction.setFollowing('question', refValue.id, target)
      setFollowing(target)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '关注问题失败')
    } finally {
      setActionBusy(false)
    }
  }

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
  const voteWritable = canExecuteZhihuOperation('vote.set')
  const questionFollowWritable = canExecuteZhihuOperation(following ? 'follow.question.clear' : 'follow.question.set')
  const currentAnswerIndex = refValue.kind === 'answer'
    ? answers.findIndex((item) => item.ref.kind === 'answer' && item.ref.id === refValue.id)
    : -1
  const previousAnswer = currentAnswerIndex > 0 ? answers[currentAnswerIndex - 1] : undefined
  const nextAnswer = currentAnswerIndex >= 0 ? answers[currentAnswerIndex + 1] : undefined
  return (
    <article className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      <div className="mb-5 border-b border-haze/60 pb-4">
        <div className="mb-2 font-mono text-[10px] tracking-[0.16em] text-cinnabar">{detail.ref.kind.toUpperCase()}</div>
        <h1 className="font-display text-[25px] font-semibold leading-[1.35] text-paper sm:text-[30px]">{detail.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-paper-faint">
          {detail.author?.name && <span>{detail.author.name}</span>}
          {typeof voteCount === 'number' && <span>{voteCount} 赞同</span>}
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
          {refValue.kind === 'answer' && (
            <button
              type="button"
              disabled={!authenticated || !voteWritable || actionBusy}
              onClick={() => void toggleDownVote()}
              title={!authenticated ? '登录后可反对回答' : !voteWritable ? '当前版本暂不可反对回答' : undefined}
              className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3.5 font-mono text-[11px] disabled:opacity-40 ${voteState === 'down' ? 'bg-paper/10 text-paper' : 'border border-haze/80 bg-ink-raised text-paper-muted'}`}
            >
              <ThumbsDown size={14} fill={voteState === 'down' ? 'currentColor' : 'none'} />{voteState === 'down' ? '已反对' : '反对'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void openExternal(detail.url)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-haze/80 bg-ink-raised px-3.5 font-mono text-[11px] text-paper-muted"
          >
            <ExternalLink size={14} /> 原站
          </button>
          {(refValue.kind === 'answer' || refValue.kind === 'article') && (
            <button
              type="button"
              disabled={!authenticated || !voteWritable || actionBusy}
              onClick={() => void toggleVote()}
              title={!authenticated ? '登录后可赞同' : !voteWritable ? '当前版本暂不可赞同' : undefined}
              className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3.5 font-mono text-[11px] disabled:opacity-40 ${voteState === 'up' ? 'bg-cinnabar text-white' : 'border border-haze/80 bg-ink-raised text-paper-muted'}`}
            >
              <ThumbsUp size={14} fill={voteState === 'up' ? 'currentColor' : 'none'} />{voteState === 'up' ? '已赞同' : '赞同'}
            </button>
          )}
          {refValue.kind === 'question' && (
            <>
              <button
                type="button"
                disabled={!authenticated || !questionFollowWritable || actionBusy}
                onClick={() => void toggleQuestionFollow()}
                title={!authenticated ? '登录后可关注问题' : !questionFollowWritable ? '当前版本暂不可关注问题' : undefined}
                className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3.5 font-mono text-[11px] disabled:opacity-40 ${following ? 'border border-haze/80 bg-ink-raised text-paper-muted' : 'bg-cinnabar text-white'}`}
              >
                <UserPlus size={14} />{following ? '已关注问题' : '关注问题'}
              </button>
              <button type="button" disabled={!authenticated} onClick={() => onWriteAnswer(refValue.id)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-cinnabar px-3.5 font-mono text-[11px] text-white disabled:opacity-40">写回答</button>
            </>
          )}
          <ZhihuCollectionPicker refValue={refValue} service={interaction} authenticated={authenticated} />
        </div>
        {actionError && <div role="alert" className="mt-2 rounded-lg border border-cinnabar/30 bg-cinnabar/8 px-3 py-2 text-[11px] text-paper-muted">{actionError}</div>}
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

      {refValue.kind === 'answer' && detail.questionId && (previousAnswer || nextAnswer) && (
        <nav className="mt-6 grid grid-cols-2 gap-2 border-y border-haze/60 py-3" aria-label="此问题的回答导航">
          <button
            type="button"
            disabled={!previousAnswer}
            onClick={() => previousAnswer && onNavigate(previousAnswer.ref)}
            className="flex min-h-11 items-center justify-start gap-2 rounded-xl border border-haze/70 px-3 text-left text-[12px] text-paper-muted disabled:opacity-35"
          >
            <ChevronLeft size={16} /><span className="truncate">上个回答</span>
          </button>
          <button
            type="button"
            disabled={!nextAnswer}
            onClick={() => nextAnswer && onNavigate(nextAnswer.ref)}
            className="flex min-h-11 items-center justify-end gap-2 rounded-xl border border-haze/70 px-3 text-right text-[12px] text-paper-muted disabled:opacity-35"
          >
            <span className="truncate">下个回答</span><ChevronRight size={16} />
          </button>
        </nav>
      )}

      {refValue.kind === 'question' && answers.length > 0 && (
        <section className="mt-8 border-t border-haze/60 pt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-display text-[18px] font-semibold text-paper">回答</h2>
            <div className="flex rounded-lg border border-haze/70 bg-ink-raised p-0.5">
              {([['default', '默认'], ['updated', '最新']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAnswerOrder(value)}
                  className={`min-h-8 rounded-md px-3 font-mono text-[10px] ${answerOrder === value ? 'bg-cinnabar text-white' : 'text-paper-faint'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
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
          {answersHasMore && (
            <button
              type="button"
              disabled={answersLoadingMore}
              onClick={() => void loadMoreAnswers()}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-haze/70 font-mono text-[11px] text-paper-muted disabled:opacity-50"
            >
              {answersLoadingMore && <Loader2 size={14} className="animate-spin" />}
              {answersLoadingMore ? '加载回答…' : '加载更多回答'}
            </button>
          )}
        </section>
      )}

      {['answer', 'article', 'pin', 'question'].includes(refValue.kind) && (
        <ZhihuCommentsSection
          refValue={refValue}
          service={commentsService}
          onNavigate={onNavigate}
          restoreAnchor={restoreAnchor}
          authenticated={authenticated}
          accountId={accountId}
          draftStore={commentDraftStore}
        />
      )}
    </article>
  )
}
