export type ReadAloudEngine = 'auto' | 'system' | 'ai'

export type ReadAloudProviderId = 'android-system' | 'web-speech' | 'ai'

export type ReadAloudState =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error'

export type ReadAloudSegmentKind =
  | 'title'
  | 'heading'
  | 'paragraph'
  | 'quote'
  | 'caption'
  | 'list-item'

export type ReadAloudAudioFormat = 'mp3' | 'opus' | 'wav' | 'aac' | 'flac'

export type ReadAloudTtsProtocol =
  | 'audio-speech'
  | 'chat-completions'

export interface ReadAloudSegment {
  id: string
  index: number
  kind: ReadAloudSegmentKind
  text: string
  lang?: string
}

export interface ReadAloudDocument {
  articleId: string
  title: string
  sourceName?: string
  artwork?: string
  segments: ReadAloudSegment[]
}

export interface ReadAloudPosition {
  articleId: string
  segmentIndex: number
  characterOffset: number
  elapsedMs?: number
  updatedAt: number
}

export interface ReadAloudVoice {
  id: string
  /** 面向用户的声音名称；Android 使用系统 Locale 的本地化显示名。 */
  name: string
  lang: string
  local?: boolean
  /** 底层引擎 voice 标识，仅用于区分/搜索，不应作为主标题。 */
  engineName?: string
}

export interface ReadAloudProviderCapabilities {
  voices: boolean
  rate: boolean
  pitch: boolean
  pauseResume: boolean
  rangeProgress: boolean
  exactTime: boolean
  seekByCharacter: boolean
  streaming: boolean
  offline: boolean
}

export interface ReadAloudSpeakOptions {
  voiceId?: string
  rate: number
  pitch: number
  startOffset?: number
  signal?: AbortSignal
}

export interface ReadAloudSpeakEvents {
  onStart?: () => void
  onRange?: (characterOffset: number) => void
  onTime?: (elapsedMs: number) => void
  onEnd?: () => void
  onError?: (error: Error) => void
}

export interface ReadAloudHandle {
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
  seekToCharacter?(characterOffset: number): Promise<void>
  dispose?(): Promise<void>
}

export interface ReadAloudProvider {
  readonly id: ReadAloudProviderId
  readonly capabilities: ReadAloudProviderCapabilities
  isAvailable(): Promise<boolean>
  listVoices(): Promise<ReadAloudVoice[]>
  speak(
    segment: ReadAloudSegment,
    options: ReadAloudSpeakOptions,
    events: ReadAloudSpeakEvents,
  ): Promise<ReadAloudHandle>
  /** 可选的一段前瞻缓存；只允许轻量预取，Provider 必须自行限制资源占用。 */
  prefetch?(
    segment: ReadAloudSegment,
    options: Omit<ReadAloudSpeakOptions, 'signal' | 'startOffset'>,
  ): Promise<void>
  cancelPrefetch?(): Promise<void> | void
  dispose(): Promise<void>
}

export interface ReadAloudAiSelection {
  providerId: string
  /** 显式选择 TTS API 协议，绝不根据 endpoint 猜测。 */
  protocol: ReadAloudTtsProtocol
  model: string
  /** 不提供任何预设 Voice；由用户按 Provider 文档填写。 */
  voice: string
  format: ReadAloudAudioFormat
}

export interface ReadAloudPrefs {
  engine: ReadAloudEngine
  rate: number
  pitch: number
  systemVoiceId: string
  autoContinue: boolean
  ai: ReadAloudAiSelection
}

export interface ReadAloudSnapshot {
  state: ReadAloudState
  providerId?: ReadAloudProviderId
  articleId?: string
  title?: string
  sourceName?: string
  artwork?: string
  segmentIndex: number
  segmentCount: number
  characterOffset: number
  elapsedMs?: number
  error?: string
}

export interface ReadAloudMediaMetadata {
  articleId: string
  title: string
  sourceName?: string
  artwork?: string
  segmentIndex: number
  segmentCount: number
}

export interface ReadAloudMediaActions {
  play: () => void
  pause: () => void
  stop: () => void
  next: () => void
  previous: () => void
  seekForward?: () => void
  seekBackward?: () => void
}

export interface ReadAloudMediaControlAdapter {
  bind(actions: ReadAloudMediaActions): Promise<void> | void
  update(
    snapshot: ReadAloudSnapshot,
    metadata?: ReadAloudMediaMetadata,
  ): Promise<void> | void
  dispose(): Promise<void> | void
}

export type ReadAloudSubscriber = (snapshot: ReadAloudSnapshot) => void
