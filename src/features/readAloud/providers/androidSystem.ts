import type { PluginListenerHandle } from '@capacitor/core'

import {
  isNativeReadAloudAvailable,
  ReadAloudNative,
} from '../native'
import type {
  ReadAloudHandle,
  ReadAloudProvider,
  ReadAloudProviderCapabilities,
  ReadAloudSpeakEvents,
  ReadAloudSpeakOptions,
  ReadAloudSegment,
  ReadAloudVoice,
} from '../types'

const CAPABILITIES: ReadAloudProviderCapabilities = {
  voices: true,
  rate: true,
  pitch: true,
  // Android TTS 本身没有 pause；原生 service 用 stop + onRangeStart offset 重建实现语义暂停。
  pauseResume: true,
  rangeProgress: true,
  exactTime: false,
  seekByCharacter: true,
  streaming: false,
  offline: true,
}

let sequence = 0

export class AndroidSystemTtsProvider implements ReadAloudProvider {
  readonly id = 'android-system' as const
  readonly capabilities = CAPABILITIES
  private listeners = new Set<PluginListenerHandle>()

  async isAvailable(): Promise<boolean> {
    if (!isNativeReadAloudAvailable()) return false
    return (await ReadAloudNative.isAvailable()).available
  }

  async listVoices(): Promise<ReadAloudVoice[]> {
    if (!isNativeReadAloudAvailable()) return []
    return (await ReadAloudNative.listVoices()).voices
  }

  async speak(
    segment: ReadAloudSegment,
    options: ReadAloudSpeakOptions,
    events: ReadAloudSpeakEvents,
  ): Promise<ReadAloudHandle> {
    if (!isNativeReadAloudAvailable()) {
      throw new Error('当前 Android 安装包不支持系统朗读')
    }
    if (options.signal?.aborted) {
      throw new DOMException('朗读已取消', 'AbortError')
    }

    const utteranceId = `newsnook-${Date.now()}-${++sequence}`
    let stopped = false
    let listener: PluginListenerHandle | null = null
    const cleanup = async () => {
      options.signal?.removeEventListener('abort', abort)
      const current = listener
      if (current && this.listeners.delete(current)) {
        await current.remove()
      }
      listener = null
    }

    listener = await ReadAloudNative.addListener(
      'readAloudEvent',
      (event) => {
        if (event.utteranceId !== utteranceId) return
        if (event.type === 'started') events.onStart?.()
        if (
          event.type === 'range' &&
          typeof event.characterOffset === 'number'
        ) {
          events.onRange?.(event.characterOffset)
        }
        if (event.type === 'ended' && !stopped) {
          events.onEnd?.()
          void cleanup()
        }
        if (event.type === 'error' && !stopped) {
          events.onError?.(
            new Error(event.message || 'Android 系统朗读失败'),
          )
          void cleanup()
        }
      },
    )
    this.listeners.add(listener)
    const abort = () => {
      stopped = true
      void ReadAloudNative.stop()
      void cleanup()
    }
    options.signal?.addEventListener('abort', abort, { once: true })

    await ReadAloudNative.speak({
      utteranceId,
      text: segment.text,
      voiceId: options.voiceId || undefined,
      rate: options.rate,
      pitch: options.pitch,
      startOffset: options.startOffset,
    })

    return {
      pause: () => ReadAloudNative.pause(),
      resume: () => ReadAloudNative.resume(),
      stop: async () => {
        stopped = true
        await ReadAloudNative.stop()
        await cleanup()
      },
      seekToCharacter: async (characterOffset) => {
        await ReadAloudNative.speak({
          utteranceId,
          text: segment.text,
          voiceId: options.voiceId || undefined,
          rate: options.rate,
          pitch: options.pitch,
          startOffset: characterOffset,
        })
      },
      dispose: cleanup,
    }
  }

  async dispose(): Promise<void> {
    await ReadAloudNative.stop().catch(() => {})
    const listeners = [...this.listeners]
    this.listeners.clear()
    await Promise.all(listeners.map((listener) => listener.remove()))
  }
}
