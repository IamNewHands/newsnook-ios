import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { Browser } from '@capacitor/browser'
import { ChevronLeft, ChevronRight, ExternalLink, Info, Loader2, LockKeyhole, MessageSquareQuote, SquarePen, ThumbsDown, ThumbsUp, UserPlus } from 'lucide-react'
import type { ZhihuCommentDraftStore } from '../comments/draftStore'
import type { ZhihuCommentsService } from '../comments/service'
import type { ZhihuContentDetail } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import { parseZhihuLink } from '../content/links'
import { normalizeZhihuContentHtml } from '../content/normalize'
import type { ZhihuContentService } from '../content/service'
import type { ZhihuFeedService } from '../feed/service'
import type { ZhihuInteractionService, ZhihuVoteState } from '../interaction/service'
import { canExecuteZhihuOperation } from '../protocol'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'
import type { ZhihuQuestionAnswerOrder } from '../api/endpoints'
import { SegmentedControl } from '../../../components/SegmentedControl'
import { ZhihuCollectionPicker } from './ZhihuCollectionPicker'
import { ZhihuCommentsSection } from './ZhihuCommentsSection'
import {
  ZhihuContentRow,
  ZhihuEntityIcon,
  ZhihuErrorBanner,
  ZhihuLoadingState,
  ZhihuSectionHeader,
  ZhihuSurface,
} from './ZhihuUi'
import { formatZhihuCount, zhihuEntityLabel } from './ZhihuUiUtils'

interface Props {
  refValue: ZhihuEntityRef
  preview?: ZhihuContentSummary
  contentService: ZhihuContentService
  feedService: ZhihuFeedService
  commentsService: ZhihuCommentsService
  onNavigate: (ref: ZhihuEntityRef, sourceAnchor?: string) => void
  restoreAnchor?: string
  authenticated: boolean
  accountId?: string
  commentDraftStore: ZhihuCommentDraftStore
  interaction: ZhihuInteractionService
  onWriteAnswer: (questionId: string) => void
}

function detailFromPreview(preview: ZhihuContentSummary): ZhihuContentDetail {
  return {
    ...preview,
    contentHtml: '',
    voteState: 'neutral',
    isFollowing: false,
  }
}

async function openExternal(url: string): Promise<void> {
  try {
    await Browser.open({ url })
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export function ZhihuContentScreen({ refValue, preview, contentService, feedService, commentsService, onNavigate, restoreAnchor, authenticated, accountId, commentDraftStore, interaction, onWriteAnswer }: Props) {
  const [detail, setDetail] = useState<ZhihuContentDetail | null>(null)
  const [answers, setAnswers] = useState<ZhihuContentSummary[]>([])
  const [answerOrder, setAnswerOrder] = useState<ZhihuQuestionAnswerOrder>('default')
  const [answersCursor, setAnswersCursor] = useState<string | undefined>()
  const [answersHasMore, setAnswersHasMore] = useState(false)
  const [answersLoadingMore, setAnswersLoadingMore] = useState(false)
  const [answersError, setAnswersError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [voteState, setVoteState] = useState<ZhihuVoteState>('neutral')
  const [voteCount, setVoteCount] = useState<number | undefined>()
  const [following, setFollowing] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [guestLimited, setGuestLimited] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setDetail(preview ? detailFromPreview(preview) : null)
    setAnswers([])
    setAnswersCursor(undefined)
    setAnswersHasMore(false)
    setAnswersError(null)
    setLoading(true)
    setError(null)
    setGuestLimited(!authenticated && Boolean(preview))
    void contentService.read(refValue, controller.signal).then(
      async (value) => {
        if (controller.signal.aborted) return
        setDetail(value)
        setGuestLimited(false)
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
          } catch (reason) {
            // 问题正文仍然可读；回答列表失败独立提示，不把一个失败请求伪装成“0 个回答”。
            if (!controller.signal.aborted) setAnswersError(reason instanceof Error ? reason.message : '回答列表读取失败')
          }
        }
        if (!controller.signal.aborted) setLoading(false)
      },
      (reason) => {
        if (controller.signal.aborted) return
        const apiError = reason instanceof ZhihuApiError ? reason : null
        // 知乎目前会对未登录详情接口返回 need_login/403，但推荐与热榜本身仍可匿名读取。
        // 已经从列表拿到的公开卡片不能因此变成一张“登录墙”：保留标题、作者和摘要，
        // 只有完整正文/评论/关系态明确提示需要登录。
        if (!authenticated && preview && (apiError?.code === 'forbidden' || apiError?.code === 'auth-expired')) {
          setDetail(detailFromPreview(preview))
          setGuestLimited(true)
          setError(null)
          setLoading(false)
          return
        }
        setError(apiError?.message ?? (reason instanceof Error ? reason.message : '读取正文失败'))
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [answerOrder, authenticated, contentService, feedService, preview, refValue])

  useEffect(() => {
    if (refValue.kind !== 'answer' || !detail?.questionId) return
    // 新版回答详情直接给 pagination_info.prev/next_answer_ids，这是最可靠的上下回答
    // 导航，不需要从问题第一页开始暴力扫描。只有上游没有该字段时才走分页回退。
    if ((detail.previousAnswerIds?.length ?? 0) > 0 || (detail.nextAnswerIds?.length ?? 0) > 0) return
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
  }, [detail?.nextAnswerIds?.length, detail?.previousAnswerIds?.length, detail?.questionId, feedService, refValue.id, refValue.kind])

  const loadMoreAnswers = async () => {
    if (refValue.kind !== 'question' || !answersCursor || answersLoadingMore) return
    setAnswersLoadingMore(true)
    try {
      setAnswersError(null)
      const page = await feedService.questionAnswers(refValue.id, answerOrder, answersCursor)
      setAnswers((prev) => {
        const seen = new Set(prev.map((item) => `${item.ref.kind}:${item.ref.id}`))
        return [...prev, ...page.items.filter((item) => !seen.has(`${item.ref.kind}:${item.ref.id}`))]
      })
      setAnswersCursor(page.nextCursor)
      setAnswersHasMore(page.hasMore)
    } catch (reason) {
      setAnswersError(reason instanceof Error ? reason.message : '加载更多回答失败')
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

  if (loading && !detail) {
    return <ZhihuLoadingState label="正在读取正文…" />
  }
  if (error || !detail) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pt-5 sm:px-6">
        <ZhihuErrorBanner>{error ?? '正文不可用'}</ZhihuErrorBanner>
      </div>
    )
  }

  const voteWritable = canExecuteZhihuOperation('vote.set')
  const questionFollowWritable = canExecuteZhihuOperation(following ? 'follow.question.clear' : 'follow.question.set')
  const currentAnswerIndex = refValue.kind === 'answer'
    ? answers.findIndex((item) => item.ref.kind === 'answer' && item.ref.id === refValue.id)
    : -1
  const previousAnswer = currentAnswerIndex > 0 ? answers[currentAnswerIndex - 1] : undefined
  const nextAnswer = currentAnswerIndex >= 0 ? answers[currentAnswerIndex + 1] : undefined
  const previousAnswerRef: ZhihuEntityRef | undefined = detail.previousAnswerIds?.[0]
    ? { kind: 'answer', id: detail.previousAnswerIds[0] }
    : previousAnswer?.ref
  const nextAnswerRef: ZhihuEntityRef | undefined = detail.nextAnswerIds?.[0]
    ? { kind: 'answer', id: detail.nextAnswerIds[0] }
    : nextAnswer?.ref
  const voteCountLabel = formatZhihuCount(voteCount)
  const commentCountLabel = formatZhihuCount(detail.commentCount)

  const actionClass = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-haze bg-ink-raised/55 px-3 text-[11px] text-paper-muted transition-colors hover:border-paper-faint/45 hover:bg-ink-raised hover:text-paper disabled:opacity-35'
  const activeActionClass = 'border-cinnabar/45 bg-cinnabar/12 text-cinnabar-soft'

  return (
    <article className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      <header className="border-b border-haze/55 pb-5">
        <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-cinnabar-soft">
          <ZhihuEntityIcon kind={refValue.kind} size={12} />
          <span>{zhihuEntityLabel(refValue.kind)}</span>
        </div>
        <h1 className="mt-2 font-display text-[27px] font-medium leading-[1.34] tracking-[0.003em] text-paper sm:text-[31px]">
          {detail.title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] text-paper-faint">
          {detail.author?.name && <span className="font-medium text-paper-muted">{detail.author.name}</span>}
          {detail.author?.headline && <span className="max-w-full truncate">{detail.author.headline}</span>}
          {voteCountLabel && <span>{voteCountLabel} 赞同</span>}
          {commentCountLabel && <span>{commentCountLabel} 评论</span>}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {refValue.kind === 'answer' && (
            <button
              type="button"
              disabled={!authenticated || !voteWritable || actionBusy}
              onClick={() => void toggleDownVote()}
              aria-label={voteState === 'down' ? '取消反对' : '反对'}
              title={!authenticated ? '登录后可反对' : voteState === 'down' ? '取消反对' : '反对'}
              className={`${actionClass} ${voteState === 'down' ? activeActionClass : ''}`}
            >
              <ThumbsDown size={14} strokeWidth={1.65} fill={voteState === 'down' ? 'currentColor' : 'none'} />
            </button>
          )}

          {(refValue.kind === 'answer' || refValue.kind === 'article') && (
            <button
              type="button"
              disabled={!authenticated || !voteWritable || actionBusy}
              onClick={() => void toggleVote()}
              aria-label={voteState === 'up' ? '取消赞同' : '赞同'}
              title={!authenticated ? '登录后可赞同' : voteState === 'up' ? '取消赞同' : '赞同'}
              className={`${actionClass} ${voteState === 'up' ? activeActionClass : ''}`}
            >
              <ThumbsUp size={14} strokeWidth={1.65} fill={voteState === 'up' ? 'currentColor' : 'none'} />
              {voteCountLabel && <span>{voteCountLabel}</span>}
            </button>
          )}

          {refValue.kind === 'question' && (
            <>
              <button
                type="button"
                disabled={!authenticated || !questionFollowWritable || actionBusy}
                onClick={() => void toggleQuestionFollow()}
                aria-label={following ? '取消关注问题' : '关注问题'}
                title={!authenticated ? '登录后可关注问题' : following ? '取消关注问题' : '关注问题'}
                className={`${actionClass} ${following ? activeActionClass : ''}`}
              >
                <UserPlus size={14} strokeWidth={1.65} />
              </button>
              <button
                type="button"
                disabled={!authenticated}
                onClick={() => onWriteAnswer(refValue.id)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-cinnabar/55 bg-cinnabar/12 px-3.5 text-[11px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/20 disabled:opacity-35"
              >
                <SquarePen size={14} strokeWidth={1.7} />
                <span>写回答</span>
              </button>
            </>
          )}

          <ZhihuCollectionPicker refValue={refValue} service={interaction} authenticated={authenticated} />
          <button
            type="button"
            onClick={() => void openExternal(detail.url)}
            aria-label="打开知乎原页"
            title="打开知乎原页"
            className={actionClass}
          >
            <ExternalLink size={14} strokeWidth={1.65} />
          </button>
        </div>

        {actionError && <div className="mt-3"><ZhihuErrorBanner>{actionError}</ZhihuErrorBanner></div>}
      </header>

      {guestLimited && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-haze/70 bg-ink-raised/45 px-3.5 py-3 text-[11.5px] leading-relaxed text-paper-muted">
          <LockKeyhole size={15} strokeWidth={1.6} className="mt-0.5 shrink-0 text-cinnabar-soft" />
          <span>当前显示的是信息流公开摘要；知乎要求登录后才能读取这条内容的完整正文、评论与回答导航。</span>
        </div>
      )}

      <div className="mt-6">
        {detail.contentHtml ? (
          <div
            className="reader-prose zhihu-prose text-paper"
            data-article-lang="zh"
            onClick={handleBodyClick}
            dangerouslySetInnerHTML={{ __html: normalizeZhihuContentHtml(detail.contentHtml) }}
          />
        ) : detail.excerpt ? (
          <div className="reader-prose zhihu-prose" data-article-lang="zh">
            <p data-cjk="true">{detail.excerpt}</p>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-8 text-[12px] text-paper-faint">
            <Info size={15} />
            <span>没有可显示的正文内容。</span>
          </div>
        )}
      </div>

      {refValue.kind === 'answer' && detail.questionId && (previousAnswerRef || nextAnswerRef) && (
        <nav className="mt-8 grid grid-cols-2 gap-2 border-y border-haze/55 py-3" aria-label="此问题的回答导航">
          <button
            type="button"
            disabled={!previousAnswerRef}
            onClick={() => previousAnswerRef && onNavigate(previousAnswerRef)}
            className="group flex min-h-11 items-center gap-2 rounded-xl px-2.5 text-left text-[12px] text-paper-muted transition-colors hover:bg-paper/5 hover:text-paper disabled:opacity-30"
          >
            <ChevronLeft size={16} strokeWidth={1.55} className="text-paper-faint group-hover:text-cinnabar-soft" />
            <span>上个回答</span>
          </button>
          <button
            type="button"
            disabled={!nextAnswerRef}
            onClick={() => nextAnswerRef && onNavigate(nextAnswerRef)}
            className="group flex min-h-11 items-center justify-end gap-2 rounded-xl px-2.5 text-right text-[12px] text-paper-muted transition-colors hover:bg-paper/5 hover:text-paper disabled:opacity-30"
          >
            <span>下个回答</span>
            <ChevronRight size={16} strokeWidth={1.55} className="text-paper-faint group-hover:text-cinnabar-soft" />
          </button>
        </nav>
      )}

      {refValue.kind === 'question' && (
        <section className="mt-8 border-t border-haze/55 pt-5">
          <ZhihuSectionHeader
            icon={<MessageSquareQuote size={17} />}
            title="回答"
            detail={answers.length > 0 ? `已载入 ${answers.length} 条` : undefined}
            action={(
              <div className="w-36">
                <SegmentedControl
                  label="回答排序"
                  value={answerOrder}
                  onChange={setAnswerOrder}
                  options={[
                    { value: 'default', label: '默认' },
                    { value: 'updated', label: '最新' },
                  ]}
                />
              </div>
            )}
          />
          {answersError && <div className="mb-3"><ZhihuErrorBanner>{answersError}</ZhihuErrorBanner></div>}
          {answers.length > 0 ? (
            <ZhihuSurface className="divide-y divide-haze/55">
              {answers.map((answer) => (
                <ZhihuContentRow key={`${answer.ref.kind}:${answer.ref.id}`} item={answer} onOpen={(item) => onNavigate(item.ref)} showReason={false} />
              ))}
            </ZhihuSurface>
          ) : !answersError && !loading ? (
            <div className="py-8 text-center text-[12px] text-paper-faint">暂无可读取回答</div>
          ) : null}
          {answersHasMore && (
            <button
              type="button"
              disabled={answersLoadingMore}
              onClick={() => void loadMoreAnswers()}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-haze/70 bg-ink-raised/45 font-mono text-[10.5px] text-paper-muted transition-colors hover:bg-ink-raised disabled:opacity-40"
            >
              {answersLoadingMore && <Loader2 size={13} className="animate-spin text-cinnabar-soft" />}
              <span>{answersLoadingMore ? '正在加载回答…' : '加载更多回答'}</span>
            </button>
          )}
        </section>
      )}

      {!guestLimited && ['answer', 'article', 'pin', 'question'].includes(refValue.kind) && (
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
