import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownUp,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckSquare,
  Clock3,
  Compass,
  FileText,
  ListChecks,
  MessageSquare,
  RotateCcw,
  Rss,
  Search,
  Sparkles,
  Square,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react'
import { SettingsShell } from '../../components/SettingsShell'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { clockTime, dayBucket, relativeTime } from '../../lib/time'
import { hasCachedBody } from '../../lib/bodyCache'
import { haptics } from '../../lib/haptics'
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

interface FilterOption {
  id: 'all' | ReadingOrigin
  label: string
  icon?: typeof Rss
}

const FILTERS: FilterOption[] = [
  { id: 'all', label: '全部' },
  { id: 'feed', label: '资讯 / RSS', icon: Rss },
  { id: 'linuxdo', label: 'Linux.do', icon: MessageSquare },
  { id: 'zhihu', label: '知乎', icon: Compass },
  { id: 'cms', label: '专栏 / CMS', icon: FileText },
]

const ORIGIN_CONFIG: Record<
  ReadingOrigin,
  { label: string; badgeClass: string; icon: typeof Rss }
> = {
  feed: {
    label: '资讯 / RSS',
    badgeClass: 'bg-cinnabar/10 text-cinnabar-soft border-cinnabar/25',
    icon: Rss,
  },
  linuxdo: {
    label: 'Linux.do',
    badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
    icon: MessageSquare,
  },
  zhihu: {
    label: '知乎',
    badgeClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25',
    icon: Compass,
  },
  cms: {
    label: '专栏 / CMS',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    icon: FileText,
  },
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

  // 统计指标洞察
  const stats = useMemo(() => {
    const total = history.length
    if (!total) {
      return { total: 0, today: 0, sourcesCount: 0, offlineCount: 0, totalVisits: 0 }
    }
    const now = Date.now()
    let today = 0
    let offlineCount = 0
    let totalVisits = 0
    const sourceSet = new Set<string>()

    for (let i = 0; i < total; i++) {
      const item = history[i]
      if (dayBucket(item.readAt, now) === '今天') today++
      sourceSet.add(item.origin)
      totalVisits += item.visits || 1
      if (item.kind === 'article' && hasCachedBody(item.article.id)) {
        offlineCount++
      }
    }

    return {
      total,
      today,
      sourcesCount: sourceSet.size,
      offlineCount,
      totalVisits,
    }
  }, [history])

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

  // 头部操作按钮
  const headerAction = useMemo(() => {
    if (history.length === 0) return undefined
    if (isManaging) {
      return (
        <button
          type="button"
          onClick={() => {
            void haptics.tick()
            setIsManaging(false)
            setSelectedKeys(new Set())
          }}
          className="rounded-lg px-2.5 py-1 text-[13px] font-medium text-cinnabar-soft transition-colors hover:bg-ink-raised active:scale-95"
        >
          完成
        </button>
      )
    }
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            void haptics.tick()
            setIsManaging(true)
          }}
          aria-label="批量选择与管理记录"
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-paper-muted transition-colors hover:bg-ink-raised hover:text-paper"
        >
          <ListChecks size={14} strokeWidth={1.7} />
          <span>批量管理</span>
        </button>
        <button
          type="button"
          onClick={() => setConfirmClear(true)}
          aria-label="清空全部足迹"
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-paper-muted transition-colors hover:bg-ink-raised hover:text-paper"
        >
          <Trash2 size={13.5} strokeWidth={1.7} />
          <span>清空</span>
        </button>
      </div>
    )
  }, [history.length, isManaging])

  // 批量管理固定底栏（坚实可靠，彻底告别悬浮遮挡与错位）
  const footerAction = useMemo(() => {
    if (!isManaging || history.length === 0) return undefined
    const count = selectedKeys.size
    return (
      <div className="flex items-center justify-between gap-3">
        {/* 全选 / 取消全选 */}
        <button
          type="button"
          onClick={handleToggleSelectAll}
          className="flex items-center gap-2 rounded-xl bg-ink-raised/60 border border-haze/60 px-3.5 py-2 text-[12.5px] font-medium text-paper transition-colors hover:bg-ink-raised active:scale-95"
        >
          {isAllCurrentSelected ? (
            <CheckSquare size={16} className="text-cinnabar" />
          ) : (
            <Square size={16} className="text-paper-muted" />
          )}
          <span>{isAllCurrentSelected ? '取消全选' : `全选当前 (${current.length})`}</span>
        </button>

        {/* 状态与删除按钮 */}
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[12px] tabular-nums text-paper-muted">
            已选 <strong className="text-paper text-[13px]">{count}</strong> 篇
          </span>

          <button
            type="button"
            disabled={count === 0}
            onClick={() => setConfirmBatchDelete(true)}
            className={
              'flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12.5px] font-medium transition-all ' +
              (count > 0
                ? 'bg-cinnabar text-white shadow-sm hover:bg-cinnabar/90 active:scale-95'
                : 'bg-ink-raised/80 text-paper-faint opacity-45 cursor-not-allowed border border-haze/40')
            }
          >
            <Trash2 size={14} />
            <span>删除所选{count > 0 ? ` (${count})` : ''}</span>
          </button>
        </div>
      </div>
    )
  }, [current.length, history.length, isAllCurrentSelected, isManaging, handleToggleSelectAll, selectedKeys.size])

  return (
    <SettingsShell
      title={isManaging ? (selectedKeys.size > 0 ? `已选 ${selectedKeys.size} 篇` : '选择足迹') : '最近阅读'}
      caption={
        isManaging
          ? `当前共 ${current.length} 篇可选 · 点击文章卡片勾选`
          : history.length
            ? `跨源阅读足迹 · 共 ${history.length} 篇`
            : undefined
      }
      onBack={
        isManaging
          ? () => {
              void haptics.tick()
              setIsManaging(false)
              setSelectedKeys(new Set())
            }
          : onBack
      }
      action={headerAction}
      footer={footerAction}
    >
      <div className="relative min-h-full">
        {history.length > 0 && (
          <div className="page-x pt-4 pb-3">
            {/* 顶尖设计感：沉浸式阅读足迹仪表微舱 (Editorial Reading Journal Hero) */}
            <div className="relative overflow-hidden rounded-2xl border border-haze/60 bg-gradient-to-br from-ink-raised/90 via-ink-raised/60 to-ink-raised/30 p-4 sm:p-5 backdrop-blur-md shadow-xs">
              {/* 背景微水印装饰 */}
              <div
                className="pointer-events-none absolute -right-4 -bottom-6 select-none opacity-[0.04] text-paper"
                aria-hidden
              >
                <BookOpen size={160} strokeWidth={1} />
              </div>

              {/* 顶部标签与副标题 */}
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cinnabar opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-cinnabar" />
                  </span>
                  <span className="font-mono text-[10.5px] tracking-[0.2em] font-medium text-paper-muted">
                    READING FOOTPRINT · 阅历足迹
                  </span>
                </div>
                <span className="text-[10px] font-mono tracking-wider text-paper-faint">
                  本机持久化 · 离线可续
                </span>
              </div>

              {/* 核心指标展示 */}
              <div className="relative mt-3 flex items-baseline gap-2.5">
                <span className="font-display text-[34px] sm:text-[40px] leading-none tabular-nums font-normal text-paper tracking-tight">
                  {stats.total}
                </span>
                <span className="text-[13px] font-medium text-paper-muted">篇已读</span>
                {stats.totalVisits > stats.total && (
                  <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-cinnabar/10 px-2 py-0.5 text-[10.5px] text-cinnabar-soft border border-cinnabar/20">
                    <Sparkles size={11} />
                    共翻阅 {stats.totalVisits} 次
                  </span>
                )}
              </div>

              {/* 三大维度微指标网格 (Insight Pills) */}
              <div className="relative mt-3.5 grid grid-cols-3 gap-2 border-t border-haze/40 pt-3">
                <div className="flex flex-col">
                  <span className="text-[10px] text-paper-faint">今日开卷</span>
                  <span className="mt-0.5 font-display text-[15px] font-medium text-paper">
                    {stats.today > 0 ? `${stats.today} 篇` : '静候启卷'}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-paper-faint">涉猎信源</span>
                  <span className="mt-0.5 font-display text-[15px] font-medium text-paper">
                    {stats.sourcesCount} 个平台
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-paper-faint">正文缓存</span>
                  <span className="mt-0.5 font-display text-[15px] font-medium text-paper">
                    {stats.offlineCount} 篇就绪
                  </span>
                </div>
              </div>
            </div>

            {/* 精雕细琢的智能搜索栏 (Intelligent Search Field) */}
            <div className="mt-3.5">
              <label className="flex h-10.5 items-center gap-2.5 rounded-2xl border border-haze/70 bg-ink-raised/60 px-3.5 transition-all focus-within:border-cinnabar/60 focus-within:bg-ink-raised/90 focus-within:ring-2 focus-within:ring-cinnabar/15">
                <Search
                  size={15.5}
                  className="shrink-0 text-paper-faint transition-colors duration-200"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索标题、来源、摘要或关键词…"
                  aria-label="搜索阅读足迹"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-paper outline-none placeholder:text-paper-faint/65"
                />
                {query && (
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-md bg-ink px-1.5 py-0.5 font-mono text-[10px] text-paper-faint border border-haze/40">
                      {current.length} 条
                    </span>
                    <button
                      type="button"
                      aria-label="清除搜索输入"
                      onClick={() => setQuery('')}
                      className="rounded-full p-1 text-paper-faint transition-colors hover:bg-ink hover:text-paper"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
              </label>
            </div>

            {/* 灵动分段来源过滤器 (Source Segment Filter with Badges) */}
            <div
              role="group"
              aria-label="按内容来源筛选"
              className="scroll-hidden -mx-4 mt-3 flex items-center gap-1.5 overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6"
            >
              {FILTERS.map((item) => {
                const count = originCounts[item.id] ?? 0
                if (item.id !== 'all' && count === 0) return null
                const active = filter === item.id
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      void haptics.selection()
                      setFilter(item.id)
                    }}
                    className={
                      'group flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] transition-all duration-150 ' +
                      (active
                        ? 'border-cinnabar/50 bg-cinnabar/12 font-medium text-cinnabar-soft shadow-xs'
                        : 'border-haze/60 bg-ink-raised/40 text-paper-muted hover:border-paper-faint/40 hover:bg-ink-raised/80 hover:text-paper')
                    }
                  >
                    {Icon && <Icon size={12} strokeWidth={1.8} className="shrink-0 opacity-80" />}
                    <span>{item.label}</span>
                    <span
                      className={
                        'rounded-full px-1.5 py-0.2 font-mono text-[9.5px] tabular-nums transition-colors ' +
                        (active
                          ? 'bg-cinnabar/20 text-cinnabar-soft'
                          : 'bg-haze/50 text-paper-faint group-hover:text-paper-muted')
                      }
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* 排序与控制栏 */}
            <div className="mt-2.5 flex items-center justify-between px-1 text-[11px] text-paper-faint">
              {isManaging ? (
                <div className="flex items-center gap-2">
                  <span className="font-medium text-paper">
                    已勾选 <span className="font-mono text-cinnabar-soft">{selectedKeys.size}</span> / {current.length} 篇
                  </span>
                  <button
                    type="button"
                    onClick={handleToggleSelectAll}
                    className="text-cinnabar-soft hover:underline"
                  >
                    {isAllCurrentSelected ? '取消全选' : '全选此分类'}
                  </button>
                </div>
              ) : (
                <span>
                  {query ? (
                    <>
                      匹配到 <span className="font-mono text-paper-muted">{current.length}</span> 条足迹
                    </>
                  ) : (
                    <>
                      共 <span className="font-mono text-paper-muted">{current.length}</span> 篇内容
                    </>
                  )}
                </span>
              )}

              {!isManaging && (
                <button
                  type="button"
                  onClick={() => {
                    void haptics.tick()
                    setSortMode((prev) => (prev === 'recent' ? 'visits' : 'recent'))
                  }}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-paper-muted transition-colors hover:bg-ink-raised hover:text-paper"
                >
                  <ArrowDownUp size={11.5} />
                  <span>{sortMode === 'recent' ? '按最近阅读' : '按翻阅频次'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* 状态 A：全局空状态（充满东方杂志与水墨美感的艺术表达） */}
        {!history.length ? (
          <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
            <div className="relative grid h-16 w-16 place-items-center rounded-3xl border border-haze/80 bg-gradient-to-b from-ink-raised to-ink-raised/40 text-paper-muted shadow-sm">
              <BookOpen size={28} strokeWidth={1.3} className="text-paper-muted" />
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-cinnabar/15 text-cinnabar border border-cinnabar/30">
                <Sparkles size={11} />
              </span>
            </div>
            <h3 className="mt-6 font-display text-[18px] tracking-wide text-paper">
              砚池未落墨 · 记录待启卷
            </h3>
            <p className="mt-2 max-w-[280px] text-[12.5px] leading-relaxed text-paper-faint">
              您在资讯源、专栏、Linux.do 或知乎中阅读过的每一篇文章，都会在此凝结为专属的阅读履历。
            </p>
          </div>
        ) : !current.length ? (
          /* 状态 B：搜索/筛选无结果 */
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center text-paper-faint">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-haze/60 bg-ink-raised/50 text-paper-faint">
              <Search size={22} strokeWidth={1.4} />
            </div>
            <p className="mt-4 text-[13.5px] font-medium text-paper-muted">未找到匹配的阅读足迹</p>
            <p className="mt-1 text-[11.5px] text-paper-faint">
              尝试缩短关键字，或切换来源分类查看。
            </p>
            <button
              type="button"
              onClick={() => {
                void haptics.tick()
                setQuery('')
                setFilter('all')
              }}
              className="mt-4 rounded-full border border-cinnabar/40 bg-cinnabar/10 px-3.5 py-1.5 text-[11.5px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/20"
            >
              重置筛选与搜索
            </button>
          </div>
        ) : (
          /* 状态 C：精巧考究的杂志时间轴列表 (Editorial Timeline Stream) */
          <div className="pb-8">
            {groups.map(([day, items]) => (
              <section key={day} className="relative">
                {/* 时间轴吸顶头部 (Timeline Sticky Header) */}
                <div className="sticky top-0 z-10 flex items-center justify-between border-y border-haze/30 bg-ink/90 px-4 py-2 backdrop-blur-md sm:px-6">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        'h-2 w-2 rounded-full transition-colors ' +
                        (day === '今天'
                          ? 'bg-cinnabar shadow-[0_0_8px_rgba(var(--tone-cinnabar-rgb)/0.6)]'
                          : 'border border-paper-faint/60 bg-transparent')
                      }
                      aria-hidden
                    />
                    <h2 className="font-display text-[13px] font-medium tracking-wide text-paper">
                      {day}
                    </h2>
                  </div>
                  <span className="rounded-full bg-ink-raised/60 px-2 py-0.5 font-mono text-[10px] tabular-nums text-paper-faint border border-haze/25">
                    {items.length} 篇
                  </span>
                </div>

                {/* 卡片流 */}
                <div className="p-3 sm:p-4 space-y-2.5">
                  {items.map((entry) => {
                    const offline = entry.kind === 'article' && hasCachedBody(entry.article.id)
                    const isSelected = selectedKeys.has(entry.key)
                    const originMeta = ORIGIN_CONFIG[entry.origin]

                    return (
                      <div
                        key={entry.key}
                        onClick={() => {
                          if (isManaging) toggleSelectKey(entry.key)
                        }}
                        className={
                          'group relative flex items-start gap-3 rounded-2xl border p-3 sm:p-3.5 transition-all duration-150 ' +
                          (isManaging ? 'cursor-pointer ' : '') +
                          (isSelected
                            ? 'border-cinnabar/60 bg-cinnabar/10 shadow-xs ring-1 ring-cinnabar/25'
                            : 'border-haze/40 bg-ink-raised/35 hover:border-haze/70 hover:bg-ink-raised/75')
                        }
                      >
                        {/* 批量管理模式下的复选框 */}
                        {isManaging && (
                          <div
                            className="mt-1 shrink-0 p-1 text-paper-muted transition-colors hover:text-paper"
                            aria-label={isSelected ? '已勾选' : '未勾选'}
                          >
                            {isSelected ? (
                              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-cinnabar text-white shadow-xs">
                                <Check size={13} strokeWidth={2.8} />
                              </div>
                            ) : (
                              <div className="h-5 w-5 rounded-full border-2 border-paper-faint/60 transition-colors group-hover:border-paper-muted" />
                            )}
                          </div>
                        )}

                        {/* 卡片主点击区域 */}
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left select-none"
                          onClick={() => {
                            if (!isManaging) {
                              onOpen(entry)
                            }
                          }}
                        >
                          {/* 顶部元信息行 (Origin + Time + Badges) */}
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] leading-none text-paper-faint">
                            {/* 来源平台药丸 */}
                            <span
                              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium ${originMeta.badgeClass}`}
                            >
                              <span>{entry.sourceLabel}</span>
                            </span>

                            {/* 时钟时间与相对时间 */}
                            <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-paper-faint">
                              <Clock3 size={10.5} strokeWidth={1.6} />
                              <time dateTime={new Date(entry.readAt).toISOString()}>
                                {clockTime(entry.readAt)}
                              </time>
                            </span>
                            <span className="text-paper-faint/60">·</span>
                            <span className="text-paper-faint/85">{relativeTime(entry.readAt)}</span>

                            {/* 离线可读状态徽标 */}
                            {offline && (
                              <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-haze/50 bg-ink/50 px-1.5 py-0.5 text-[9.5px] text-paper-faint">
                                <WifiOff size={10} strokeWidth={1.7} />
                                <span>离线可读</span>
                              </span>
                            )}

                            {/* 重温频次印记 */}
                            {entry.visits > 1 && (
                              <span className="ml-auto inline-flex items-center gap-0.5 font-mono text-[9.5px] text-paper-faint">
                                <span>重温 {entry.visits} 次</span>
                              </span>
                            )}
                          </div>

                          {/* 标题 */}
                          <h4 className="mt-1.5 font-display text-[15.5px] sm:text-[16px] font-medium leading-[1.45] text-paper [overflow-wrap:anywhere] transition-colors group-hover:text-cinnabar-soft">
                            {entry.title}
                          </h4>

                          {/* 摘要 (两行自然截断，生动唤醒记忆) */}
                          {entry.excerpt && (
                            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-paper-faint/90">
                              {entry.excerpt}
                            </p>
                          )}
                        </button>

                        {/* 配图缩略图 (如果有) */}
                        {entry.image && (
                          <div
                            onClick={(e) => {
                              if (!isManaging) {
                                e.stopPropagation()
                                onOpen(entry)
                              }
                            }}
                            className="relative h-[62px] w-[78px] sm:h-[68px] sm:w-[86px] shrink-0 cursor-pointer overflow-hidden rounded-xl border border-haze/40 bg-ink-raised"
                          >
                            <img
                              src={entry.image}
                              loading="lazy"
                              alt=""
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        )}

                        {/* 单条轻巧移除按钮（防误触设计） */}
                        {!isManaging && (
                          <div className="relative shrink-0 self-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRemoveSingle(entry)
                              }}
                              aria-label={`移出足迹：${entry.title}`}
                              className="rounded-xl p-2 text-paper-faint/60 transition-all hover:bg-ink hover:text-cinnabar active:scale-90"
                              title="移出足迹"
                            >
                              <X size={15} strokeWidth={1.8} />
                            </button>
                          </div>
                        )}

                        {/* 桌面端外跳图标 */}
                        {!isManaging && (
                          <ArrowUpRight
                            size={13}
                            className="hidden shrink-0 self-center text-paper-faint/40 transition-colors group-hover:text-paper-muted sm:block"
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* 交互核心：非侵入式撤销浮动条 (Undo Toast) */}
        {undoPrompt && (
          <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 w-[90%] max-w-md animate-fade-in pointer-events-auto">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-haze/60 bg-ink/95 px-4 py-3 shadow-xl backdrop-blur-md">
              <span className="truncate text-[12.5px] text-paper">{undoPrompt.text}</span>
              <button
                type="button"
                onClick={handleUndo}
                className="flex shrink-0 items-center gap-1 rounded-xl bg-cinnabar/15 px-3 py-1.5 text-[12px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/25 active:scale-95 border border-cinnabar/25"
              >
                <RotateCcw size={12.5} />
                <span>撤销</span>
              </button>
            </div>
          </div>
        )}

        {/* 对话框：清空确认 */}
        <ConfirmDialog
          open={confirmClear}
          title="清空全部阅读足迹？"
          message="将清除本机的全部最近阅读记录。此操作不会影响您的稍后读收藏、离线正文缓存或订阅源。"
          confirmLabel="清空足迹"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            onClear()
            setConfirmClear(false)
          }}
        />

        {/* 对话框：批量删除确认 */}
        <ConfirmDialog
          open={confirmBatchDelete}
          title={`删除已选的 ${selectedKeys.size} 条足迹？`}
          message="只从本机移除阅读足迹，不影响原文与收藏。"
          confirmLabel="确认删除"
          danger
          onCancel={() => setConfirmBatchDelete(false)}
          onConfirm={handleConfirmBatchDelete}
        />
      </div>
    </SettingsShell>
  )
}
