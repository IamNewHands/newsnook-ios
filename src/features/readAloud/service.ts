import { log } from '../../lib/logger'
import type { AiPrefs } from '../translation/types'
import { createReadAloudMediaControlAdapter } from './media/factory'
import {
  createReadAloudProvider,
  readAloudProviderKey,
  type ReadAloudProviderContext,
} from './providers/factory'
import {
  loadReadAloudPosition,
  saveReadAloudPosition,
} from './storage'
import type {
  ReadAloudDocument,
  ReadAloudHandle,
  ReadAloudMediaControlAdapter,
  ReadAloudPrefs,
  ReadAloudProvider,
  ReadAloudSnapshot,
  ReadAloudSubscriber,
} from './types'

export type ReadAloudProviderFactory = (
  context: ReadAloudProviderContext,
) => Promise<ReadAloudProvider>

export interface ReadAloudServiceOptions {
  providerFactory?: ReadAloudProviderFactory
  mediaAdapter?: ReadAloudMediaControlAdapter
}

const EMPTY_SNAPSHOT: ReadAloudSnapshot = {
  state: 'idle',
  segmentIndex: 0,
  segmentCount: 0,
  characterOffset: 0,
}

export class ReadAloudService {
  private snapshot: ReadAloudSnapshot = { ...EMPTY_SNAPSHOT }
  private readonly subscribers = new Set<ReadAloudSubscriber>()
  private readonly providerFactory: ReadAloudProviderFactory
  private readonly media: ReadAloudMediaControlAdapter

  private document: ReadAloudDocument | null = null
  private prefs: ReadAloudPrefs | null = null
  private ai: AiPrefs | null = null
  private provider: ReadAloudProvider | null = null
  private providerKey = ''
  private handle: ReadAloudHandle | null = null
  private abortController: AbortController | null = null
  private generation = 0
  private lastPersistAt = 0
  private mediaBound = false

  constructor(options: ReadAloudServiceOptions = {}) {
    this.providerFactory = options.providerFactory ?? createReadAloudProvider
    this.media = options.mediaAdapter ?? createReadAloudMediaControlAdapter()
    void this.bindMedia()
  }

  private async bindMedia(): Promise<void> {
    if (this.mediaBound) return
    this.mediaBound = true
    await this.media.bind({
      play: () => void this.resume(),
      pause: () => void this.pause(),
      stop: () => void this.stop(),
      next: () => void this.next(),
      previous: () => void this.previous(),
      seekForward: () => void this.seekRelative(140),
      seekBackward: () => void this.seekRelative(-140),
    })
  }

  subscribe(subscriber: ReadAloudSubscriber): () => void {
    this.subscribers.add(subscriber)
    subscriber(this.getSnapshot())
    return () => {
      this.subscribers.delete(subscriber)
    }
  }

  getSnapshot(): ReadAloudSnapshot {
    return { ...this.snapshot }
  }

  getDocument(): ReadAloudDocument | null {
    return this.document
  }

  async listVoices(
    prefs: ReadAloudPrefs,
    ai: AiPrefs,
  ): Promise<Awaited<ReturnType<ReadAloudProvider['listVoices']>>> {
    const context = { prefs, ai }
    const key = readAloudProviderKey(context)
    let provider = this.provider
    let temporary = false
    if (!provider || this.providerKey !== key) {
      provider = await this.providerFactory(context)
      temporary = true
    }
    try {
      return await provider.listVoices()
    } finally {
      if (temporary) await provider.dispose()
    }
  }

  async start(
    document: ReadAloudDocument,
    prefs: ReadAloudPrefs,
    ai: AiPrefs,
    options?: { resumeSaved?: boolean },
  ): Promise<void> {
    if (!document.segments.length) {
      this.fail(new Error('这篇文章没有可朗读的正文。'))
      return
    }

    this.document = document
    this.prefs = prefs
    this.ai = ai

    const saved =
      options?.resumeSaved === false
        ? null
        : loadReadAloudPosition(document.articleId)
    let segmentIndex = Math.min(
      Math.max(saved?.segmentIndex ?? 0, 0),
      document.segments.length - 1,
    )
    let characterOffset = Math.min(
      Math.max(saved?.characterOffset ?? 0, 0),
      document.segments[segmentIndex]?.text.length ?? 0,
    )

    const savedSegment = document.segments[segmentIndex]
    if (savedSegment && characterOffset >= savedSegment.text.length) {
      if (segmentIndex < document.segments.length - 1) {
        segmentIndex += 1
        characterOffset = 0
      } else {
        segmentIndex = 0
        characterOffset = 0
      }
    }

    await this.playSegment(segmentIndex, characterOffset)
  }

  async updatePreferences(
    prefs: ReadAloudPrefs,
    ai: AiPrefs,
  ): Promise<void> {
    const previousPrefs = this.prefs
    const previousAi = this.ai
    this.prefs = prefs
    this.ai = ai

    if (!this.document || !previousPrefs || !previousAi) return

    const previousKey = readAloudProviderKey({
      prefs: previousPrefs,
      ai: previousAi,
    })
    const nextKey = readAloudProviderKey({ prefs, ai })
    if (previousKey === nextKey) return

    const wasActive =
      this.snapshot.state === 'playing' ||
      this.snapshot.state === 'loading' ||
      this.snapshot.state === 'paused'
    if (!wasActive) return

    const paused = this.snapshot.state === 'paused'
    await this.playSegment(
      this.snapshot.segmentIndex,
      this.snapshot.characterOffset,
    )
    if (paused) await this.pause()
  }

  async pause(): Promise<void> {
    if (
      this.snapshot.state !== 'playing' &&
      this.snapshot.state !== 'loading'
    ) {
      return
    }

    this.setSnapshot({ state: 'paused' })
    this.persistPosition(true)

    if (this.handle) {
      try {
        await this.handle.pause()
      } catch (error) {
        log.readAloud.warn('pause failed', error)
      }
      return
    }

    if (!this.handle && this.abortController) {
      this.generation += 1
      this.abortController.abort()
      this.abortController = null
    }
  }

  async resume(): Promise<void> {
    if (this.snapshot.state !== 'paused') return

    if (this.handle) {
      try {
        await this.handle.resume()
        this.setSnapshot({ state: 'playing', error: undefined })
        return
      } catch (error) {
        log.readAloud.warn('resume failed; rebuilding segment', error)
      }
    }

    await this.playSegment(
      this.snapshot.segmentIndex,
      this.snapshot.characterOffset,
    )
  }

  async stop(): Promise<void> {
    const generation = ++this.generation
    this.abortController?.abort()
    this.abortController = null
    const handle = this.handle
    this.handle = null
    if (handle) {
      try {
        await handle.stop()
        await handle.dispose?.()
      } catch (error) {
        log.readAloud.warn('stop failed', error)
      }
    }
    if (generation !== this.generation) return

    this.persistPosition(true)
    this.setSnapshot({
      state: 'idle',
      error: undefined,
      elapsedMs: undefined,
    })
  }

  async next(): Promise<void> {
    if (!this.document) return
    const nextIndex = Math.min(
      this.snapshot.segmentIndex + 1,
      this.document.segments.length - 1,
    )
    if (nextIndex === this.snapshot.segmentIndex) {
      ++this.generation
      this.abortController?.abort()
      this.abortController = null
      const handle = this.handle
      this.handle = null
      if (handle) {
        await handle.stop().catch(() => {})
        await handle.dispose?.().catch(() => {})
      }
      const segment = this.document.segments[this.snapshot.segmentIndex]
      this.setSnapshot({
        state: 'ended',
        characterOffset: segment?.text.length ?? this.snapshot.characterOffset,
        elapsedMs: undefined,
      })
      this.persistPosition(true)
      return
    }
    await this.playSegment(nextIndex, 0)
  }

  async previous(): Promise<void> {
    if (!this.document) return
    const previousIndex =
      this.snapshot.characterOffset > 80
        ? this.snapshot.segmentIndex
        : Math.max(0, this.snapshot.segmentIndex - 1)
    await this.playSegment(previousIndex, 0)
  }

  async seekRelative(characterDelta: number): Promise<void> {
    if (!this.document) return
    const segment = this.document.segments[this.snapshot.segmentIndex]
    if (!segment) return
    const target = Math.min(
      segment.text.length,
      Math.max(0, this.snapshot.characterOffset + characterDelta),
    )

    if (
      this.handle?.seekToCharacter &&
      this.provider?.capabilities.seekByCharacter
    ) {
      try {
        await this.handle.seekToCharacter(target)
        this.setSnapshot({ characterOffset: target, elapsedMs: undefined })
        this.persistPosition(true)
        return
      } catch {
        // fall through to a complete segment rebuild
      }
    }
    await this.playSegment(this.snapshot.segmentIndex, target)
  }

  private async ensureProvider(): Promise<ReadAloudProvider> {
    if (!this.prefs || !this.ai) {
      throw new Error('朗读配置尚未初始化')
    }
    const context = { prefs: this.prefs, ai: this.ai }
    const key = readAloudProviderKey(context)
    if (this.provider && this.providerKey === key) return this.provider

    const previous = this.provider
    this.provider = null
    this.providerKey = ''
    if (previous) await previous.dispose()

    const provider = await this.providerFactory(context)
    this.provider = provider
    this.providerKey = key
    return provider
  }

  private async playSegment(
    segmentIndex: number,
    characterOffset: number,
  ): Promise<void> {
    if (!this.document || !this.prefs || !this.ai) return
    const segment = this.document.segments[segmentIndex]
    if (!segment) return

    const generation = ++this.generation
    this.abortController?.abort()
    this.abortController = new AbortController()

    const previousHandle = this.handle
    this.handle = null
    if (previousHandle) {
      try {
        await previousHandle.stop()
        await previousHandle.dispose?.()
      } catch {
        // stale handles are best-effort cleanup
      }
    }
    if (generation !== this.generation) return

    this.setSnapshot({
      state: 'loading',
      providerId: undefined,
      articleId: this.document.articleId,
      title: this.document.title,
      sourceName: this.document.sourceName,
      artwork: this.document.artwork,
      segmentIndex,
      segmentCount: this.document.segments.length,
      characterOffset,
      elapsedMs: undefined,
      error: undefined,
    })
    this.persistPosition(true)

    try {
      const provider = await this.ensureProvider()
      if (generation !== this.generation) return

      this.setSnapshot({ providerId: provider.id })

      const handle = await provider.speak(
        segment,
        {
          voiceId:
            provider.id === 'ai'
              ? this.prefs.ai.voice
              : this.prefs.systemVoiceId || undefined,
          rate: this.prefs.rate,
          pitch: this.prefs.pitch,
          startOffset: characterOffset,
          signal: this.abortController.signal,
        },
        {
          onStart: () => {
            if (generation !== this.generation) return
            this.setSnapshot({ state: 'playing', error: undefined })
          },
          onRange: (offset) => {
            if (generation !== this.generation) return
            this.snapshot = { ...this.snapshot, characterOffset: offset }
            this.persistPosition(false)
          },
          onTime: (elapsedMs) => {
            if (generation !== this.generation) return
            this.snapshot = { ...this.snapshot, elapsedMs }
          },
          onEnd: () => {
            if (generation !== this.generation) return
            void this.onSegmentEnded(generation)
          },
          onError: (error) => {
            if (generation !== this.generation) return
            this.fail(error)
          },
        },
      )

      if (generation !== this.generation) {
        await handle.stop().catch(() => {})
        await handle.dispose?.().catch(() => {})
        return
      }

      this.handle = handle
      // 某些实现的 onStart 可能在 speak() Promise resolve 前发生。
      if (this.snapshot.state === 'loading') {
        this.setSnapshot({ state: 'playing' })
      }
    } catch (error) {
      if (generation !== this.generation) return
      if (
        error instanceof DOMException &&
        error.name === 'AbortError'
      ) {
        return
      }
      this.fail(
        error instanceof Error ? error : new Error('朗读启动失败'),
      )
    }
  }

  private async onSegmentEnded(generation: number): Promise<void> {
    if (
      generation !== this.generation ||
      !this.document ||
      !this.prefs
    ) {
      return
    }

    const segment = this.document.segments[this.snapshot.segmentIndex]
    if (segment) {
      this.setSnapshot({ characterOffset: segment.text.length })
      this.persistPosition(true)
    }

    const nextIndex = this.snapshot.segmentIndex + 1
    if (
      this.prefs.autoContinue &&
      nextIndex < this.document.segments.length
    ) {
      await this.playSegment(nextIndex, 0)
      return
    }

    this.handle = null
    this.setSnapshot({ state: 'ended', elapsedMs: undefined })
  }

  private fail(error: Error): void {
    log.readAloud.warn('read aloud failed', error)
    this.setSnapshot({
      state: 'error',
      error: error.message,
    })
  }

  private persistPosition(force: boolean): void {
    if (!this.document || !this.snapshot.articleId) return
    const now = Date.now()
    if (!force && now - this.lastPersistAt < 800) return
    this.lastPersistAt = now

    saveReadAloudPosition({
      articleId: this.document.articleId,
      segmentIndex: this.snapshot.segmentIndex,
      characterOffset: this.snapshot.characterOffset,
      ...(typeof this.snapshot.elapsedMs === 'number'
        ? { elapsedMs: this.snapshot.elapsedMs }
        : {}),
      updatedAt: now,
    })
  }

  private setSnapshot(
    patch: Partial<ReadAloudSnapshot>,
  ): void {
    const previous = this.snapshot
    this.snapshot = { ...this.snapshot, ...patch }
    const copy = this.getSnapshot()
    for (const subscriber of this.subscribers) subscriber(copy)

    const mediaChanged =
      previous.state !== copy.state ||
      previous.articleId !== copy.articleId ||
      previous.title !== copy.title ||
      previous.sourceName !== copy.sourceName ||
      previous.artwork !== copy.artwork ||
      previous.segmentIndex !== copy.segmentIndex ||
      previous.segmentCount !== copy.segmentCount

    if (!mediaChanged) return

    if (this.document) {
      void this.media.update(copy, {
        articleId: this.document.articleId,
        title: this.document.title,
        sourceName: this.document.sourceName,
        artwork: this.document.artwork,
        segmentIndex: copy.segmentIndex,
        segmentCount: copy.segmentCount,
      })
    } else {
      void this.media.update(copy)
    }
  }

  async dispose(): Promise<void> {
    ++this.generation
    this.abortController?.abort()
    this.abortController = null
    const handle = this.handle
    this.handle = null
    if (handle) {
      await handle.stop().catch(() => {})
      await handle.dispose?.().catch(() => {})
    }
    await this.provider?.dispose().catch(() => {})
    this.provider = null
    this.providerKey = ''
    await this.media.dispose()
    this.subscribers.clear()
  }
}

let singleton: ReadAloudService | null = null

export function getReadAloudService(): ReadAloudService {
  singleton ??= new ReadAloudService()
  return singleton
}

/** App 级偏好变化时只更新已经存在的会话，不会为了设置同步而冷启动媒体服务。 */
export async function updateActiveReadAloudPreferences(
  prefs: ReadAloudPrefs,
  ai: AiPrefs,
): Promise<void> {
  if (!singleton) return
  await singleton.updatePreferences(prefs, ai)
}

export async function resetReadAloudServiceForTests(): Promise<void> {
  await singleton?.dispose()
  singleton = null
}
