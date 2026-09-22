import { useEffect, useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  AudioLines,
  ChevronDown,
  LoaderCircle,
  ServerCog,
  Volume2,
} from 'lucide-react'

import {
  OptionPickerDialog,
  PromptDialog,
  type OptionPickerItem,
} from '../../components/ConfirmDialog'
import {
  SettingsHint,
  SettingsSection,
  SettingsShell,
} from '../../components/SettingsShell'
import {
  DEFAULT_READ_ALOUD_PREFS,
  readAloudEngineLabel,
} from '../../features/readAloud/config'
import { getReadAloudService } from '../../features/readAloud/service'
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
]

const CUSTOM_AI_VOICE = '__newsnook_custom_voice__'

type PickerKind = 'system-voice' | 'provider' | 'ai-voice' | 'format' | null

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block font-mono text-[10px] tracking-[0.12em] text-paper-faint">
      {children}
    </span>
  )
}

function PickerField({
  label,
  value,
  caption,
  disabled = false,
  loading = false,
  onClick,
}: {
  label: string
  value: string
  caption?: string
  disabled?: boolean
  loading?: boolean
  onClick: () => void
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-haze bg-ink-raised px-3.5 text-left transition-colors hover:border-cinnabar/40 disabled:opacity-45"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-paper">{value}</span>
          {caption && (
            <span className="mt-0.5 block truncate font-mono text-[9.5px] text-paper-faint">
              {caption}
            </span>
          )}
        </span>
        {loading ? (
          <LoaderCircle size={14} className="shrink-0 animate-spin text-paper-faint" />
        ) : (
          <ChevronDown size={15} strokeWidth={1.8} className="shrink-0 text-paper-faint" />
        )}
      </button>
    </div>
  )
}

function sameLanguage(left: string, right: string): number {
  const a = left.toLowerCase()
  const b = right.toLowerCase()
  if (a === b) return 0
  if (a.split('-')[0] === b.split('-')[0]) return 1
  return 2
}

function systemVoiceOptions(
  voices: ReadAloudVoice[],
  currentLanguage: string,
): OptionPickerItem[] {
  const ordered = [...voices].sort((left, right) => {
    const language =
      sameLanguage(left.lang, currentLanguage) - sameLanguage(right.lang, currentLanguage)
    if (language !== 0) return language
    if (left.local !== right.local) return left.local ? -1 : 1
    const locale = left.lang.localeCompare(right.lang)
    return locale || left.name.localeCompare(right.name)
  })

  return [
    {
      id: '',
      label: '跟随系统默认',
      description: '由系统 TTS 引擎自动选择当前语言 Voice',
    },
    ...ordered.map((voice) => ({
      id: voice.id,
      label: voice.name || voice.lang || '系统语音',
      description: [
        voice.lang || '未知语言',
        voice.local ? '本地' : '联网',
        voice.engineName,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
  ]
}

function formatDescription(format: ReadAloudAudioFormat): string {
  if (format === 'mp3') return '兼容性最好，推荐默认使用'
  if (format === 'opus') return '体积较小，适合网络传输'
  if (format === 'aac') return '移动端兼容性较好'
  if (format === 'wav') return '无压缩，体积较大'
  return '无损压缩，体积较大'
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
  const [picker, setPicker] = useState<PickerKind>(null)
  const [modelPromptOpen, setModelPromptOpen] = useState(false)
  const [customVoicePromptOpen, setCustomVoicePromptOpen] = useState(false)

  const ttsProviders = useMemo(
    () => ai.providers.filter((provider) => provider.capabilities.tts),
    [ai.providers],
  )
  const selectedAiProvider =
    ttsProviders.find((provider) => provider.id === prefs.ai.providerId) ??
    ttsProviders[0]

  const currentLanguage =
    typeof navigator !== 'undefined' && navigator.language
      ? navigator.language
      : 'zh-CN'

  const voiceOptions = useMemo(
    () => systemVoiceOptions(voices, currentLanguage),
    [currentLanguage, voices],
  )
  const selectedSystemVoice =
    voiceOptions.find((option) => option.id === prefs.systemVoiceId) ?? voiceOptions[0]

  const providerOptions = useMemo<OptionPickerItem[]>(
    () =>
      ttsProviders.map((provider) => ({
        id: provider.id,
        label: provider.name,
        description: provider.endpoint || '尚未填写 Base URL',
      })),
    [ttsProviders],
  )

  const aiVoiceOptions = useMemo<OptionPickerItem[]>(() => {
    const standard: OptionPickerItem[] = OPENAI_VOICES.map((voice) => ({
      id: voice,
      label: voice,
      description: 'OpenAI 标准 Voice',
    }))
    if (prefs.ai.voice && !OPENAI_VOICES.includes(prefs.ai.voice as (typeof OPENAI_VOICES)[number])) {
      standard.unshift({
        id: prefs.ai.voice,
        label: prefs.ai.voice,
        description: '当前自定义 Voice',
      })
    }
    standard.push({
      id: CUSTOM_AI_VOICE,
      label: '自定义 Voice…',
      description: '用于兼容自建或第三方 OpenAI-compatible Provider',
    })
    return standard
  }, [prefs.ai.voice])

  const formatOptions = useMemo<OptionPickerItem<ReadAloudAudioFormat>[]>(
    () =>
      FORMATS.map((format) => ({
        id: format,
        label: format.toUpperCase(),
        description: formatDescription(format),
      })),
    [],
  )

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
    <>
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

            <div className="flex items-center justify-between gap-4">
              <span>
                <span className="block text-[13px] text-paper">自动连续朗读</span>
                <span className="mt-0.5 block font-mono text-[9.5px] text-paper-faint">
                  当前段结束后自动进入下一段
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.autoContinue}
                aria-label="自动连续朗读"
                onClick={() =>
                  onChange({
                    ...prefs,
                    autoContinue: !prefs.autoContinue,
                  })
                }
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
                  prefs.autoContinue
                    ? 'border-cinnabar/60 bg-cinnabar/70'
                    : 'border-haze bg-ink-raised'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow-sm transition-transform ${
                    prefs.autoContinue ? 'translate-x-[21px]' : 'translate-x-[3px]'
                  }`}
                />
              </button>
            </div>
          </div>
        </SettingsSection>

        {prefs.engine !== 'ai' && (
          <SettingsSection title="系统语音">
            <div className="page-x border-y border-haze bg-ink py-4">
              <PickerField
                label="声音"
                value={selectedSystemVoice?.label ?? '跟随系统默认'}
                caption={selectedSystemVoice?.description}
                loading={voiceState === 'loading'}
                disabled={voiceState === 'loading'}
                onClick={() => setPicker('system-voice')}
              />
              {voiceMessage && (
                <p className="mt-2 text-[11px] text-cinnabar-soft">
                  {voiceMessage}
                </p>
              )}
              <p className="mt-3 flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-paper-faint">
                <Volume2 size={13} className="mt-0.5 shrink-0" />
                Android 使用系统安装的 TTS 引擎；Web 使用浏览器暴露的 SpeechSynthesis 声音。语音列表按当前语言与本地 Voice 优先排序，也可以直接搜索语言或 Voice 名称。
              </p>
            </div>
          </SettingsSection>
        )}

        {prefs.engine === 'ai' && (
          <SettingsSection title="AI 语音">
            <div className="page-x space-y-4 border-y border-haze bg-ink py-4">
              {ttsProviders.length ? (
                <>
                  <PickerField
                    label="AI Provider"
                    value={selectedAiProvider?.name ?? '未选择'}
                    caption={selectedAiProvider?.endpoint || '尚未填写 Base URL'}
                    onClick={() => setPicker('provider')}
                  />

                  <PickerField
                    label="Model"
                    value={prefs.ai.model || '未填写'}
                    caption="点击输入 OpenAI-compatible TTS 模型名"
                    onClick={() => setModelPromptOpen(true)}
                  />

                  <PickerField
                    label="Voice"
                    value={prefs.ai.voice || '未填写'}
                    caption="可选标准 Voice，也可输入第三方 Provider 的自定义 Voice"
                    onClick={() => setPicker('ai-voice')}
                  />

                  <PickerField
                    label="音频格式"
                    value={prefs.ai.format.toUpperCase()}
                    caption={formatDescription(prefs.ai.format)}
                    onClick={() => setPicker('format')}
                  />
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
          Android 后台朗读使用原生前台媒体服务，系统 TTS 与 AI TTS 都由原生播放器托管，支持熄屏、通知栏、锁屏和蓝牙媒体键；Web 端使用 Web Speech / HTML Audio 与浏览器 Media Session，后台能力取决于浏览器和操作系统。
        </SettingsHint>
      </SettingsShell>

      <OptionPickerDialog
        open={picker === 'system-voice'}
        title="系统语音"
        value={prefs.systemVoiceId}
        options={voiceOptions}
        searchPlaceholder="搜索语言、Voice 名称…"
        emptyLabel="没有匹配的系统语音"
        onCancel={() => setPicker(null)}
        onChange={(systemVoiceId) => {
          onChange({ ...prefs, systemVoiceId })
          setPicker(null)
        }}
      />

      <OptionPickerDialog
        open={picker === 'provider'}
        title="AI Provider"
        value={selectedAiProvider?.id ?? ''}
        options={providerOptions}
        searchPlaceholder="搜索 Provider…"
        onCancel={() => setPicker(null)}
        onChange={(providerId) => {
          onChange({
            ...prefs,
            ai: { ...prefs.ai, providerId },
          })
          setPicker(null)
        }}
      />

      <OptionPickerDialog
        open={picker === 'ai-voice'}
        title="AI Voice"
        value={prefs.ai.voice}
        options={aiVoiceOptions}
        searchPlaceholder="搜索 Voice…"
        onCancel={() => setPicker(null)}
        onChange={(voice) => {
          setPicker(null)
          if (voice === CUSTOM_AI_VOICE) {
            setCustomVoicePromptOpen(true)
            return
          }
          onChange({
            ...prefs,
            ai: { ...prefs.ai, voice },
          })
        }}
      />

      <OptionPickerDialog
        open={picker === 'format'}
        title="AI TTS 音频格式"
        value={prefs.ai.format}
        options={formatOptions}
        onCancel={() => setPicker(null)}
        onChange={(format) => {
          onChange({
            ...prefs,
            ai: { ...prefs.ai, format },
          })
          setPicker(null)
        }}
      />

      <PromptDialog
        open={modelPromptOpen}
        title="AI TTS Model"
        label="MODEL"
        defaultValue={prefs.ai.model}
        message="填写所选 Provider 的 OpenAI-compatible TTS 模型名，例如 gpt-4o-mini-tts。"
        onCancel={() => setModelPromptOpen(false)}
        onConfirm={(model) => {
          onChange({ ...prefs, ai: { ...prefs.ai, model } })
          setModelPromptOpen(false)
        }}
      />

      <PromptDialog
        open={customVoicePromptOpen}
        title="自定义 AI Voice"
        label="VOICE"
        defaultValue={prefs.ai.voice}
        message="用于支持自建或第三方 OpenAI-compatible TTS Provider 的 Voice 标识。"
        onCancel={() => setCustomVoicePromptOpen(false)}
        onConfirm={(voice) => {
          onChange({ ...prefs, ai: { ...prefs.ai, voice } })
          setCustomVoicePromptOpen(false)
        }}
      />

    </>
  )
}
