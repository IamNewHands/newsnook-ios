import { DEFAULT_AI_PROVIDER_ID } from '../translation/aiConfig'
import type { ReadAloudAudioFormat, ReadAloudPrefs } from './types'

export const DEFAULT_READ_ALOUD_PREFS: ReadAloudPrefs = {
  engine: 'auto',
  rate: 1,
  pitch: 1,
  systemVoiceId: '',
  autoContinue: true,
  ai: {
    providerId: DEFAULT_AI_PROVIDER_ID,
    model: 'gpt-4o-mini-tts',
    voice: 'coral',
    format: 'mp3',
  },
}

const AUDIO_FORMATS = new Set<ReadAloudAudioFormat>([
  'mp3',
  'opus',
  'wav',
  'aac',
  'flac',
  'pcm',
])

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function normalizeReadAloudPrefs(value: unknown): ReadAloudPrefs {
  const input = (value ?? {}) as Partial<ReadAloudPrefs>
  const ai = (input.ai ?? {}) as Partial<ReadAloudPrefs['ai']>
  return {
    engine:
      input.engine === 'system' || input.engine === 'ai' || input.engine === 'auto'
        ? input.engine
        : DEFAULT_READ_ALOUD_PREFS.engine,
    rate: number(input.rate, DEFAULT_READ_ALOUD_PREFS.rate, 0.5, 2.5),
    pitch: number(input.pitch, DEFAULT_READ_ALOUD_PREFS.pitch, 0.5, 2),
    systemVoiceId: text(input.systemVoiceId),
    autoContinue:
      typeof input.autoContinue === 'boolean'
        ? input.autoContinue
        : DEFAULT_READ_ALOUD_PREFS.autoContinue,
    ai: {
      providerId: text(ai.providerId) || DEFAULT_READ_ALOUD_PREFS.ai.providerId,
      model: text(ai.model) || DEFAULT_READ_ALOUD_PREFS.ai.model,
      voice: text(ai.voice) || DEFAULT_READ_ALOUD_PREFS.ai.voice,
      format: AUDIO_FORMATS.has(ai.format as ReadAloudAudioFormat)
        ? (ai.format as ReadAloudAudioFormat)
        : DEFAULT_READ_ALOUD_PREFS.ai.format,
    },
  }
}

export function readAloudEngineLabel(engine: ReadAloudPrefs['engine']): string {
  if (engine === 'system') return '系统语音'
  if (engine === 'ai') return 'AI 高品质语音'
  return '自动'
}
