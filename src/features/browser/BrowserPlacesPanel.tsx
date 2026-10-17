import { useMemo, useState } from 'react'
import { Bookmark, Clock3, MoreHorizontal, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { BrowserPageHeader } from './BrowserPrimitives'

interface BrowserPlaceEntry {
  url: string
  title: string
  time: number
}

interface BrowserPlacesPanelProps {
  kind: 'history' | 'bookmarks'
  entries: BrowserPlaceEntry[]
  hiddenHostCount: number
  onBack: () => void
  onOpen: (url: string) => void
  onRemove: (url: string) => void
  onClear: () => void
  onRestoreHidden: () => void
  onHistoryOptions: (entry: BrowserPlaceEntry) => void
}

function dateGroup(time: number, today: Date) {
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return { key: 'unknown', label: '较早' }
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const label = day.getTime() === today.getTime()
    ? '今天'
    : day.getTime() === yesterday.getTime()
      ? '昨天'
      : date.toLocaleDateString('zh-CN', {
        year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
        month: 'long',
        day: 'numeric',
      })
  return { key: String(day.getTime()), label }
}

export function BrowserPlacesPanel({
  kind,
  entries,
  hiddenHostCount,
  onBack,
  onOpen,
  onRemove,
  onClear,
  onRestoreHidden,
  onHistoryOptions,
}: BrowserPlacesPanelProps) {
  const [query, setQuery] = useState('')
  const isHistory = kind === 'history'
  const title = isHistory ? '浏览历史' : '书签'
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return entries
      .filter(entry => !needle || (entry.title || '').toLocaleLowerCase().includes(needle)
        || entry.url.toLocaleLowerCase().includes(needle))
      .slice()
      .sort((a, b) => b.time - a.time)
  }, [entries, query])
  const groups = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const result: { key: string; label: string; entries: BrowserPlaceEntry[] }[] = []
    for (const entry of filtered) {
      const group = dateGroup(entry.time, today)
      const previous = result[result.length - 1]
      if (previous?.key === group.key) previous.entries.push(entry)
      else result.push({ ...group, entries: [entry] })
    }
    return result
  }, [filtered])
  const hasQuery = query.trim().length > 0
  const EmptyIcon = isHistory ? Clock3 : Bookmark

  return (
    <section
      aria-label={title}
      className="absolute inset-0 z-30 flex min-h-0 flex-col bg-ink text-paper"
      style={{ paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)' }}
    >
      <BrowserPageHeader title={title} onBack={onBack}>
        {entries.length > 0 && (
          <button
            type="button"
            aria-label={isHistory ? '清空浏览历史' : '清空书签'}
            onClick={onClear}
            className="min-h-11 rounded-xl px-3 text-sm text-paper-muted transition-colors hover:bg-ink-raised hover:text-cinnabar active:bg-ink-raised focus-visible:outline-2 focus-visible:outline-cinnabar"
          >
            清空
          </button>
        )}
      </BrowserPageHeader>

      <div className="shrink-0 px-4 pt-4 pb-2">
        <div className="flex min-h-11 items-center gap-2 rounded-xl border border-haze bg-ink-raised pl-3 focus-within:border-cinnabar">
          <Search size={18} className="shrink-0 text-paper-faint" aria-hidden="true" />
          <input
            type="search"
            aria-label={isHistory ? '搜索浏览历史' : '搜索书签'}
            placeholder="搜索标题或网址"
            value={query}
            onInput={event => setQuery(event.currentTarget.value)}
            className="min-h-11 min-w-0 flex-1 appearance-none bg-transparent text-base text-paper outline-none placeholder:text-paper-faint [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query ? (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => setQuery('')}
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-paper-muted hover:text-paper focus-visible:outline-2 focus-visible:outline-cinnabar"
            >
              <X size={18} aria-hidden="true" />
            </button>
          ) : <span className="w-3" aria-hidden="true" />}
        </div>
        <p role="status" aria-live="polite" className="mt-3 text-sm text-paper-muted">
          {hasQuery ? '找到 ' + filtered.length + ' 条' : '共 ' + entries.length + (isHistory ? ' 条记录' : ' 个书签')}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        {isHistory && hiddenHostCount > 0 && (
          <button
            type="button"
            aria-label="恢复首页隐藏的网站"
            onClick={onRestoreHidden}
            className="my-3 flex min-h-11 w-full items-center gap-3 rounded-xl border border-haze px-3 py-2.5 text-left text-sm text-paper-muted transition-colors hover:bg-ink-raised active:bg-ink-raised focus-visible:outline-2 focus-visible:outline-cinnabar"
          >
            <RotateCcw size={17} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">恢复首页隐藏的网站</span>
            <span className="shrink-0 tabular-nums">{hiddenHostCount} 个</span>
          </button>
        )}

        {groups.length > 0 ? groups.map(group => (
          <section key={group.key} data-date-group={group.key} className="pt-4">
            <h3 className="pb-2 text-sm font-semibold text-paper-muted">{group.label}</h3>
            <ul className="divide-y divide-haze">
              {group.entries.map(entry => {
                const entryTitle = entry.title || entry.url
                const date = new Date(entry.time)
                const validTime = !Number.isNaN(date.getTime())
                return (
                  <li key={entry.url + ':' + entry.time} className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={'打开：' + entryTitle}
                      onClick={() => onOpen(entry.url)}
                      onContextMenu={event => {
                        if (isHistory) {
                          event.preventDefault()
                          onHistoryOptions(entry)
                        }
                      }}
                      className="min-h-20 min-w-0 flex-1 rounded-lg py-3 pr-2 text-left transition-colors hover:bg-ink-raised active:bg-ink-raised focus-visible:outline-2 focus-visible:outline-cinnabar"
                    >
                      <span className="line-clamp-2 break-words text-[15px] font-medium leading-snug text-paper">
                        {entryTitle}
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-2 text-sm leading-5 text-paper-muted">
                        <span className="min-w-0 flex-1 truncate">{entry.url}</span>
                        {validTime && (
                          <time
                            dateTime={date.toISOString()}
                            title={date.toLocaleString('zh-CN')}
                            className="shrink-0 tabular-nums text-paper-faint"
                          >
                            {date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                          </time>
                        )}
                      </span>
                    </button>
                    {isHistory && (
                      <button
                        type="button"
                        aria-label={'更多操作：' + entryTitle}
                        onClick={() => onHistoryOptions(entry)}
                        className="flex size-11 shrink-0 items-center justify-center rounded-xl text-paper-muted transition-colors hover:bg-ink-raised active:bg-ink-raised focus-visible:outline-2 focus-visible:outline-cinnabar"
                      >
                        <MoreHorizontal size={20} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={'删除：' + entryTitle}
                      onClick={() => onRemove(entry.url)}
                      className="flex size-11 shrink-0 items-center justify-center rounded-xl text-paper-faint transition-colors hover:bg-ink-raised hover:text-cinnabar active:bg-ink-raised focus-visible:outline-2 focus-visible:outline-cinnabar"
                    >
                      <Trash2 size={18} aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )) : (
          <div className="flex min-h-52 flex-col items-center justify-center px-4 py-10 text-center">
            <EmptyIcon size={28} strokeWidth={1.5} className="mb-4 text-paper-faint" aria-hidden="true" />
            <p className="text-base font-medium">
              {hasQuery ? '没有找到相关记录' : isHistory ? '暂无浏览历史' : '暂无书签'}
            </p>
            <p className="mt-2 text-sm leading-6 text-paper-muted">
              {hasQuery ? '试试其他标题或网址。' : isHistory ? '访问过的网页会显示在这里。' : '在网页菜单中添加书签。'}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
