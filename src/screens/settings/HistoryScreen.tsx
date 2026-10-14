import { useMemo, useState } from 'react'
import { ArrowUpRight, BookOpen, Clock3, Search, Trash2, X, WifiOff } from 'lucide-react'
import { SettingsShell } from '../../components/SettingsShell'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { dayBucket, clockTime } from '../../lib/time'
import { hasCachedBody } from '../../lib/bodyCache'
import type { ReadingHistoryEntry } from '../../features/readingHistory/store'

interface Props {
  history: ReadingHistoryEntry[]
  onOpen: (entry: ReadingHistoryEntry) => void
  onRemove: (key: string) => void
  onClear: () => void
  onBack: () => void
}
type ReadingOrigin = ReadingHistoryEntry['origin']
const filters: { id: 'all' | ReadingOrigin; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'feed', label: '资讯 / RSS' },
  { id: 'cms', label: 'CMS' },
  { id: 'linuxdo', label: 'Linux.do' },
  { id: 'zhihu', label: '知乎' },
]
const readableDay = (timestamp: number) => {
  const bucket = dayBucket(timestamp)
  if (bucket !== '更早') return bucket
  const date = new Date(timestamp)
  return String(date.getFullYear()) + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日'
}

export function HistoryScreen({ history, onOpen, onRemove, onClear, onBack }: Props) {
  const [filter, setFilter] = useState<'all' | ReadingOrigin>('all')
  const [query, setQuery] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const current = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return history.filter((item) => (filter === 'all' || item.origin === filter) &&
      (!search || (item.title + ' ' + item.sourceLabel + ' ' + (item.excerpt || '')).toLocaleLowerCase().includes(search)))
  }, [filter, history, query])
  const groups = useMemo(() => {
    const map = new Map<string, ReadingHistoryEntry[]>()
    current.forEach((item) => {
      const label = readableDay(item.readAt)
      map.set(label, [...(map.get(label) ?? []), item])
    })
    return [...map.entries()]
  }, [current])

  return (
    <SettingsShell title="最近阅读" caption={history.length ? `共 ${history.length} 篇` : undefined} onBack={onBack}
      action={history.length > 0 ? <button type="button" onClick={() => setConfirmClear(true)}
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] text-paper-muted hover:bg-ink-raised hover:text-paper"><Trash2 size={13} />清空</button> : undefined}>
      {history.length > 0 && (
        <div className="px-5 pt-3 pb-3 sm:px-7">
          <label className="flex h-10 items-center gap-2 rounded-xl border border-haze/70 bg-ink-raised/50 px-3 focus-within:border-cinnabar/50">
            <Search size={15} className="shrink-0 text-paper-faint" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或来源"
              aria-label="搜索最近阅读" className="min-w-0 flex-1 bg-transparent text-[13px] text-paper outline-none placeholder:text-paper-faint/70" />
            {query && <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}><X size={14} /></button>}
          </label>
          <div role="group" aria-label="筛选内容来源" className="scroll-hidden -mx-5 mt-3 flex gap-1.5 overflow-x-auto px-5 py-1 sm:-mx-7 sm:px-7">
            {filters.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={'shrink-0 rounded-full border px-3 py-1.5 text-[11px] transition-colors ' +
                (filter === item.id ? 'border-cinnabar/60 bg-cinnabar/10 font-medium text-cinnabar-soft' :
                  'border-haze/60 text-paper-muted hover:border-paper-faint/50 hover:text-paper')}>{item.label}</button>)}
          </div>
        </div>
      )}
      {!history.length ? (
        <div className="flex flex-col items-center px-8 py-20 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-haze/60 bg-ink-raised/50 text-paper-muted"><BookOpen size={25} strokeWidth={1.4}/></div>
          <p className="mt-5 font-display text-[17px] text-paper">暂无阅读记录</p>
        </div>
      ) : !current.length ? (
        <div className="flex flex-col items-center px-5 py-16 text-center text-paper-faint">
          <Search size={24} strokeWidth={1.4} />
          <p className="mt-3 text-[13px] text-paper-muted">无匹配记录</p>
          <button type="button" onClick={() => { setQuery(''); setFilter('all') }} className="mt-3 text-[12px] text-cinnabar-soft">查看全部</button>
        </div>
      ) : (
        <div className="pb-7">
          {groups.map(([day, items]) => <section key={day}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-y border-haze/40 bg-ink/95 px-5 py-2 backdrop-blur-md sm:px-7">
              <h2 className="text-[12px] font-medium text-paper">{day}</h2>
              <span className="font-mono text-[10px] tabular-nums text-paper-faint">{items.length} 篇</span>
            </div>
            <ul className="divide-y divide-haze/45">
              {items.map((entry) => {
                const offline = entry.kind === 'article' && hasCachedBody(entry.article.id)
                return <li key={entry.key} className="group flex items-center gap-1 px-5 transition-colors hover:bg-ink-raised/45 sm:px-7">
                  <button type="button" className="min-w-0 flex-1 py-3.5 text-left" onClick={() => onOpen(entry)}>
                    <span className="flex items-center gap-2 text-[10px] leading-4 text-paper-faint">
                      <span className="max-w-[45%] truncate font-medium text-paper-muted">{entry.sourceLabel}</span>
                      <span aria-hidden>·</span>
                      <Clock3 size={11} strokeWidth={1.5}/>
                      <time dateTime={new Date(entry.readAt).toISOString()}>{clockTime(entry.readAt)}</time>
                      {offline && <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-paper-faint"><WifiOff size={11}/>离线可读</span>}
                    </span>
                    <span className="mt-1.5 block font-display text-[15px] font-medium leading-[1.5] text-paper [overflow-wrap:anywhere] sm:text-[16px]">{entry.title}</span>
                    {entry.excerpt && <span className="mt-1 block truncate text-[11px] text-paper-faint">{entry.excerpt}</span>}
                    {entry.visits > 1 && <span className="mt-1 block text-[10px] text-paper-faint">阅读 {entry.visits} 次</span>}
                  </button>
                  {entry.image && <img src={entry.image} loading="lazy" alt="" className="ml-2 h-[62px] w-[76px] shrink-0 rounded-lg object-cover" referrerPolicy="no-referrer" />}
                  <button type="button" onClick={() => setRemoving(entry.key)} aria-label={'删除记录：' + entry.title}
                    className="ml-1 shrink-0 rounded-lg p-2 text-paper-faint hover:bg-ink-raised hover:text-cinnabar-soft"><X size={15}/></button>
                  <ArrowUpRight size={13} className="hidden shrink-0 text-paper-faint/60 sm:block" />
                </li>
              })}
            </ul>
          </section>)}
        </div>
      )}
      <ConfirmDialog open={confirmClear} title="清空全部阅读记录？" message="清空后无法恢复。"
        confirmLabel="清空记录" danger onCancel={() => setConfirmClear(false)} onConfirm={() => { onClear(); setConfirmClear(false) }}/>
      <ConfirmDialog open={removing != null} title="删除该条阅读记录？" message="删除后无法恢复。"
        confirmLabel="删除" danger onCancel={() => setRemoving(null)} onConfirm={() => { if (removing) onRemove(removing); setRemoving(null) }}/>
    </SettingsShell>
  )
}
