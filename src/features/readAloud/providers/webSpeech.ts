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
  pauseResume: true,
  rangeProgress: true,
  exactTime: false,
  seekByCharacter: false,
  streaming: false,
  offline: false,
}

function speech(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null
}

function currentVoices(): SpeechSynthesisVoice[] {
  return speech()?.getVoices() ?? []
}

export class WebSpeechProvider implements ReadAloudProvider {
  readonly id = 'web-speech' as const
  readonly capabilities = CAPABILITIES
  private current: SpeechSynthesisUtterance | null = null

  async isAvailable(): Promise<boolean> {
    return Boolean(
      speech() &&
        typeof SpeechSynthesisUtterance !== 'undefined',
    )
  }

  async listVoices(): Promise<ReadAloudVoice[]> {
    const synth = speech()
    if (!synth) return []

    if (!currentVoices().length) {
      await new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          synth.removeEventListener('voiceschanged', finish)
          resolve()
        }
        const timer = window.setTimeout(finish, 1200)
        synth.addEventListener('voiceschanged', finish, { once: true })
      })
    }

    return currentVoices().map((voice) => ({
      id: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      local: voice.localService,
    }))
  }

  async speak(
    segment: ReadAloudSegment,
    options: ReadAloudSpeakOptions,
    events: ReadAloudSpeakEvents,
  ): Promise<ReadAloudHandle> {
    const synth = speech()
    if (!synth) throw new Error('当前浏览器不支持系统朗读')
    if (options.signal?.aborted) {
      throw new DOMException('朗读已取消', 'AbortError')
    }

    synth.cancel()
    const startOffset = Math.max(
      0,
      Math.min(options.startOffset ?? 0, segment.text.length),
    )
    const utterance = new SpeechSynthesisUtterance(
      segment.text.slice(startOffset),
    )
    utterance.rate = options.rate
    utterance.pitch = options.pitch
    if (segment.lang) utterance.lang = segment.lang

    if (options.voiceId) {
      utterance.voice =
        currentVoices().find(
          (voice) => voice.voiceURI === options.voiceId,
        ) ?? null
    }

    let stopped = false
    const cleanup = () => {
      options.signal?.removeEventListener('abort', abort)
      if (this.current === utterance) this.current = null
    }
    const abort = () => {
      stopped = true
      synth.cancel()
      cleanup()
    }

    options.signal?.addEventListener('abort', abort, { once: true })
    utterance.onstart = () => events.onStart?.()
    utterance.onboundary = (event) => {
      if (typeof event.charIndex === 'number') {
        events.onRange?.(startOffset + event.charIndex)
      }
    }
    utterance.onerror = (event) => {
      cleanup()
      if (
        stopped ||
        event.error === 'canceled' ||
        event.error === 'interrupted'
      ) {
        return
      }
      events.onError?.(
        new Error(`系统朗读失败：${event.error || 'unknown'}`),
      )
    }
    utterance.onend = () => {
      cleanup()
      if (!stopped) events.onEnd?.()
    }

    this.current = utterance
    synth.speak(utterance)

    return {
      pause: async () => {
        synth.pause()
      },
      resume: async () => {
        synth.resume()
      },
      stop: async () => {
        stopped = true
        synth.cancel()
        cleanup()
      },
    }
  }

  async dispose(): Promise<void> {
    speech()?.cancel()
    this.current = null
  }
}
