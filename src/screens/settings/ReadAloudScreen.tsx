import { useEffect, useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  AudioLines,
  LoaderCircle,
  ServerCog,
  Volume2,
} from 'lucide-react'

import {
  SettingsHint,
  SettingsSection,
  SettingsShell,
} from '../../components/SettingsShell'
import { getReadAloudService } from '../../features/readAloud/service'
import {
  DEFAULT_READ_ALOUD_PREFS,
  readAloudEngineLabel,
} from '../../features/readAloud/config'
import type {
  ReadAloudAudioFormat,
  ReadAloudPrefs,
  ReadAloudVoice,
} from '../../features/readAloud/types'
import type { AiPrefs } from '../../features/translation/types'

interface Props {
  prefs: ReadAloudPrefs
  ai: AiPrefs
  onChange: (prefs: ReadAloudPrefs) => void
  onBack: () => void
  onOpenAiSettings: () => void
}

const OPENAI_VOICES = [
  'marin',
  'cedar',
  'coral',
  'alloy',
  'ash',
  'ballad',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
] as const

const FORMATS: ReadAloudAudioFormat[] = [
  'mp3',
  'opus',
  'aac',
  'flac',
  'wav',
  'pcm',
]

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block font-mono text-[10px] tracking-[0.12em] text-paper-faint">
      {children}
    </span>
  )
}

export function ReadAloudScreen({
  prefs,
  ai,
  onChange,
  onBack,
  onOpenAiSettings,
}: Props) {
  const [voices, setVoices] = useState<ReadAloudVoice[]>([])
  const [voiceState, setVoiceState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [voiceMessage, setVoiceMessage] = useState('')

  const ttsProviders = useMemo(
    () => ai.providers.filter((provider) => provider.capabilities.tts),
    [ai.providers],
  )
  const selectedAiProvider =
    ttsProviders.find((provider) => provider.id === prefs.ai.providerId) ??
    ttsProviders[0]

  useEffect(() => {
    if (prefs.engine === 'ai') return
    let alive = true
    setVoiceState('loading')
    setVoiceMessage('')
    void getReadAloudService()
      .listVoices({ ...DEFAULT_READ_ALOUD_PREFS, engine: 'system' }, ai)
      .then((list) => {
        if (!alive) return
        setVoices(list)
        setVoiceState('ready')
      })
      .catch((error) => {
        if (!alive) return
        setVoices([])
        setVoiceState('error')
        setVoiceMessage(
          error instanceof Error ? error.message : '无法读取系统语音',
        )
      })
    return () => {
      alive = false
    }
  }, [ai, prefs.engine])

  const caption =
    prefs.engine === 'auto'
      ? `自动 · ${Capacitor.getPlatform() === 'android' ? 'Android 系统语音' : 'Web Speech'}`
      : readAloudEngineLabel(prefs.engine)

  return (
    <SettingsShell title="朗读" caption={caption} onBack={onBack}>
      <SettingsSection title="朗读引擎">
        <div className="page-x grid gap-2 sm:grid-cols-3">
          {(
            [
              ['auto', '自动', '按平台选择系统语音'],
              ['system', '系统语音', '免费 · 优先本地'],
              ['ai', 'AI 高品质语音', 'BYOK · 需要联网'],
            ] as const
          ).map(([id, title, description]) => (
            <button
              key={id}
              type="button"
              onClick={() => onChange({ ...prefs, engine: id })}
              className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${
                prefs.engine === id
                  ? 'border-cinnabar/60 bg-cinnabar/10'
                  : 'border-haze bg-ink hover:bg-ink-raised/55'
              }`}
            >
              <span
                className={`block text-[13px] ${
                  prefs.engine === id ? 'text-cinnabar-soft' : 'text-paper'
                }`}
              >
                {title}
              </span>
              <span className="mt-1 block font-mono text-[9.5px] leading-relaxed text-paper-faint">
                {description}
              </span>
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="播放">
        <div className="page-x space-y-5 border-y border-haze bg-ink py-4">
          <label className="block">
            <span className="flex items-center justify-between">
              <FieldLabel>语速</FieldLabel>
              <span className="font-mono text-[11px] text-cinnabar-soft">
                {prefs.rate.toFixed(2)}×
              </span>
            </span>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.05"
              value={prefs.rate}
              onChange={(event) =>
                onChange({
                  ...prefs,
                  rate: Number(event.target.value),
                })
              }
              className="w-full accent-[var(--color-cinnabar)]"
            />
          </label>

          {prefs.engine !== 'ai' && (
            <label className="block">
              <span className="flex items-center justify-between">
                <FieldLabel>音调</FieldLabel>
                <span className="font-mono text-[11px] text-cinnabar-soft">
                  {prefs.pitch.toFixed(2)}
                </span>
              </span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={prefs.pitch}
                onChange={(event) =>
                  onChange({
                    ...prefs,
                    pitch: Number(event.target.value),
                  })
                }
                className="w-full accent-[var(--color-cinnabar)]"
              />
            </label>
          )}

          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-[13px] text-paper">自动连续朗读</span>
              <span className="mt-0.5 block font-mono text-[9.5px] text-paper-faint">
                当前段结束后自动进入下一段
              </span>
            </span>
            <input
              type="checkbox"
              checked={prefs.autoContinue}
              onChange={(event) =>
                onChange({
                  ...prefs,
                  autoContinue: event.target.checked,
                })
              }
              className="h-4 w-4 accent-[var(--color-cinnabar)]"
            />
          </label>
        </div>
      </SettingsSection>

      {prefs.engine !== 'ai' && (
        <SettingsSection title="系统语音">
          <div className="page-x border-y border-haze bg-ink py-4">
            <label className="block">
              <FieldLabel>声音</FieldLabel>
              <div className="relative">
                <select
                  value={prefs.systemVoiceId}
                  onChange={(event) =>
                    onChange({
                      ...prefs,
                      systemVoiceId: event.target.value,
                    })
                  }
                  disabled={voiceState === 'loading'}
                  className="min-h-11 w-full rounded-xl border border-haze bg-ink-raised px-3.5 text-[13px] text-paper outline-none focus:border-cinnabar/55 disabled:opacity-50"
                >
                  <option value="">跟随系统默认</option>
                  {voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name} · {voice.lang}
                      {voice.local ? ' · 本地' : ''}
                    </option>
                  ))}
                </select>
                {voiceState === 'loading' && (
                  <LoaderCircle
                    size={14}
                    className="pointer-events-none absolute right-3 top-3.5 animate-spin text-paper-faint"
                  />
                )}
              </div>
            </label>
            {voiceMessage && (
              <p className="mt-2 text-[11px] text-cinnabar-soft">
                {voiceMessage}
              </p>
            )}
            <p className="mt-3 flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-paper-faint">
              <Volume2 size={13} className="mt-0.5 shrink-0" />
              Android 使用系统安装的 TTS 引擎；Web 使用浏览器暴露的 SpeechSynthesis 声音。实际离线能力取决于系统语音包。
            </p>
          </div>
        </SettingsSection>
      )}

      {prefs.engine === 'ai' && (
        <SettingsSection title="AI 语音">
          <div className="page-x space-y-4 border-y border-haze bg-ink py-4">
            {ttsProviders.length ? (
              <>
                <label className="block">
                  <FieldLabel>AI Provider</FieldLabel>
                  <select
                    value={selectedAiProvider?.id ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...prefs,
                        ai: {
                          ...prefs.ai,
                          providerId: event.target.value,
                        },
                      })
                    }
                    className="min-h-11 w-full rounded-xl border border-haze bg-ink-raised px-3.5 text-[13px] text-paper outline-none focus:border-cinnabar/55"
                  >
                    {ttsProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <FieldLabel>Model</FieldLabel>
                  <input
                    value={prefs.ai.model}
                    onChange={(event) =>
                      onChange({
                        ...prefs,
                        ai: { ...prefs.ai, model: event.target.value },
                      })
                    }
                    placeholder="gpt-4o-mini-tts"
                    className="min-h-11 w-full rounded-xl border border-haze bg-ink-raised px-3.5 text-[13px] text-paper outline-none placeholder:text-paper-faint/60 focus:border-cinnabar/55"
                  />
                </label>

                <label className="block">
                  <FieldLabel>Voice</FieldLabel>
                  <input
                    list="newsnook-tts-voices"
                    value={prefs.ai.voice}
                    onChange={(event) =>
                      onChange({
                        ...prefs,
                        ai: { ...prefs.ai, voice: event.target.value },
                      })
                    }
                    placeholder="marin"
                    className="min-h-11 w-full rounded-xl border border-haze bg-ink-raised px-3.5 text-[13px] text-paper outline-none placeholder:text-paper-faint/60 focus:border-cinnabar/55"
                  />
                  <datalist id="newsnook-tts-voices">
                    {OPENAI_VOICES.map((voice) => (
                      <option key={voice} value={voice} />
                    ))}
                  </datalist>
                </label>

                <label className="block">
                  <FieldLabel>音频格式</FieldLabel>
                  <select
                    value={prefs.ai.format}
                    onChange={(event) =>
                      onChange({
                        ...prefs,
                        ai: {
                          ...prefs.ai,
                          format: event.target.value as ReadAloudAudioFormat,
                        },
                      })
                    }
                    className="min-h-11 w-full rounded-xl border border-haze bg-ink-raised px-3.5 text-[13px] text-paper outline-none focus:border-cinnabar/55"
                  >
                    {FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {format.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <div className="rounded-xl border border-cinnabar/30 bg-cinnabar/10 p-3.5">
                <p className="text-[12px] leading-relaxed text-cinnabar-soft">
                  还没有 AI Provider 明确启用 TTS 能力。
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={onOpenAiSettings}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-haze bg-ink-raised px-3.5 text-[12px] text-paper-muted hover:text-paper"
            >
              <ServerCog size={14} strokeWidth={1.7} />
              管理 AI Provider 与 TTS 能力
            </button>

            <p className="flex items-start gap-2 rounded-xl bg-ink-raised/70 p-3 text-[10.5px] leading-relaxed text-paper-faint">
              <AudioLines size={14} className="mt-0.5 shrink-0 text-cinnabar-soft" />
              AI 朗读会把当前朗读段落发送到你选择的第三方 Provider，并可能产生 API 费用；播放的是 AI 生成语音，不是真人录音。
            </p>
          </div>
        </SettingsSection>
      )}

      <SettingsHint>
        Android 后台朗读会使用媒体播放前台服务，支持通知栏、锁屏和蓝牙耳机媒体键；Web 端使用浏览器 Media Session，具体后台能力取决于浏览器和操作系统。
      </SettingsHint>
    </SettingsShell>
  )
}
