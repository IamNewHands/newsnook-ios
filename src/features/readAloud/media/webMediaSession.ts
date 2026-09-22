import type {
  ReadAloudMediaActions,
  ReadAloudMediaControlAdapter,
  ReadAloudMediaMetadata,
  ReadAloudSnapshot,
} from '../types'

type MediaSessionLike = {
  metadata: MediaMetadata | null
  playbackState: MediaSessionPlaybackState
  setActionHandler(
    action: MediaSessionAction,
    handler: MediaSessionActionHandler | null,
  ): void
}

function mediaSession(): MediaSessionLike | null {
  if (typeof navigator === 'undefined') return null
  const session = (
    navigator as Navigator & {
      mediaSession?: MediaSession
    }
  ).mediaSession
  return session ?? null
}

export class WebMediaSessionAdapter implements ReadAloudMediaControlAdapter {
  private actions: ReadAloudMediaActions | null = null
  private registered = new Set<MediaSessionAction>()

  bind(actions: ReadAloudMediaActions): void {
    this.actions = actions
    const session = mediaSession()
    if (!session) return

    const bind = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler,
    ) => {
      try {
        session.setActionHandler(action, handler)
        this.registered.add(action)
      } catch {
        // 不同浏览器支持的 action 不同，逐项降级。
      }
    }

    bind('play', () => this.actions?.play())
    bind('pause', () => this.actions?.pause())
    bind('stop', () => this.actions?.stop())
    bind('nexttrack', () => this.actions?.next())
    bind('previoustrack', () => this.actions?.previous())
    bind('seekforward', () => this.actions?.seekForward?.())
    bind('seekbackward', () => this.actions?.seekBackward?.())
  }

  update(
    snapshot: ReadAloudSnapshot,
    metadata?: ReadAloudMediaMetadata,
  ): void {
    const session = mediaSession()
    if (!session) return

    if (metadata && typeof MediaMetadata !== 'undefined') {
      const artwork = metadata.artwork
        ? [
            {
              src: metadata.artwork,
              sizes: '512x512',
            },
          ]
        : undefined
      try {
        session.metadata = new MediaMetadata({
          title: metadata.title,
          artist: metadata.sourceName || '有所闻',
          album: `第 ${metadata.segmentIndex + 1} / ${metadata.segmentCount} 段`,
          artwork,
        })
      } catch {
        // 某些 WebView 对远程 artwork 或 MediaMetadata 构造支持不完整。
      }
    }

    try {
      session.playbackState =
        snapshot.state === 'playing' || snapshot.state === 'loading'
          ? 'playing'
          : snapshot.state === 'paused'
            ? 'paused'
            : 'none'
    } catch {
      // 老浏览器可能只暴露部分 Media Session API。
    }
  }

  dispose(): void {
    const session = mediaSession()
    if (session) {
      for (const action of this.registered) {
        try {
          session.setActionHandler(action, null)
        } catch {
          // ignore
        }
      }
      try {
        session.metadata = null
        session.playbackState = 'none'
      } catch {
        // ignore
      }
    }
    this.registered.clear()
    this.actions = null
  }
}
