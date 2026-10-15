import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownUp,
  MoreHorizontal,
  BookOpen,
  Check,
  FileText,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { SettingsShell } from '../../components/SettingsShell'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { clockTime, dayBucket, relativeTime } from '../../lib/time'
import { hasCachedBody } from '../../lib/bodyCache'
import { haptics } from '../../lib/haptics'
import { useHardwareBackLayer } from '../../hooks/useHardwareBackLayer'
import type { ReadingHistoryEntry } from '../../features/readingHistory/store'

interface Props {
  history: ReadingHistoryEntry[]
  onOpen: (entry: ReadingHistoryEntry) => void
  onRemove: (key: string) => void
  onBatchRemove?: (keys: string[]) => void
  onRestore?: (entries: ReadingHistoryEntry[]) => void
  onClear: () => void
  onBack: () => void
}

type ReadingOrigin = ReadingHistoryEntry['origin']
type SortMode = 'recent' | 'visits'

interface FilterOption { id: 'all' | ReadingOrigin; label: string }
const FILTERS: FilterOption[] = [
  { id: 'all', label: '全部' },
  { id: 'feed', label: '资讯 / RSS' },
  { id: 'linuxdo', label: 'Linux.do' },
  { id: 'zhihu', label: '知乎' },
  { id: 'cms', label: '专栏 / CMS' },
]
const SOURCE_LETTERS: Record<ReadingOrigin, string> = {
  feed: 'R', linuxdo: 'L', zhihu: '知', cms: 'C',
}

const formatGroupDay = (timestamp: number, now = Date.now()) => {
  const bucket = dayBucket(timestamp, now)
  if (bucket === '今天' || bucket === '昨天') return bucket
  const date = new Date(timestamp)
  const currentYear = new Date(now).getFullYear()
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const weekday = weekdays[date.getDay()]
  if (date.getFullYear() === currentYear) {
    return `${date.getMonth() + 1}月${date.getDate()}日 · ${weekday}`
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export function HistoryScreen({
  history,
  onOpen,
  onRemove,
  onBatchRemove,
  onRestore,
  onClear,
  onBack,
}: Props) {
  const [filter, setFilter] = useState<'all' | ReadingOrigin>('all')
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [isManaging, setIsManaging] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false)
  const [undoPrompt, setUndoPrompt] = useState<{
    text: string
    entries: ReadingHistoryEntry[]
  } | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 清除定时器
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }
  }, [])

  // 各来源条数统计
  const originCounts = useMemo(() => {
    const counts: Record<string, number> = { all: history.length }
    for (const item of history) {
      counts[item.origin] = (counts[item.origin] ?? 0) + 1
    }
    return counts
  }, [history])

  // 过滤与排序
  const current = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    const filtered = history.filter((item) => {
      if (filter !== 'all' && item.origin !== filter) return false
      if (!search) return true
      const corpus = `${item.title} ${item.sourceLabel} ${item.excerpt || ''}`.toLocaleLowerCase()
      return corpus.includes(search)
    })

    if (sortMode === 'visits') {
      return [...filtered].sort((a, b) => (b.visits || 1) - (a.visits || 1) || b.readAt - a.readAt)
    }
    return [...filtered].sort((a, b) => b.readAt - a.readAt)
  }, [filter, history, query, sortMode])

  // 按日期分组
  const groups = useMemo(() => {
    const map = new Map<string, ReadingHistoryEntry[]>()
    for (const item of current) {
      const label = formatGroupDay(item.readAt)
      const list = map.get(label)
      if (list) list.push(item)
      else map.set(label, [item])
    }
    return [...map.entries()]
  }, [current])

  // 是否当前分类已全选
  const isAllCurrentSelected = useMemo(() => {
    if (!current.length) return false
    return current.every((item) => selectedKeys.has(item.key))
  }, [current, selectedKeys])

  // 触发单条安全移除并支持撤销
  const handleRemoveSingle = useCallback(
    (entry: ReadingHistoryEntry) => {
      void haptics.tick()
      onRemove(entry.key)

      if (onRestore) {
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
        setUndoPrompt({
          text: `已移出「${entry.title.slice(0, 14)}${entry.title.length > 14 ? '…' : ''}」`,
          entries: [entry],
        })
        undoTimerRef.current = setTimeout(() => {
          setUndoPrompt(null)
          undoTimerRef.current = null
        }, 5000)
      }
    },
    [onRemove, onRestore],
  )

  // 执行撤销
  const handleUndo = useCallback(() => {
    if (!undoPrompt || !onRestore) return
    void haptics.snap()
    onRestore(undoPrompt.entries)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    setUndoPrompt(null)
  }, [onRestore, undoPrompt])

  // 批量管理模式下的勾选切换
  const toggleSelectKey = useCallback((key: string) => {
    void haptics.selection()
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // 批量全选 / 取消全选（针对当前过滤结果）
  const handleToggleSelectAll = useCallback(() => {
    void haptics.tick()
    if (isAllCurrentSelected) {
      setSelectedKeys(new Set())
    } else {
      setSelectedKeys(new Set(current.map((item) => item.key)))
    }
  }, [current, isAllCurrentSelected])

  // 确认批量删除
  const handleConfirmBatchDelete = useCallback(() => {
    if (selectedKeys.size === 0) return
    void haptics.snap()
    const keysArray = Array.from(selectedKeys)
    const removedEntries = history.filter((item) => selectedKeys.has(item.key))

    if (onBatchRemove) {
      onBatchRemove(keysArray)
    } else {
      for (const k of keysArray) onRemove(k)
    }

    setSelectedKeys(new Set())
    setIsManaging(false)
    setConfirmBatchDelete(false)

    if (onRestore && removedEntries.length > 0) {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
      setUndoPrompt({
        text: `已移除 ${removedEntries.length} 篇阅读足迹`,
        entries: removedEntries,
      })
      undoTimerRef.current = setTimeout(() => {
        setUndoPrompt(null)
        undoTimerRef.current = null
      }, 5500)
    }
  }, [history, onBatchRemove, onRemove, onRestore, selectedKeys])

  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const [removeCandidate, setRemoveCandidate] = useState<ReadingHistoryEntry | null>(null)
  const headerMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!headerMenuOpen) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!headerMenuRef.current?.contains(event.target as Node)) setHeaderMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHeaderMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [headerMenuOpen])

  useHardwareBackLayer(headerMenuOpen, () => {
    setHeaderMenuOpen(false)
    return true
  })

  const stopManaging = useCallback(() => {
    void haptics.tick()
    setIsManaging(false)
    setSelectedKeys(new Set())
  }, [])

  const handleBack = useCallback(() => {
    if (headerMenuOpen) {
      setHeaderMenuOpen(false)
      return
    }
    if (isManaging) {
      stopManaging()
      return
    }
    onBack()
  }, [headerMenuOpen, isManaging, onBack, stopManaging])

  const actions = history.length > 0 ? (
    <div ref={headerMenuRef} className="history-archive-header-actions">
      <button
        type="button"
        className={`history-archive-manage ${isManaging ? 'history-archive-manage--active' : ''}`}
        onClick={() => {
          if (isManaging) stopManaging()
          else {
            void haptics.tick()
            setHeaderMenuOpen(false)
            setIsManaging(true)
          }
        }}
      >
        {isManaging ? '完成' : '选择'}
      </button>
      {!isManaging && (
        <div className="history-archive-header-menu-anchor">
          <button
            type="button"
            className="history-archive-header-more"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={headerMenuOpen}
            onClick={() => setHeaderMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={20} strokeWidth={1.7} />
          </button>
          {headerMenuOpen && (
            <div className="history-archive-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setHeaderMenuOpen(false)
                  setConfirmClear(true)
                }}
              >
                <Trash2 size={17} strokeWidth={1.7} aria-hidden />
                清空阅读记录
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  ) : undefined

  const toolbar = history.length > 0 ? (
    <div className="history-archive-toolbar">
      <label className="history-archive-search">
        <Search size={18} strokeWidth={1.7} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索阅读记录"
          aria-label="搜索标题、来源和摘要"
        />
        {query && (
          <button
            type="button"
            className="history-archive-search-clear"
            onClick={() => setQuery('')}
            aria-label="清除搜索"
          >
            <X size={13} />
          </button>
        )}
      </label>

      <div className="history-archive-filter-scroll" role="group" aria-label="按平台筛选">
        <div className="history-archive-filters">
          {FILTERS.map((item) => {
            const count = originCounts[item.id] ?? 0
            if (item.id !== 'all' && count === 0) return null
            return (
              <button
                key={item.id}
                type="button"
                className="history-archive-filter"
                aria-pressed={filter === item.id}
                onClick={() => {
                  void haptics.selection()
                  setFilter(item.id)
                }}
              >
                <span>{item.label}</span>
                <span className="history-archive-filter-count">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="history-archive-sortbar">
        <span>
          {query.trim() || filter !== 'all' ? `找到 ${current.length} 篇` : `${current.length} 篇记录`}
        </span>
        <button
          type="button"
          className="history-archive-sort"
          onClick={() => {
            void haptics.tick()
            setSortMode((mode) => (mode === 'recent' ? 'visits' : 'recent'))
          }}
          aria-label={sortMode === 'recent' ? '按翻阅次数排序' : '按最近浏览排序'}
        >
          <ArrowDownUp size={14} strokeWidth={1.6} aria-hidden />
          <span>{sortMode === 'recent' ? '最近浏览' : '翻阅次数'}</span>
        </button>
      </div>
    </div>
  ) : undefined

  const footer = isManaging && history.length > 0 ? (
    <div className="history-archive-manage-footer">
      <button type="button" className="history-archive-select-all" onClick={handleToggleSelectAll}>
        {isAllCurrentSelected ? '取消全选' : `全选当前 (${current.length})`}
      </button>
      <div className="history-archive-manage-right">
        <span>已选 {selectedKeys.size} 篇</span>
        <button
          type="button"
          disabled={!selectedKeys.size}
          className="history-archive-delete-selected"
          onClick={() => setConfirmBatchDelete(true)}
        >
          删除所选
        </button>
      </div>
    </div>
  ) : undefined

  return (
    <SettingsShell
      className="history-archive-shell"
      title={
        <>
          <span>{isManaging ? '选择阅读记录' : '最近阅读'}</span>
          {history.length > 0 && <span className="history-archive-head-count">{isManaging ? `已选 ${selectedKeys.size} 篇` : `共 ${history.length} 篇`}</span>}
        </>
      }
      action={actions}
      toolbar={toolbar}
      footer={footer}
      onBack={handleBack}
    >
      <div className="history-archive-content">
        {history.length === 0 ? (
          <div className="history-archive-empty">
            <div className="history-archive-empty-icon"><BookOpen size={34} strokeWidth={1.3} aria-hidden /></div>
            <h2>暂无阅读记录</h2>
            <p>打开过的文章和社区帖子会出现在这里。</p>
          </div>
        ) : current.length === 0 ? (
          <div className="history-archive-empty">
            <div className="history-archive-empty-icon"><Search size={30} strokeWidth={1.3} aria-hidden /></div>
            <h2>没有找到相关记录</h2>
            <p>试试其他关键词，或切换来源分类。</p>
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setFilter('all')
              }}
            >
              清除筛选
            </button>
          </div>
        ) : (
          <div className="history-archive-groups">
            {groups.map(([day, items]) => {
              const date = new Date(items[0].readAt)
              const formattedDate = `${date.getMonth() + 1}月${date.getDate()}日`
              const isRelativeDay = day === '今天' || day === '昨天'
              return (
                <section key={day} className="history-archive-group" aria-label={day}>
                  <div className="history-archive-day">
                    <h2>
                      {isRelativeDay ? day : day.split(' · ')[0]}
                      {isRelativeDay && <span>{formattedDate}</span>}
                    </h2>
                    <span className="history-archive-day-count">{items.length} 篇</span>
                  </div>
                  <div role="list">
                    {items.map((entry) => {
                      const offline = entry.kind === 'article' && hasCachedBody(entry.article.id)
                      const isSelected = selectedKeys.has(entry.key)
                      return (
                        <article
                          key={entry.key}
                          role="listitem"
                          onClick={isManaging ? () => toggleSelectKey(entry.key) : undefined}
                          className={`history-archive-entry ${isManaging ? 'history-archive-entry--managing' : ''} ${isSelected ? 'history-archive-entry--selected' : ''}`}
                        >
                          {isManaging && (
                            <span className="history-archive-check" aria-hidden>
                              {isSelected && <Check size={15} strokeWidth={2.5} />}
                            </span>
                          )}
                          <button
                            type="button"
                            className="history-archive-open"
                            aria-label={isManaging ? `${isSelected ? '取消选择' : '选择'}：${entry.title}` : `打开：${entry.title}`}
                            aria-pressed={isManaging ? isSelected : undefined}
                            onClick={() => {
                              if (!isManaging) onOpen(entry)
                            }}
                          >
                            <span className="history-archive-entry-meta">
                              <span className={`history-entry-source-sign history-entry-source--${entry.origin}`} aria-hidden>
                                {SOURCE_LETTERS[entry.origin]}
                              </span>
                              <span className="history-archive-entry-source">{entry.sourceLabel}</span>
                              <time
                                dateTime={new Date(entry.readAt).toISOString()}
                                title={relativeTime(entry.readAt)}
                              >
                                {clockTime(entry.readAt)}
                              </time>
                            </span>
                            <span className="history-archive-entry-body">
                              <span className="history-archive-entry-copy">
                                <span className="history-archive-entry-title">{entry.title}</span>
                                {entry.excerpt && <span className="history-archive-entry-excerpt">{entry.excerpt}</span>}
                                {(offline || entry.visits > 1) && (
                                  <span className="history-archive-entry-tags">
                                    {offline && (
                                      <span><FileText size={12} strokeWidth={1.6} aria-hidden />离线可读</span>
                                    )}
                                    {entry.visits > 1 && (
                                      <span><RotateCcw size={12} strokeWidth={1.6} aria-hidden />重温 {entry.visits} 次</span>
                                    )}
                                  </span>
                                )}
                              </span>
                              {entry.image && (
                                <img
                                  src={entry.image}
                                  alt=""
                                  loading="lazy"
                                  className="history-archive-entry-image"
                                  referrerPolicy="no-referrer"
                                />
                              )}
                            </span>
                          </button>
                          {!isManaging && (
                            <button
                              type="button"
                              className="history-entry-more"
                              aria-label={`管理记录：${entry.title}`}
                              onClick={() => setRemoveCandidate(entry)}
                            >
                              <MoreHorizontal size={18} strokeWidth={1.65} aria-hidden />
                            </button>
                          )}
                        </article>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        )}

        {undoPrompt && (
          <div className="history-archive-undo" role="status">
            <span>{undoPrompt.text}</span>
            <button type="button" onClick={handleUndo}><RotateCcw size={14} aria-hidden />撤销</button>
          </div>
        )}

        <ConfirmDialog
          open={Boolean(removeCandidate)}
          title="移出最近阅读？"
          message={removeCandidate?.title ?? ''}
          confirmLabel="移出记录"
          danger
          placement="bottom"
          onCancel={() => setRemoveCandidate(null)}
          onConfirm={() => {
            if (removeCandidate) handleRemoveSingle(removeCandidate)
            setRemoveCandidate(null)
          }}
        />
        <ConfirmDialog
          open={confirmClear}
          title="清空全部阅读记录？"
          message="将从本机移除全部最近阅读。稍后读、订阅与缓存不受影响。"
          confirmLabel="清空记录"
          danger
          placement="bottom"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            onClear()
            setConfirmClear(false)
            setSelectedKeys(new Set())
            setIsManaging(false)
            setQuery('')
            setFilter('all')
          }}
        />
        <ConfirmDialog
          open={confirmBatchDelete}
          title={`删除选中的 ${selectedKeys.size} 篇记录？`}
          message="删除后可在短时间内撤销。稍后读和订阅不受影响。"
          confirmLabel="删除记录"
          danger
          placement="bottom"
          onCancel={() => setConfirmBatchDelete(false)}
          onConfirm={handleConfirmBatchDelete}
        />
      </div>
    </SettingsShell>
  )
}
