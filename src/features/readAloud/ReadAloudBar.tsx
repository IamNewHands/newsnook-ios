import {
  LoaderCircle,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
} from 'lucide-react'

import type { ReadAloudSnapshot } from './types'

interface Props {
  snapshot: ReadAloudSnapshot
  activeForArticle: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onPrevious: () => void
  onNext: () => void
  onStop: () => void
}

export function ReadAloudBar({
  snapshot,
  activeForArticle,
  onStart,
  onPause,
  onResume,
  onPrevious,
  onNext,
  onStop,
}: Props) {
  if (!activeForArticle) return null

  const busy = snapshot.state === 'loading'
  const playing = snapshot.state === 'playing' || busy
  const segmentLabel = snapshot.segmentCount
    ? `${snapshot.segmentIndex + 1} / ${snapshot.segmentCount}`
    : ''

  return (
    <div
      role="region"
      aria-label="文章朗读控制"
      className="border-b border-haze/40 bg-ink-raised/72 backdrop-blur-md"
    >
      <div className="page-x mx-auto flex min-h-12 w-full max-w-4xl items-center gap-2 lg:px-8">
        <Volume2
          size={15}
          strokeWidth={1.7}
          className="shrink-0 text-cinnabar"
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-paper">
            {snapshot.state === 'error'
              ? '朗读遇到问题'
              : snapshot.state === 'ended'
                ? '朗读完成'
                : busy
                  ? '正在准备语音…'
                  : playing
                    ? '正在朗读'
                    : '朗读已暂停'}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[9px] tracking-[0.08em] text-paper-faint">
            {snapshot.error ||
              `${segmentLabel}${snapshot.sourceName ? ` · ${snapshot.sourceName}` : ''}`}
          </span>
        </span>

        <button
          type="button"
          onClick={onPrevious}
          aria-label="上一段"
          disabled={busy}
          className="flex h-8 w-8 items-center justify-center rounded-full text-paper-muted hover:bg-ink hover:text-paper disabled:opacity-35"
        >
          <SkipBack size={15} strokeWidth={1.8} />
        </button>

        <button
          type="button"
          onClick={
            snapshot.state === 'error' || snapshot.state === 'ended'
              ? onStart
              : playing
                ? onPause
                : onResume
          }
          aria-label={
            snapshot.state === 'error' || snapshot.state === 'ended'
              ? '重新朗读'
              : playing
                ? '暂停朗读'
                : '继续朗读'
          }
          className="flex h-9 w-9 items-center justify-center rounded-full bg-cinnabar text-white shadow-sm active:scale-95"
        >
          {busy ? (
            <LoaderCircle size={16} strokeWidth={1.8} className="animate-spin" />
          ) : snapshot.state === 'error' || snapshot.state === 'ended' ? (
            <Play size={16} strokeWidth={1.8} />
          ) : playing ? (
            <Pause size={16} strokeWidth={1.8} />
          ) : (
            <Play size={16} strokeWidth={1.8} />
          )}
        </button>

        <button
          type="button"
          onClick={onNext}
          aria-label="下一段"
          disabled={busy}
          className="flex h-8 w-8 items-center justify-center rounded-full text-paper-muted hover:bg-ink hover:text-paper disabled:opacity-35"
        >
          <SkipForward size={15} strokeWidth={1.8} />
        </button>

        <button
          type="button"
          onClick={onStop}
          aria-label="停止朗读"
          className="flex h-8 w-8 items-center justify-center rounded-full text-paper-faint hover:bg-ink hover:text-paper"
        >
          <Square size={13} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
}
