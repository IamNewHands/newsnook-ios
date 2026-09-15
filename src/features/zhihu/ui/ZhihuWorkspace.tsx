import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { ArrowLeft, Bell, Home, Search, UserRound } from 'lucide-react'

import { PresetSwitcher, type PresetSwitcherProps } from '../../../components/PresetSwitcher'
import type { Article } from '../../../lib/types'
import { ZhihuCommentsService } from '../comments/service'
import { ZhihuContentService } from '../content/service'
import { createZhihuFeedService, type ZhihuFeedService } from '../feed/service'
import { useZhihuFeed } from '../feed/useZhihuFeed'
import { createZhihuRootFrame, reduceRoutes } from '../navigation'
import { ZhihuPeopleService } from '../people/service'
import { createZhihuRuntime } from '../runtime'
import { ZhihuTopicService } from '../topic/service'
import type { RouteFrame, ZhihuEntityRef, ZhihuFeedMode } from '../types'
import { ZhihuContentScreen } from './ZhihuContentScreen'
import { ZhihuFeedScreen } from './ZhihuFeedScreen'
import { ZhihuPeopleScreen } from './ZhihuPeopleScreen'
import { ZhihuSearchScreen } from './ZhihuSearchScreen'
import { ZhihuTopicScreen } from './ZhihuTopicScreen'

interface Props {
  onExit: () => void
  onOpenArticle: (article: Article) => void
  backHandlerRef: MutableRefObject<(() => boolean) | null>
  presetSwitcher: PresetSwitcherProps
}

let retainedFrames: RouteFrame[] | null = null

interface FeedRouteProps {
  mode: ZhihuFeedMode
  service: ZhihuFeedService
  onModeChange: (mode: ZhihuFeedMode) => void
  onOpen: (ref: ZhihuEntityRef) => void
  onSearch: () => void
}

/** 只在 feed route 挂载时请求列表，避免正文/搜索页后台继续拉推荐。 */
function ZhihuFeedRoute({ mode, service, onModeChange, onOpen, onSearch }: FeedRouteProps) {
  const feed = useZhihuFeed(service, mode)
  return (
    <ZhihuFeedScreen
      mode={mode}
      items={feed.items}
      loading={feed.loading}
      loadingMore={feed.loadingMore}
      hasMore={feed.hasMore}
      error={feed.error}
      onModeChange={onModeChange}
      onRefresh={feed.refresh}
      onLoadMore={feed.loadMore}
      onOpen={onOpen}
      onSearch={onSearch}
    />
  )
}

function capabilityPlaceholder(title: string, description: string) {
  return (
    <div className="mx-auto max-w-xl px-5 py-16 text-center">
      <h2 className="font-display text-[22px] font-semibold text-paper">{title}</h2>
      <p className="mt-3 text-[13px] leading-7 text-paper-muted">{description}</p>
      <div className="mt-5 rounded-xl border border-haze/70 bg-ink-raised/55 p-3 text-left font-mono text-[10.5px] leading-5 text-paper-faint">
        此入口不会模拟登录、伪造通知或返回假成功。完成用户授权实网协议验证后，能力矩阵会把对应 operation 从 source-only/blocked 提升为 verified。
      </div>
    </div>
  )
}

export function ZhihuWorkspace({ onExit, onOpenArticle, backHandlerRef, presetSwitcher }: Props) {
  const runtime = useMemo(() => createZhihuRuntime(), [])
  const feedService = useMemo(() => createZhihuFeedService(runtime.api), [runtime])
  const contentService = useMemo(() => new ZhihuContentService(runtime.api), [runtime])
  const commentsService = useMemo(() => new ZhihuCommentsService(runtime.api), [runtime])
  const peopleService = useMemo(() => new ZhihuPeopleService(runtime.api), [runtime])
  const topicService = useMemo(() => new ZhihuTopicService(runtime.api), [runtime])
  const [frames, setFrames] = useState<RouteFrame[]>(() => retainedFrames?.map((frame) => ({ ...frame })) ?? [createZhihuRootFrame()])
  const current = frames.at(-1) ?? createZhihuRootFrame()
  const scrollRef = useRef<HTMLDivElement>(null)
  const feedMode: ZhihuFeedMode = current.route.screen === 'feed' ? current.route.mode : 'recommended'

  useEffect(() => {
    retainedFrames = frames.map((frame) => ({ ...frame }))
  }, [frames])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    requestAnimationFrame(() => node.scrollTo({ top: current.scrollTop }))
  }, [current])

  const saveScroll = useCallback((source: RouteFrame[]) => {
    if (!source.length) return source
    const next = source.slice()
    const top = next.at(-1)!
    next[next.length - 1] = { ...top, scrollTop: scrollRef.current?.scrollTop ?? top.scrollTop }
    return next
  }, [])

  const pushEntity = useCallback((ref: ZhihuEntityRef, sourceAnchor?: string) => {
    setFrames((prev) => {
      const saved = saveScroll(prev)
      if (sourceAnchor && saved.length) {
        const index = saved.length - 1
        saved[index] = { ...saved[index], anchor: sourceAnchor }
      }
      return reduceRoutes(saved, { type: 'push', frame: { route: { screen: 'entity', ref }, scrollTop: 0 } })
    })
  }, [saveScroll])

  const pushSearch = useCallback((query = '') => {
    setFrames((prev) => reduceRoutes(saveScroll(prev), { type: 'push', frame: { route: { screen: 'search', query }, scrollTop: 0 } }))
  }, [saveScroll])

  const goBack = useCallback(() => {
    if (frames.length <= 1) return false
    setFrames((prev) => reduceRoutes(prev, { type: 'back' }))
    return true
  }, [frames.length])

  useEffect(() => {
    backHandlerRef.current = goBack
    return () => {
      if (backHandlerRef.current === goBack) backHandlerRef.current = null
    }
  }, [backHandlerRef, goBack])

  const setFeedMode = useCallback((mode: ZhihuFeedMode) => {
    setFrames((prev) => reduceRoutes(saveScroll(prev), { type: 'reset', frame: createZhihuRootFrame(mode) }))
  }, [saveScroll])

  const currentTitle = current.route.screen === 'feed'
    ? '知乎'
    : current.route.screen === 'search'
      ? '搜索'
      : current.route.screen === 'entity'
        ? '知乎内容'
        : current.route.screen === 'notifications'
          ? '通知'
          : current.route.screen === 'profile'
            ? '我的知乎'
            : '知乎'

  const body = (() => {
    switch (current.route.screen) {
      case 'feed':
        return (
          <ZhihuFeedRoute
            mode={current.route.mode}
            service={feedService}
            onModeChange={setFeedMode}
            onOpen={pushEntity}
            onSearch={() => pushSearch('')}
          />
        )
      case 'search':
        return (
          <ZhihuSearchScreen
            initialQuery={current.route.query}
            service={feedService}
            onQueryChange={(query) => setFrames((prev) => reduceRoutes(prev, {
              type: 'replace', frame: { route: { screen: 'search', query }, scrollTop: 0 },
            }))}
            onOpen={pushEntity}
          />
        )
      case 'entity':
        if (current.route.ref.kind === 'people') {
          return (
            <ZhihuPeopleScreen
              token={current.route.ref.id}
              service={peopleService}
              onOpen={pushEntity}
            />
          )
        }
        if (current.route.ref.kind === 'topic') {
          return (
            <ZhihuTopicScreen
              topicId={current.route.ref.id}
              service={topicService}
              onOpen={pushEntity}
            />
          )
        }
        return (
          <ZhihuContentScreen
            refValue={current.route.ref}
            contentService={contentService}
            feedService={feedService}
            commentsService={commentsService}
            onNavigate={pushEntity}
            onOpenArticle={onOpenArticle}
            restoreAnchor={current.anchor}
          />
        )
      case 'notifications':
        return capabilityPlaceholder('通知暂未开放', '通知属于账号私有数据；当前没有经过 NewsNook 授权账号实网验证的会话链路。')
      case 'profile':
        return capabilityPlaceholder('知乎账号暂未接入', '公开内容可直接阅读；登录、收藏、草稿、作品管理与资料修改必须等待独立认证协议闭环。')
      case 'editor':
        return capabilityPlaceholder('创作入口已安全封锁', '草稿与发布属于非幂等写操作，当前协议矩阵没有 verified 写能力。')
      case 'conversation':
        return capabilityPlaceholder('私信暂未开放', '私信包含账号私有数据与写操作，不能通过公共代理或 source-only 协议直接启用。')
    }
  })()

  const navTo = (frame: RouteFrame) => setFrames((prev) => reduceRoutes(saveScroll(prev), { type: 'push', frame }))

  return (
    <section className="relative flex h-full min-h-0 flex-1 flex-col bg-ink" aria-label="知乎工作区">
      <header className="z-10 flex min-h-[58px] shrink-0 items-center gap-2 border-b border-haze/70 bg-ink-raised/95 px-3 sm:px-5" style={{ paddingTop: 'var(--sat)' }}>
        <button
          type="button"
          onClick={() => (goBack() ? undefined : onExit())}
          aria-label={frames.length > 1 ? '返回' : '返回 NewsNook'}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-paper-muted hover:bg-ink hover:text-cinnabar"
        >
          <ArrowLeft size={19} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[17px] font-semibold text-paper">{currentTitle}</div>
          <div className="truncate font-mono text-[9.5px] tracking-[0.12em] text-paper-faint">NEWSNOOK · ZHIHU WORKSPACE</div>
        </div>
        <button
          type="button"
          onClick={() => pushSearch('')}
          aria-label="搜索知乎"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-paper-muted hover:bg-ink hover:text-cinnabar sm:hidden"
        >
          <Search size={17} />
        </button>
        <PresetSwitcher {...presetSwitcher} />
      </header>

      <div ref={scrollRef} className="scroll-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {body}
      </div>

      <nav className="absolute inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t border-haze/80 bg-ink-raised/95" style={{ paddingBottom: 'var(--sab)' }} aria-label="知乎主导航">
        <button
          type="button"
          onClick={() => setFrames([createZhihuRootFrame(feedMode)])}
          className={`flex min-h-14 flex-col items-center justify-center gap-1 font-mono text-[9.5px] ${current.route.screen === 'feed' ? 'text-cinnabar' : 'text-paper-faint'}`}
        >
          <Home size={17} /><span>首页</span>
        </button>
        <button
          type="button"
          onClick={() => navTo({ route: { screen: 'notifications' }, scrollTop: 0 })}
          className={`flex min-h-14 flex-col items-center justify-center gap-1 font-mono text-[9.5px] ${current.route.screen === 'notifications' ? 'text-cinnabar' : 'text-paper-faint'}`}
        >
          <Bell size={17} /><span>通知</span>
        </button>
        <button
          type="button"
          onClick={() => navTo({ route: { screen: 'profile' }, scrollTop: 0 })}
          className={`flex min-h-14 flex-col items-center justify-center gap-1 font-mono text-[9.5px] ${current.route.screen === 'profile' ? 'text-cinnabar' : 'text-paper-faint'}`}
        >
          <UserRound size={17} /><span>我的</span>
        </button>
      </nav>
    </section>
  )
}
