import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { ArrowLeft, Bell, Home, Search, UserRound } from 'lucide-react'

import { PresetSwitcher, type PresetSwitcherProps } from '../../../components/PresetSwitcher'
import type { Article } from '../../../lib/types'
import { ZhihuCollectionService } from '../collection/service'
import { ZhihuCommentDraftStore } from '../comments/draftStore'
import { ZhihuCommentsService } from '../comments/service'
import { ZhihuContentService } from '../content/service'
import { ZhihuDraftStore } from '../editor/draftStore'
import { ZhihuEditorService } from '../editor/service'
import { ZhihuImageUploadService } from '../editor/upload'
import { createZhihuFeedService, type ZhihuFeedService } from '../feed/service'
import { useZhihuFeed } from '../feed/useZhihuFeed'
import { ZhihuInteractionService } from '../interaction/service'
import { createZhihuRootFrame, reduceRoutes } from '../navigation'
import { ZhihuNotificationService } from '../notification/service'
import { ZhihuMessageDraftStore } from '../notification/draftStore'
import { ZhihuPeopleService } from '../people/service'
import { createZhihuRuntime } from '../runtime'
import { ZhihuTopicService } from '../topic/service'
import type {
  RouteFrame,
  ZhihuContentSummary,
  ZhihuEntityRef,
  ZhihuFeedMode,
} from '../types'
import type { ZhihuSessionSnapshot } from '../session/types'
import { ZhihuContentScreen } from './ZhihuContentScreen'
import { ZhihuAccountCollectionsScreen } from './ZhihuAccountCollectionsScreen'
import { ZhihuCollectionScreen } from './ZhihuCollectionScreen'
import { ZhihuFeedScreen } from './ZhihuFeedScreen'
import { ZhihuEditorScreen } from './ZhihuEditorScreen'
import { ZhihuPeopleScreen } from './ZhihuPeopleScreen'
import { ZhihuSearchScreen } from './ZhihuSearchScreen'
import { ZhihuTopicScreen } from './ZhihuTopicScreen'
import { ZhihuAccountScreen } from './ZhihuAccountScreen'
import { ZhihuConversationScreen } from './ZhihuConversationScreen'
import { ZhihuNotificationScreen } from './ZhihuNotificationScreen'

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
  authenticated: boolean
  accountId?: string | null
}

/** 只在 feed route 挂载时请求列表，避免正文/搜索页后台继续拉推荐。 */
function ZhihuFeedRoute({
  mode,
  service,
  onModeChange,
  onOpen,
  onSearch,
  authenticated,
  accountId,
}: FeedRouteProps) {
  // 推荐协议来源是传输层细节，不属于用户信息架构。工作区固定使用移动端推荐，
  // 用户只看到知乎语义上的「推荐 / 热榜 / 关注」。
  const feed = useZhihuFeed(service, mode, 'android', accountId)
  const openItem = useCallback((item: ZhihuContentSummary) => {
    onOpen(item.ref)
  }, [onOpen])
  return (
    <ZhihuFeedScreen
      mode={mode}
      items={feed.items}
      loading={feed.loading}
      loadingMore={feed.loadingMore}
      hasMore={feed.hasMore}
      error={feed.error}
      authenticated={authenticated}
      onModeChange={onModeChange}
      onRefresh={feed.refresh}
      onLoadMore={feed.loadMore}
      onOpen={openItem}
      onSearch={onSearch}
    />
  )
}

function capabilityPlaceholder(title: string, description: string) {
  return (
    <div className="mx-auto max-w-xl px-5 py-16 text-center">
      <h2 className="font-display text-[22px] font-semibold text-paper">{title}</h2>
      <p className="mt-3 text-[13px] leading-7 text-paper-muted">{description}</p>
    </div>
  )
}

export function ZhihuWorkspace({ onExit, onOpenArticle, backHandlerRef, presetSwitcher }: Props) {
  const runtime = useMemo(() => createZhihuRuntime(), [])
  const feedService = useMemo(() => createZhihuFeedService(runtime.api), [runtime])
  const collectionService = useMemo(() => new ZhihuCollectionService(runtime.api), [runtime])
  const contentService = useMemo(() => new ZhihuContentService(runtime.api), [runtime])
  const commentsService = useMemo(() => new ZhihuCommentsService(runtime.api), [runtime])
  const commentDraftStore = useMemo(() => new ZhihuCommentDraftStore(), [])
  const peopleService = useMemo(() => new ZhihuPeopleService(runtime.api), [runtime])
  const topicService = useMemo(() => new ZhihuTopicService(runtime.api), [runtime])
  const interactionService = useMemo(() => new ZhihuInteractionService(runtime.api), [runtime])
  const notificationService = useMemo(() => new ZhihuNotificationService(runtime.api), [runtime])
  const messageDraftStore = useMemo(() => new ZhihuMessageDraftStore(), [])
  const draftStore = useMemo(() => new ZhihuDraftStore(), [])
  const editorService = useMemo(() => new ZhihuEditorService(runtime.api, draftStore), [draftStore, runtime])
  const imageUploadService = useMemo(() => new ZhihuImageUploadService(runtime.api, runtime.session), [runtime])
  const [sessionSnapshot, setSessionSnapshot] = useState<ZhihuSessionSnapshot>(() => runtime.session.getSnapshot())
  const [frames, setFrames] = useState<RouteFrame[]>(() => retainedFrames?.map((frame) => ({ ...frame })) ?? [createZhihuRootFrame()])
  const current = frames.at(-1) ?? createZhihuRootFrame()
  const scrollRef = useRef<HTMLDivElement>(null)
  const feedMode: ZhihuFeedMode = current.route.screen === 'feed' ? current.route.mode : 'recommended'

  useEffect(() => runtime.session.subscribe(setSessionSnapshot), [runtime])
  useEffect(() => {
    void runtime.account.hydrate().catch(() => undefined)
  }, [runtime])

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

  const navTo = useCallback((frame: RouteFrame) => {
    setFrames((prev) => reduceRoutes(saveScroll(prev), { type: 'push', frame }))
  }, [saveScroll])

  const openAnswerEditor = useCallback(async (questionId: string) => {
    const accountId = runtime.session.getSnapshot().account?.id
    if (!accountId) {
      navTo({ route: { screen: 'profile' }, scrollTop: 0 })
      return
    }
    const draft = await draftStore.create(accountId, 'answer', questionId)
    navTo({ route: { screen: 'editor', localDraftId: draft.localDraftId }, scrollTop: 0 })
  }, [draftStore, navTo, runtime])

  const currentTitle = current.route.screen === 'feed'
    ? '知乎'
    : current.route.screen === 'search'
      ? '搜索'
      : current.route.screen === 'entity'
        ? '知乎内容'
        : current.route.screen === 'notifications'
          ? '消息'
          : current.route.screen === 'profile'
            ? '我的知乎'
            : current.route.screen === 'collections'
              ? '我的收藏夹'
            : current.route.screen === 'editor'
              ? '创作'
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
            authenticated={sessionSnapshot.auth === 'authenticated'}
            accountId={sessionSnapshot.account?.id}
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
              interaction={interactionService}
              authenticated={sessionSnapshot.auth === 'authenticated'}
              onMessage={(peerId) => navTo({ route: { screen: 'conversation', peerId }, scrollTop: 0 })}
            />
          )
        }
        if (current.route.ref.kind === 'topic') {
          return (
            <ZhihuTopicScreen
              topicId={current.route.ref.id}
              service={topicService}
              onOpen={pushEntity}
              interaction={interactionService}
              authenticated={sessionSnapshot.auth === 'authenticated'}
            />
          )
        }
        if (current.route.ref.kind === 'collection') {
          return (
            <ZhihuCollectionScreen
              collectionId={current.route.ref.id}
              service={collectionService}
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
            authenticated={sessionSnapshot.auth === 'authenticated'}
            accountId={sessionSnapshot.account?.id}
            commentDraftStore={commentDraftStore}
            interaction={interactionService}
            onWriteAnswer={(questionId) => void openAnswerEditor(questionId)}
          />
        )
      case 'notifications':
        return sessionSnapshot.auth === 'authenticated' ? (
          <ZhihuNotificationScreen
            service={notificationService}
            onOpen={pushEntity}
            onMessage={(peerId) => navTo({ route: { screen: 'conversation', peerId }, scrollTop: 0 })}
          />
        ) : capabilityPlaceholder('请先登录知乎', '登录后即可查看评论、赞同、关注通知和私信。')
      case 'profile':
        return (
          <ZhihuAccountScreen
            runtime={runtime}
            onOpenEditor={() => navTo({ route: { screen: 'editor', localDraftId: 'new' }, scrollTop: 0 })}
            onOpenProfile={(urlToken) => pushEntity({ kind: 'people', id: urlToken })}
            onOpenCollections={(urlToken) => navTo({ route: { screen: 'collections', urlToken }, scrollTop: 0 })}
          />
        )
      case 'collections':
        return sessionSnapshot.auth === 'authenticated' ? (
          <ZhihuAccountCollectionsScreen
            urlToken={current.route.urlToken}
            service={interactionService}
            onOpenCollection={(collectionId) => pushEntity({ kind: 'collection', id: collectionId })}
          />
        ) : capabilityPlaceholder('请先登录知乎', '登录后即可查看和管理你的知乎收藏夹。')
      case 'editor':
        return sessionSnapshot.auth === 'authenticated' && sessionSnapshot.account ? (
          <ZhihuEditorScreen
            accountId={sessionSnapshot.account.id}
            localDraftId={current.route.localDraftId}
            store={draftStore}
            service={editorService}
            uploadService={imageUploadService}
            onOpenDraft={(localDraftId) => navTo({ route: { screen: 'editor', localDraftId }, scrollTop: 0 })}
            onPublished={pushEntity}
            onDeleted={() => { if (!goBack()) navTo({ route: { screen: 'editor', localDraftId: 'new' }, scrollTop: 0 }) }}
          />
        ) : capabilityPlaceholder('请先登录知乎', '登录后即可进入草稿箱、写回答、发布想法和上传图片。')
      case 'conversation':
        return sessionSnapshot.auth === 'authenticated' ? (
          <ZhihuConversationScreen
            peerId={current.route.peerId}
            accountId={sessionSnapshot.account?.id}
            service={notificationService}
            draftStore={messageDraftStore}
          />
        ) : capabilityPlaceholder('请先登录知乎', '登录后即可查看知乎私信会话。')
    }
  })()

  return (
    <section className="relative flex h-full min-h-0 flex-1 flex-col bg-ink" aria-label="知乎工作区">
      {/* AppShell 已经统一吃掉顶部 safe-area；工作区再次加 --sat 会在打孔/刘海机型上形成双倍顶部留白。 */}
      <header className="z-10 flex min-h-[58px] shrink-0 items-center gap-2 border-b border-haze/70 bg-ink-raised/95 px-3 sm:px-5">
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
          <Bell size={17} /><span>消息</span>
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
