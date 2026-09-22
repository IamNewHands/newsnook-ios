import { Capacitor, CapacitorHttp } from '@capacitor/core'

import type { AiProviderConfig } from '../../translation/types'
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
  exactTime: true,
  seekByCharacter: false,
  streaming: false,
  offline: false,
}

const CONNECT_TIMEOUT_MS = 15_000
const READ_TIMEOUT_MS = 90_000

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

  let base: URL
  try {
    base = new URL(provider.endpoint.trim())
  } catch {
    throw new Error('AI TTS Base URL 格式不正确')
  }
  if (base.protocol !== 'https:') {
    throw new Error('为保护 API Key，AI TTS Base URL 必须使用 HTTPS')
  }
  return new URL(
    `${base.toString().replace(/\/+$/, '')}/audio/speech`,
  )
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
  if (format === 'mp3') return 'audio/mpeg'
  if (format === 'opus') return 'audio/ogg; codecs=opus'
  if (format === 'wav') return 'audio/wav'
  if (format === 'aac') return 'audio/aac'
  if (format === 'flac') return 'audio/flac'
  return 'audio/L16'
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

async function fetchSpeechBlob(
  provider: AiProviderConfig,
  selection: ReadAloudAiSelection,
  text: string,
  rate: number,
  signal?: AbortSignal,
): Promise<Blob> {
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
    return new Blob([decodeBase64(raw)], {
      type: String(contentType).split(';')[0],
    })
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
    return blob
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

export class AiTtsProvider implements ReadAloudProvider {
  readonly id = 'ai' as const
  readonly capabilities = CAPABILITIES

  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private readonly provider: AiProviderConfig
  private readonly selection: ReadAloudAiSelection

  constructor(
    provider: AiProviderConfig,
    selection: ReadAloudAiSelection,
  ) {
    this.provider = provider
    this.selection = selection
  }

  async isAvailable(): Promise<boolean> {
    return (
      this.provider.capabilities.tts &&
      Boolean(this.provider.endpoint.trim()) &&
      Boolean(this.provider.apiKey.trim()) &&
      typeof Audio !== 'undefined'
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

    const blob = await fetchSpeechBlob(
      this.provider,
      this.selection,
      input,
      options.rate,
      options.signal,
    )
    if (options.signal?.aborted) throw abortError()

    const objectUrl = URL.createObjectURL(blob)
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
        new Error(code ? `AI TTS 音频播放失败（code ${code}）` : 'AI TTS 音频播放失败'),
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

  async dispose(): Promise<void> {
    this.releaseAudio()
  }
}

export const __aiTtsTest = {
  fetchSpeechBlob,
  mimeFor,
}
