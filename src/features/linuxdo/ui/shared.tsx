import { Heart, MessageCircle } from 'lucide-react'

import type { LinuxDoTopicSummary } from '../types'
import { ago, avatar, compact } from './utils'

export function TopicCard({ topic, onOpen, categoryName }: { topic: LinuxDoTopicSummary; onOpen: () => void; categoryName?: string }) {
  const author = topic.posters[0]
  const last = topic.posters[topic.posters.length - 1]
  return (
    <button
      type="button"
      onClick={onOpen}
      className="linuxdo-control group w-full rounded-[22px] border border-haze/70 bg-ink-raised px-4 py-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-cinnabar/30 hover:shadow-md active:translate-y-0"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-10 w-10 shrink-0 overflow-hidden rounded-full border border-haze bg-ink-deep shadow-sm">
          {avatar(author?.avatarTemplate, author?.username)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between gap-2 text-[10.5px] text-paper-faint"><span className="truncate font-medium text-paper-muted">{author?.username || 'Linux.do'}</span><span>{topic.lastPostedAt ? ago(topic.lastPostedAt) : ''}</span></div>
          <div className="flex items-start gap-2">
            <h3 className="line-clamp-2 flex-1 text-[15px] font-semibold leading-[1.45] text-paper">{topic.title}</h3>
            {topic.unseen || (topic.newPosts || 0) > 0 ? (
              <span className="mt-0.5 shrink-0 rounded-full bg-cinnabar/15 px-2 py-0.5 font-mono text-[9px] font-semibold tracking-[0.08em] text-cinnabar-soft">NEW</span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {categoryName ? <span className="rounded-full bg-cinnabar/10 px-2 py-0.5 text-[10px] text-cinnabar-soft">{categoryName}</span> : null}
            {topic.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-full border border-haze/70 bg-paper/[0.035] px-2 py-0.5 text-[10px] text-paper-muted">#{tag}</span>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-[10.5px] text-paper-faint">
            <span className="min-w-0 truncate">
              {(last?.username ? '最后回复 ' + last.username : author?.username || 'Linux.do') + (topic.lastPostedAt ? ' · ' + ago(topic.lastPostedAt) : '')}
            </span>
            <span className="flex shrink-0 items-center gap-3 font-mono">
              <span className="inline-flex items-center gap-1"><MessageCircle size={11} />{compact(topic.replyCount)}</span>
              <span>{compact(topic.views)} 阅</span>
              {topic.likeCount > 0 ? <span className="inline-flex items-center gap-1"><Heart size={10} />{compact(topic.likeCount)}</span> : null}
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}

