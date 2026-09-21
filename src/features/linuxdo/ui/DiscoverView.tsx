import {
  ArrowLeft,
  ChevronRight,
  Compass,
  Flame,
  Grid2X2,
  RotateCw,
  Search,
  Sparkles,
  Tag,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import { linuxDoDiscovery as discovery } from '../runtime'
import type {
  LinuxDoCategory,
  LinuxDoTag,
  LinuxDoTopicSummary,
} from '../types'
import { TopicCard } from './shared'
import { loadDiscoveryScope, type LinuxDoDiscoveryScope } from './discoveryScope'
import { compact, readableError } from './utils'

function getCategoryColor(category?: LinuxDoCategory): string {
  if (!category?.color) return 'var(--color-cinnabar)'
  return category.color.startsWith('#') ? category.color : `#${category.color}`
}

function CategoryCard({
  category,
  onClick,
}: {
  category: LinuxDoCategory
  onClick: () => void
}) {
  const catColor = getCategoryColor(category)
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ '--cat-accent': catColor } as CSSProperties}
      className="linuxdo-control linuxdo-cat-card group relative flex flex-col justify-between rounded-2xl p-3.5 text-left select-none"
    >
      <div className="linuxdo-cat-accent-bar" />
      <div className="pl-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: catColor }}
            />
            <span className="truncate text-[13.5px] font-semibold text-paper group-hover:text-cinnabar-soft transition-colors">
              {category.name}
            </span>
          </div>
          {typeof category.topicCount === 'number' ? (
            <span className="shrink-0 rounded-full bg-paper/6 px-2 py-0.5 font-mono text-[9.5px] font-medium text-paper-muted">
              {compact(category.topicCount)}
            </span>
          ) : null}
        </div>
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-paper-muted">
          {category.description || '浏览该版块的最新讨论'}
        </p>
      </div>
      <div className="mt-3 flex items-center justify-end pl-1.5 text-[10px] font-medium text-paper-faint group-hover:text-cinnabar transition-colors">
        <span>进入版块</span>
        <ChevronRight size={12} className="ml-0.5" />
      </div>
    </button>
  )
}

function TagChip({
  tag,
  rank,
  onClick,
}: {
  tag: LinuxDoTag
  rank?: number
  onClick: () => void
}) {
  const isRank1 = rank === 1
  const isRank2 = rank === 2
  const isRank3 = rank === 3

  return (
    <button
      type="button"
      onClick={onClick}
      className={`linuxdo-control linuxdo-tag-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium select-none ${
        isRank1
          ? 'is-rank-1 text-cinnabar dark:text-cinnabar-soft'
          : isRank2
          ? 'is-rank-2 text-[#7c3aed] dark:text-[#a78bfa]'
          : isRank3
          ? 'is-rank-3 text-[#d97706] dark:text-[#fbbf24]'
          : 'text-paper-muted hover:text-paper'
      }`}
    >
      {isRank1 ? (
        <Flame size={12} className="shrink-0 fill-current" />
      ) : isRank2 ? (
        <span className="shrink-0 text-[10px] font-bold">#2</span>
      ) : isRank3 ? (
        <span className="shrink-0 text-[10px] font-bold">#3</span>
      ) : (
        <span className="shrink-0 text-paper-faint">#</span>
      )}
      <span className="truncate max-w-[120px]">{tag.name}</span>
      {typeof tag.topicCount === 'number' && tag.topicCount > 0 ? (
        <span
          className={`font-mono text-[9px] ${
            isRank1 || isRank2 || isRank3 ? 'font-semibold opacity-90' : 'text-paper-faint'
          }`}
        >
          {compact(tag.topicCount)}
        </span>
      ) : null}
    </button>
  )
}

export function DiscoverView({
  onOpen,
  initialScope,
}: {
  onOpen: (topic: LinuxDoTopicSummary) => void
  initialScope?: LinuxDoDiscoveryScope
}) {
  const [categories, setCategories] = useState<LinuxDoCategory[]>([])
  const [tags, setTags] = useState<LinuxDoTag[]>([])
  const [items, setItems] = useState<LinuxDoTopicSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState('')
  const [activeScope, setActiveScope] = useState<LinuxDoDiscoveryScope | null>(initialScope ?? null)
  const [activeTab, setActiveTab] = useState<'featured' | 'categories' | 'tags'>('featured')
  const [tagQuery, setTagQuery] = useState('')

  useEffect(() => {
    void Promise.all([discovery.categories(), discovery.tags()])
      .then(([nextCategories, nextTags]) => {
        setCategories(nextCategories)
        setTags(nextTags)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (initialScope) {
      setActiveScope(initialScope)
    }
  }, [initialScope])

  useEffect(() => {
    if (!activeScope) {
      setItems([])
      setItemsError('')
      setItemsLoading(false)
      return
    }
    setItemsLoading(true)
    setItemsError('')
    void loadDiscoveryScope(discovery, activeScope)
      .then(setItems)
      .catch((nextError) => setItemsError(readableError(nextError)))
      .finally(() => setItemsLoading(false))
  }, [activeScope])

  const reloadActiveScope = async () => {
    if (!activeScope) return
    setItemsLoading(true)
    setItemsError('')
    try {
      const next = await loadDiscoveryScope(discovery, activeScope)
      setItems(next)
    } catch (nextError) {
      setItemsError(readableError(nextError))
    } finally {
      setItemsLoading(false)
    }
  }

  const categoriesById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories]
  )

  const activeCategory = activeScope?.kind === 'category'
    ? categoriesById[activeScope.category.id] || activeScope.category
    : undefined

  const sortedTags = useMemo(
    () => [...tags].sort((a, b) => (b.topicCount ?? 0) - (a.topicCount ?? 0)),
    [tags]
  )

  const hotTags = useMemo(() => sortedTags.slice(0, 10), [sortedTags])

  const normalizedTagQuery = tagQuery.trim().toLowerCase()
  const filteredTags = useMemo(() => {
    if (!normalizedTagQuery) return sortedTags
    return sortedTags.filter((t) => t.name.toLowerCase().includes(normalizedTagQuery))
  }, [sortedTags, normalizedTagQuery])

  if (loading) {
    return (
      <div className="space-y-4 page-x pt-5" role="status" aria-label="正在加载分类与标签">
        <div className="linuxdo-skeleton h-36 rounded-[26px] border border-haze/50" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="linuxdo-skeleton h-24 rounded-2xl border border-haze/50" />
          ))}
        </div>
      </div>
    )
  }

  // --- 模态 B：专属讨论流 (Scoped Feed Mode) ---
  if (activeScope) {
    const isCategory = activeScope.kind === 'category'
    const catColor = isCategory ? getCategoryColor(activeCategory) : undefined

    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* 顶部聚焦固定导航栏 */}
        <header className="shrink-0 border-b border-haze/50 bg-ink/95 backdrop-blur-xl select-none">
          <div className="page-x flex items-center justify-between gap-2 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setActiveScope(null)}
                className="linuxdo-control grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper/6 text-paper-muted transition-all hover:bg-paper/12 hover:text-paper active:scale-95"
                aria-label="返回发现大厅"
              >
                <ArrowLeft size={16} />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {isCategory ? (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-paper/10"
                      style={{ backgroundColor: catColor }}
                    />
                  ) : (
                    <Tag size={13} className="shrink-0 text-cinnabar-soft" />
                  )}
                  <h2 className="truncate text-[15px] font-bold text-paper">
                    {isCategory ? activeCategory?.name : `#${activeScope.name}`}
                  </h2>
                </div>
                <p className="truncate text-[10px] text-paper-faint">
                  {isCategory
                    ? (activeCategory?.description || (itemsLoading ? '正在加载讨论…' : `共 ${items.length} 篇相关讨论`))
                    : (itemsLoading ? '正在加载讨论…' : `共 ${items.length} 篇相关讨论`)}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={itemsLoading}
              onClick={() => void reloadActiveScope()}
              className="linuxdo-control grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper/6 text-paper-muted transition-all hover:bg-paper/12 hover:text-cinnabar active:scale-95 disabled:opacity-40"
              aria-label="刷新"
            >
              <RotateCw size={14} className={itemsLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>

        {/* 独立滚动区域 */}
        <div className="min-h-0 flex-1 overflow-y-auto page-x pb-6 pt-3">

        {/* 讨论列表 */}
        {itemsLoading ? (
          <div className="space-y-3" role="status" aria-label="正在加载讨论">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="linuxdo-skeleton h-28 rounded-2xl border border-haze/50" />
            ))}
          </div>
        ) : null}

        {itemsError ? (
          <div className="rounded-2xl border border-cinnabar/25 bg-cinnabar/[0.07] p-4 text-center">
            <p className="text-[12px] text-cinnabar-soft">{itemsError}</p>
            <button
              type="button"
              onClick={() => void reloadActiveScope()}
              className="linuxdo-control mt-3 rounded-full bg-cinnabar px-4 py-1.5 text-[11.5px] font-medium text-white shadow-sm"
            >
              重新加载
            </button>
          </div>
        ) : null}

        {!itemsLoading && !itemsError && items.length > 0 ? (
          <div className="space-y-3">
            {items.map((topic, index) => (
              <div
                key={topic.id}
                className="linuxdo-card-in"
                style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
              >
                <TopicCard
                  topic={topic}
                  category={topic.categoryId ? categoriesById[topic.categoryId] : undefined}
                  onOpen={() => onOpen(topic)}
                  onOpenCategory={(cat) => setActiveScope({ kind: 'category', category: cat })}
                  onOpenTag={(name) => setActiveScope({ kind: 'tag', name })}
                />
              </div>
            ))}
          </div>
        ) : null}

        {!itemsLoading && !itemsError && items.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-paper/5 text-paper-muted">
              <Compass size={22} />
            </div>
            <p className="mt-3 text-[13px] font-medium text-paper">该分类或标签下暂无讨论</p>
            <p className="mt-1 text-[11px] text-paper-faint">可以去其他版块或热门标签看看</p>
            <button
              type="button"
              onClick={() => setActiveScope(null)}
              className="linuxdo-control mt-4 rounded-full bg-paper/8 px-4 py-1.5 text-[11.5px] font-medium text-paper hover:bg-paper/12"
            >
              返回发现全览
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

  // --- 模态 A：探索大厅 (Hub Mode) ---
  return (
    <div className="min-h-0 flex-1 overflow-y-auto page-x pb-6 pt-4">
      {/* 顶部社区氛围横幅 */}
      <section className="linuxdo-discover-hero rounded-[26px] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-cinnabar/12 px-3 py-1 text-[10.5px] font-semibold text-cinnabar dark:bg-cinnabar/20 dark:text-cinnabar-soft">
              <Sparkles size={12} />
              <span>探索 Linux.do</span>
            </div>
            <h2 className="mt-3 text-[22px] font-bold tracking-[-0.03em] text-paper">
              发现前沿讨论
            </h2>
            <p className="mt-1 max-w-sm text-[11px] leading-5 text-paper-muted">
              从真实版块与社区标签中探索优质话题，直连一手经验。
            </p>
          </div>
          <div className="grid h-13 w-13 shrink-0 place-items-center rounded-2xl bg-cinnabar/10 text-cinnabar">
            <Compass size={26} />
          </div>
        </div>

        {/* 社区数据微胶囊 */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div
            onClick={() => setActiveTab('categories')}
            className="linuxdo-control linuxdo-stat-card cursor-pointer rounded-2xl p-3 select-none"
          >
            <div className="flex items-center gap-1.5 text-paper-faint text-[10px]">
              <Grid2X2 size={12} />
              <span>版块</span>
            </div>
            <div className="mt-1 text-[18px] font-bold font-mono text-paper">
              {categories.length}
            </div>
          </div>
          <div
            onClick={() => setActiveTab('tags')}
            className="linuxdo-control linuxdo-stat-card cursor-pointer rounded-2xl p-3 select-none"
          >
            <div className="flex items-center gap-1.5 text-paper-faint text-[10px]">
              <Tag size={12} />
              <span>标签</span>
            </div>
            <div className="mt-1 text-[18px] font-bold font-mono text-paper">
              {tags.length}
            </div>
          </div>
          <div className="linuxdo-stat-card rounded-2xl p-3 select-none">
            <div className="flex items-center gap-1.5 text-paper-faint text-[10px]">
              <Flame size={12} className="text-[#ff8a3d]" />
              <span>焦点热度</span>
            </div>
            <div className="mt-1 text-[18px] font-bold font-mono text-paper">
              {compact(hotTags[0]?.topicCount ?? 0)}
            </div>
          </div>
        </div>
      </section>

      {/* 探索分段导航 */}
      <div className="mt-4 flex rounded-full bg-paper/[0.04] p-1 border border-haze/50 select-none">
        <button
          type="button"
          onClick={() => setActiveTab('featured')}
          className={'flex-1 flex items-center justify-center gap-1.5 rounded-full py-2 text-[12px] font-semibold transition-all ' + (activeTab === 'featured' ? 'bg-cinnabar text-white shadow-sm' : 'text-paper-muted hover:text-paper')}
        >
          <Sparkles size={13} />
          <span>精选探索</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('categories')}
          className={'flex-1 flex items-center justify-center gap-1.5 rounded-full py-2 text-[12px] font-semibold transition-all ' + (activeTab === 'categories' ? 'bg-cinnabar text-white shadow-sm' : 'text-paper-muted hover:text-paper')}
        >
          <Grid2X2 size={13} />
          <span>版块大厅</span>
          <span className="ml-0.5 text-[10px] opacity-75 font-mono">({categories.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('tags')}
          className={'flex-1 flex items-center justify-center gap-1.5 rounded-full py-2 text-[12px] font-semibold transition-all ' + (activeTab === 'tags' ? 'bg-cinnabar text-white shadow-sm' : 'text-paper-muted hover:text-paper')}
        >
          <Tag size={13} />
          <span>标签集市</span>
          <span className="ml-0.5 text-[10px] opacity-75 font-mono">({tags.length})</span>
        </button>
      </div>

      {/* Tab 1: 精选探索 */}
      {activeTab === 'featured' ? (
        <div className="mt-5 space-y-6">
          {/* 热门焦点标签 */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame size={15} className="text-[#ff8a3d]" />
                <h3 className="text-[13px] font-bold text-paper">热门焦点标签</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('tags')}
                className="linuxdo-control text-[11px] font-medium text-paper-faint hover:text-cinnabar transition-colors"
              >
                查看全部 →
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {hotTags.map((tag, index) => (
                <TagChip
                  key={tag.name}
                  tag={tag}
                  rank={index + 1}
                  onClick={() => setActiveScope({ kind: 'tag', name: tag.name })}
                />
              ))}
            </div>
          </div>

          {/* 热门版块精选 */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Grid2X2 size={15} className="text-cinnabar-soft" />
                <h3 className="text-[13px] font-bold text-paper">热门活跃版块</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('categories')}
                className="linuxdo-control text-[11px] font-medium text-paper-faint hover:text-cinnabar transition-colors"
              >
                浏览全部版块 →
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2.5 min-[380px]:grid-cols-2 sm:grid-cols-3">
              {categories.slice(0, 6).map((category) => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  onClick={() => setActiveScope({ kind: 'category', category })}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Tab 2: 版块大厅 */}
      {activeTab === 'categories' ? (
        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Grid2X2 size={15} className="text-cinnabar-soft" />
              <h3 className="text-[13px] font-bold text-paper">全部分类版块</h3>
            </div>
            <span className="text-[10.5px] text-paper-faint font-mono">共 {categories.length} 个分类</span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 min-[380px]:grid-cols-2 sm:grid-cols-3">
            {categories.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                onClick={() => setActiveScope({ kind: 'category', category })}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Tab 3: 标签集市 */}
      {activeTab === 'tags' ? (
        <div className="mt-5 space-y-4">
          {/* 即时过滤搜索框 */}
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-paper-faint" />
            <input
              value={tagQuery}
              onChange={(event) => setTagQuery(event.target.value)}
              placeholder="搜索社区标签（如 Docker, AI, 薅羊毛...）"
              className="w-full rounded-2xl border border-haze bg-ink-raised/60 py-2.5 pl-10 pr-9 text-[12.5px] text-paper outline-none placeholder:text-paper-faint focus:border-cinnabar/45 transition-colors"
            />
            {tagQuery ? (
              <button
                type="button"
                onClick={() => setTagQuery('')}
                className="linuxdo-control absolute right-2.5 top-1/2 -translate-y-1/2 grid h-5 w-5 place-items-center rounded-full bg-paper/10 text-paper-muted hover:text-paper"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>

          {/* 标签列表 */}
          {normalizedTagQuery ? (
            <div>
              <div className="mb-2 text-[11px] text-paper-faint">
                找到 {filteredTags.length} 个相关标签
              </div>
              {filteredTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {filteredTags.map((tag) => (
                    <TagChip
                      key={tag.name}
                      tag={tag}
                      onClick={() => setActiveScope({ kind: 'tag', name: tag.name })}
                    />
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-[12px] text-paper-faint">
                  未找到包含“{tagQuery}”的标签
                </div>
              )}
            </div>
          ) : (
            <>
              {/* 热门 Top 10 */}
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-paper">
                  <Flame size={14} className="text-[#ff8a3d]" />
                  <span>热门排行</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {hotTags.map((tag, index) => (
                    <TagChip
                      key={tag.name}
                      tag={tag}
                      rank={index + 1}
                      onClick={() => setActiveScope({ kind: 'tag', name: tag.name })}
                    />
                  ))}
                </div>
              </div>

              {/* 全部标签 */}
              <div className="pt-2">
                <div className="mb-2 flex items-center justify-between text-[12px] font-bold text-paper">
                  <div className="flex items-center gap-1.5">
                    <Tag size={13} className="text-cinnabar-soft" />
                    <span>全部标签</span>
                  </div>
                  <span className="font-mono text-[10px] font-normal text-paper-faint">
                    {tags.length} 个
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tags.slice(0, 80).map((tag) => (
                    <TagChip
                      key={tag.name}
                      tag={tag}
                      onClick={() => setActiveScope({ kind: 'tag', name: tag.name })}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
