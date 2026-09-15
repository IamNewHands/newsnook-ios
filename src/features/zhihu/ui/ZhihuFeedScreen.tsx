import { RefreshCw, Search } from 'lucide-react'

import type { ZhihuApiError } from '../api/errors'
import { isZhihuOperationEnabled } from '../protocol'
import type { ZhihuContentSummary, ZhihuEntityRef, ZhihuFeedMode } from '../types'

interface Props {
  mode: ZhihuFeedMode
  items: ZhihuContentSummary[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: ZhihuApiError | null
  onModeChange: (mode: ZhihuFeedMode) => void
  onRefresh: () => void
  onLoadMore: () => void
  onOpen: (ref: ZhihuEntityRef) => void
  onSearch: () => void
}

const MODES: Array<{ id: ZhihuFeedMode; label: string; enabled: boolean; hint?: string }> = [
  { id: 'recommended', label: '推荐', enabled: true },
  { id: 'hot', label: '热榜', enabled: true },
  {
    id: 'following',
    label: '关注',
    enabled: isZhihuOperationEnabled('feed.following'),
    hint: '需完成独立登录实网验证',
  },
]

function errorMessage(error: ZhihuApiError): string {
  switch (error.code) {
    case 'verification-required': return '知乎返回了验证页，请稍后再试或在官方客户端完成验证。'
    case 'rate-limited': return '请求过于频繁，知乎暂时限流。'
    case 'unsupported': return error.message
    case 'invalid-response': return '知乎返回的数据格式已变化，本页没有把解析失败伪装成空列表。'
    default: return `读取失败：${error.message}`
  }
}

export function ZhihuFeedScreen({
  mode,
  items,
  loading,
  loadingMore,
  hasMore,
  error,
  onModeChange,
  onRefresh,
  onLoadMore,
  onOpen,
  onSearch,
}: Props) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-3 sm:px-6">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1 rounded-xl border border-haze/70 bg-ink-raised/70 p-1">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={!item.enabled}
              title={item.hint}
              onClick={() => item.enabled && onModeChange(item.id)}
              className={`min-h-9 flex-1 rounded-lg px-3 font-mono text-[11px] font-medium transition-colors ${
                mode === item.id
                  ? 'bg-cinnabar text-white'
                  : item.enabled
                    ? 'text-paper-muted hover:bg-ink hover:text-paper'
                    : 'cursor-not-allowed text-paper-faint opacity-55'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onSearch}
          aria-label="搜索知乎"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-haze/70 bg-ink-raised text-paper-muted hover:border-cinnabar/50 hover:text-cinnabar"
        >
          <Search size={18} />
        </button>
      </div>

      <div className="mb-3 flex items-center justify-between rounded-xl border border-haze/60 bg-ink-raised/45 px-3 py-2">
        <p className="pr-3 text-[11.5px] leading-5 text-paper-faint">
          当前为公开只读适配。接口来自源码证据，运行时若遇验证页/字段变化会明确报错，不会显示假空列表。
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-paper-muted hover:bg-ink hover:text-cinnabar disabled:opacity-40"
          aria-label="刷新"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-3 rounded-xl border border-cinnabar/35 bg-cinnabar/8 p-3 text-[12.5px] leading-6 text-paper-muted">
          {errorMessage(error)}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="py-16 text-center font-mono text-[12px] tracking-wide text-paper-faint">正在读取知乎…</div>
      ) : items.length === 0 && !error ? (
        <div className="py-16 text-center text-[13px] text-paper-faint">没有可显示的公开内容</div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => (
            <button
              key={`${item.ref.kind}:${item.ref.id}`}
              type="button"
              onClick={() => onOpen(item.ref)}
              className="block w-full rounded-2xl border border-haze/70 bg-ink-raised/55 p-4 text-left transition-colors hover:border-cinnabar/35 hover:bg-ink-raised"
            >
              <h2 className="font-display text-[17px] font-semibold leading-7 text-paper">{item.title}</h2>
              {item.excerpt && (
                <p className="mt-1.5 line-clamp-3 text-[13px] leading-6 text-paper-muted">{item.excerpt}</p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-paper-faint">
                {item.author?.name && <span>{item.author.name}</span>}
                {typeof item.voteupCount === 'number' && <span>{item.voteupCount} 赞同</span>}
                {typeof item.commentCount === 'number' && <span>{item.commentCount} 评论</span>}
                <span>{item.ref.kind}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {items.length > 0 && hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="mt-4 min-h-11 w-full rounded-xl border border-haze/70 bg-ink-raised font-mono text-[11px] text-paper-muted hover:border-cinnabar/40 hover:text-cinnabar disabled:opacity-50"
        >
          {loadingMore ? '正在加载…' : '加载更多'}
        </button>
      )}
    </div>
  )
}
