import type { PluginListenerHandle } from '@capacitor/core'

import { ReadAloudNative, isNativeReadAloudAvailable } from '../native'
import type {
  ReadAloudMediaActions,
  ReadAloudMediaControlAdapter,
  ReadAloudMediaMetadata,
  ReadAloudSnapshot,
} from '../types'

export class AndroidMediaSessionAdapter implements ReadAloudMediaControlAdapter {
  private listener: PluginListenerHandle | null = null
  private actions: ReadAloudMediaActions | null = null

  async bind(actions: ReadAloudMediaActions): Promise<void> {
    this.actions = actions
    if (!isNativeReadAloudAvailable()) return
    await this.listener?.remove()
    this.listener = await ReadAloudNative.addListener(
      'readAloudEvent',
      (event) => {
        if (event.utteranceId) return
        if (event.type === 'play') this.actions?.play()
        if (event.type === 'pause' || event.type === 'focus-loss' || event.type === 'noisy') {
          this.actions?.pause()
        }
        if (event.type === 'next') this.actions?.next()
        if (event.type === 'previous') this.actions?.previous()
        if (event.type === 'stop') this.actions?.stop()
      },
    )
  }

  async update(
    snapshot: ReadAloudSnapshot,
    metadata?: ReadAloudMediaMetadata,
  ): Promise<void> {
    if (!isNativeReadAloudAvailable()) return
    const active =
      snapshot.state !== 'idle' &&
      snapshot.state !== 'ended' &&
      snapshot.state !== 'error'

    await ReadAloudNative.setMediaSession({
      active,
      title: metadata?.title,
      sourceName: metadata?.sourceName,
      artwork: metadata?.artwork,
      state:
        snapshot.state === 'loading'
          ? 'loading'
          : snapshot.state === 'playing'
            ? 'playing'
            : 'paused',
      segmentIndex: metadata?.segmentIndex,
      segmentCount: metadata?.segmentCount,
    }).catch(() => {})
  }

  async dispose(): Promise<void> {
    await this.listener?.remove()
    this.listener = null
    this.actions = null
    if (isNativeReadAloudAvailable()) {
      await ReadAloudNative.setMediaSession({ active: false }).catch(() => {})
    }
  }
}
