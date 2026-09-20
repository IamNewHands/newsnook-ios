import { Capacitor } from '@capacitor/core'
import { Compass, Loader2, Search, Tag } from 'lucide-react'
import { useEffect, useState } from 'react'

import { linuxDoCapabilities } from '../capabilities'
import type { LinuxDoBookmarkService } from '../bookmark/service'
import type { LinuxDoPeopleService } from '../people/service'
import {
  linuxDoApi as api,
  linuxDoBookmarks as bookmarkApi,
  linuxDoDiscovery as discovery,
  linuxDoNotifications as notificationsApi,
  linuxDoPeople as peopleApi,
  linuxDoSearch as searchApi,
} from '../runtime'
import {
  authenticateLinuxDo,
  cancelLinuxDoAuthentication,
  clearLinuxDoBrowserSession,
  clearLinuxDoSession,
  verifyLinuxDoBrowserSession,
} from '../session/native'
import type {
  LinuxDoCategory,
  LinuxDoNotification,
  LinuxDoPost,
  LinuxDoSessionSnapshot,
  LinuxDoTag,
  LinuxDoTopicSummary,
} from '../types'
import { TopicCard } from './shared'
import { ago, avatar, readableError } from './utils'

export function SearchView({ onOpen, onOpenUser }: { onOpen: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void; onOpenUser: (username: string) => void }) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [topics, setTopics] = useState<LinuxDoTopicSummary[]>([])
  const [posts, setPosts] = useState<LinuxDoPost[]>([])
  const [users, setUsers] = useState<Array<{ id: number; username: string; name?: string; avatarTemplate?: string }>>([])
  const [active, setActive] = useState<'topics' | 'posts' | 'users'>('topics')
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [lastQuery, setLastQuery] = useState('')
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('newsnook-linuxdo-search-history') || '[]') as string[] } catch { return [] }
  })

  const run = async (nextPage = 1) => {
    const normalized = query.trim()
    if (!normalized) return
    if (nextPage === 1) setLoading(true)
    else setLoadingMore(true)
    setError('')
    try {
      const next = await searchApi.search(normalized, nextPage)
      if (nextPage === 1) {
        const nextHistory = [normalized, ...history.filter((item) => item !== normalized)].slice(0, 8)
        setHistory(nextHistory)
        localStorage.setItem('newsnook-linuxdo-search-history', JSON.stringify(nextHistory))
        setTopics(next.topics)
        setPosts(next.posts)
        setUsers(next.users)
        setLastQuery(normalized)
      } else {
        setTopics((previous) => previous.concat(next.topics.filter((item) => !previous.some((existing) => existing.id === item.id))))
        setPosts((previous) => previous.concat(next.posts.filter((item) => !previous.some((existing) => existing.id === item.id))))
        setUsers((previous) => previous.concat(next.users.filter((item) => !previous.some((existing) => existing.id === item.id))))
      }
      setPage(nextPage)
      setHasMore(next.topics.length > 0 || next.posts.length > 0 || next.users.length > 0)
    } catch (nextError) {
      setError(readableError(nextError))
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto page-x pb-28 pt-4">
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-paper-faint" />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void run(1)} placeholder="搜索主题、帖子、用户" className="w-full rounded-[18px] border border-haze bg-ink-raised/50 py-3 pl-10 pr-20 text-[13px] text-paper outline-none placeholder:text-paper-faint focus:border-cinnabar/45" />
        <button type="button" onClick={() => void run(1)} className="linuxdo-control absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-cinnabar px-3 py-1.5 text-[10.5px] font-medium text-white">搜索</button>
      </div>
      {history.length ? <div className="mt-3 flex items-center gap-2 overflow-x-auto scrollbar-none"><span className="shrink-0 text-[9.5px] text-paper-faint">最近</span>{history.map((item) => <button key={item} type="button" onClick={() => setQuery(item)} className="linuxdo-control shrink-0 rounded-full border border-haze px-2.5 py-1 text-[10px] text-paper-muted">{item}</button>)}<button type="button" onClick={() => { setHistory([]); localStorage.removeItem('newsnook-linuxdo-search-history') }} className="linuxdo-control shrink-0 text-[9.5px] text-paper-faint">清除</button></div> : null}
      <div className="linuxdo-control mt-3 flex gap-1 rounded-full bg-paper/[0.035] p-1 select-none">
        {([['topics','主题'],['posts','帖子'],['users','用户']] as const).map(([key,label]) => <button key={key} type="button" onClick={() => setActive(key)} className={'rounded-full px-3 py-1.5 text-[10.5px] ' + (active === key ? 'bg-paper text-ink' : 'text-paper-muted')}>{label}</button>)}
      </div>
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-paper-faint" /></div> : null}
      {error ? <p className="py-8 text-center text-[12px] text-cinnabar-soft">{error}</p> : null}
      {!loading && active === 'topics' ? <div className="mt-4 space-y-3">{topics.map((topic) => <TopicCard key={topic.id} topic={topic} onOpen={() => onOpen(topic)} />)}</div> : null}
      {!loading && active === 'posts' ? <div className="mt-4 space-y-2.5">{posts.map((post) => <button key={post.id} type="button" disabled={!post.topicId} onClick={() => post.topicId && onOpen({ id: post.topicId, slug: post.topicSlug || 'topic', title: post.topicTitle || 'Linux.do 主题', postsCount: 0, replyCount: 0, views: 0, likeCount: 0, createdAt: post.createdAt, lastPostedAt: post.createdAt, tags: [], posters: [] }, post.postNumber)} className="linuxdo-control w-full rounded-[18px] border border-haze/60 bg-ink-raised/40 px-4 py-3 text-left disabled:opacity-70"><div className="text-[10px] text-paper-faint">{'@' + post.username + ' · #' + post.postNumber}</div><div className="linuxdo-post-prose mt-2 line-clamp-4 text-[12px] text-paper-muted" dangerouslySetInnerHTML={{ __html: post.cooked }} /></button>)}</div> : null}
      {!loading && active === 'users' ? <div className="mt-4 space-y-2.5">{users.map((user) => <button key={user.id} type="button" onClick={() => onOpenUser(user.username)} className="linuxdo-control flex w-full items-center gap-3 rounded-[18px] border border-haze/60 bg-ink-raised/40 px-4 py-3 text-left"><div className="h-9 w-9 overflow-hidden rounded-full border border-haze bg-paper/5">{avatar(user.avatarTemplate, user.username)}</div><div><div className="text-[12.5px] font-medium text-paper">{user.name || user.username}</div><div className="text-[10px] text-paper-faint">{'@' + user.username}</div></div></button>)}</div> : null}
      {!loading && lastQuery && hasMore ? <button type="button" disabled={loadingMore || query.trim() !== lastQuery} onClick={() => void run(page + 1)} className="linuxdo-control mt-4 w-full rounded-full border border-haze px-4 py-2 text-[10.5px] text-paper-muted disabled:opacity-40">{loadingMore ? '加载中…' : '加载更多结果'}</button> : null}
    </div>
  )
}

export function DiscoverView({ onOpen }: { onOpen: (topic: LinuxDoTopicSummary) => void }) {
  const [categories, setCategories] = useState<LinuxDoCategory[]>([])
  const [tags, setTags] = useState<LinuxDoTag[]>([])
  const [items, setItems] = useState<LinuxDoTopicSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void Promise.all([discovery.categories(), discovery.tags()]).then(([nextCategories, nextTags]) => {
      setCategories(nextCategories)
      setTags(nextTags)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-paper-faint" /></div>

  return (
    <div className="min-h-0 flex-1 overflow-y-auto page-x pb-28 pt-4">
      <div className="mb-2 flex items-center gap-2"><Compass size={14} className="text-cinnabar-soft" /><h2 className="text-[12px] font-semibold tracking-[0.08em] text-paper-muted">分类</h2></div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {categories.map((category) => (
          <button key={category.id} type="button" onClick={() => void discovery.category(category.slug, category.id).then(setItems)} className="linuxdo-control rounded-[18px] border border-haze/60 bg-ink-raised/40 px-3.5 py-3 text-left hover:bg-ink-raised/70">
            <div className="text-[13px] font-semibold text-paper">{category.name}</div>
            <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-paper-faint">{category.description || '浏览该分类的最新讨论'}</div>
          </button>
        ))}
      </div>
      <div className="mb-2 mt-5 flex items-center gap-2"><Tag size={14} className="text-cinnabar-soft" /><h2 className="text-[12px] font-semibold tracking-[0.08em] text-paper-muted">标签</h2></div>
      <div className="flex flex-wrap gap-2">
        {tags.slice(0, 60).map((tag) => (
          <button key={tag.name} type="button" onClick={() => void discovery.tag(tag.name).then(setItems)} className="linuxdo-control rounded-full border border-haze/70 px-3 py-1.5 text-[10.5px] text-paper-muted hover:bg-paper/6 hover:text-paper">
            {'#' + tag.name + (tag.topicCount ? ' · ' + tag.topicCount : '')}
          </button>
        ))}
      </div>
      {items.length ? <div className="mt-6 space-y-3 border-t border-haze/50 pt-4">{items.map((topic) => <TopicCard key={topic.id} topic={topic} onOpen={() => onOpen(topic)} />)}</div> : null}
    </div>
  )
}

export function NotificationsView({ session, onOpen, onUnreadChange }: { session: LinuxDoSessionSnapshot; onOpen: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void; onUnreadChange: (count: number) => void }) {
  const notificationLabel = (type: number) => ({
    1: '有人提到了你', 2: '有人回复了你', 3: '有人引用了你', 4: '帖子被编辑', 5: '有人点赞', 6: '收到私信',
    7: '收到私信邀请', 9: '关注主题有新帖', 11: '有人链接了你的内容', 12: '获得徽章', 13: '收到主题邀请',
    18: '主题提醒', 24: '书签提醒', 25: '收到 Reaction', 29: '聊天中提到了你', 36: '关注的分类或标签有新内容', 43: '收到 Boost',
  } as Record<number, string>)[type] || '新通知'
  const [items, setItems] = useState<LinuxDoNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextOffset, setNextOffset] = useState<number | undefined>()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!session.authenticated) {
      setLoading(false)
      return
    }
    void notificationsApi.list().then((result) => {
      setItems(result.items)
      setNextOffset(result.nextOffset)
      onUnreadChange(result.items.filter((item) => !item.read).length)
    }).catch((nextError) => setError(readableError(nextError))).finally(() => setLoading(false))
  }, [session.authenticated, onUnreadChange])

  if (!session.authenticated) return <div className="px-6 py-20 text-center text-[13px] text-paper-muted">登录后可查看通知</div>

  return (
    <div className="min-h-0 flex-1 overflow-y-auto page-x pb-28 pt-3">
      <div className="mb-3 flex items-center justify-between"><span className="text-[10.5px] text-paper-faint">未读 {items.filter((item) => !item.read).length}</span><button type="button" onClick={() => void notificationsApi.markRead().then(() => { setItems((previous) => previous.map((item) => ({ ...item, read: true }))); onUnreadChange(0) }).catch((nextError) => setError(readableError(nextError)))} className="linuxdo-control rounded-full border border-haze px-3 py-1.5 text-[10px] text-paper-muted">全部已读</button></div>
      {error ? <button type="button" onClick={() => setError('')} className="mb-3 w-full rounded-xl border border-cinnabar/25 bg-cinnabar/10 px-3 py-2 text-left text-[10.5px] text-cinnabar-soft">{error} · 点击关闭</button> : null}
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-paper-faint" /></div> : (
        <div className="space-y-2.5">
          {items.map((item) => (
            <button key={item.id} type="button" onClick={() => {
              if (!item.read) {
                void notificationsApi.markRead(item.id).then(() => { setItems((previous) => previous.map((candidate) => candidate.id === item.id ? { ...candidate, read: true } : candidate)); onUnreadChange(Math.max(0, items.filter((candidate) => !candidate.read).length - 1)) }).catch((nextError) => setError(readableError(nextError)))
              }
              if (item.topicId) {
                onOpen({
                  id: item.topicId,
                  slug: item.slug || 'topic',
                  title: item.fancyTitle || 'Linux.do 主题',
                  postsCount: 0,
                  replyCount: 0,
                  views: 0,
                  likeCount: 0,
                  createdAt: item.createdAt,
                  lastPostedAt: item.createdAt,
                  tags: [],
                  posters: [],
                }, item.postNumber)
              }
            }} className={'linuxdo-control w-full rounded-[18px] border px-4 py-3 text-left ' + (item.read ? 'border-haze/50 bg-ink-raised/30' : 'border-cinnabar/25 bg-cinnabar/[0.055]')}>
              <div className="flex items-start gap-3">
                <div className={'mt-1 h-2 w-2 rounded-full ' + (item.read ? 'bg-paper/15' : 'bg-cinnabar')} />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-medium text-cinnabar-soft">{notificationLabel(item.notificationType)}</div>
                  <div className="mt-0.5 line-clamp-2 text-[12.5px] font-medium text-paper">{item.fancyTitle || 'Linux.do'}</div>
                  <div className="mt-1 text-[9.5px] text-paper-faint">{ago(item.createdAt)}</div>
                </div>
              </div>
            </button>
          ))}
          {nextOffset !== undefined ? <button type="button" disabled={loadingMore} onClick={() => {
            setLoadingMore(true)
            void notificationsApi.list(nextOffset).then((result) => {
              setItems((previous) => previous.concat(result.items.filter((item) => !previous.some((existing) => existing.id === item.id))))
              setNextOffset(result.nextOffset)
            }).catch((nextError) => setError(readableError(nextError))).finally(() => setLoadingMore(false))
          }} className="linuxdo-control w-full rounded-full border border-haze px-4 py-2 text-[10.5px] text-paper-muted disabled:opacity-40">{loadingMore ? '加载中…' : '加载更多通知'}</button> : null}
        </div>
      )}
    </div>
  )
}

export function UserProfileView({ username, onOpenTopic }: { username: string; onOpenTopic: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void }) {
  const [profile, setProfile] = useState<Awaited<ReturnType<LinuxDoPeopleService['profile']>> | null>(null)
  const [activity, setActivity] = useState<Awaited<ReturnType<LinuxDoPeopleService['activity']>> | null>(null)
  const [boostsGiven, setBoostsGiven] = useState<any[]>([])
  const [boostsReceived, setBoostsReceived] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    void Promise.all([
      peopleApi.profile(username),
      peopleApi.activity(username),
      peopleApi.boostsGiven(username).catch(() => []),
      peopleApi.boostsReceived(username).catch(() => []),
    ]).then(([nextProfile, nextActivity, given, received]) => {
      setProfile(nextProfile)
      setActivity(nextActivity)
      setBoostsGiven(given)
      setBoostsReceived(received)
    }).catch((nextError) => setError(readableError(nextError))).finally(() => setLoading(false))
  }, [username])

  const openBoostPost = (item: Awaited<ReturnType<LinuxDoPeopleService['boostsGiven']>>[number]) => {
    const post = item.post
    if (!post?.topicId) return
    let slug = 'topic'
    let postNumber: number | undefined
    if (post.url) {
      try {
        const parsed = new URL(post.url, 'https://linux.do')
        const match = parsed.pathname.match(/^\/t\/([^/]+)\/(\d+)(?:\/(\d+))?/)
        if (match) {
          slug = match[1] || slug
          postNumber = match[3] ? Number(match[3]) : undefined
        }
      } catch {
        // Use topic id even if the plugin returns a non-standard URL.
      }
    }
    onOpenTopic({ id: post.topicId, slug, title: post.topicTitle || 'Linux.do 主题', postsCount: 0, replyCount: 0, views: 0, likeCount: 0, createdAt: item.createdAt || '', lastPostedAt: item.createdAt || '', tags: [], posters: [] }, postNumber)
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-paper-faint" /></div>
  if (error || !profile) return <div className="px-6 py-20 text-center text-[12px] text-cinnabar-soft">{error || '用户不存在'}</div>

  return (
    <div className="min-h-0 flex-1 overflow-y-auto page-x pb-28 pt-5">
      <section className="rounded-[24px] border border-haze/60 bg-ink-raised/45 p-5">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 overflow-hidden rounded-full border border-haze bg-paper/5">{avatar(profile.avatarTemplate, profile.username)}</div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[18px] font-semibold text-paper">{profile.name || profile.username}</h2>
            <p className="mt-1 text-[11px] text-paper-faint">{'@' + profile.username + (profile.trustLevel !== undefined ? ' · TL' + profile.trustLevel : '')}</p>
          </div>
        </div>
        {profile.bioCooked ? <div className="linuxdo-post-prose reader-prose mt-4 text-[12px] text-paper-muted" dangerouslySetInnerHTML={{ __html: profile.bioCooked }} /> : null}
        <div className="mt-4 grid grid-cols-4 gap-2">
          {[
            ['主题', profile.topicCount ?? 0],
            ['帖子', profile.postCount ?? 0],
            ['获赞', profile.likesReceived ?? 0],
            ['Boost', boostsReceived.length],
          ].map(([label, value]) => <div key={String(label)} className="rounded-2xl bg-paper/[0.035] px-2 py-2 text-center"><div className="text-[13px] font-semibold text-paper">{String(value)}</div><div className="mt-0.5 text-[9px] text-paper-faint">{String(label)}</div></div>)}
        </div>
      </section>
      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between"><h3 className="text-[12px] font-semibold text-paper-muted">最近活动</h3><span className="text-[9.5px] text-paper-faint">主题与回复</span></div>
        <div className="space-y-3">{(activity?.topics ?? []).map((topic) => <TopicCard key={topic.id} topic={topic} onOpen={() => onOpenTopic(topic)} />)}</div>
      </section>
      {(boostsReceived.length || boostsGiven.length) ? <section className="mt-5 grid gap-4 lg:grid-cols-2">
        {([['收到的 Boost', boostsReceived], ['发出的 Boost', boostsGiven]] as const).map(([label, list]) => <div key={label}>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-[12px] font-semibold text-paper-muted">{label}</h3><span className="text-[9.5px] text-paper-faint">{list.length}</span></div>
          <div className="space-y-2">{list.slice(0, 8).map((item) => <button key={item.id} type="button" disabled={!item.post?.topicId} onClick={() => openBoostPost(item)} className="linuxdo-control w-full rounded-[18px] border border-haze/55 bg-ink-raised/35 px-3.5 py-3 text-left disabled:opacity-70">
            <div className="line-clamp-2 text-[12px] font-medium text-paper">{item.raw || 'Boost'}</div>
            {item.post?.excerpt ? <div className="mt-1.5 line-clamp-2 text-[10.5px] leading-4 text-paper-faint">{item.post.excerpt}</div> : null}
            <div className="mt-2 text-[9.5px] text-paper-faint">{item.post?.topicTitle || 'Linux.do'}{item.createdAt ? ' · ' + ago(item.createdAt) : ''}</div>
          </button>)}</div>
        </div>)}</section> : null}
    </div>
  )
}

export function BookmarksView({ session, onOpenTopic }: { session: LinuxDoSessionSnapshot; onOpenTopic: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void }) {
  const [items, setItems] = useState<Awaited<ReturnType<LinuxDoBookmarkService['list']>>['items']>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextUrl, setNextUrl] = useState<string | undefined>()
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<number | undefined>()
  const [editName, setEditName] = useState('')
  const [editReminder, setEditReminder] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const username = session.currentUser?.username
    if (!session.authenticated || !username) {
      setLoading(false)
      return
    }
    void bookmarkApi.list(username).then((result) => {
      setItems(result.items)
      setNextUrl(result.nextUrl)
    }).catch((nextError) => setError(readableError(nextError))).finally(() => setLoading(false))
  }, [session.authenticated, session.currentUser?.username])

  if (!session.authenticated) return <div className="px-6 py-20 text-center text-[13px] text-paper-muted">登录后可查看书签</div>
  if (loading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-paper-faint" /></div>
  if (error) return <div className="px-6 py-20 text-center text-[12px] text-cinnabar-soft">{error}</div>

  return (
    <div className="min-h-0 flex-1 overflow-y-auto page-x pb-28 pt-4">
      <div className="space-y-2.5">
        {items.map((item) => (
          <div key={item.id} className="rounded-[18px] border border-haze/60 bg-ink-raised/40 px-4 py-3">
            <div className="flex items-start gap-3">
              <button type="button" onClick={() => item.topicId && onOpenTopic({ id: item.topicId, slug: item.topicSlug || 'topic', title: item.topicTitle || 'Linux.do 主题', postsCount: 0, replyCount: 0, views: 0, likeCount: 0, createdAt: item.createdAt || '', lastPostedAt: item.createdAt || '', tags: [], posters: [] }, item.postNumber)} className="linuxdo-control min-w-0 flex-1 text-left">
                <div className="line-clamp-2 text-[13px] font-medium text-paper">{item.topicTitle || item.name || '已收藏帖子'}</div>
                <div className="mt-1 text-[10px] text-paper-faint">{item.username ? '@' + item.username + ' · ' : ''}{item.postNumber ? '#' + item.postNumber : ''}{item.name ? ' · ' + item.name : ''}{item.reminderAt ? ' · ' + new Date(item.reminderAt).toLocaleString('zh-CN') : ''}</div>
              </button>
              <button type="button" onClick={() => {
                setEditingId(item.id)
                setEditName(item.name || '')
                if (item.reminderAt) {
                  const date = new Date(item.reminderAt)
                  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
                  setEditReminder(local)
                } else setEditReminder('')
              }} className="linuxdo-control shrink-0 rounded-full bg-paper/5 px-2.5 py-1.5 text-[10px] text-paper-muted">编辑</button>
            </div>
            {editingId === item.id ? <div className="mt-3 grid gap-2 rounded-2xl bg-ink/55 p-3 sm:grid-cols-[1fr_1fr_auto]">
              <input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="书签备注" className="rounded-xl border border-haze bg-ink px-3 py-2 text-[11px] text-paper outline-none" />
              <input type="datetime-local" value={editReminder} onChange={(event) => setEditReminder(event.target.value)} className="rounded-xl border border-haze bg-ink px-3 py-2 text-[11px] text-paper outline-none" />
              <div className="flex gap-1.5">
                <button type="button" disabled={saving} onClick={async () => {
                  setSaving(true)
                  setError('')
                  try {
                    const reminderAt = editReminder ? new Date(editReminder).toISOString() : ''
                    await bookmarkApi.update(item.id, { name: editName.trim(), reminderAt })
                    setItems((previous) => previous.map((candidate) => candidate.id === item.id ? { ...candidate, name: editName.trim() || undefined, reminderAt: reminderAt || undefined } : candidate))
                    setEditingId(undefined)
                  } catch (nextError) {
                    setError(readableError(nextError))
                  } finally {
                    setSaving(false)
                  }
                }} className="linuxdo-control rounded-full bg-cinnabar px-3 py-2 text-[10px] text-white disabled:opacity-40">保存</button>
                <button type="button" disabled={saving} onClick={() => setEditingId(undefined)} className="linuxdo-control rounded-full border border-haze px-3 py-2 text-[10px] text-paper-muted">取消</button>
                <button type="button" disabled={saving} onClick={async () => {
                  if (!window.confirm('确定删除这个书签吗？')) return
                  setSaving(true)
                  try {
                    await bookmarkApi.delete(item.id)
                    setItems((previous) => previous.filter((candidate) => candidate.id !== item.id))
                    setEditingId(undefined)
                  } catch (nextError) {
                    setError(readableError(nextError))
                  } finally {
                    setSaving(false)
                  }
                }} className="linuxdo-control rounded-full border border-haze px-3 py-2 text-[10px] text-paper-faint disabled:opacity-40">删除</button>
              </div>
            </div> : null}
          </div>
        ))}
        {!items.length ? <div className="py-16 text-center text-[12px] text-paper-faint">暂无书签</div> : null}
        {nextUrl ? <button type="button" disabled={loadingMore} onClick={() => {
          const username = session.currentUser?.username
          if (!username) return
          setLoadingMore(true)
          void bookmarkApi.list(username, nextUrl).then((result) => {
            setItems((previous) => previous.concat(result.items.filter((item) => !previous.some((existing) => existing.id === item.id))))
            setNextUrl(result.nextUrl)
          }).catch((nextError) => setError(readableError(nextError))).finally(() => setLoadingMore(false))
        }} className="linuxdo-control w-full rounded-full border border-haze px-4 py-2 text-[10.5px] text-paper-muted disabled:opacity-40">{loadingMore ? '加载中…' : '加载更多书签'}</button> : null}
      </div>
    </div>
  )
}

export function AccountView({ session, onSession, onBookmarks, onProfile }: { session: LinuxDoSessionSnapshot; onSession: (next: LinuxDoSessionSnapshot) => void; onBookmarks: () => void; onProfile: (username: string) => void }) {
  const caps = linuxDoCapabilities()
  const native = Capacitor.isNativePlatform()
  const [accountError, setAccountError] = useState('')
  const [loginState, setLoginState] = useState<'idle' | 'authenticating' | 'unsupported' | 'cf-required'>('idle')

  const applySession = (next: LinuxDoSessionSnapshot) => {
    api.setSession(next)
    onSession(next)
  }

  const errorCode = (error: unknown): string => {
    if (typeof error === 'object' && error !== null && 'code' in error) return String((error as { code?: unknown }).code ?? '')
    return ''
  }

  const login = async () => {
    setAccountError('')
    setLoginState('authenticating')
    try {
      applySession(await authenticateLinuxDo())
      setLoginState('idle')
    } catch (nextError) {
      const code = errorCode(nextError)
      if (code === 'LINUXDO_USER_API_CANCELLED') {
        setLoginState('idle')
      } else if (code === 'LINUXDO_USER_API_UNSUPPORTED') {
        setLoginState('unsupported')
      } else if (code === 'LINUXDO_USER_API_BROWSER_VERIFICATION_REQUIRED') {
        setLoginState('cf-required')
      } else {
        setLoginState('idle')
        setAccountError(readableError(nextError))
      }
    }
  }

  const verifyBrowser = async (compatibilityMode: boolean) => {
    setAccountError('')
    try {
      const next = await verifyLinuxDoBrowserSession()
      if (compatibilityMode) {
        applySession(next)
        setLoginState('idle')
      } else {
        setLoginState('idle')
        await login()
      }
    } catch (nextError) {
      setLoginState('idle')
      setAccountError(readableError(nextError))
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto page-x pb-28 pt-5">
      <div className="rounded-[24px] border border-haze/60 bg-ink-raised/45 p-5">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 overflow-hidden rounded-full border border-haze bg-paper/5">{avatar(session.currentUser?.avatarTemplate, session.currentUser?.username)}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold text-paper">{session.authenticated ? session.currentUser?.name || session.currentUser?.username : '未登录'}</div>
            <div className="mt-1 text-[11px] text-paper-faint">{session.authenticated ? '@' + session.currentUser?.username + (session.authMode === 'user-api-key' ? ' · 安全授权' : ' · 兼容会话') : '使用系统浏览器登录，可复用 Chrome 中已登录的 GitHub / Google 账号'}</div>
          </div>
        </div>
        {session.authMode === 'user-api-key' ? <div className="mt-4 inline-flex items-center rounded-full border border-haze/60 bg-paper/[0.035] px-3 py-1.5 text-[10px] text-paper-muted">User API Key · Auth API v{session.apiVersion ?? 4}{session.expiresAt ? ' · 有效期至 ' + new Date(session.expiresAt).toLocaleDateString('zh-CN') : ''}</div> : null}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={!native || loginState === 'authenticating'} onClick={() => void login()} className="linuxdo-control flex-1 rounded-full bg-cinnabar px-4 py-2.5 text-[12px] font-medium text-white disabled:opacity-45">
            {loginState === 'authenticating' ? '请在系统浏览器完成授权…' : session.authMode === 'user-api-key' ? '重新安全授权' : native ? '使用系统浏览器登录' : '请在 App 中登录'}
          </button>
          {loginState === 'authenticating' ? <button type="button" onClick={() => void cancelLinuxDoAuthentication().finally(() => setLoginState('idle'))} className="linuxdo-control rounded-full border border-haze px-4 py-2.5 text-[12px] text-paper-muted">取消</button> : session.authenticated ? <button type="button" onClick={async () => {
            if (session.authMode === 'user-api-key') await clearLinuxDoSession()
            else if (session.authMode === 'browser-session') await clearLinuxDoBrowserSession()
            applySession({ authenticated: false, authMode: 'none' })
            setLoginState('idle')
          }} className="linuxdo-control rounded-full border border-haze px-4 py-2.5 text-[12px] text-paper-muted">退出</button> : null}
        </div>
        {loginState === 'authenticating' ? <p className="mt-3 rounded-2xl bg-paper/[0.035] px-3 py-2 text-[10.5px] leading-5 text-paper-muted">已打开系统浏览器。若 Chrome 已登录 GitHub 或 Google，通常无需再次输入密码；在 Linux.do 页面确认授权后会自动完成登录。</p> : null}
        {loginState === 'cf-required' ? <div className="mt-3 rounded-2xl border border-haze/60 bg-paper/[0.025] px-3 py-3"><div className="text-[11px] font-medium text-paper">需要先完成 Cloudflare 验证</div><div className="mt-1 text-[10px] leading-5 text-paper-faint">验证只用于通过 Linux.do 的浏览器安全检查，不保存账号密码。完成后再使用系统浏览器登录。</div><button type="button" onClick={() => void verifyBrowser(false)} className="linuxdo-control mt-2 rounded-full border border-haze px-3 py-1.5 text-[10px] text-paper-muted">完成 Cloudflare 验证</button></div> : null}
        {loginState === 'unsupported' ? <div className="mt-3 rounded-2xl border border-haze/60 bg-paper/[0.025] px-3 py-3"><div className="text-[11px] font-medium text-paper">Linux.do 当前未开放 App 安全授权</div><div className="mt-1 text-[10px] leading-5 text-paper-faint">可使用兼容模式继续登录，但 GitHub / Google 的系统浏览器登录态不一定能被复用。</div><button type="button" onClick={() => void verifyBrowser(true)} className="linuxdo-control mt-2 rounded-full border border-haze px-3 py-1.5 text-[10px] text-paper-muted">使用兼容模式</button></div> : null}
        {!native ? <p className="mt-3 rounded-2xl bg-paper/[0.035] px-3 py-2 text-[10.5px] leading-5 text-paper-faint">Web 端可浏览公开内容；登录、发帖、回复、点赞、书签、Boost 与上传需要 NewsNook App，以避免把 Linux.do 会话凭据转发到云端。</p> : null}
        {native ? <button type="button" onClick={async () => { await clearLinuxDoBrowserSession(); setAccountError('') }} className="linuxdo-control mt-3 text-[10px] text-paper-faint underline decoration-haze underline-offset-4">清除 Cloudflare / 浏览器验证数据</button> : null}
        {accountError ? <button type="button" onClick={() => setAccountError('')} className="mt-3 w-full rounded-xl border border-cinnabar/25 bg-cinnabar/10 px-3 py-2 text-left text-[10.5px] text-cinnabar-soft">{accountError} · 点击关闭</button> : null}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button type="button" onClick={onBookmarks} className="linuxdo-control rounded-[18px] border border-haze/55 bg-ink-raised/30 px-3.5 py-3 text-left">
          <div className="text-[11.5px] font-medium text-paper">书签</div>
          <div className="mt-1 text-[9.5px] text-paper-faint">{caps.bookmarks ? '查看收藏的楼层与主题' : '不可用'}</div>
        </button>
        <button type="button" disabled={!session.currentUser?.username} onClick={() => session.currentUser?.username && onProfile(session.currentUser.username)} className="linuxdo-control rounded-[18px] border border-haze/55 bg-ink-raised/30 px-3.5 py-3 text-left disabled:opacity-50">
          <div className="text-[11.5px] font-medium text-paper">个人主页</div>
          <div className="mt-1 text-[9.5px] text-paper-faint">主题、活动、Boost 与统计</div>
        </button>
        <div className="rounded-[18px] border border-haze/55 bg-ink-raised/30 px-3.5 py-3">
          <div className="text-[11.5px] font-medium text-paper">草稿</div>
          <div className="mt-1 text-[9.5px] text-paper-faint">{caps.drafts ? '自动保存与恢复已启用' : '不可用'}</div>
        </div>
        <div className="rounded-[18px] border border-haze/55 bg-ink-raised/30 px-3.5 py-3">
          <div className="text-[11.5px] font-medium text-paper">图片与附件</div>
          <div className="mt-1 text-[9.5px] text-paper-faint">{caps.uploads ? 'Composer 原生上传已启用' : '不可用'}</div>
        </div>
      </div>
      {!caps.boost.available ? <p className="mt-4 rounded-[18px] border border-haze/50 bg-paper/[0.025] px-4 py-3 text-[10.5px] leading-5 text-paper-faint">{caps.boost.reason}</p> : null}
    </div>
  )
}

