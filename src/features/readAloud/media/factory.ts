import { Capacitor } from '@capacitor/core'

import type { ReadAloudMediaControlAdapter } from '../types'
import { AndroidMediaSessionAdapter } from './androidMediaSession'
import { WebMediaSessionAdapter } from './webMediaSession'

/**
 * 原生媒体会话：Android 用 `MediaSession`，iOS 用 `MPNowPlayingInfoCenter` +
 * `MPRemoteCommandCenter`，两者都由同一个 `ReadAloud` 插件的 `setMediaSession`
 * 驱动，所以共用 `AndroidMediaSessionAdapter`——类名是历史包袱，实现只依赖插件接口，
 * 与平台无关。
 */
function usesNativeMediaSession(): boolean {
  const platform = Capacitor.getPlatform()
  return platform === 'android' || platform === 'ios'
}

export function createReadAloudMediaControlAdapter(): ReadAloudMediaControlAdapter {
  return usesNativeMediaSession()
    ? new AndroidMediaSessionAdapter()
    : new WebMediaSessionAdapter()
}
