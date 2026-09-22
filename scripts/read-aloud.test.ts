import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseHTML } from 'linkedom'

const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() {
      return memory.size
    },
  },
})
memory.set('newsnook:log', JSON.stringify({ level: 'silent' }))

const dom = parseHTML('<html><body></body></html>')
Object.defineProperty(globalThis, 'DOMParser', {
  configurable: true,
  value: dom.window.DOMParser,
})

const { normalizeReadAloudPrefs } = await import(
  '../src/features/readAloud/config'
)
const { MAX_READ_ALOUD_SEGMENT_CHARS, segmentArticle } = await import(
  '../src/features/readAloud/segmenter'
)
const { ReadAloudService } = await import(
  '../src/features/readAloud/service'
)
const { readAloudProviderKey } = await import(
  '../src/features/readAloud/providers/factory'
)
const { WebSpeechProvider } = await import(
  '../src/features/readAloud/providers/webSpeech'
)
const { WebMediaSessionAdapter } = await import(
  '../src/features/readAloud/media/webMediaSession'
)
const { AiTtsProvider, __aiTtsTest } = await import(
  '../src/features/readAloud/providers/aiTts'
)
const { shouldShowGlobalReadAloudBar } = await import(
  '../src/features/readAloud/visibility'
)
const { normalizePreferences } = await import(
  '../src/sources/preferences'
)
const { DEFAULT_TRANSLATION_PREFS } = await import(
  '../src/features/translation/config'
)

type SpeakEvents = import('../src/features/readAloud/types').ReadAloudSpeakEvents
type Provider = import('../src/features/readAloud/types').ReadAloudProvider
type MediaAdapter = import('../src/features/readAloud/types').ReadAloudMediaControlAdapter
type MediaActions = import('../src/features/readAloud/types').ReadAloudMediaActions
type Snapshot = import('../src/features/readAloud/types').ReadAloudSnapshot

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function testGlobalReadAloudVisibility(): void {
  const base: Snapshot = {
    state: 'playing',
    articleId: 'article-a',
    title: '正在朗读的文章',
    segmentIndex: 0,
    segmentCount: 3,
    characterOffset: 0,
  }

  assert.equal(
    shouldShowGlobalReadAloudBar(base, null),
    true,
    '离开文章回到信息流后必须保留应用内朗读控制',
  )
  assert.equal(
    shouldShowGlobalReadAloudBar({ ...base, state: 'paused' }, null),
    true,
    '暂停状态也必须保留全局控制，用户才能继续或停止',
  )
  assert.equal(
    shouldShowGlobalReadAloudBar(base, 'article-a'),
    false,
    '当前阅读器已经展示同一篇文章的完整控制条时不能重复显示',
  )
  assert.equal(
    shouldShowGlobalReadAloudBar({ ...base, state: 'ended' }, null),
    false,
    '自然结束后不应残留无意义的全局控制条',
  )
  assert.equal(
    shouldShowGlobalReadAloudBar({ ...base, state: 'idle' }, null),
    false,
  )
}

function testPrefsAndSegmentation(): void {
  const prefs = normalizeReadAloudPrefs({
    engine: 'ai',
    rate: 99,
    pitch: -1,
    autoContinue: false,
    ai: {
      providerId: 'custom',
      model: 'voice-model',
      voice: 'voice-a',
      format: 'opus',
    },
  })
  assert.equal(prefs.engine, 'ai')
  assert.equal(prefs.rate, 2.5)
  assert.equal(prefs.pitch, 0.5)
  assert.equal(prefs.ai.format, 'opus')
  assert.equal(prefs.autoContinue, false)

  const legacyPcm = normalizeReadAloudPrefs({
    ai: { format: 'pcm' },
  })
  assert.equal(
    legacyPcm.ai.format,
    'mp3',
    '旧版 PCM 配置必须迁移到 Android/Web 都可直接播放的默认格式',
  )

  const migratedLegacyVoice = normalizeReadAloudPrefs({
    ai: {
      providerId: 'openai',
      model: 'gpt-4o-mini-tts',
      voice: 'coral',
      format: 'mp3',
    },
  })
  assert.equal(
    migratedLegacyVoice.ai.voice,
    '',
    '旧版自动写入的 coral 必须迁移为空，避免升级后继续显示应用预设 Voice',
  )
  const preservedManualVoice = normalizeReadAloudPrefs({
    ai: {
      providerId: 'openai',
      protocol: 'audio-speech',
      model: 'gpt-4o-mini-tts',
      voice: 'coral',
      format: 'mp3',
    },
  })
  assert.equal(
    preservedManualVoice.ai.voice,
    'coral',
    '新协议版本中用户显式填写的 Voice 必须保留',
  )

  const migrated = normalizePreferences({})
  assert.equal(migrated.readAloud.engine, 'auto')
  assert.equal(migrated.readAloud.ai.model, 'gpt-4o-mini-tts')
  assert.equal(
    migrated.readAloud.ai.voice,
    '',
    'AI Voice 不得预设任何厂商 Voice 名称，必须由用户填写',
  )
  assert.equal(
    migrated.readAloud.ai.protocol,
    'audio-speech',
    '旧配置缺少协议字段时保持现有 /audio/speech 行为',
  )
  assert.equal(
    migrated.translation.ai.providers[0]?.capabilities.tts,
    true,
  )

  const document = segmentArticle(
    'article-1',
    '  标题  ',
    `
      <h2 lang="zh-CN">章节</h2>
      <p>第一段 <strong>正文</strong></p>
      <blockquote>引用内容</blockquote>
      <figure><img src="x"><figcaption>图片说明</figcaption></figure>
      <ul><li>列表项目</li></ul>
      <pre>代码不要读</pre>
      <p aria-hidden="true">隐藏内容不要读</p>
      <script>脚本不要读</script>
    `,
  )
  assert.deepEqual(
    document.segments.map((item) => item.kind),
    ['title', 'heading', 'paragraph', 'quote', 'caption', 'list-item'],
  )
  assert.equal(document.segments[0]?.lang, 'zh-CN')
  assert.equal(document.segments[1]?.lang, 'zh-CN')
  assert.ok(!document.segments.some((item) => item.text.includes('代码不要读')))
  assert.ok(!document.segments.some((item) => item.text.includes('隐藏内容不要读')))

  const longParagraph = Array.from({ length: 420 }, (_, index) =>
    `第${index + 1}句用于验证长段落安全切分。`,
  ).join('')
  const longDocument = segmentArticle(
    'article-long',
    '重复标题',
    `<h1>重复标题</h1><p>${longParagraph}</p>`,
  )
  assert.equal(
    longDocument.segments.filter((item) => item.kind === 'heading').length,
    0,
    '正文 h1 与文章标题相同时不应重复朗读',
  )
  assert.ok(longDocument.segments.length > 2)
  assert.ok(
    longDocument.segments.every(
      (item) => item.text.length <= MAX_READ_ALOUD_SEGMENT_CHARS,
    ),
    '所有朗读段必须受最大字符数约束',
  )
}

class FakeProvider implements Provider {
  readonly id = 'web-speech' as const
  readonly capabilities = {
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
  sessions: SpeakEvents[] = []
  pauseCount = 0
  resumeCount = 0
  stopCount = 0
  prefetchCount = 0
  cancelPrefetchCount = 0

  async isAvailable() {
    return true
  }
  async listVoices() {
    return []
  }
  async prefetch() {
    this.prefetchCount += 1
  }
  async cancelPrefetch() {
    this.cancelPrefetchCount += 1
  }
  async speak(
    _segment: import('../src/features/readAloud/types').ReadAloudSegment,
    _options: import('../src/features/readAloud/types').ReadAloudSpeakOptions,
    events: SpeakEvents,
  ) {
    this.sessions.push(events)
    events.onStart?.()
    return {
      pause: async () => void (this.pauseCount += 1),
      resume: async () => void (this.resumeCount += 1),
      stop: async () => void (this.stopCount += 1),
    }
  }
  async dispose() {}
}

class FakeMedia implements MediaAdapter {
  actions: MediaActions | null = null
  updates: Snapshot[] = []
  bind(actions: MediaActions) {
    this.actions = actions
  }
  update(snapshot: Snapshot) {
    this.updates.push({ ...snapshot })
  }
  dispose() {}
}

async function testServiceStateMachine(): Promise<void> {
  memory.clear()
  const provider = new FakeProvider()
  const media = new FakeMedia()
  const service = new ReadAloudService({
    providerFactory: async () => provider,
    mediaAdapter: media,
  })

  const prefs = normalizeReadAloudPrefs({ engine: 'system' })
  const ai = DEFAULT_TRANSLATION_PREFS.ai
  const document = segmentArticle(
    'state-machine',
    '标题',
    '<p>第一段正文</p><p>第二段正文</p>',
  )

  await service.start(document, prefs, ai, { resumeSaved: false })
  assert.equal(service.getSnapshot().state, 'playing')
  assert.equal(service.getSnapshot().segmentIndex, 0)
  await tick()
  assert.equal(provider.prefetchCount, 1, '开始当前段后应轻量预取下一段')

  const mediaUpdatesBeforeRange = media.updates.length
  provider.sessions[0]?.onRange?.(2)
  assert.equal(service.getSnapshot().characterOffset, 2)
  assert.equal(
    media.updates.length,
    mediaUpdatesBeforeRange,
    '高频字符进度不应刷新系统 MediaSession',
  )

  await service.pause()
  assert.equal(service.getSnapshot().state, 'paused')
  assert.equal(provider.pauseCount, 1)

  await service.resume()
  assert.equal(service.getSnapshot().state, 'playing')
  assert.equal(provider.resumeCount, 1)

  const stale = provider.sessions[0]
  await service.next()
  assert.equal(service.getSnapshot().segmentIndex, 1)
  stale?.onEnd?.()
  await tick()
  assert.equal(service.getSnapshot().segmentIndex, 1)

  const stopCountBeforeAutoContinue = provider.stopCount
  provider.sessions.at(-1)?.onEnd?.()
  await tick()
  assert.equal(service.getSnapshot().segmentIndex, 2)
  assert.equal(
    provider.stopCount,
    stopCountBeforeAutoContinue,
    '自然完成自动续读不能 stop 已完成 handle，否则 Android 会每段重启前台服务',
  )

  const stopCountBeforeFinalNext = provider.stopCount
  await service.next()
  assert.equal(service.getSnapshot().state, 'ended')
  assert.ok(provider.stopCount > stopCountBeforeFinalNext)

  await service.previous()
  assert.equal(service.getSnapshot().segmentIndex, 1)

  await service.stop()
  assert.equal(service.getSnapshot().state, 'idle')
  assert.ok(provider.cancelPrefetchCount > 0)
  assert.ok(media.updates.length > 0)
  await service.dispose()
}

async function testEmptyDocumentStopsPrevious(): Promise<void> {
  const provider = new FakeProvider()
  const service = new ReadAloudService({
    providerFactory: async () => provider,
    mediaAdapter: new FakeMedia(),
  })
  const prefs = normalizeReadAloudPrefs({ engine: 'system' })
  await service.start(
    segmentArticle('before-empty', '标题', '<p>正在朗读的正文</p>'),
    prefs,
    DEFAULT_TRANSLATION_PREFS.ai,
    { resumeSaved: false },
  )
  const stopsBefore = provider.stopCount
  await service.start(
    { articleId: 'empty', title: '空文章', segments: [] },
    prefs,
    DEFAULT_TRANSLATION_PREFS.ai,
    { resumeSaved: false },
  )
  assert.ok(provider.stopCount > stopsBefore)
  assert.equal(service.getSnapshot().state, 'error')
  assert.equal(service.getSnapshot().articleId, 'empty')
  await service.dispose()
}

async function testProviderSwitch(): Promise<void> {
  memory.clear()
  memory.set('newsnook:log', JSON.stringify({ level: 'silent' }))
  const systemProvider = new FakeProvider()
  const aiProvider = new FakeProvider()
  Object.defineProperty(aiProvider, 'id', { value: 'ai' })
  const media = new FakeMedia()
  const service = new ReadAloudService({
    providerFactory: async ({ prefs }) =>
      prefs.engine === 'ai' ? aiProvider : systemProvider,
    mediaAdapter: media,
  })
  const document = segmentArticle(
    'provider-switch',
    '标题',
    '<p>正文一</p><p>正文二</p>',
  )
  await service.start(
    document,
    normalizeReadAloudPrefs({ engine: 'system' }),
    DEFAULT_TRANSLATION_PREFS.ai,
    { resumeSaved: false },
  )
  assert.equal(systemProvider.sessions.length, 1)

  await service.updatePreferences(
    normalizeReadAloudPrefs({
      engine: 'ai',
      ai: {
        providerId: 'openai',
        protocol: 'audio-speech',
        model: 'gpt-4o-mini-tts',
        voice: 'manual-voice',
        format: 'mp3',
      },
    }),
    DEFAULT_TRANSLATION_PREFS.ai,
  )
  assert.equal(aiProvider.sessions.length, 1)
  assert.equal(service.getSnapshot().providerId, 'ai')
  await service.dispose()
}

async function testProviderFailure(): Promise<void> {
  const media = new FakeMedia()
  const service = new ReadAloudService({
    providerFactory: async () => {
      throw new Error('provider unavailable')
    },
    mediaAdapter: media,
  })
  await service.start(
    segmentArticle('failure', '标题', '<p>正文</p>'),
    normalizeReadAloudPrefs({ engine: 'system' }),
    DEFAULT_TRANSLATION_PREFS.ai,
    { resumeSaved: false },
  )
  assert.equal(service.getSnapshot().state, 'error')
  assert.match(service.getSnapshot().error ?? '', /provider unavailable/)
  await service.dispose()
}

async function testWebSpeechProvider(): Promise<void> {
  let current: any = null
  let pauseCount = 0
  let resumeCount = 0
  let cancelCount = 0
  const voice = {
    voiceURI: 'voice:zh',
    name: 'Test Chinese',
    lang: 'zh-CN',
    localService: true,
  }

  class MockUtterance {
    text: string
    rate = 1
    pitch = 1
    lang = ''
    voice: any = null
    onstart: (() => void) | null = null
    onboundary: ((event: { charIndex: number }) => void) | null = null
    onerror: ((event: { error?: string }) => void) | null = null
    onend: (() => void) | null = null
    constructor(text: string) {
      this.text = text
    }
  }

  const synth = {
    getVoices: () => [voice],
    speak: (utterance: any) => {
      current = utterance
      utterance.onstart?.()
    },
    pause: () => {
      pauseCount += 1
    },
    resume: () => {
      resumeCount += 1
    },
    cancel: () => {
      cancelCount += 1
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      speechSynthesis: synth,
      setTimeout,
      clearTimeout,
    },
  })
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: MockUtterance,
  })

  const provider = new WebSpeechProvider()
  assert.equal(await provider.isAvailable(), true)
  assert.equal((await provider.listVoices())[0]?.id, 'voice:zh')

  let started = 0
  let offset = 0
  let ended = 0
  const handle = await provider.speak(
    {
      id: 's',
      index: 0,
      kind: 'paragraph',
      text: 'abcdef',
      lang: 'zh-CN',
    },
    {
      voiceId: 'voice:zh',
      rate: 1.25,
      pitch: 0.9,
      startOffset: 2,
    },
    {
      onStart: () => {
        started += 1
      },
      onRange: (value) => {
        offset = value
      },
      onEnd: () => {
        ended += 1
      },
    },
  )
  assert.equal(current.text, 'cdef')
  assert.equal(started, 1)
  current.onboundary?.({ charIndex: 1 })
  assert.equal(offset, 3)
  await handle.pause()
  await handle.resume()
  assert.equal(pauseCount, 1)
  assert.equal(resumeCount, 1)
  current.onend?.()
  assert.equal(ended, 1)
  await provider.dispose()
  assert.ok(cancelCount >= 1)
}

async function testWebMediaSession(): Promise<void> {
  const handlers = new Map<string, (() => void) | null>()
  let playbackState = 'none'
  let metadata: unknown = null

  class MockMetadata {
    constructor(public init: unknown) {}
  }
  Object.defineProperty(globalThis, 'MediaMetadata', {
    configurable: true,
    value: MockMetadata,
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaSession: {
        get metadata() {
          return metadata
        },
        set metadata(value: unknown) {
          metadata = value
        },
        get playbackState() {
          return playbackState
        },
        set playbackState(value: string) {
          playbackState = value
        },
        setActionHandler(action: string, handler: (() => void) | null) {
          handlers.set(action, handler)
        },
      },
    },
  })

  let next = 0
  let pause = 0
  const adapter = new WebMediaSessionAdapter()
  adapter.bind({
    play: () => {},
    pause: () => {
      pause += 1
    },
    stop: () => {},
    next: () => {
      next += 1
    },
    previous: () => {},
  })
  adapter.update(
    {
      state: 'playing',
      articleId: 'a',
      title: '文章',
      segmentIndex: 0,
      segmentCount: 2,
      characterOffset: 0,
    },
    {
      articleId: 'a',
      title: '文章',
      sourceName: '来源',
      segmentIndex: 0,
      segmentCount: 2,
    },
  )
  assert.equal(playbackState, 'playing')
  assert.ok(metadata)
  handlers.get('pause')?.()
  handlers.get('nexttrack')?.()
  assert.equal(pause, 1)
  assert.equal(next, 1)
  adapter.dispose()
  assert.equal(playbackState, 'none')
}

async function testAiTts(): Promise<void> {
  const originalFetch = globalThis.fetch
  const originalAudio = (globalThis as any).Audio
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  let requestBody: any = null
  let requestHeaders: Record<string, string> = {}
  let requestUrl = ''
  let requestCount = 0
  let revoked = ''
  let objectSequence = 0

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requestCount += 1
    requestUrl = String(input)
    requestHeaders = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    )
    requestBody = JSON.parse(String(init?.body ?? '{}'))
    return new Response(new Blob(['audio'], { type: 'audio/mpeg' }), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    })
  }) as typeof fetch

  URL.createObjectURL = () => `blob:test-${++objectSequence}`
  URL.revokeObjectURL = (value) => {
    revoked = value
  }

  class MockAudio {
    src: string
    currentTime = 0
    error: MediaError | null = null
    playbackRate = 1
    preload = ''
    onplay: (() => void) | null = null
    ontimeupdate: (() => void) | null = null
    onended: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(src: string) {
      this.src = src
    }
    async play() {
      this.onplay?.()
    }
    pause() {}
    removeAttribute() {}
    load() {}
  }
  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    value: MockAudio,
  })

  const providerConfig = {
    id: 'openai',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: 'test-key',
    capabilities: { tts: true },
  }
  const provider = new AiTtsProvider(providerConfig, {
    providerId: 'openai',
    protocol: 'audio-speech',
    model: 'gpt-4o-mini-tts',
    voice: 'manual-voice',
    format: 'mp3',
  })
  const handle = await provider.speak(
    {
      id: 'ai',
      index: 0,
      kind: 'paragraph',
      text: 'hello world',
    },
    { rate: 1.2, pitch: 1 },
    {},
  )
  assert.equal(requestBody.model, 'gpt-4o-mini-tts')
  assert.equal(requestBody.voice, 'manual-voice')
  assert.equal(requestBody.speed, 1.2)
  assert.equal(requestBody.response_format, 'mp3')
  assert.equal(
    requestUrl,
    'https://api.openai.com/v1/audio/speech',
    'AI TTS 必须复用 OpenAI-compatible Base URL 归一化',
  )
  await handle.stop()
  assert.equal(revoked, 'blob:test-1')

  await __aiTtsTest.fetchSpeechBlob(
    { ...providerConfig, endpoint: 'https://api.openai.com/v1/audio/speech' },
    {
      providerId: 'openai',
      protocol: 'audio-speech',
      model: 'gpt-4o-mini-tts',
      voice: 'manual-voice',
      format: 'mp3',
    },
    'normalized endpoint',
    1,
  )
  assert.equal(
    requestUrl,
    'https://api.openai.com/v1/audio/speech',
    '已填写 /audio/speech 时不能重复追加路径',
  )

  const chatAudio = Buffer.from('chat-completions-audio').toString('base64')
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requestCount += 1
    requestUrl = String(input)
    requestHeaders = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    )
    requestBody = JSON.parse(String(init?.body ?? '{}'))
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              audio: { data: chatAudio },
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )
  }) as typeof fetch

  const chatBlob = await __aiTtsTest.fetchSpeechBlob(
    {
      ...providerConfig,
      endpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
    },
    {
      providerId: 'openai',
      protocol: 'chat-completions',
      model: 'mimo-v2.5-tts',
      voice: 'voice-entered-by-user',
      format: 'wav',
    },
    '这是需要合成的正文',
    1.75,
  )
  assert.equal(
    requestUrl,
    'https://api.xiaomimimo.com/v1/chat/completions',
    'Chat Completions TTS 必须显式走 /v1/chat/completions',
  )
  assert.deepEqual(requestBody.messages, [
    { role: 'assistant', content: '这是需要合成的正文' },
  ])
  assert.deepEqual(requestBody.audio, {
    format: 'wav',
    voice: 'voice-entered-by-user',
  })
  assert.equal(requestBody.model, 'mimo-v2.5-tts')
  assert.equal(requestBody.stream, false)
  assert.equal('input' in requestBody, false)
  assert.equal('response_format' in requestBody, false)
  assert.equal('speed' in requestBody, false)
  assert.equal(requestHeaders.Authorization, 'Bearer test-key')
  assert.equal(
    requestHeaders['api-key'],
    'test-key',
    'MiMo 文档使用 api-key；Chat Completions TTS 需兼容该认证头',
  )
  assert.equal(await chatBlob.text(), 'chat-completions-audio')
  assert.equal(chatBlob.type, 'audio/wav')

  await assert.rejects(
    () =>
      __aiTtsTest.fetchSpeechBlob(
        providerConfig,
        {
          providerId: 'openai',
          protocol: 'chat-completions',
          model: 'mimo-v2.5-tts',
          voice: '',
          format: 'wav',
        },
        'hello',
        1,
      ),
    /填写.*Voice|填写.*声音/,
  )

  requestCount = 0
  const cachedSegment = {
    id: 'ai-cached',
    index: 1,
    kind: 'paragraph' as const,
    text: 'prefetched next paragraph',
  }
  await provider.prefetch?.(cachedSegment, { rate: 1, pitch: 1 })
  assert.equal(requestCount, 1)
  const cachedHandle = await provider.speak(
    cachedSegment,
    { rate: 1, pitch: 1, startOffset: 0 },
    {},
  )
  assert.equal(requestCount, 1, '播放下一段应消费预取结果，不重复请求 AI TTS')
  await cachedHandle.stop()

  await provider.prefetch?.(cachedSegment, { rate: 1, pitch: 1 })
  assert.equal(requestCount, 2)
  const resumedHandle = await provider.speak(
    cachedSegment,
    { rate: 1, pitch: 1, startOffset: 3 },
    {},
  )
  assert.equal(requestCount, 3, '字符断点恢复不能错误复用整段预取音频')
  await resumedHandle.stop()

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: 'bad voice' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
  await assert.rejects(
    () =>
      __aiTtsTest.fetchSpeechBlob(
        providerConfig,
        {
          providerId: 'openai',
          protocol: 'audio-speech',
          model: 'gpt-4o-mini-tts',
          voice: 'bad',
          format: 'mp3',
        },
        'hello',
        1,
      ),
    /bad voice/,
  )

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () =>
      __aiTtsTest.fetchSpeechBlob(
        providerConfig,
        {
          providerId: 'openai',
          protocol: 'audio-speech',
          model: 'gpt-4o-mini-tts',
          voice: 'manual-voice',
          format: 'mp3',
        },
        'hello',
        1,
        controller.signal,
      ),
    /取消/,
  )

  await assert.rejects(
    () =>
      __aiTtsTest.fetchSpeechBlob(
        { ...providerConfig, capabilities: { tts: false } },
        {
          providerId: 'openai',
          protocol: 'audio-speech',
          model: 'gpt-4o-mini-tts',
          voice: 'manual-voice',
          format: 'mp3',
        },
        'hello',
        1,
      ),
    /未声明支持 AI 语音接口/,
  )

  globalThis.fetch = originalFetch
  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    value: originalAudio,
  })
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
}

function testProviderSelectionAndAndroidContract(): void {
  const prefs = normalizeReadAloudPrefs({ engine: 'auto' })
  assert.match(
    readAloudProviderKey({
      prefs,
      ai: DEFAULT_TRANSLATION_PREFS.ai,
    }),
    /web-speech|android-system/,
  )

  const audioProtocolKey = readAloudProviderKey({
    prefs: normalizeReadAloudPrefs({
      engine: 'ai',
      ai: {
        providerId: 'openai',
        protocol: 'audio-speech',
        model: 'model',
        voice: 'voice',
        format: 'mp3',
      },
    }),
    ai: DEFAULT_TRANSLATION_PREFS.ai,
  })
  const chatProtocolKey = readAloudProviderKey({
    prefs: normalizeReadAloudPrefs({
      engine: 'ai',
      ai: {
        providerId: 'openai',
        protocol: 'chat-completions',
        model: 'model',
        voice: 'voice',
        format: 'mp3',
      },
    }),
    ai: DEFAULT_TRANSLATION_PREFS.ai,
  })
  assert.notEqual(
    audioProtocolKey,
    chatProtocolKey,
    '切换 TTS API 协议必须重建 Provider，不能复用旧协议实例/预取缓存',
  )

  const manifest = fs.readFileSync(
    path.join(process.cwd(), 'android/app/src/main/AndroidManifest.xml'),
    'utf8',
  )
  const service = fs.readFileSync(
    path.join(
      process.cwd(),
      'android/app/src/main/java/com/aizeek/newsnook/ReadAloudPlaybackService.java',
    ),
    'utf8',
  )
  const mainActivity = fs.readFileSync(
    path.join(
      process.cwd(),
      'android/app/src/main/java/com/aizeek/newsnook/MainActivity.java',
    ),
    'utf8',
  )
  const plugin = fs.readFileSync(
    path.join(
      process.cwd(),
      'android/app/src/main/java/com/aizeek/newsnook/ReadAloudPlugin.java',
    ),
    'utf8',
  )

  assert.match(manifest, /FOREGROUND_SERVICE_MEDIA_PLAYBACK/)
  assert.match(manifest, /foregroundServiceType="mediaPlayback"/)
  assert.match(manifest, /android\.intent\.action\.TTS_SERVICE/)
  assert.match(service, /MediaSession/)
  assert.match(service, /MediaPlayer/)
  assert.match(service, /PowerManager\.PARTIAL_WAKE_LOCK/)
  assert.match(service, /ACTION_PLAY_AUDIO/)
  assert.match(service, /ACTION_AUDIO_BECOMING_NOISY/)
  assert.match(service, /AudioFocusRequest/)
  assert.match(service, /onRangeStart/)
  assert.match(service, /EXTRA_LANGUAGE_TAG/)
  assert.match(service, /audioPrepared/)
  assert.match(service, /ttsGeneration/)
  assert.match(service, /onTaskRemoved/)
  assert.match(plugin, /File\.createTempFile/)
  assert.match(plugin, /EXTRA_AUDIO_PATH/)
  assert.match(plugin, /EXTRA_LANGUAGE_TAG/)
  assert.match(plugin, /Executors\.newSingleThreadExecutor/)
  assert.match(plugin, /getDisplayName\(Locale\.getDefault\(\)\)/)
  assert.match(plugin, /engineName/)
  assert.match(mainActivity, /registerPlugin\(ReadAloudPlugin\.class\)/)

  const app = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8')
  const reader = fs.readFileSync(
    path.join(process.cwd(), 'src/screens/ReaderScreen.tsx'),
    'utf8',
  )
  const me = fs.readFileSync(
    path.join(process.cwd(), 'src/screens/MeScreen.tsx'),
    'utf8',
  )
  const settings = fs.readFileSync(
    path.join(process.cwd(), 'src/screens/settings/ReadAloudScreen.tsx'),
    'utf8',
  )
  assert.match(app, /name: 'read-aloud'/)
  assert.match(
    app,
    /GlobalReadAloudBar/,
    'App 根层必须订阅全局朗读会话，离开 Reader 后仍能暂停/继续/切段/停止',
  )
  assert.match(app, /readAloudPrefs=\{prefs\.readAloud\}/)
  assert.match(reader, /useReadAloud/)
  assert.match(reader, /ReadAloudBar/)
  assert.match(me, /title="朗读"/)
  assert.match(settings, /OptionPickerDialog/)
  assert.match(settings, /PromptDialog/)
  assert.match(settings, /TTS 接口协议/)
  assert.match(settings, /chat-completions/)
  assert.doesNotMatch(settings, /OPENAI_VOICES|OpenAI 标准 Voice|CUSTOM_AI_VOICE/)
  assert.doesNotMatch(settings, /<select|<datalist/)
  assert.doesNotMatch(settings, /window\.(alert|confirm|prompt)/)
}

testGlobalReadAloudVisibility()
testPrefsAndSegmentation()
await testServiceStateMachine()
await testEmptyDocumentStopsPrevious()
await testProviderSwitch()
await testProviderFailure()
await testWebSpeechProvider()
await testWebMediaSession()
await testAiTts()
testProviderSelectionAndAndroidContract()

console.log('read-aloud tests passed')
