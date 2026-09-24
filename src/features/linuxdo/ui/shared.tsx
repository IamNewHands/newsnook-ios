import { Heart, MessageCircle } from 'lucide-react'
import type { KeyboardEvent } from 'react'

import type { LinuxDoCategory, LinuxDoTopicSummary } from '../types'
import { linuxDoTopicReadState } from '../topic/readState'
import { ago, avatar, compact, tagGlyph } from './utils'

export function TopicCard({
  topic,
  onOpen,
  category,
  onOpenCategory,
  onOpenTag,
}: {
  topic: LinuxDoTopicSummary
  onOpen: () => void
  category?: LinuxDoCategory
  onOpenCategory?: (category: LinuxDoCategory) => void
  onOpenTag?: (tag: string) => void
}) {
  const author = topic.posters[0]
  const last = topic.posters[topic.posters.length - 1]
  const readState = linuxDoTopicReadState(topic)
  const unreadLabel = readState === 'new'
    ? '新主题'
    : readState === 'unread'
      ? `${Math.max(1, topic.unread ?? 0, topic.newPosts ?? 0)} 条未读`
      : ''
  const openFromKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen()
  }
  return (
    <article
      role="link"
      tabIndex={0}
      aria-label={'打开主题：' + topic.title}
      onClick={onOpen}
      onKeyDown={openFromKeyboard}
      className="linuxdo-control group w-full rounded-xl sm:rounded-2xl border border-haze/50 bg-ink-raised/85 p-3 sm:p-4 text-left shadow-[0_1px_3px_rgba(0,0,0,0.03)] backdrop-blur-sm transition-all duration-180 hover:-translate-y-0.5 hover:border-cinnabar/30 hover:shadow-md active:translate-y-0"
    >
      <div className="flex items-start gap-2.5 sm:gap-3">
        <div className="mt-0.5 flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/5 dark:ring-white/10 bg-ink-deep shadow-sm">
          {avatar(author?.avatarTemplate, author?.username)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[10.5px] text-paper-faint">
            <span className="truncate font-medium text-paper-muted">{author?.username || 'Linux.do'}</span>
            <span>{topic.lastPostedAt ? ago(topic.lastPostedAt) : ''}</span>
          </div>
          <div className="flex items-start gap-2">
            <h3 className="line-clamp-2 flex-1 text-[14.5px] sm:text-[15px] font-semibold leading-[1.42] text-paper">{topic.title}</h3>
            {readState !== 'read' ? (
              <span
                className="mt-[0.48rem] h-2 w-2 shrink-0 rounded-full bg-sky-400 ring-2 ring-sky-400/15"
                role="status"
                aria-label={unreadLabel}
                title={unreadLabel}
              />
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {category ? <button type="button" disabled={!onOpenCategory} onClick={(event) => { event.stopPropagation(); onOpenCategory?.(category) }} className="linuxdo-control rounded-full bg-cinnabar/10 px-2 py-0.5 text-[10px] text-cinnabar-soft disabled:pointer-events-none">{category.name}</button> : null}
            {topic.tags.slice(0, 3).map((tag) => {
              const glyph = tagGlyph(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  disabled={!onOpenTag}
                  onClick={(event) => { event.stopPropagation(); onOpenTag?.(tag) }}
                  className="linuxdo-control inline-flex items-center gap-1 rounded-full border border-haze/70 bg-paper/[0.035] px-2 py-0.5 text-[10px] text-paper-muted disabled:pointer-events-none"
                >
                  {glyph ? <span className="text-[9px] leading-none">{glyph}</span> : <span className="font-mono text-[9px] text-paper-faint">#</span>}
                  <span>{tag}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-2.5 sm:mt-3 flex items-center justify-between gap-2 text-[10px] sm:text-[10.5px] text-paper-faint">
            <span className="min-w-0 truncate">
              {(last?.username ? '最后回复 ' + last.username : author?.username || 'Linux.do') + (topic.lastPostedAt ? ' · ' + ago(topic.lastPostedAt) : '')}
            </span>
            <span className="flex shrink-0 items-center gap-2.5 sm:gap-3 font-mono">
              <span className="inline-flex items-center gap-1"><MessageCircle size={11} />{compact(topic.replyCount)}</span>
              <span>{compact(topic.views)} 阅</span>
              {topic.likeCount > 0 ? <span className="inline-flex items-center gap-1"><Heart size={10} />{compact(topic.likeCount)}</span> : null}
            </span>
          </div>
        </div>
      </div>
    </article>
  )
}

