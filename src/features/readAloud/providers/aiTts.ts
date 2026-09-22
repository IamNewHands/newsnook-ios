import {
  Capacitor,
  CapacitorHttp,
  type PluginListenerHandle,
} from '@capacitor/core'

import { normalizeOpenAiBaseUrl } from '../../translation/openai'
import type { AiProviderConfig } from '../../translation/types'
import { isNativeReadAloudAvailable, ReadAloudNative } from '../native'
import type {
  ReadAloudAiSelection,
  ReadAloudHandle,
  ReadAloudProvider,
  ReadAloudProviderCapabilities,
  ReadAloudSpeakEvents,
  ReadAloudSpeakOptions,
  ReadAloudSegment,
  ReadAloudVoice,
} from '../types'

const CAPABILITIES: ReadAloudProviderCapabilities = {
  voices: false,
  rate: true,
  pitch: false,
  pauseResume: true,
  rangeProgress: false,
  exactTime: !Capacitor.isNativePlatform(),
  seekByCharacter: false,
  streaming: false,
  offline: false,
}

const CONNECT_TIMEOUT_MS = 15_000
const READ_TIMEOUT_MS = 90_000
let aiSequence = 0

interface SpeechPayload {
  blob: Blob
  mimeType: string
  nativeBase64?: string
}

function abortError(): DOMException {
  return new DOMException('朗读已取消', 'AbortError')
}

function assertConfig(
  provider: AiProviderConfig,
  selection: ReadAloudAiSelection,
): URL {
  if (!provider.capabilities.tts) {
    throw new Error(`${provider.name} 未声明支持 AI 语音接口，请先在「我的 → AI」开启 TTS 能力。`)
  }
  if (!provider.endpoint.trim()) throw new Error('AI TTS Provider 未填写 Base URL')
  if (!provider.apiKey.trim()) throw new Error('AI TTS Provider 未填写 API Key')
  if (!selection.model.trim()) throw new Error('AI TTS 未选择模型')
  if (!selection.voice.trim()) throw new Error('AI TTS 未选择声音')

  const normalizedBase = normalizeOpenAiBaseUrl(provider.endpoint.trim())
  let base: URL
  try {
    base = new URL(normalizedBase)
  } catch {
    throw new Error('AI TTS Base URL 格式不正确')
  }
  if (base.protocol !== 'https:') {
    throw new Error('为保护 API Key，AI TTS Base URL 必须使用 HTTPS')
  }
  let path = base.pathname.replace(/\/+$/, '')
  if (/\/audio\/speech$/i.test(path)) {
    path = path.replace(/\/audio\/speech$/i, '')
  }
  base.pathname = `${path || ''}/audio/speech`.replace(/\/{2,}/g, '/')
  base.search = ''
  base.hash = ''
  return base
}

function decodeBase64(base64: string): ArrayBuffer {
  const clean = base64.replace(/^data:[^;]+;base64,/, '')
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function mimeFor(format: ReadAloudAiSelection['format']): string {
  const mimeTypes: Record<ReadAloudAiSelection['format'], string> = {
    mp3: 'audio/mpeg',
    opus: 'audio/ogg; codecs=opus',
    wav: 'audio/wav',
    aac: 'audio/aac',
    flac: 'audio/flac',
  }
  return mimeTypes[format]
}

async function responseDetail(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as {
      error?: { message?: string }
      message?: string
    }
    return data.error?.message || data.message || ''
  } catch {
    return ''
  }
}

async function fetchSpeechPayload(
  provider: AiProviderConfig,
  selection: ReadAloudAiSelection,
  text: string,
  rate: number,
  signal?: AbortSignal,
): Promise<SpeechPayload> {
  const url = assertConfig(provider, selection)
  if (signal?.aborted) throw abortError()

  const body = {
    model: selection.model.trim(),
    voice: selection.voice.trim(),
    input: text,
    response_format: selection.format,
    speed: Math.min(4, Math.max(0.25, rate)),
  }
  const headers = {
    Authorization: `Bearer ${provider.apiKey.trim()}`,
    Accept: mimeFor(selection.format),
    'Content-Type': 'application/json',
  }

  if (Capacitor.isNativePlatform()) {
    let timer: ReturnType<typeof setTimeout> | null = null
    const request = CapacitorHttp.post({
      url: url.toString(),
      headers,
      data: body,
      responseType: 'blob',
      connectTimeout: CONNECT_TIMEOUT_MS,
      readTimeout: READ_TIMEOUT_MS,
    })

    const response = await new Promise<Awaited<typeof request>>(
      (resolve, reject) => {
        let settled = false
        const finish = (
          fn: (value: never) => void,
          value: unknown,
        ) => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          fn(value as never)
        }
        const onAbort = () => finish(reject, abortError())
        signal?.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(
          () => finish(reject, new DOMException('AI TTS 请求超时', 'TimeoutError')),
          READ_TIMEOUT_MS + 1000,
        )
        request.then(
          (value) => finish(resolve as (value: never) => void, value),
          (error) => finish(reject, error),
        )
      },
    )

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`AI TTS 请求失败（HTTP ${response.status}）`)
    }
    const raw = typeof response.data === 'string' ? response.data : ''
    if (!raw) throw new Error('AI TTS 返回了空音频')
    const contentType =
      response.headers?.['content-type'] ||
      response.headers?.['Content-Type'] ||
      mimeFor(selection.format)
    const mimeType = String(contentType).split(';')[0]
    return {
      blob: new Blob([decodeBase64(raw)], { type: mimeType }),
      mimeType,
      nativeBase64: raw,
    }
  }

  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, READ_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await responseDetail(response)
      throw new Error(
        detail
          ? `AI TTS：${detail}`
          : `AI TTS 请求失败（HTTP ${response.status}）`,
      )
    }
    const blob = await response.blob()
    if (!blob.size) throw new Error('AI TTS 返回了空音频')
    return {
      blob,
      mimeType: blob.type || mimeFor(selection.format),
    }
  } catch (error) {
    if (signal?.aborted) throw abortError()
    if (timedOut) {
      throw new DOMException('AI TTS 请求超时', 'TimeoutError')
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function fetchSpeechBlob(
  provider: AiProviderConfig,
  selection: ReadAloudAiSelection,
  text: string,
  rate: number,
  signal?: AbortSignal,
): Promise<Blob> {
  return (await fetchSpeechPayload(provider, selection, text, rate, signal)).blob
}

function speechCacheKey(
  selection: ReadAloudAiSelection,
  text: string,
  rate: number,
): string {
  return [
    selection.model.trim(),
    selection.voice.trim(),
    selection.format,
    rate.toFixed(3),
    text,
  ].join('\u0000')
}

export class AiTtsProvider implements ReadAloudProvider {
  readonly id = 'ai' as const
  readonly capabilities = CAPABILITIES

  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private readonly provider: AiProviderConfig
  private readonly selection: ReadAloudAiSelection
  private prefetchController: AbortController | null = null
  private prefetchKey = ''
  private prefetchPromise: Promise<SpeechPayload | null> | null = null

  constructor(
    provider: AiProviderConfig,
    selection: ReadAloudAiSelection,
  ) {
    this.provider = provider
    this.selection = selection
  }

  async isAvailable(): Promise<boolean> {
    const playbackAvailable = Capacitor.isNativePlatform()
      ? isNativeReadAloudAvailable()
      : typeof Audio !== 'undefined'
    return (
      this.provider.capabilities.tts &&
      Boolean(this.provider.endpoint.trim()) &&
      Boolean(this.provider.apiKey.trim()) &&
      playbackAvailable
    )
  }

  async listVoices(): Promise<ReadAloudVoice[]> {
    return []
  }

  private releaseAudio(): void {
    if (this.audio) {
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
      this.audio = null
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }

  async prefetch(
    segment: ReadAloudSegment,
    options: Omit<ReadAloudSpeakOptions, 'signal' | 'startOffset'>,
  ): Promise<void> {
    const text = segment.text.trim()
    if (!text) return
    const key = speechCacheKey(this.selection, text, options.rate)
    if (this.prefetchKey === key && this.prefetchPromise) {
      await this.prefetchPromise
      return
    }

    await this.cancelPrefetch()
    const controller = new AbortController()
    this.prefetchController = controller
    this.prefetchKey = key
    this.prefetchPromise = fetchSpeechPayload(
      this.provider,
      this.selection,
      text,
      options.rate,
      controller.signal,
    ).catch(() => null)
    await this.prefetchPromise
  }

  async cancelPrefetch(): Promise<void> {
    this.prefetchController?.abort()
    this.prefetchController = null
    this.prefetchKey = ''
    this.prefetchPromise = null
  }

  private async speechPayload(
    input: string,
    rate: number,
    startOffset: number,
    signal?: AbortSignal,
  ): Promise<SpeechPayload> {
    const key = speechCacheKey(this.selection, input, rate)
    if (
      startOffset === 0 &&
      this.prefetchKey === key &&
      this.prefetchPromise
    ) {
      const pending = this.prefetchPromise
      this.prefetchController = null
      this.prefetchKey = ''
      this.prefetchPromise = null
      const payload = await pending
      if (signal?.aborted) throw abortError()
      if (payload) return payload
    } else if (this.prefetchPromise) {
      await this.cancelPrefetch()
    }

    return fetchSpeechPayload(
      this.provider,
      this.selection,
      input,
      rate,
      signal,
    )
  }

  private async speakNative(
    payload: SpeechPayload,
    options: ReadAloudSpeakOptions,
    events: ReadAloudSpeakEvents,
  ): Promise<ReadAloudHandle> {
    if (!payload.nativeBase64 || !isNativeReadAloudAvailable()) {
      throw new Error('Android 原生 AI TTS 播放能力不可用')
    }

    const utteranceId = `newsnook-ai-${Date.now()}-${++aiSequence}`
    let stopped = false
    let listener: PluginListenerHandle | null = null

    const cleanup = async () => {
      options.signal?.removeEventListener('abort', abort)
      const current = listener
      listener = null
      if (current) await current.remove()
    }
    const abort = () => {
      stopped = true
      void ReadAloudNative.stop()
      void cleanup()
    }

    listener = await ReadAloudNative.addListener(
      'readAloudEvent',
      (event) => {
        if (event.utteranceId !== utteranceId) return
        if (event.type === 'started') events.onStart?.()
        if (event.type === 'ended' && !stopped) {
          events.onEnd?.()
          void cleanup()
        }
        if (event.type === 'error' && !stopped) {
          events.onError?.(
            new Error(event.message || 'Android AI TTS 音频播放失败'),
          )
          void cleanup()
        }
      },
    )
    options.signal?.addEventListener('abort', abort, { once: true })

    try {
      await ReadAloudNative.playAudio({
        utteranceId,
        base64: payload.nativeBase64,
        mimeType: payload.mimeType,
      })
      if (options.signal?.aborted) {
        stopped = true
        await ReadAloudNative.stop().catch(() => {})
        await cleanup()
        throw abortError()
      }
    } catch (error) {
      await cleanup()
      throw error
    }

    return {
      pause: () => ReadAloudNative.pause(),
      resume: () => ReadAloudNative.resume(),
      stop: async () => {
        stopped = true
        await ReadAloudNative.stop()
        await cleanup()
      },
      dispose: cleanup,
    }
  }

  private async speakWeb(
    payload: SpeechPayload,
    options: ReadAloudSpeakOptions,
    events: ReadAloudSpeakEvents,
  ): Promise<ReadAloudHandle> {
    const objectUrl = URL.createObjectURL(payload.blob)
    const audio = new Audio(objectUrl)
    this.objectUrl = objectUrl
    this.audio = audio

    let stopped = false
    const cleanup = () => {
      options.signal?.removeEventListener('abort', abort)
      audio.onplay = null
      audio.ontimeupdate = null
      audio.onended = null
      audio.onerror = null
      if (this.audio === audio) this.releaseAudio()
    }
    const abort = () => {
      stopped = true
      cleanup()
    }
    options.signal?.addEventListener('abort', abort, { once: true })

    audio.preload = 'auto'
    audio.playbackRate = 1
    audio.onplay = () => events.onStart?.()
    audio.ontimeupdate = () => {
      if (Number.isFinite(audio.currentTime)) {
        events.onTime?.(Math.round(audio.currentTime * 1000))
      }
    }
    audio.onended = () => {
      if (stopped) return
      cleanup()
      events.onEnd?.()
    }
    audio.onerror = () => {
      if (stopped) return
      const code = audio.error?.code
      cleanup()
      events.onError?.(
        new Error(
          code
            ? `AI TTS 音频播放失败（code ${code}）`
            : 'AI TTS 音频播放失败',
        ),
      )
    }

    try {
      await audio.play()
    } catch (error) {
      cleanup()
      throw error instanceof Error
        ? new Error(`AI TTS 无法开始播放：${error.message}`)
        : new Error('AI TTS 无法开始播放')
    }

    return {
      pause: async () => {
        audio.pause()
      },
      resume: async () => {
        await audio.play()
      },
      stop: async () => {
        stopped = true
        cleanup()
      },
      dispose: async () => {
        stopped = true
        cleanup()
      },
    }
  }

  async speak(
    segment: ReadAloudSegment,
    options: ReadAloudSpeakOptions,
    events: ReadAloudSpeakEvents,
  ): Promise<ReadAloudHandle> {
    if (options.signal?.aborted) throw abortError()
    this.releaseAudio()

    const startOffset = Math.max(
      0,
      Math.min(options.startOffset ?? 0, segment.text.length),
    )
    const input = segment.text.slice(startOffset)
    if (!input.trim()) {
      queueMicrotask(() => events.onEnd?.())
      return {
        pause: async () => {},
        resume: async () => {},
        stop: async () => {},
      }
    }

    const payload = await this.speechPayload(
      input,
      options.rate,
      startOffset,
      options.signal,
    )
    if (options.signal?.aborted) throw abortError()

    if (Capacitor.isNativePlatform()) {
      return this.speakNative(payload, options, events)
    }
    return this.speakWeb(payload, options, events)
  }

  async dispose(): Promise<void> {
    await this.cancelPrefetch()
    this.releaseAudio()
    // native 播放由 speak() handle 所有，Provider dispose 可能发生在临时/非活动实例上。
  }
}

export const __aiTtsTest = {
  fetchSpeechBlob,
  mimeFor,
}
