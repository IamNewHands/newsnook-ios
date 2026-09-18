import type { ReactNode } from 'react'
import {
  Bookmark,
  ChevronRight,
  CircleHelp,
  FileText,
  Hash,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  MessageSquareQuote,
  ThumbsUp,
  UserRound,
} from 'lucide-react'

import type { ZhihuAuthor, ZhihuContentSummary, ZhihuEntityKind } from '../types'
import { formatZhihuCount, zhihuEntityLabel } from './ZhihuUiUtils'

export function ZhihuEntityIcon({ kind, size = 13 }: { kind: ZhihuEntityKind; size?: number }) {
  const props = { size, strokeWidth: 1.6, className: 'shrink-0' }
  switch (kind) {
    case 'answer': return <MessageSquareQuote {...props} />
    case 'article': return <FileText {...props} />
    case 'question': return <CircleHelp {...props} />
    case 'pin': return <Lightbulb {...props} />
    case 'people': return <UserRound {...props} />
    case 'topic': return <Hash {...props} />
    case 'collection': return <Bookmark {...props} />
    case 'comment': return <MessageCircle {...props} />
    default: return <FileText {...props} />
  }
}

export function ZhihuAuthorAvatar({ author, className = 'size-8' }: { author: ZhihuAuthor; className?: string }) {
  const initial = author.name.trim().slice(0, 1) || '?'
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-haze/70 bg-ink-raised/70 font-display text-paper-muted ${className}`}
      aria-hidden
    >
      <span className="select-none text-[0.72em] leading-none">{initial}</span>
      {author.avatarUrl && (
        <img
          src={author.avatarUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-cover"
          onError={(event) => { event.currentTarget.style.display = 'none' }}
        />
      )}
    </span>
  )
}

export function ZhihuSurface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-haze/75 bg-ink-raised/45 shadow-[var(--shadow-lift)] ${className}`}>
      {children}
    </div>
  )
}

export function ZhihuSectionHeader({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode
  title: string
  detail?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon && <span className="text-cinnabar-soft">{icon}</span>}
          <h2 className="font-display text-[18px] font-medium leading-tight text-paper">{title}</h2>
        </div>
        {detail && <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-paper-faint">{detail}</p>}
      </div>
      {action}
    </div>
  )
}

export function ZhihuLoadingState({ label = '正在读取…' }: { label?: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2.5 text-paper-faint">
      <LoaderCircle size={22} className="animate-spin text-cinnabar-soft" />
      <span className="font-mono text-[10.5px] tracking-[0.08em]">{label}</span>
    </div>
  )
}

export function ZhihuEmptyState({ icon, title, description }: { icon?: ReactNode; title: string; description?: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
      {icon && <div className="mb-3 text-paper-faint/55">{icon}</div>}
      <p className="font-display text-[16px] text-paper-muted">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-[12px] leading-relaxed text-paper-faint">{description}</p>}
    </div>
  )
}

export function ZhihuErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-cinnabar/30 bg-cinnabar/8 px-3.5 py-3 text-[12px] leading-relaxed text-paper-muted">
      {children}
    </div>
  )
}

function formatZhihuDetailTime(value?: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const date = new Date(value * 1000)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function ZhihuAnswerMeta({
  createdAt,
  updatedAt,
  ipLocation,
}: {
  createdAt?: number
  updatedAt?: number
  ipLocation?: string
}) {
  const created = formatZhihuDetailTime(createdAt)
  const updated = formatZhihuDetailTime(updatedAt)
  const entries = [
    { label: '发布于', value: created ?? '时间未知', timestamp: createdAt },
    { label: '编辑于', value: updated ?? '时间未知', timestamp: updatedAt },
    { label: 'IP 属地', value: ipLocation?.trim() || '未显示' },
  ]
  return (
    <dl
      className="mt-7 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-haze/25 pt-2.5 text-[10.5px] leading-5 text-paper-faint/55"
      aria-label="回答信息"
    >
      {entries.map((entry, index) => (
        <div key={entry.label} className="inline-flex min-w-0 items-baseline gap-1">
          {index > 0 && <span className="mr-1 text-paper-faint/25" aria-hidden>·</span>}
          <dt className="shrink-0 text-paper-faint/45">{entry.label}</dt>
          <dd className="min-w-0 text-paper-faint/65">
            {entry.timestamp && entry.value !== '时间未知'
              ? <time dateTime={new Date(entry.timestamp * 1000).toISOString()}>{entry.value}</time>
              : entry.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function ZhihuContentRow({
  item,
  onOpen,
  showReason = true,
  trailing,
  compact = false,
}: {
  item: ZhihuContentSummary
  onOpen: (item: ZhihuContentSummary) => void
  showReason?: boolean
  trailing?: ReactNode
  /** 首页信息流保持与 NewsNook 新闻列表相同的扫描密度：标题 2 行、摘要 2 行。 */
  compact?: boolean
}) {
  const vote = formatZhihuCount(item.voteupCount)
  const comments = formatZhihuCount(item.commentCount)
  if (compact) {
    return (
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="group block w-full overflow-hidden rounded-2xl border border-haze/70 bg-ink-raised/48 p-3.5 text-left shadow-[0_12px_30px_-24px_rgba(0,0,0,0.75)] transition-[border-color,background-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-cinnabar/35 hover:bg-ink-raised/72 hover:shadow-[0_18px_36px_-24px_rgba(0,0,0,0.86)] active:translate-y-0 active:scale-[0.995] sm:p-4"
      >
        <span className="flex min-w-0 items-stretch gap-3.5">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="zhihu-content-row-title is-compact block font-display text-[17px] font-medium leading-[1.42] tracking-[0.005em] text-paper transition-colors group-hover:text-cinnabar-soft sm:text-[18px]">
              {item.title}
            </span>
            {item.excerpt && (
              <span className="zhihu-content-row-excerpt is-compact mt-1.5 block text-[12.5px] leading-[1.68] text-paper-muted">
                {item.excerpt}
              </span>
            )}
            {vote && (
              <span className="mt-auto flex items-center gap-1.5 pt-2.5 font-mono text-[10.5px] text-paper-faint">
                <ThumbsUp size={12.5} strokeWidth={1.65} className="text-cinnabar-soft/75" />
                <span>{vote} 赞同</span>
              </span>
            )}
          </span>
          {item.imageUrl && (
            <span className="relative aspect-[4/3] w-[34%] max-w-32 shrink-0 overflow-hidden rounded-xl border border-haze/60 bg-ink-deep sm:max-w-36">
              <img
                src={item.imageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.035]"
                onError={(event) => { event.currentTarget.parentElement?.classList.add('hidden') }}
              />
            </span>
          )}
        </span>
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group relative block w-full px-4 py-3.5 text-left transition-colors duration-200 hover:bg-ink-raised active:bg-ink-deep/25 sm:px-5 sm:py-4"
    >
      <span className="flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] text-paper-faint">
        <span className="flex items-center gap-1.25 text-cinnabar-soft/85">
          <ZhihuEntityIcon kind={item.ref.kind} size={12} />
          <span>{zhihuEntityLabel(item.ref.kind)}</span>
        </span>
        {item.author?.name && (
          <>
            <span aria-hidden className="text-paper-faint/45">·</span>
            <span className="truncate text-paper-muted/90">{item.author.name}</span>
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-paper-faint">
          {vote && <span>{vote} 赞同</span>}
          {comments && <span>{comments} 评论</span>}
          {trailing}
        </span>
      </span>

      <span className="mt-1.5 flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className={`zhihu-content-row-title block font-display text-[17px] font-medium leading-[1.46] tracking-[0.005em] text-paper transition-colors group-hover:text-cinnabar sm:text-[18px] ${compact ? 'is-compact' : ''}`}>
            {item.title}
          </span>
          {item.excerpt && (
            <span className={`zhihu-content-row-excerpt mt-1.5 block text-[13px] leading-[1.72] text-paper-muted ${compact ? 'is-compact' : ''}`}>
              {item.excerpt}
            </span>
          )}
          {showReason && item.recommendationReason && (
            <span className="mt-2 block font-mono text-[10.5px] leading-relaxed text-cinnabar-soft/85">
              {item.recommendationReason}
            </span>
          )}
        </span>
        <ChevronRight size={16} strokeWidth={1.45} className="mt-1 shrink-0 text-paper-faint/60 transition-transform group-hover:translate-x-0.5 group-hover:text-cinnabar-soft" />
      </span>
    </button>
  )
}
