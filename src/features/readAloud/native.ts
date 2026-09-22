import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core'

import type { ReadAloudVoice } from './types'

export type NativeReadAloudEventType =
  | 'started'
  | 'range'
  | 'ended'
  | 'error'
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'stop'
  | 'focus-loss'
  | 'focus-gain'
  | 'noisy'

export interface NativeReadAloudEvent {
  type: NativeReadAloudEventType
  utteranceId?: string
  characterOffset?: number
  message?: string
}

interface ReadAloudNativePlugin {
  isAvailable(): Promise<{ available: boolean }>
  listVoices(): Promise<{ voices: ReadAloudVoice[] }>
  speak(options: {
    utteranceId: string
    text: string
    voiceId?: string
    rate: number
    pitch: number
    startOffset?: number
  }): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  setMediaSession(options: {
    active: boolean
    title?: string
    sourceName?: string
    artwork?: string
    state?: 'playing' | 'paused'
    segmentIndex?: number
    segmentCount?: number
  }): Promise<void>
  addListener(
    eventName: 'readAloudEvent',
    listener: (event: NativeReadAloudEvent) => void,
  ): Promise<PluginListenerHandle>
}

export const ReadAloudNative =
  registerPlugin<ReadAloudNativePlugin>('ReadAloud')

export function isNativeReadAloudAvailable(): boolean {
  return (
    Capacitor.getPlatform() === 'android' &&
    Capacitor.isPluginAvailable('ReadAloud')
  )
}
