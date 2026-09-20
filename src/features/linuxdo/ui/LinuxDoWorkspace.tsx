import { ArrowLeft, Bell, Compass, Loader2, MessageCircle, Plus, RefreshCcw, Search, UserRound } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'

import { PresetSwitcher, type PresetSwitcherProps } from '../../../components/PresetSwitcher'
import { LinuxDoBoostComposer, LinuxDoComposer, LinuxDoTopicView } from './ThreadViews'
import { AccountView, BookmarksView, DiscoverView, NotificationsView, SearchView, UserProfileView } from './CommunityViews'
import { verifyLinuxDoBrowserSession } from '../session/native'
import {
  linuxDoApi as api,
  linuxDoDiscovery as discovery,
  linuxDoFeeds as feeds,
  linuxDoTopics as topicsApi,
} from '../runtime'
import { TopicCard } from './shared'
import { readableError } from './utils'
import type { LinuxDoFeedMode, LinuxDoPost, LinuxDoSessionSnapshot, LinuxDoTopic, LinuxDoTopicSummary } from '../types'
import { LinuxDoApiError } from '../types'

type Route =
  | { kind: 'feed'; mode: LinuxDoFeedMode }
  | { kind: 'topic'; topic: LinuxDoTopicSummary; targetPostNumber?: number }
  | { kind: 'search' }
  | { kind: 'discover' }
  | { kind: 'notifications' }
  | { kind: 'user'; username: string }
  | { kind: 'bookmarks' }
  | { kind: 'account' }

interface Props {
  onExit: () => void
  backHandlerRef: MutableRefObject<(() => boolean) | null>
  presetSwitcher: PresetSwitcherProps
}

type LinuxDoFeedCache = Record<LinuxDoFeedMode, { items: LinuxDoTopicSummary[]; page: number; scrollTop: number }>

const createFeedCache = (): LinuxDoFeedCache => ({
  latest: { items: [], page: 0, scrollTop: 0 },
  top: { items: [], page: 0, scrollTop: 0 },
  new: { items: [], page: 0, scrollTop: 0 },
  unread: { items: [], page: 0, scrollTop: 0 },
})

const feedTabs: Array<{ id: LinuxDoFeedMode; label: string }> = [
  { id: 'latest', label: '最新' },
  { id: 'top', label: '热门' },
  { id: 'new', label: '新帖' },
  { id: 'unread', label: '未读' },
]

function FeedView({
  mode,
  session,
  onMode,
  onOpen,
  onVerify,
  cacheRef,
}: {
  mode: LinuxDoFeedMode
  session: LinuxDoSessionSnapshot
  onMode: (mode: LinuxDoFeedMode) => void
  onOpen: (topic: LinuxDoTopicSummary) => void
  onVerify: () => void
  cacheRef: MutableRefObject<LinuxDoFeedCache>
}) {
  const [items, setItems] = useState<LinuxDoTopicSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [categoryNames, setCategoryNames] = useState<Record<number, string>>({})
  const pageRef = useRef(0)
  const touchStartX = useRef<number | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const previousModeRef = useRef<LinuxDoFeedMode>(mode)
  const touchStartY = useRef<number | null>(null)
  const [pullDistance, setPullDistance] = useState(0)

  const load = useCallback(async (reset: boolean) => {
    if (mode === 'unread' && !session.authenticated) {
      setItems([])
      setError(new LinuxDoApiError('auth-required', '登录后可查看未读主题'))
      setLoading(false)
      return
    }
    if (reset) {
      if (cacheRef.current[mode].items.length) setRefreshing(true)
      else setLoading(true)
    } else setLoadingMore(true)
    setError(null)
    try {
      const page = reset ? 0 : pageRef.current + 1
      const incoming = await feeds.list(mode, page)
      pageRef.current = page
      setItems((previous) => {
        const nextItems = reset
          ? incoming
          : previous.concat(incoming.filter((next) => !previous.some((item) => item.id === next.id)))
        cacheRef.current[mode] = { ...cacheRef.current[mode], items: nextItems, page }
        return nextItems
      })
    } catch (nextError) {
      setError(nextError)
    } finally {
      setLoading(false)
      setRefreshing(false)
      setLoadingMore(false)
    }
  }, [mode, session.authenticated, cacheRef])

  useEffect(() => {
    void discovery.categories().then((categories) => setCategoryNames(Object.fromEntries(categories.map((category) => [category.id, category.name])))).catch(() => undefined)
  }, [])

  useEffect(() => {
    const previousMode = previousModeRef.current
    if (previousMode !== mode && scrollerRef.current) {
      cacheRef.current[previousMode] = { ...cacheRef.current[previousMode], scrollTop: scrollerRef.current.scrollTop }
    }
    previousModeRef.current = mode
    const cached = cacheRef.current[mode]
    pageRef.current = cached.page
    setItems(cached.items)
    setError(null)
    if (cached.items.length) {
      setLoading(false)
      window.requestAnimationFrame(() => {
        if (scrollerRef.current) scrollerRef.current.scrollTop = cached.scrollTop
      })
    } else {
      void load(true)
    }
  }, [mode, load, cacheRef])

  const needsVerification = error instanceof LinuxDoApiError && error.kind === 'browser-verification'

  return (
    <div className="flex h-full min-h-0 flex-col" onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; touchStartY.current = event.touches[0]?.clientY ?? null }} onTouchMove={(event) => {
      if (touchStartY.current === null || (scrollerRef.current?.scrollTop ?? 0) > 0) return
      const distance = Math.max(0, (event.touches[0]?.clientY ?? touchStartY.current) - touchStartY.current)
      if (distance > 0) setPullDistance(Math.min(96, distance * 0.55))
    }} onTouchEnd={(event) => {
      if (pullDistance >= 54) void load(true)
      setPullDistance(0)
      touchStartY.current = null
      if (touchStartX.current === null) return
      const delta = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current
      touchStartX.current = null
      if (Math.abs(delta) < 72) return
      const index = feedTabs.findIndex((tab) => tab.id === mode)
      const nextIndex = delta < 0 ? Math.min(feedTabs.length - 1, index + 1) : Math.max(0, index - 1)
      const nextTab = feedTabs[nextIndex]
      if (nextTab && nextTab.id !== mode) onMode(nextTab.id)
    }}>
      <div className="sticky top-0 z-10 border-b border-haze/50 bg-ink/95 backdrop-blur-xl">
        <div className="page-x flex items-center gap-1.5 py-2.5">
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-full bg-paper/[0.035] p-1 scrollbar-none">
            {feedTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onMode(tab.id)}
                className={'linuxdo-control min-h-9 shrink-0 rounded-full px-4 py-1.5 text-[12px] font-semibold transition-all ' + (tab.id === mode ? 'bg-cinnabar text-white shadow-[0_6px_18px_rgb(22_119_255_/_0.22)]' : 'text-paper-muted hover:bg-ink-deep hover:text-paper')}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button type="button" disabled={refreshing || loading} onClick={() => void load(true)} className="linuxdo-control grid h-10 w-10 shrink-0 place-items-center rounded-full border border-haze/70 bg-ink-raised text-paper-muted shadow-sm hover:text-cinnabar disabled:opacity-55" aria-label={refreshing ? '正在刷新' : '刷新'}>
            <RefreshCcw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {pullDistance > 0 || refreshing ? <div className="pointer-events-none flex items-center justify-center gap-2 overflow-hidden text-[10px] text-paper-faint transition-[height]" style={{ height: refreshing ? 34 : pullDistance }}>{refreshing ? <><Loader2 size={13} className="animate-spin" /><span>正在刷新最新主题</span></> : pullDistance >= 54 ? '松手刷新' : '下拉刷新'}</div> : null}
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain page-x pb-28 pt-3"
        onScroll={(event) => {
          const node = event.currentTarget
          cacheRef.current[mode] = { ...cacheRef.current[mode], scrollTop: node.scrollTop }
          if (!loadingMore && !loading && node.scrollHeight - node.scrollTop - node.clientHeight < 420) void load(false)
        }}
      >
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-[126px] animate-pulse rounded-[20px] border border-haze/50 bg-paper/[0.035]" />)}
          </div>
        ) : error ? (
          <div className="mx-auto mt-20 max-w-sm rounded-[22px] border border-haze bg-ink-raised/50 px-5 py-6 text-center">
            <p className="text-[14px] font-medium text-paper">{readableError(error)}</p>
            <p className="mt-2 text-[11.5px] leading-6 text-paper-faint">
              {needsVerification ? '安全验证由你在 Linux.do 第一方页面中完成，NewsNook 不尝试绕过 Cloudflare。' : '检查网络或登录状态后重试。'}
            </p>
            <button type="button" onClick={needsVerification ? onVerify : () => void load(true)} className="linuxdo-control mt-4 rounded-full bg-cinnabar px-4 py-2 text-[12px] font-medium text-white">
              {needsVerification ? '打开安全验证' : '重新加载'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((topic, index) => <div key={topic.id} className="linuxdo-card-in" style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}><TopicCard topic={topic} categoryName={topic.categoryId ? categoryNames[topic.categoryId] : undefined} onOpen={() => onOpen(topic)} /></div>)}
            {loadingMore ? <div className="flex justify-center py-5 text-paper-faint"><Loader2 size={17} className="animate-spin" /></div> : null}
          </div>
        )}
      </div>
    </div>
  )
}

export function LinuxDoWorkspace({ onExit, backHandlerRef, presetSwitcher }: Props) {
  const [route, setRoute] = useState<Route>({ kind: 'feed', mode: 'latest' })
  const [history, setHistory] = useState<Route[]>([])
  const feedCacheRef = useRef<LinuxDoFeedCache>(createFeedCache())
  const [session, setSession] = useState<LinuxDoSessionSnapshot>({ authenticated: false, authMode: 'none' })
  const [composerTopic, setComposerTopic] = useState<LinuxDoTopic | undefined>()
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerInitialRaw, setComposerInitialRaw] = useState('')
  const [composerReplyTo, setComposerReplyTo] = useState<number | undefined>()
  const [composerEditPost, setComposerEditPost] = useState<LinuxDoPost | undefined>()
  const [topicPostMutation, setTopicPostMutation] = useState<LinuxDoPost | undefined>()
  const [boostPost, setBoostPost] = useState<LinuxDoPost | null>(null)
  const [workspaceError, setWorkspaceError] = useState('')
  const [notificationUnread, setNotificationUnread] = useState(0)
  const topicOverlayBackHandlerRef = useRef<(() => boolean) | null>(null)

  useEffect(() => {
    void api.restore().then((next) => { setSession(next); setNotificationUnread(next.currentUser?.unreadNotifications ?? 0) }).catch((nextError) => setWorkspaceError(readableError(nextError)))
  }, [])

  const navigate = useCallback((next: Route) => {
    setHistory((previous) => previous.concat(route))
    setRoute(next)
  }, [route])

  const goBack = useCallback(() => {
    const previous = history[history.length - 1]
    if (!previous) return false
    setHistory((items) => items.slice(0, -1))
    setRoute(previous)
    return true
  }, [history])

  const closeComposer = useCallback(() => {
    setComposerOpen(false)
    setComposerInitialRaw('')
    setComposerReplyTo(undefined)
    setComposerEditPost(undefined)
  }, [])

  useEffect(() => {
    backHandlerRef.current = () => {
      if (topicOverlayBackHandlerRef.current?.()) return true
      if (boostPost) { setBoostPost(null); return true }
      if (composerOpen) { closeComposer(); return true }
      return goBack()
    }
    return () => { backHandlerRef.current = null }
  }, [backHandlerRef, boostPost, closeComposer, composerOpen, goBack])

  const verify = async () => {
    try {
      const next = await verifyLinuxDoBrowserSession('https://linux.do/')
      api.setSession(next)
      setSession(next)
      if (route.kind === 'feed') setRoute({ kind: 'feed', mode: route.mode })
    } catch (nextError) {
      const message = readableError(nextError)
      if (!message.includes('取消')) setWorkspaceError(message)
    }
  }

  const title =
    route.kind === 'feed' ? 'Linux.do'
      : route.kind === 'topic' ? '主题'
        : route.kind === 'search' ? '搜索'
          : route.kind === 'discover' ? '发现'
            : route.kind === 'notifications' ? '通知'
              : route.kind === 'user' ? '用户'
                : route.kind === 'bookmarks' ? '书签'
                  : '我的'

  return (
    <div className="linuxdo-workspace relative flex h-full min-h-0 flex-col overflow-hidden bg-ink text-paper">
      {route.kind !== 'topic' ? <header className="linuxdo-brand-header linuxdo-control shrink-0 border-b border-haze/60 bg-ink/95 page-x select-none">
        <div className="flex min-h-[72px] items-center gap-3 py-2.5">
          <button type="button" onClick={() => { if (!goBack()) onExit() }} className="linuxdo-icon-button grid h-11 w-11 shrink-0 place-items-center rounded-full text-paper-muted" aria-label="返回 NewsNook"><ArrowLeft size={18} /></button>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2"><span className="text-[21px] font-bold tracking-[-0.03em] text-paper">Linux.do</span><span className="text-[10px] font-medium text-paper-faint">in NewsNook</span></div>
            <div className="mt-0.5 truncate text-[10.5px] text-paper-muted">{route.kind === 'feed' ? '更好的技术讨论，从这里开始' : title}</div>
          </div>
          <button type="button" onClick={() => navigate({ kind: 'search' })} className={'linuxdo-icon-button grid h-11 w-11 shrink-0 place-items-center rounded-full ' + (route.kind === 'search' ? 'bg-cinnabar text-white' : 'text-paper-muted')} aria-label="搜索"><Search size={18} /></button>
          <button type="button" onClick={() => navigate({ kind: 'notifications' })} className={'linuxdo-icon-button relative grid h-11 w-11 shrink-0 place-items-center rounded-full ' + (route.kind === 'notifications' ? 'bg-cinnabar text-white' : 'text-paper-muted')} aria-label="通知"><Bell size={18} />{notificationUnread > 0 ? <span className="absolute right-1 top-1 min-w-4 rounded-full bg-[#ff4d4f] px-1 text-center font-mono text-[8px] leading-4 text-white">{notificationUnread > 99 ? '99+' : notificationUnread}</span> : null}</button>
          <PresetSwitcher {...presetSwitcher} />
        </div>
      </header> : null}

      {workspaceError ? <button type="button" onClick={() => setWorkspaceError('')} className="linuxdo-control mx-3 mt-2 rounded-xl border border-cinnabar/25 bg-cinnabar/10 px-3 py-2 text-left text-[10.5px] text-cinnabar-soft">{workspaceError} · 点击关闭</button> : null}

      <div className="min-h-0 flex-1">
        {route.kind === 'feed' ? (
          <FeedView mode={route.mode} session={session} cacheRef={feedCacheRef} onMode={(mode) => setRoute({ kind: 'feed', mode })} onOpen={(topic) => navigate({ kind: 'topic', topic })} onVerify={() => void verify()} />
        ) : route.kind === 'topic' ? (
          <LinuxDoTopicView summary={route.topic} session={session} targetPostNumber={route.targetPostNumber} postMutation={topicPostMutation} overlayBackHandlerRef={topicOverlayBackHandlerRef} onBack={() => { if (!goBack()) setRoute({ kind: 'feed', mode: 'latest' }) }} onCompose={(topic, options) => { setComposerTopic(topic); setComposerEditPost(undefined); setComposerInitialRaw(options?.initialRaw || ''); setComposerReplyTo(options?.replyToPostNumber); setComposerOpen(true) }} onBoost={setBoostPost} onOpenUser={(username) => navigate({ kind: 'user', username })} onOpenTopic={(topic, targetPostNumber) => navigate({ kind: 'topic', topic, targetPostNumber })} onEdit={(topic, post) => {
            setComposerTopic(topic)
            setComposerReplyTo(undefined)
            const openEditor = (raw: string) => { setComposerEditPost({ ...post, raw }); setComposerInitialRaw(raw); setComposerOpen(true) }
            if (post.raw) openEditor(post.raw)
            else void topicsApi.raw(post.id).then(openEditor).catch((nextError) => setWorkspaceError(readableError(nextError)))
          }} />
        ) : route.kind === 'search' ? (
          <SearchView onOpen={(topic, targetPostNumber) => navigate({ kind: 'topic', topic, targetPostNumber })} onOpenUser={(username) => navigate({ kind: 'user', username })} />
        ) : route.kind === 'discover' ? (
          <DiscoverView onOpen={(topic) => navigate({ kind: 'topic', topic })} />
        ) : route.kind === 'notifications' ? (
          <NotificationsView session={session} onUnreadChange={setNotificationUnread} onOpen={(topic, targetPostNumber) => navigate({ kind: 'topic', topic, targetPostNumber })} />
        ) : route.kind === 'user' ? (
          <UserProfileView username={route.username} onOpenTopic={(topic, targetPostNumber) => navigate({ kind: 'topic', topic, targetPostNumber })} />
        ) : route.kind === 'bookmarks' ? (
          <BookmarksView session={session} onOpenTopic={(topic, targetPostNumber) => navigate({ kind: 'topic', topic, targetPostNumber })} />
        ) : (
          <AccountView session={session} onSession={(next) => { setSession(next); setNotificationUnread(next.currentUser?.unreadNotifications ?? 0) }} onBookmarks={() => navigate({ kind: 'bookmarks' })} onProfile={(username) => navigate({ kind: 'user', username })} />
        )}
      </div>

      <nav className="linuxdo-bottom-nav linuxdo-control absolute inset-x-3 bottom-[max(10px,var(--sab))] z-30 grid grid-cols-5 items-end rounded-[24px] border border-haze/70 bg-ink-raised/95 px-2 py-1.5 shadow-2xl backdrop-blur-xl select-none">
        <button type="button" onClick={() => setRoute({ kind: 'feed', mode: route.kind === 'feed' ? route.mode : 'latest' })} className={'linuxdo-nav-item ' + (route.kind === 'feed' ? 'is-active' : '')} aria-label="首页"><MessageCircle size={18} /><span>首页</span></button>
        <button type="button" onClick={() => setRoute({ kind: 'discover' })} className={'linuxdo-nav-item ' + (route.kind === 'discover' ? 'is-active' : '')} aria-label="发现"><Compass size={18} /><span>发现</span></button>
        <button type="button" onClick={() => { setComposerTopic(undefined); setComposerEditPost(undefined); setComposerInitialRaw(''); setComposerReplyTo(undefined); setComposerOpen(true) }} className="linuxdo-nav-compose" aria-label="发布"><span className="grid h-12 w-12 place-items-center rounded-full bg-cinnabar text-white shadow-lg"><Plus size={22} /></span><span>发布</span></button>
        <button type="button" onClick={() => setRoute({ kind: 'notifications' })} className={'linuxdo-nav-item relative ' + (route.kind === 'notifications' ? 'is-active' : '')} aria-label="通知"><Bell size={18} /><span>通知</span>{notificationUnread > 0 ? <i className="absolute right-[24%] top-1 h-2 w-2 rounded-full bg-[#ff4d4f]" /> : null}</button>
        <button type="button" onClick={() => setRoute({ kind: 'account' })} className={'linuxdo-nav-item ' + (route.kind === 'account' || route.kind === 'user' || route.kind === 'bookmarks' ? 'is-active' : '')} aria-label="我的"><UserRound size={18} /><span>我的</span></button>
      </nav>

      <LinuxDoComposer open={composerOpen} topic={composerTopic} session={session} initialRaw={composerInitialRaw} replyToPostNumber={composerReplyTo} editPost={composerEditPost} onClose={closeComposer} onSent={(created, kind) => {
        if (kind === 'reply') {
          setTopicPostMutation(created)
        } else if (created.topicId) {
          navigate({ kind: 'topic', topic: { id: created.topicId, slug: created.topicSlug || 'topic', title: created.topicTitle || '新主题', postsCount: 1, replyCount: 0, views: 0, likeCount: 0, createdAt: created.createdAt, lastPostedAt: created.createdAt, tags: [], posters: [{ username: created.username, avatarTemplate: created.avatarTemplate }] }, targetPostNumber: created.postNumber || 1 })
        } else {
          feedCacheRef.current.latest = { items: [], page: 0, scrollTop: 0 }
          setRoute({ kind: 'feed', mode: 'latest' })
        }
      }} onEdited={(updated) => { setTopicPostMutation(updated); setComposerOpen(false); setComposerEditPost(undefined) }} />

      {boostPost ? <LinuxDoBoostComposer post={boostPost} onClose={() => setBoostPost(null)} /> : null}

    </div>
  )
}
