import { useEffect, useState } from 'react'

import type { PeopleContentKind, ZhihuPeopleProfile, ZhihuPeopleService } from '../people/service'
import type { ZhihuInteractionService } from '../interaction/service'
import { canExecuteZhihuOperation } from '../protocol'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'

interface Props {
  token: string
  service: ZhihuPeopleService
  onOpen: (ref: ZhihuEntityRef) => void
  interaction: ZhihuInteractionService
  authenticated: boolean
  onMessage: (peerId: string) => void
}

type Tab =
  | PeopleContentKind
  | 'activities'
  | 'followers'
  | 'following'
  | 'following-questions'
  | 'following-topics'
  | 'collections'
  | 'following-collections'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'answers', label: '回答' },
  { id: 'articles', label: '文章' },
  { id: 'questions', label: '提问' },
  { id: 'pins', label: '想法' },
  { id: 'activities', label: '动态' },
  { id: 'followers', label: '粉丝' },
  { id: 'following', label: '关注的人' },
  { id: 'following-questions', label: '关注问题' },
  { id: 'following-topics', label: '关注话题' },
  { id: 'collections', label: '收藏夹' },
  { id: 'following-collections', label: '关注收藏夹' },
]

function isContentTab(tab: Tab): tab is PeopleContentKind {
  return tab === 'answers' || tab === 'articles' || tab === 'questions' || tab === 'pins'
}

function isRelationTab(tab: Tab): tab is 'followers' | 'following' {
  return tab === 'followers' || tab === 'following'
}

export function ZhihuPeopleScreen({ token, service, onOpen, interaction, authenticated, onMessage }: Props) {
  const [profile, setProfile] = useState<ZhihuPeopleProfile | null>(null)
  const [tab, setTab] = useState<Tab>('answers')
  const [items, setItems] = useState<ZhihuContentSummary[]>([])
  const [peopleItems, setPeopleItems] = useState<ZhihuPeopleProfile[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [followBusy, setFollowBusy] = useState(false)
  const [blockBusy, setBlockBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setItems([])
    setPeopleItems([])
    setNextCursor(undefined)
    setHasMore(false)
    void (async () => {
      try {
        const nextProfile = await service.read(token, controller.signal)
        if (controller.signal.aborted) return
        setProfile(nextProfile)
        if (isContentTab(tab)) {
          const page = await service.listContent(token, tab, undefined, controller.signal)
          if (controller.signal.aborted) return
          setItems(page.items)
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
        } else if (tab === 'activities') {
          const page = await service.listActivities(nextProfile.token, undefined, controller.signal)
          if (controller.signal.aborted) return
          setItems(page.items)
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
        } else if (isRelationTab(tab)) {
          const page = await service.listRelations(nextProfile, tab, undefined, controller.signal)
          if (controller.signal.aborted) return
          setPeopleItems(page.items)
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
        } else if (tab === 'following-questions' || tab === 'following-topics') {
          const page = await service.listFollowingEntities(
            nextProfile.token,
            tab === 'following-questions' ? 'questions' : 'topics',
            undefined,
            controller.signal,
          )
          if (controller.signal.aborted) return
          setItems(page.items)
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
        } else {
          const page = await service.listCollections(nextProfile.token, tab, undefined, controller.signal)
          if (controller.signal.aborted) return
          setItems(page.items)
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取用户页失败')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [service, tab, token])

  const loadMore = () => {
    if (!profile || loadingMore || !hasMore) return
    setLoadingMore(true)
    const request = isContentTab(tab)
      ? !nextCursor
        ? Promise.resolve(null)
        : service.listContent(token, tab, nextCursor)
      : tab === 'activities'
        ? nextCursor
          ? service.listActivities(profile.token, nextCursor)
          : Promise.resolve(null)
        : isRelationTab(tab)
          ? nextCursor
            ? service.listRelations(profile, tab, nextCursor)
            : Promise.resolve(null)
          : tab === 'following-questions' || tab === 'following-topics'
            ? nextCursor
              ? service.listFollowingEntities(profile.token, tab === 'following-questions' ? 'questions' : 'topics', nextCursor)
              : Promise.resolve(null)
            : nextCursor
              ? service.listCollections(profile.token, tab, nextCursor)
              : Promise.resolve(null)
    void request.then(
      (page) => {
        if (!page) {
          setLoadingMore(false)
          return
        }
        if (isRelationTab(tab)) {
          setPeopleItems((prev) => {
            const seen = new Set(prev.map((item) => item.id))
            return [...prev, ...(page.items as ZhihuPeopleProfile[]).filter((item) => !seen.has(item.id))]
          })
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
          setLoadingMore(false)
          return
        }
        setItems((prev) => {
          const seen = new Set(prev.map((item) => `${item.ref.kind}:${item.ref.id}`))
          return [...prev, ...(page.items as ZhihuContentSummary[]).filter((item) => !seen.has(`${item.ref.kind}:${item.ref.id}`))]
        })
        setNextCursor(page.nextCursor)
        setHasMore(page.hasMore)
        setLoadingMore(false)
      },
      (reason) => {
        setError(reason instanceof Error ? reason.message : '加载更多失败')
        setLoadingMore(false)
      },
    )
  }

  const toggleBlock = async () => {
    if (!profile || !authenticated || blockBusy) return
    const target = !profile.isBlocking
    setBlockBusy(true)
    setError(null)
    try {
      await interaction.setPersonBlocked(profile.token, target)
      setProfile((prev) => prev ? { ...prev, isBlocking: target } : prev)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '屏蔽操作失败')
    } finally {
      setBlockBusy(false)
    }
  }

  const toggleFollow = async () => {
    if (!profile || !authenticated || followBusy) return
    const target = !profile.isFollowing
    setFollowBusy(true)
    setError(null)
    try {
      await interaction.setFollowing('person', profile.token, target)
      setProfile((prev) => prev ? {
        ...prev,
        isFollowing: target,
        followerCount: typeof prev.followerCount === 'number'
          ? Math.max(0, prev.followerCount + (target ? 1 : -1))
          : prev.followerCount,
      } : prev)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '关注操作失败')
    } finally {
      setFollowBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      {profile && (
        <header className="mb-5 rounded-2xl border border-haze/70 bg-ink-raised/55 p-4">
          <div className="flex items-start gap-3">
            {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" className="size-14 rounded-xl object-cover" loading="lazy" /> : null}
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-[22px] font-semibold text-paper">{profile.name}</h1>
              {profile.headline && <p className="mt-1 text-[12.5px] leading-6 text-paper-muted">{profile.headline}</p>}
            </div>
            {authenticated && (
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => onMessage(profile.id)} className="min-h-9 rounded-xl border border-haze px-3 font-mono text-[10.5px] text-paper-muted">私信</button>
                <button type="button" disabled={followBusy || !canExecuteZhihuOperation(profile.isFollowing ? 'follow.person.clear' : 'follow.person.set')} onClick={() => void toggleFollow()} title={canExecuteZhihuOperation(profile.isFollowing ? 'follow.person.clear' : 'follow.person.set') ? undefined : '当前版本暂不可关注用户'} className={`min-h-9 rounded-xl px-3 font-mono text-[10.5px] ${profile.isFollowing ? 'border border-haze text-paper-muted' : 'bg-cinnabar text-white'} disabled:opacity-45`}>
                  {followBusy ? '处理中…' : profile.isFollowing ? '已关注' : '关注'}
                </button>
                <button type="button" disabled={blockBusy || !canExecuteZhihuOperation(profile.isBlocking ? 'block.person.clear' : 'block.person.set')} onClick={() => void toggleBlock()} title={canExecuteZhihuOperation(profile.isBlocking ? 'block.person.clear' : 'block.person.set') ? undefined : '当前版本暂不可屏蔽用户'} className={`min-h-9 rounded-xl border px-3 font-mono text-[10.5px] disabled:opacity-45 ${profile.isBlocking ? 'border-cinnabar/50 text-cinnabar' : 'border-haze text-paper-faint'}`}>
                  {blockBusy ? '处理中…' : profile.isBlocking ? '取消屏蔽' : '屏蔽'}
                </button>
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] text-paper-faint">
            {typeof profile.followerCount === 'number' && <span>{profile.followerCount} 关注者</span>}
            {typeof profile.followingCount === 'number' && <span>{profile.followingCount} 关注</span>}
            {typeof profile.answerCount === 'number' && <span>{profile.answerCount} 回答</span>}
            {typeof profile.articleCount === 'number' && <span>{profile.articleCount} 文章</span>}
            {typeof profile.questionCount === 'number' && <span>{profile.questionCount} 提问</span>}
          </div>
          {profile.description && <p className="mt-3 whitespace-pre-wrap text-[12.5px] leading-6 text-paper-muted">{profile.description}</p>}
        </header>
      )}

      <div className="scroll-hidden mb-3 flex gap-1 overflow-x-auto rounded-xl border border-haze/70 bg-ink-raised/70 p-1">
        {TABS.map((item) => (
          <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`min-h-9 shrink-0 rounded-lg px-3 font-mono text-[10.5px] ${tab === item.id ? 'bg-cinnabar text-white' : 'text-paper-muted hover:bg-ink'}`}>{item.label}</button>
        ))}
      </div>

      {loading && <div className="py-14 text-center font-mono text-[11px] text-paper-faint">正在读取用户内容…</div>}
      {error && <div role="alert" className="mb-3 rounded-xl border border-cinnabar/35 bg-cinnabar/8 p-3 text-[12px] text-paper-muted">{error}</div>}
      <div className="space-y-2.5">
        {peopleItems.map((person) => (
          <button key={person.id} type="button" onClick={() => onOpen({ kind: 'people', id: person.token })} className="flex w-full items-center gap-3 rounded-xl border border-haze/70 bg-ink-raised/55 p-3.5 text-left hover:border-cinnabar/35">
            {person.avatarUrl ? <img src={person.avatarUrl} alt="" className="size-10 rounded-xl object-cover" loading="lazy" /> : <div className="size-10 rounded-xl bg-paper/5" />}
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-[15px] font-semibold text-paper">{person.name}</div>
              {person.headline && <div className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-paper-faint">{person.headline}</div>}
              {typeof person.followerCount === 'number' && <div className="mt-1 font-mono text-[9.5px] text-paper-faint">{person.followerCount} 关注者</div>}
            </div>
          </button>
        ))}
        {items.map((item) => (
          <button key={`${item.ref.kind}:${item.ref.id}`} type="button" onClick={() => onOpen(item.ref)} className="block w-full rounded-xl border border-haze/70 bg-ink-raised/55 p-3.5 text-left hover:border-cinnabar/35">
            <div className="font-display text-[16px] font-semibold leading-7 text-paper">{item.title}</div>
            {item.excerpt && <p className="mt-1 line-clamp-3 text-[12.5px] leading-6 text-paper-muted">{item.excerpt}</p>}
          </button>
        ))}
      </div>
      {hasMore && <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-4 min-h-11 w-full rounded-xl border border-haze/70 bg-ink-raised font-mono text-[11px] text-paper-muted disabled:opacity-50">{loadingMore ? '正在加载…' : '加载更多'}</button>}
    </div>
  )
}
