import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, Clock3, MoreHorizontal, RotateCcw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import { BrowserEmptyState, BrowserIconButton, BrowserPageHeader, BrowserSiteIcon, BrowserStatusBanner } from './BrowserPrimitives'
import { advancePrivateBookmarkTap, EMPTY_PRIVATE_BOOKMARK_TAP, type PrivateBookmarkTap } from './browserBookmarks'

interface BrowserPlaceEntry {
  url: string
  title: string
  time: number
}

interface BrowserPlacesPanelProps {
  kind: 'history' | 'bookmarks'
  entries: BrowserPlaceEntry[]
  /** Separate explicit saves from private browsing. Never shown in normal mode. */
  privateEntries?: BrowserPlaceEntry[]
  hiddenHostCount: number
  onBack: () => void
  onOpen: (url: string) => void
  onRemove: (url: string) => void
  onClear: () => void
  onPrivateRemove?: (url: string) => void
  onPrivateClear?: () => void
  onRestoreHidden: () => void
  onHistoryOptions: (entry: BrowserPlaceEntry) => void
  privateMode?: boolean
  pending?: boolean
  error?: string
}

interface PlaceGroup { key: string; label: string; entries: BrowserPlaceEntry[] }

function dateGroup(time: number, today: Date) {
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return {key: 'unknown', label: '较早'}
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const label = day.getTime() === today.getTime() ? '今天'
    : day.getTime() === yesterday.getTime() ? '昨天'
    : date.toLocaleDateString('zh-CN', {
      year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric', month: 'long', day: 'numeric',
    })
  return {key: String(day.getTime()), label}
}

function filterPlaces(entries: BrowserPlaceEntry[], needle: string): BrowserPlaceEntry[] {
  return entries.filter(entry => !needle || (entry.title || '').toLocaleLowerCase().includes(needle)
    || entry.url.toLocaleLowerCase().includes(needle)).slice().sort((a, b) => b.time - a.time)
}

function groupPlaces(entries: BrowserPlaceEntry[]): PlaceGroup[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const result: PlaceGroup[] = []
  for (const entry of entries) {
    const group = dateGroup(entry.time, today)
    const previous = result[result.length - 1]
    if (previous?.key === group.key) previous.entries.push(entry)
    else result.push({...group, entries: [entry]})
  }
  return result
}

function PlaceGroups({groups, isHistory, isPrivate, privateMode, pending, onOpen, onRemove, onHistoryOptions}: {
  groups: PlaceGroup[]
  isHistory: boolean
  isPrivate: boolean
  privateMode: boolean
  pending: boolean
  onOpen: (url: string) => void
  onRemove: (url: string) => void
  onHistoryOptions: (entry: BrowserPlaceEntry) => void
}) {
  return <>{groups.map(group =>
    <section key={group.key} data-date-group={group.key} className="browser-place-group">
      <h3>{group.label}</h3>
      <ul className="browser-place-list">
        {group.entries.map(entry => {
          const entryTitle = entry.title || entry.url
          const date = new Date(entry.time)
          const validTime = !Number.isNaN(date.getTime())
          return <li key={entry.url + ':' + entry.time}>
            <button type="button" aria-label={'打开：' + entryTitle} disabled={pending} onClick={() => onOpen(entry.url)}
              onContextMenu={event => {if (isHistory && !pending) {event.preventDefault(); onHistoryOptions(entry)}}}
              className={'browser-place-open' + (!isHistory ? ' browser-bookmark-open' : '')}>
              {!isHistory && <BrowserSiteIcon url={entry.url} name={entryTitle} size="small" allowRemote={!privateMode && !isPrivate}/>}
              <span className="browser-place-copy">
                <span className="browser-place-title" title={entryTitle}>{entryTitle}</span>
                <span className="browser-place-meta">
                  <span title={entry.url}>{entry.url}</span>
                  {validTime && <time dateTime={date.toISOString()} title={date.toLocaleString('zh-CN')}>
                    {date.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false})}
                  </time>}
                </span>
              </span>
            </button>
            {isHistory && <BrowserIconButton label={'更多操作：' + entryTitle} disabled={pending}
              onClick={() => onHistoryOptions(entry)}><MoreHorizontal size={20} strokeWidth={1.8} aria-hidden="true"/></BrowserIconButton>}
            <BrowserIconButton label={'删除：' + entryTitle} disabled={pending} className="browser-delete-button"
              onClick={() => onRemove(entry.url)}><Trash2 size={18} strokeWidth={1.8} aria-hidden="true"/></BrowserIconButton>
          </li>
        })}
      </ul>
    </section>
  )}</>
}

export function BrowserPlacesPanel({
  kind, entries, privateEntries = [], hiddenHostCount, onBack, onOpen, onRemove, onClear, onPrivateRemove,
  onPrivateClear, onRestoreHidden, onHistoryOptions, privateMode = false, pending = false, error = '',
}: BrowserPlacesPanelProps) {
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const [privateUnlocked, setPrivateUnlocked] = useState(false)
  const titleTaps = useRef<PrivateBookmarkTap>(EMPTY_PRIVATE_BOOKMARK_TAP)
  const isHistory = kind === 'history'
  const title = isHistory ? '浏览历史' : '书签'
  const showPrivate = !isHistory && privateMode && privateUnlocked

  useEffect(() => {
    if (privateMode && !isHistory) return
    titleTaps.current = EMPTY_PRIVATE_BOOKMARK_TAP
    setPrivateUnlocked(false)
  }, [privateMode, isHistory])

  const unlockPrivate = () => {
    const attempt = advancePrivateBookmarkTap(titleTaps.current, Date.now())
    titleTaps.current = attempt.state
    if (attempt.activated) setPrivateUnlocked(open => !open)
  }

  const needle = query.trim().toLocaleLowerCase()
  const filtered = useMemo(() => filterPlaces(entries, needle), [entries, needle])
  const groups = useMemo(() => groupPlaces(filtered), [filtered])
  const privateFiltered = useMemo(() => showPrivate ? filterPlaces(privateEntries, needle) : [],
    [showPrivate, privateEntries, needle])
  const privateGroups = useMemo(() => groupPlaces(privateFiltered), [privateFiltered])
  const hasQuery = needle.length > 0
  const visibleTotal = entries.length + (showPrivate ? privateEntries.length : 0)
  const visibleMatches = filtered.length + privateFiltered.length

  return <section aria-label={title} aria-busy={pending} className="browser-panel browser-places"
    style={{paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)'}}
    onClickCapture={event => {
      if (!privateMode || isHistory) return
      if (!(event.target as Element).closest('.browser-page-title-tap')) {
        titleTaps.current = EMPTY_PRIVATE_BOOKMARK_TAP
      }
    }}>
    <BrowserPageHeader title={title} onBack={onBack} onTitleActivate={!isHistory && privateMode ? unlockPrivate : undefined}>
      {entries.length > 0 && <button type="button" aria-label={isHistory ? '清空浏览历史' : '清空书签'}
        disabled={pending} onClick={onClear} className="browser-text-button">清空</button>}
    </BrowserPageHeader>
    <div className="browser-places-filter">
      {privateMode && isHistory && <p className="browser-results-count browser-recording-notice">已暂停记录新的浏览历史</p>}
      <div className="browser-input-field">
        <Search size={19} strokeWidth={1.8} aria-hidden="true"/>
        <input ref={input} type="search" aria-label={isHistory ? '搜索浏览历史' : '搜索书签'} placeholder="搜索标题或网址"
          value={query} autoComplete="off" onInput={event => setQuery(event.currentTarget.value)}/>
        {query && <BrowserIconButton label="清空搜索" onClick={() => {setQuery(''); input.current?.focus()}}><X size={18} aria-hidden="true"/></BrowserIconButton>}
      </div>
      <p role="status" aria-live="polite" className="browser-results-count">
        {hasQuery ? '找到 ' + visibleMatches + ' 条' : '共 ' + visibleTotal + (isHistory ? ' 条记录' : ' 个书签')}
      </p>
    </div>
    <div className="browser-panel-scroll">
      <div className="browser-places-content">
        {error && <BrowserStatusBanner error>{error}</BrowserStatusBanner>}
        {isHistory && hiddenHostCount > 0 && <button type="button" aria-label="恢复首页隐藏的网站"
          disabled={pending} onClick={onRestoreHidden} className="browser-restore-hidden">
          <RotateCcw size={18} strokeWidth={1.8} aria-hidden="true"/>
          <span>恢复首页隐藏的网站</span><span>{hiddenHostCount} 个</span>
        </button>}
        {(groups.length || privateGroups.length) ? <PlaceGroups groups={groups} isHistory={isHistory} isPrivate={false}
          privateMode={privateMode} pending={pending} onOpen={onOpen} onRemove={onRemove} onHistoryOptions={onHistoryOptions}/>
          : <BrowserEmptyState icon={isHistory ? Clock3 : Bookmark}
            title={hasQuery ? '没有找到相关记录' : isHistory ? '暂无浏览历史' : '暂无书签'}
            description={hasQuery ? '试试其他标题或网址。' : isHistory ? privateMode ? '已暂停记录新的浏览历史。' : '访问过的网页会显示在这里。' : '在网页菜单中添加书签。'}/>}
        {showPrivate && <section aria-label="隐私书签" className="mt-5 border-t border-haze pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-[14px] font-semibold text-paper">
              <ShieldCheck size={17} strokeWidth={1.8} aria-hidden="true"/>隐私书签
            </h3>
            {privateEntries.length > 0 && onPrivateClear && <button type="button" aria-label="清空隐私书签" className="browser-text-button"
              disabled={pending} onClick={onPrivateClear}>清空</button>}
          </div>
          {privateGroups.length ? <PlaceGroups groups={privateGroups} isHistory={false} isPrivate privateMode
            pending={pending} onOpen={onOpen} onRemove={url => onPrivateRemove?.(url)}
            onHistoryOptions={onHistoryOptions}/> : <p className="py-5 text-center text-[13px] text-paper-muted">
              {hasQuery ? '没有找到隐私书签' : '暂无隐私书签'}
            </p>}
        </section>}
      </div>
    </div>
  </section>
}
