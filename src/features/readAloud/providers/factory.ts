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
      prefs.ai.model,
      prefs.ai.voice,
      prefs.ai.format,
    ].join('|')
  }
  return Capacitor.getPlatform() === 'android'
    ? 'android-system'
    : 'web-speech'
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

  if (Capacitor.getPlatform() === 'android') {
    const provider = new AndroidSystemTtsProvider()
    if (!(await provider.isAvailable())) {
      throw new Error('Android 系统语音当前不可用，请检查系统 TTS 引擎。')
    }
    return provider
  }

  const provider = new WebSpeechProvider()
  if (!(await provider.isAvailable())) {
    throw new Error('当前浏览器不支持 Web Speech 朗读。')
  }
  return provider
}
