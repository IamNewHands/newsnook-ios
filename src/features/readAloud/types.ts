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

export type ReadAloudAudioFormat = 'mp3' | 'opus' | 'wav' | 'aac' | 'flac' | 'pcm'

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
  name: string
  lang: string
  local?: boolean
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
  dispose(): Promise<void>
}

export interface ReadAloudAiSelection {
  providerId: string
  model: string
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
