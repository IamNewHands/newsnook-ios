import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, MutableRefObject, ReactNode } from 'react'
import { Browser } from '@capacitor/browser'
import { ChevronDown, ChevronUp, Copy, ExternalLink, Heart, Info, Loader2, LockKeyhole, MessageCircle, MessageSquareQuote, SquarePen, ThumbsDown, ThumbsUp, UserPlus, X } from 'lucide-react'
import type { ZhihuCommentDraftStore } from '../comments/draftStore'
import type { ZhihuCommentsService } from '../comments/service'
import type { ZhihuContentDetail } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import { parseZhihuLink, parseZhihuVideoId } from '../content/links'
import { normalizeZhihuContentHtml } from '../content/normalize'
import type { ZhihuContentService } from '../content/service'
import type { ZhihuFeedService } from '../feed/service'
import type { ZhihuInteractionService, ZhihuVoteState } from '../interaction/service'
import { canExecuteZhihuOperation } from '../protocol'
import { segmentTargetFromElement, type ZhihuSegmentTarget } from '../segments/normalize'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'
import type { ZhihuQuestionAnswerOrder } from '../api/endpoints'
import { SegmentedControl } from '../../../components/SegmentedControl'
import { ImageLightbox } from '../../../components/ImageLightbox'
import { InlineArticleVideos } from '../../../components/InlineArticleVideos'
import { InlineYoutubeEmbeds } from '../../../components/InlineYoutubeEmbeds'
import { OriginPlayerSurface, type OriginPlayerCloseHandle } from '../../../components/OriginPlayerSurface'
import { useProgressiveImages } from '../../../hooks/useProgressiveImages'
import { ZhihuCollectionPicker } from './ZhihuCollectionPicker'
import { ZhihuCommentsSection } from './ZhihuCommentsSection'
import {
  ZhihuAuthorAvatar,
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
  onReplaceNavigate: (ref: ZhihuEntityRef) => void
  overlayCloserRef?: MutableRefObject<(() => boolean) | null>
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
    segmentInfos: [],
    allowSegmentInteraction: false,
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

async function copyPlainText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('当前系统无法写入剪贴板')
}

interface ZhihuAnswerActionBarProps {
  authenticated: boolean
  voteWritable: boolean
  actionBusy: boolean
  voteState: ZhihuVoteState
  voteCountLabel?: string
  commentCountLabel?: string
  commentsDisabled: boolean
  actionError?: string | null
  collectionAction: ReactNode
  onUpVote: () => void
  onDownVote: () => void
  onOpenComments: () => void
}

export function ZhihuAnswerActionBar({
  authenticated,
  voteWritable,
  actionBusy,
  voteState,
  voteCountLabel,
  commentCountLabel,
  commentsDisabled,
  actionError,
  collectionAction,
  onUpVote,
  onDownVote,
  onOpenComments,
}: ZhihuAnswerActionBarProps) {
  const voteDisabled = !authenticated || !voteWritable || actionBusy

  return (
    <nav
      className="pointer-events-none fixed inset-x-0 z-40 px-3 sm:px-4"
      style={{ bottom: 'calc(var(--sab) + 4rem)' }}
      aria-label="回答操作"
    >
      <div className="relative mx-auto w-full max-w-lg">
        {actionError && (
          <div role="alert" className="absolute bottom-full left-1/2 mb-2.5 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-cinnabar/35 bg-ink/98 px-3.5 py-2.5 text-[11px] text-cinnabar-soft shadow-2xl">
            {actionError}
          </div>
        )}

        <div className="pointer-events-auto flex h-[3.65rem] min-w-0 items-center rounded-[1.85rem] border border-haze/90 bg-ink-raised/95 p-1 shadow-[0_18px_46px_-18px_rgba(0,0,0,0.72),0_5px_16px_-8px_rgba(0,0,0,0.48)] ring-1 ring-cinnabar/10 backdrop-blur-xl">
          <button
            type="button"
            disabled={voteDisabled}
            onClick={onUpVote}
            aria-label={voteState === 'up' ? '取消赞同' : '赞同'}
            title={!authenticated ? '登录后可赞同' : voteState === 'up' ? '取消赞同' : '赞同'}
            className={`flex h-[2.95rem] min-w-0 flex-[1.3] items-center justify-center gap-2 rounded-[1.45rem] px-3 transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.97] disabled:opacity-35 disabled:active:scale-100 ${voteState === 'up' ? 'bg-cinnabar/16 text-cinnabar-soft shadow-[inset_0_0_0_1px_rgba(255,255,255,0.035)]' : 'text-paper-muted hover:bg-paper/5 hover:text-paper'}`}
          >
            <ThumbsUp size={19} strokeWidth={1.8} fill={voteState === 'up' ? 'currentColor' : 'none'} />
            {voteCountLabel && <span className="max-w-20 truncate text-[12.5px] font-medium tabular-nums">{voteCountLabel}</span>}
          </button>

          <span className="mx-1.5 h-6 w-px shrink-0 bg-haze/90" aria-hidden />

          <button
            type="button"
            disabled={voteDisabled}
            onClick={onDownVote}
            aria-label={voteState === 'down' ? '取消反对' : '反对'}
            title={!authenticated ? '登录后可反对' : voteState === 'down' ? '取消反对' : '反对'}
            className={`flex size-[2.95rem] shrink-0 items-center justify-center rounded-[1.45rem] transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.94] disabled:opacity-35 disabled:active:scale-100 ${voteState === 'down' ? 'bg-cinnabar/14 text-cinnabar-soft shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]' : 'text-paper-muted hover:bg-paper/5 hover:text-paper'}`}
          >
            <ThumbsDown size={18.5} strokeWidth={1.75} fill={voteState === 'down' ? 'currentColor' : 'none'} />
          </button>

          <span className="mx-1.5 h-6 w-px shrink-0 bg-haze/90" aria-hidden />

          <div className="flex size-[2.95rem] shrink-0 items-center justify-center text-paper-muted [&>button]:size-full [&>button]:min-h-0 [&>button]:rounded-[1.45rem] [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-0 [&>button]:transition-[background-color,color,transform] [&>button]:duration-200 [&>button:hover]:bg-paper/5 [&>button:hover]:text-paper [&>button:active]:scale-[0.94]">
            {collectionAction}
          </div>

          <span className="mx-1.5 h-6 w-px shrink-0 bg-haze/90" aria-hidden />

          <button
            type="button"
            disabled={commentsDisabled}
            onClick={onOpenComments}
            aria-label={commentCountLabel ? `查看 ${commentCountLabel} 条评论` : '查看评论'}
            title={commentsDisabled ? '当前内容暂无法读取评论' : '查看评论'}
            className="flex h-[2.95rem] min-w-0 flex-1 items-center justify-center gap-2 rounded-[1.45rem] px-3 text-paper-muted transition-[background-color,color,transform] duration-200 hover:bg-paper/5 hover:text-paper active:scale-[0.97] disabled:opacity-35 disabled:active:scale-100"
          >
            <MessageCircle size={19} strokeWidth={1.75} />
            {commentCountLabel && <span className="truncate text-[12px] font-medium tabular-nums">{commentCountLabel}</span>}
          </button>
        </div>
      </div>
    </nav>
  )
}

interface ZhihuAnswerCommentsDialogProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export function ZhihuAnswerCommentsDialog({ open, onClose, children }: ZhihuAnswerCommentsDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[74] flex min-h-0 flex-col bg-ink/98" role="dialog" aria-modal="true" aria-label="知乎回答评论">
      <button type="button" onClick={onClose} aria-label="关闭评论" title="关闭评论" className="absolute right-3 top-[calc(var(--sat)+0.5rem)] z-10 flex size-10 items-center justify-center rounded-xl border border-haze/60 bg-ink/90 text-paper-muted shadow-lg backdrop-blur-xl transition-colors hover:bg-ink-raised hover:text-paper">
        <X size={18} />
      </button>
      <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--sab)+1rem)] sm:px-6">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </div>
    </div>
  )
}

export function ZhihuContentScreen({ refValue, preview, contentService, feedService, commentsService, onNavigate, onReplaceNavigate, overlayCloserRef, restoreAnchor, authenticated, accountId, commentDraftStore, interaction, onWriteAnswer }: Props) {
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
  const proseRef = useRef<HTMLDivElement | null>(null)
  const questionDetailRef = useRef<HTMLDivElement | null>(null)
  const originPlayerCloseRef = useRef<OriginPlayerCloseHandle | null>(null)
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)
  const [videoPage, setVideoPage] = useState<{ url: string; title: string; poster?: string } | null>(null)
  const [commentsOpen, setCommentsOpen] = useState(Boolean(restoreAnchor))
  const [questionDetailExpanded, setQuestionDetailExpanded] = useState(false)
  const [questionDetailCanCollapse, setQuestionDetailCanCollapse] = useState(false)
  const [selectedSegment, setSelectedSegment] = useState<ZhihuSegmentTarget | null>(null)
  const [segmentCommentsOpen, setSegmentCommentsOpen] = useState(false)
  const [segmentBusy, setSegmentBusy] = useState(false)
  const [segmentError, setSegmentError] = useState<string | null>(null)
  const normalizedHtml = useMemo(
    () => normalizeZhihuContentHtml(
      detail?.contentHtml ?? '',
      detail?.segmentInfos ?? [],
      refValue,
    ),
    [detail?.contentHtml, detail?.segmentInfos, refValue],
  )

  // 与 NewsNook Reader 共用同一套图片代理、占位、渐显和失败处理。
  // 知乎图片直连失败时允许走原生字节通道 + Referer 自动补救，并保留点按重试。
  useProgressiveImages(proseRef, normalizedHtml, Boolean(normalizedHtml), {
    autoLoad: true,
    forceNativeFallback: true,
    imageReferer: 'https://www.zhihu.com/',
  })

  useEffect(() => {
    setLightbox(null)
    setVideoPage(null)
    setCommentsOpen(Boolean(restoreAnchor))
    setQuestionDetailExpanded(false)
    setQuestionDetailCanCollapse(false)
    setSelectedSegment(null)
    setSegmentCommentsOpen(false)
    setSegmentError(null)
  }, [refValue.id, refValue.kind, restoreAnchor])

  useEffect(() => {
    if (refValue.kind !== 'question') {
      setQuestionDetailCanCollapse(false)
      return
    }
    const node = questionDetailRef.current
    if (!node) return
    const measure = () => setQuestionDetailCanCollapse(node.scrollHeight > 300)
    const frame = window.requestAnimationFrame(measure)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(node)
    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [detail?.excerpt, normalizedHtml, refValue.kind])

  useEffect(() => {
    if (!overlayCloserRef) return
    if (!lightbox && !videoPage && !commentsOpen && !selectedSegment) {
      overlayCloserRef.current = null
      return
    }
    overlayCloserRef.current = () => {
      if (lightbox) {
        setLightbox(null)
        return true
      }
      if (videoPage) {
        // InkVideoPlayer 全屏/自定义层先按 Reader 的既有语义逐层退出，
        // 再由下一次返回关闭视频浮层。
        if (originPlayerCloseRef.current?.closeCustom()) return true
        setVideoPage(null)
        return true
      }
      if (commentsOpen) {
        setCommentsOpen(false)
        return true
      }
      if (segmentCommentsOpen) {
        setSegmentCommentsOpen(false)
        return true
      }
      if (selectedSegment) {
        setSelectedSegment(null)
        setSegmentError(null)
        return true
      }
      return false
    }
    return () => {
      overlayCloserRef.current = null
    }
  }, [commentsOpen, lightbox, overlayCloserRef, segmentCommentsOpen, selectedSegment, videoPage])

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

  const syncSegmentDom = (previous: ZhihuSegmentTarget, next: ZhihuSegmentTarget) => {
    const nodes = proseRef.current?.querySelectorAll<HTMLElement>('[data-reader-role="zhihu-segment"]') ?? []
    for (const node of nodes) {
      if (node.getAttribute('data-zhihu-segment-id') !== previous.segmentId) continue
      node.setAttribute('data-zhihu-segment-id', next.segmentId)
      node.setAttribute('data-zhihu-segment-liked', String(next.liked))
      node.setAttribute('data-zhihu-segment-like-count', String(next.likeCount))
    }
  }

  const toggleSegmentLike = async () => {
    if (!selectedSegment || !authenticated || segmentBusy) return
    const operation = selectedSegment.liked ? 'segment.like.clear' : 'segment.like.set'
    if (!canExecuteZhihuOperation(operation)) return
    const previous = selectedSegment
    setSegmentBusy(true)
    setSegmentError(null)
    try {
      const next = await interaction.setSegmentLiked(previous, !previous.liked)
      syncSegmentDom(previous, next)
      setSelectedSegment(next)
    } catch (reason) {
      setSegmentError(reason instanceof Error ? reason.message : '段落点赞失败')
    } finally {
      setSegmentBusy(false)
    }
  }

  const copySelectedSegment = async () => {
    if (!selectedSegment) return
    setSegmentError(null)
    try {
      await copyPlainText(selectedSegment.displayText)
      setSelectedSegment(null)
    } catch (reason) {
      setSegmentError(reason instanceof Error ? reason.message : '复制失败')
    }
  }

  const handleBodyClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return

    const segment = segmentTargetFromElement(target)
    if (segment) {
      event.preventDefault()
      event.stopPropagation()
      setSegmentError(null)
      setSegmentCommentsOpen(false)
      setSelectedSegment(segment)
      return
    }

    const anchor = target.closest('a') as HTMLAnchorElement | null
    const anchorUrl = anchor?.getAttribute('data-source-page') || anchor?.href || ''
    const zhihuVideoId = anchorUrl ? parseZhihuVideoId(anchorUrl) : null
    if (anchor && (anchor.getAttribute('data-media-format') === 'video-page' || zhihuVideoId)) {
      event.preventDefault()
      event.stopPropagation()
      const posterImage = anchor.querySelector('img')
      setVideoPage({
        url: anchorUrl || (zhihuVideoId ? `https://www.zhihu.com/video/${zhihuVideoId}` : anchor.href),
        title: anchor.getAttribute('data-related-title') || detail?.title || '视频',
        poster: posterImage?.currentSrc || posterImage?.getAttribute('src') || undefined,
      })
      return
    }

    const image = target.closest('img') as HTMLImageElement | null
    const imageCard = image?.closest('a[data-reader-role="zhihu-link-card"]')
    if (image && !imageCard && !image.classList.contains('async-img-failed')) {
      const src = image.currentSrc || image.src
      if (src) {
        event.preventDefault()
        event.stopPropagation()
        setLightbox({ src, alt: image.alt || detail?.title || '' })
        return
      }
    }

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
    <article className={`mx-auto w-full max-w-3xl px-4 pt-5 sm:px-6 ${refValue.kind === 'answer' ? 'pb-44' : 'pb-28'}`}>
      <header className="border-b border-haze/55 pb-5">
        <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-cinnabar-soft">
          <ZhihuEntityIcon kind={refValue.kind} size={12} />
          <span>{zhihuEntityLabel(refValue.kind)}</span>
        </div>
        <h1 className="mt-2 font-display text-[27px] font-medium leading-[1.34] tracking-[0.003em] text-paper sm:text-[31px]">
          {refValue.kind === 'answer' && detail.questionId ? (
            <button
              type="button"
              onClick={() => onNavigate({ kind: 'question', id: detail.questionId! })}
              title="查看问题详情"
              className="text-left transition-colors hover:text-cinnabar-soft"
            >
              {detail.title}
            </button>
          ) : detail.title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] text-paper-faint">
          {detail.author?.name && (
            <button
              type="button"
              onClick={() => onNavigate({ kind: 'people', id: detail.author!.token ?? detail.author!.id })}
              aria-label={`查看 ${detail.author.name} 的主页`}
              className="group inline-flex max-w-full items-center gap-2 rounded-full text-left transition-colors hover:text-cinnabar-soft"
            >
              <ZhihuAuthorAvatar author={detail.author} className="size-8" />
              <span className="max-w-[12rem] truncate font-medium text-paper-muted transition-colors group-hover:text-cinnabar-soft sm:max-w-[18rem]">{detail.author.name}</span>
            </button>
          )}
          {detail.author?.headline && <span className="max-w-full truncate">{detail.author.headline}</span>}
          {refValue.kind !== 'answer' && voteCountLabel && <span>{voteCountLabel} 赞同</span>}
          {refValue.kind !== 'answer' && commentCountLabel && <span>{commentCountLabel} 评论</span>}
        </div>

        {refValue.kind !== 'answer' && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {refValue.kind === 'article' && (
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
        )}

        {refValue.kind !== 'answer' && actionError && <div className="mt-3"><ZhihuErrorBanner>{actionError}</ZhihuErrorBanner></div>}
      </header>

      {guestLimited && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-haze/70 bg-ink-raised/45 px-3.5 py-3 text-[11.5px] leading-relaxed text-paper-muted">
          <LockKeyhole size={15} strokeWidth={1.6} className="mt-0.5 shrink-0 text-cinnabar-soft" />
          <span>当前显示的是信息流公开摘要；知乎要求登录后才能读取这条内容的完整正文、评论与回答导航。</span>
        </div>
      )}

      <div className="mt-6">
        <div
          ref={questionDetailRef}
          className={`relative ${refValue.kind === 'question' && questionDetailCanCollapse && !questionDetailExpanded ? 'max-h-[18rem] overflow-hidden' : ''}`}
        >
          {detail.contentHtml ? (
            <>
              <div
                ref={proseRef}
                className="reader-prose zhihu-prose text-paper"
                data-article-lang="zh"
                onClick={handleBodyClick}
                dangerouslySetInnerHTML={{ __html: normalizedHtml }}
              />
              <InlineArticleVideos
                rootRef={proseRef}
                html={normalizedHtml}
                enabled={Boolean(normalizedHtml)}
                fallbackTitle={detail.title}
                sourcePage={detail.url}
              />
              <InlineYoutubeEmbeds
                rootRef={proseRef}
                html={normalizedHtml}
                enabled={Boolean(normalizedHtml)}
                fallbackTitle={detail.title}
                sourcePage={detail.url}
              />
            </>
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
          {refValue.kind === 'question' && questionDetailCanCollapse && !questionDetailExpanded && (
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-ink" aria-hidden />
          )}
        </div>
        {refValue.kind === 'question' && questionDetailCanCollapse && (
          <div className="mt-2 flex justify-center border-b border-haze/45 pb-3">
            <button
              type="button"
              onClick={() => setQuestionDetailExpanded((value) => !value)}
              aria-expanded={questionDetailExpanded}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-haze/70 bg-ink-raised/45 px-3.5 text-[11px] text-paper-muted transition-colors hover:border-cinnabar/35 hover:text-cinnabar-soft"
            >
              {questionDetailExpanded ? <ChevronUp size={14} strokeWidth={1.7} /> : <ChevronDown size={14} strokeWidth={1.7} />}
              <span>{questionDetailExpanded ? '收起问题详情' : '展开问题详情'}</span>
            </button>
          </div>
        )}
      </div>

      {refValue.kind === 'answer' && detail.questionId && (previousAnswerRef || nextAnswerRef) && (
        <nav
          className="pointer-events-none fixed right-3 z-30 flex flex-col gap-2.5 sm:right-5"
          style={{ bottom: 'calc(var(--sab) + 8.75rem)' }}
          aria-label="此问题的回答导航"
        >
          <button
            type="button"
            disabled={!previousAnswerRef}
            onClick={() => previousAnswerRef && onReplaceNavigate(previousAnswerRef)}
            aria-label="上一个回答"
            title="上一个回答"
            className="group pointer-events-auto relative flex size-12 items-center justify-center overflow-hidden rounded-full border border-haze/90 bg-ink-raised/95 text-paper-muted shadow-[0_12px_30px_-12px_rgba(0,0,0,0.68),0_4px_12px_-6px_rgba(0,0,0,0.42)] ring-1 ring-cinnabar/10 backdrop-blur-xl transition-[transform,border-color,color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-cinnabar/45 hover:text-cinnabar-soft hover:shadow-[0_16px_34px_-12px_rgba(0,0,0,0.72)] active:translate-y-0 active:scale-[0.94] disabled:translate-y-0 disabled:border-haze/55 disabled:text-paper-faint disabled:opacity-30 disabled:shadow-md disabled:ring-0"
          >
            <ChevronUp size={20} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            disabled={!nextAnswerRef}
            onClick={() => nextAnswerRef && onReplaceNavigate(nextAnswerRef)}
            aria-label="下一个回答"
            title="下一个回答"
            className="group pointer-events-auto relative flex size-12 items-center justify-center overflow-hidden rounded-full border border-haze/90 bg-ink-raised/95 text-paper-muted shadow-[0_12px_30px_-12px_rgba(0,0,0,0.68),0_4px_12px_-6px_rgba(0,0,0,0.42)] ring-1 ring-cinnabar/10 backdrop-blur-xl transition-[transform,border-color,color,box-shadow] duration-200 hover:translate-y-0.5 hover:border-cinnabar/45 hover:text-cinnabar-soft hover:shadow-[0_16px_34px_-12px_rgba(0,0,0,0.72)] active:translate-y-0 active:scale-[0.94] disabled:translate-y-0 disabled:border-haze/55 disabled:text-paper-faint disabled:opacity-30 disabled:shadow-md disabled:ring-0"
          >
            <ChevronDown size={20} strokeWidth={1.9} />
          </button>
        </nav>
      )}

      {refValue.kind === 'answer' && (
        <ZhihuAnswerActionBar
          authenticated={authenticated}
          voteWritable={voteWritable}
          actionBusy={actionBusy}
          voteState={voteState}
          voteCountLabel={voteCountLabel}
          commentCountLabel={commentCountLabel}
          commentsDisabled={guestLimited}
          actionError={actionError}
          collectionAction={<ZhihuCollectionPicker refValue={refValue} service={interaction} authenticated={authenticated} />}
          onUpVote={() => void toggleVote()}
          onDownVote={() => void toggleDownVote()}
          onOpenComments={() => setCommentsOpen(true)}
        />
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

      {!guestLimited && refValue.kind !== 'answer' && ['article', 'pin', 'question'].includes(refValue.kind) && (
        <ZhihuCommentsSection
          target={refValue}
          service={commentsService}
          onNavigate={onNavigate}
          restoreAnchor={restoreAnchor}
          authenticated={authenticated}
          accountId={accountId}
          draftStore={commentDraftStore}
        />
      )}

      <ZhihuAnswerCommentsDialog open={refValue.kind === 'answer' && commentsOpen} onClose={() => setCommentsOpen(false)}>
        <ZhihuCommentsSection
          target={refValue}
          service={commentsService}
          onNavigate={(nextRef, anchor) => {
            setCommentsOpen(false)
            onNavigate(nextRef, anchor)
          }}
          restoreAnchor={restoreAnchor}
          authenticated={authenticated}
          accountId={accountId}
          draftStore={commentDraftStore}
          variant="dialog"
        />
      </ZhihuAnswerCommentsDialog>

      {selectedSegment && !segmentCommentsOpen && (
        <div
          className="fixed inset-0 z-[72] flex items-end bg-black/35 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="段落互动"
          onClick={() => { setSelectedSegment(null); setSegmentError(null) }}
        >
          <div
            className="w-full rounded-t-[1.75rem] border-t border-haze/80 bg-ink/98 px-4 pb-[calc(var(--sab)+1rem)] pt-3 shadow-2xl sm:mx-auto sm:max-w-xl sm:rounded-[1.5rem] sm:border sm:mb-4 sm:pb-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto h-1 w-10 rounded-full bg-paper-faint/30" aria-hidden />
            <div className="mt-4 rounded-xl border border-haze/60 bg-ink-raised/45 px-3.5 py-3 text-[12.5px] leading-[1.75] text-paper-muted">
              {selectedSegment.displayText}
            </div>
            {segmentError && <div className="mt-2.5"><ZhihuErrorBanner>{segmentError}</ZhihuErrorBanner></div>}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={
                  !authenticated
                  || segmentBusy
                  || !canExecuteZhihuOperation(selectedSegment.liked ? 'segment.like.clear' : 'segment.like.set')
                }
                onClick={() => void toggleSegmentLike()}
                className={`flex min-h-12 items-center justify-center gap-1.5 rounded-xl border text-[11px] transition-colors disabled:opacity-35 ${selectedSegment.liked ? 'border-cinnabar/45 bg-cinnabar/12 text-cinnabar-soft' : 'border-haze/70 bg-ink-raised/55 text-paper-muted hover:border-cinnabar/35 hover:text-cinnabar-soft'}`}
                title={!authenticated ? '登录后可点赞这段文字' : selectedSegment.liked ? '取消段落点赞' : '点赞这段文字'}
              >
                {segmentBusy ? <Loader2 size={14} className="animate-spin" /> : <Heart size={14} fill={selectedSegment.liked ? 'currentColor' : 'none'} strokeWidth={1.7} />}
                <span>{selectedSegment.liked ? '已赞' : '赞'}</span>
                {selectedSegment.likeCount > 0 && <span className="font-mono text-[9.5px]">{formatZhihuCount(selectedSegment.likeCount)}</span>}
              </button>
              <button
                type="button"
                disabled={!canExecuteZhihuOperation('segment.comment.list-root')}
                onClick={() => setSegmentCommentsOpen(true)}
                className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-haze/70 bg-ink-raised/55 text-[11px] text-paper-muted transition-colors hover:border-cinnabar/35 hover:text-cinnabar-soft disabled:opacity-35"
                title="查看段评"
              >
                <MessageCircle size={14} strokeWidth={1.7} />
                <span>段评</span>
                {selectedSegment.commentCount > 0 && <span className="font-mono text-[9.5px]">{formatZhihuCount(selectedSegment.commentCount)}</span>}
              </button>
              <button
                type="button"
                onClick={() => void copySelectedSegment()}
                className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-haze/70 bg-ink-raised/55 text-[11px] text-paper-muted transition-colors hover:border-cinnabar/35 hover:text-cinnabar-soft"
                title="复制这段文字"
              >
                <Copy size={14} strokeWidth={1.7} />
                <span>复制</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedSegment && segmentCommentsOpen && (
        <div className="fixed inset-0 z-[74] flex min-h-0 flex-col bg-ink/98" role="dialog" aria-modal="true" aria-label="知乎段评">
          <header className="shrink-0 border-b border-haze/60 px-4 pb-3 pt-[calc(var(--sat)+0.75rem)] sm:px-6">
            <div className="flex items-center gap-3">
              <MessageCircle size={17} className="shrink-0 text-cinnabar-soft" strokeWidth={1.7} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[17px] text-paper">段评</div>
                <div className="mt-0.5 line-clamp-1 text-[10.5px] text-paper-faint">{selectedSegment.displayText}</div>
              </div>
              <button
                type="button"
                onClick={() => setSegmentCommentsOpen(false)}
                aria-label="关闭段评"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-paper-muted hover:bg-paper/5 hover:text-paper"
              >
                <X size={18} />
              </button>
            </div>
          </header>
          <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--sab)+1rem)] sm:px-6">
            <div className="mx-auto w-full max-w-3xl">
              <ZhihuCommentsSection
                target={selectedSegment}
                service={commentsService}
                onNavigate={(ref, anchor) => {
                  setSegmentCommentsOpen(false)
                  setSelectedSegment(null)
                  onNavigate(ref, anchor)
                }}
                authenticated={authenticated}
                accountId={accountId}
                draftStore={commentDraftStore}
              />
            </div>
          </div>
        </div>
      )}

      {videoPage && (
        <div className="fixed inset-0 z-[75] flex min-h-0 flex-col bg-ink/98" role="dialog" aria-modal="true" aria-label={`播放视频：${videoPage.title}`}>
          <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-haze/60 px-3">
            <div className="min-w-0 flex-1 truncate font-display text-[16px] text-paper">{videoPage.title}</div>
            <button
              type="button"
              onClick={() => setVideoPage(null)}
              aria-label="关闭视频"
              className="flex size-10 items-center justify-center rounded-xl text-paper-muted hover:bg-paper/5 hover:text-paper"
            >
              <X size={18} />
            </button>
          </header>
          <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto pb-6">
            <OriginPlayerSurface
              pageUrl={videoPage.url}
              referrer={detail.url}
              title={videoPage.title}
              poster={videoPage.poster}
              autoUseReader
              closeHandleRef={originPlayerCloseRef}
              openOriginal={() => void openExternal(videoPage.url)}
            />
          </div>
        </div>
      )}

      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}
    </article>
  )
}
