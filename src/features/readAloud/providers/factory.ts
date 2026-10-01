import { Capacitor } from '@capacitor/core'

import { aiProviderById } from '../../translation/aiConfig'
import type { AiPrefs } from '../../translation/types'
import type { ReadAloudPrefs, ReadAloudProvider } from '../types'
import { AiTtsProvider } from './aiTts'
import { AndroidSystemTtsProvider } from './androidSystem'
import { WebSpeechProvider } from './webSpeech'

export interface ReadAloudProviderContext {
  prefs: ReadAloudPrefs
  ai: AiPrefs
}

function resolveTtsProvider(ai: AiPrefs, requestedId: string) {
  const requested = ai.providers.find((provider) => provider.id === requestedId)
  if (requested?.capabilities.tts) return requested
  return (
    ai.providers.find((provider) => provider.capabilities.tts) ??
    requested ??
    aiProviderById(ai, requestedId)
  )
}

function secretFingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * 原生系统 TTS 通道：Android 走 `TextToSpeech`，iOS 走 `AVSpeechSynthesizer`，
 * 两边由同一个 `ReadAloud` 插件驱动，JS 侧共用 `AndroidSystemTtsProvider`。
 * Provider id 沿用 `android-system`（JS 侧的稳定标识，不代表平台），
 * 这样 provider key 的比较与既有缓存语义都不用改。
 */
function usesNativeTts(): boolean {
  const platform = Capacitor.getPlatform()
  return platform === 'android' || platform === 'ios'
}

export function readAloudProviderKey({
  prefs,
  ai,
}: ReadAloudProviderContext): string {
  if (prefs.engine === 'ai') {
    const provider = resolveTtsProvider(ai, prefs.ai.providerId)
    return [
      'ai',
      provider.id,
      provider.endpoint,
      secretFingerprint(provider.apiKey),
      provider.capabilities.tts ? 'tts' : 'no-tts',
      prefs.ai.protocol,
      prefs.ai.model,
      prefs.ai.voice,
      prefs.ai.format,
    ].join('|')
  }
  return usesNativeTts() ? 'android-system' : 'web-speech'
}

export async function createReadAloudProvider({
  prefs,
  ai,
}: ReadAloudProviderContext): Promise<ReadAloudProvider> {
  if (prefs.engine === 'ai') {
    const provider = resolveTtsProvider(ai, prefs.ai.providerId)
    const result = new AiTtsProvider(provider, {
      ...prefs.ai,
      providerId: provider.id,
    })
    if (!(await result.isAvailable())) {
      if (!provider.capabilities.tts) {
        throw new Error(
          `${provider.name} 未声明支持 AI TTS，请到「我的 → AI」开启 TTS 能力。`,
        )
      }
      throw new Error('AI TTS 配置不完整，请检查 Provider、API Key、模型和声音。')
    }
    return result
  }

  if (usesNativeTts()) {
    const provider = new AndroidSystemTtsProvider()
    if (!(await provider.isAvailable())) {
      throw new Error(
        Capacitor.getPlatform() === 'ios'
          ? 'iOS 系统语音当前不可用，请到「设置 → 辅助功能 → 朗读内容 → 声音」确认已安装系统声音。'
          : 'Android 系统语音当前不可用，请检查系统 TTS 引擎。',
      )
    }
    return provider
  }

  const provider = new WebSpeechProvider()
  if (!(await provider.isAvailable())) {
    throw new Error('当前浏览器不支持 Web Speech 朗读。')
  }
  return provider
}
