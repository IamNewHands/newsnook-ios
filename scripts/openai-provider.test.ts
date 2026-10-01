import assert from 'node:assert/strict'
import { normalizeTranslationPrefs } from '../src/features/translation/config'
import {
  assertOpenAiConfig,
  cleanOpenAiTranslation,
  extractOpenAiChatContent,
  normalizeOpenAiBaseUrl,
  OPENAI_TRANSLATION_STOP,
  parseOpenAiSegmentTranslations,
} from '../src/features/translation/openai'
import {
  isHunyuanTranslationModel,
  openAiSegmentMarker,
  openAiTranslationBatchSystemPrompt,
  openAiTranslationBatchUserPrompt,
  openAiTranslationSystemPrompt,
  openAiTranslationUserPrompt,
} from '../src/features/translation/prompts'
import { OpenAiProvider } from '../src/features/translation/providers'

const empty = normalizeTranslationPrefs({})
assert.equal(empty.cloud.openai?.endpoint, 'https://api.openai.com/v1')
assert.equal(empty.cloud.openai?.apiKey, '')
assert.equal(empty.cloud.openai?.model ?? '', '')
assert.equal(empty.cloud.openai.concurrency, 2)

const saved = normalizeTranslationPrefs({
  provider: 'openai',
  cloud: {
    openai: {
      apiKey: 'sk-test',
      endpoint: 'https://gateway.example/v1/',
      model: 'gpt-4o-mini',
    },
  },
})
assert.equal(saved.provider, 'openai')
assert.equal(saved.cloud.openai.apiKey, '')
assert.equal(saved.ai.providers[0].apiKey, 'sk-test')
assert.equal(saved.cloud.openai.endpoint, 'https://gateway.example/v1/')
assert.equal(saved.cloud.openai.model, 'gpt-4o-mini')

const withConcurrency = normalizeTranslationPrefs({
  cloud: {
    openai: {
      apiKey: 'k',
      endpoint: 'https://api.openai.com/v1',
      model: 'm',
      concurrency: 5,
    },
  },
})
assert.equal(withConcurrency.cloud.openai.concurrency, 5)

const clampedHigh = normalizeTranslationPrefs({
  cloud: { openai: { apiKey: '', endpoint: 'https://api.openai.com/v1', concurrency: 99 } },
})
assert.equal(clampedHigh.cloud.openai.concurrency, 2)

const clampedLow = normalizeTranslationPrefs({
  cloud: { openai: { apiKey: '', endpoint: 'https://api.openai.com/v1', concurrency: 0 } },
})
assert.equal(clampedLow.cloud.openai.concurrency, 2)

const clampedFloat = normalizeTranslationPrefs({
  cloud: { openai: { apiKey: '', endpoint: 'https://api.openai.com/v1', concurrency: 3.7 } },
})
assert.equal(clampedFloat.cloud.openai.concurrency, 2)

assert.equal(normalizeOpenAiBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1')
assert.equal(
  normalizeOpenAiBaseUrl('https://api.openai.com/v1/chat/completions'),
  'https://api.openai.com/v1',
)
assert.equal(
  normalizeOpenAiBaseUrl('https://gateway.example/v1/chat/completions/'),
  'https://gateway.example/v1',
)

assert.equal(cleanOpenAiTranslation('  你好世界  '), '你好世界')
assert.equal(cleanOpenAiTranslation('"你好世界"'), '你好世界')
assert.equal(cleanOpenAiTranslation('```\n你好世界\n```'), '你好世界')
assert.equal(cleanOpenAiTranslation('「你好」'), '「你好」')
assert.equal(cleanOpenAiTranslation('“你好”'), '你好')
assert.equal(cleanOpenAiTranslation('<source_text>关于</source_text>'), '关于')
assert.equal(cleanOpenAiTranslation('<translation>关于</translation>'), '关于')
assert.equal(cleanOpenAiTranslation('Translation: 关于'), '关于')
assert.equal(cleanOpenAiTranslation('译文：关于'), '关于')
assert.equal(cleanOpenAiTranslation('翻译结果：关于我们'), '关于我们')
assert.equal(
  cleanOpenAiTranslation('最终以69票的优势获胜。</center>'),
  '最终以69票的优势获胜。',
)
assert.equal(
  cleanOpenAiTranslation(
    '最终赢得 279 票。</target_text>< | hy_end__of__translation | >',
  ),
  '最终赢得 279 票。',
)
assert.equal(
  cleanOpenAiTranslation(
    '在美国，癌症手术的等待时间正日益延长。</target_text><｜hy_end▁of▁sentence｜>',
  ),
  '在美国，癌症手术的等待时间正日益延长。',
)
assert.equal(
  cleanOpenAiTranslation(
    '美国癌症手术的等待时间正越来越长。</target_text>< | hy_end__of__sentence | >',
  ),
  '美国癌症手术的等待时间正越来越长。',
)
assert.equal(
  cleanOpenAiTranslation('<target_text>关于我们</target_text>'),
  '关于我们',
)

assert.equal(
  extractOpenAiChatContent(
    JSON.stringify({ choices: [{ message: { content: '手机端字符串体' } }] }),
  ),
  '手机端字符串体',
)
assert.equal(
  extractOpenAiChatContent({
    choices: [{ message: { content: [{ type: 'text', text: '分段' }, { type: 'text', text: '内容' }] } }],
  }),
  '分段内容',
)
assert.equal(extractOpenAiChatContent('not-json'), null)

assert.throws(
  () => assertOpenAiConfig({ apiKey: '', endpoint: 'https://api.openai.com/v1', model: 'x' }),
  /API Key/,
)
assert.throws(
  () => assertOpenAiConfig({ apiKey: 'k', endpoint: 'https://api.openai.com/v1', model: '' }),
  /Model/,
)
assert.throws(
  () => assertOpenAiConfig({ apiKey: 'k', endpoint: 'http://insecure.example/v1', model: 'x' }),
  /HTTPS/,
)

const systemAuto = openAiTranslationSystemPrompt('auto', 'zh-Hans', 'paragraph')
assert.match(systemAuto, /translate any source text provided by the user into Simplified Chinese/)
assert.match(systemAuto, /senior professional translation expert/)
assert.match(systemAuto, /Context & Domain Adaptation/)
assert.match(systemAuto, /Tone & Style Fidelity/)
assert.match(systemAuto, /Native Idiomaticity/)
assert.match(systemAuto, /Neutral & Objective Stance/)
assert.match(systemAuto, /Output the translation directly without any explanations/)
assert.match(systemAuto, /Do not wrap the translation in XML or HTML tags/)
assert.doesNotMatch(systemAuto, /信、达、雅|信达雅/)
assert.doesNotMatch(systemAuto, /from English/i)
assert.doesNotMatch(systemAuto, /Tehran|德黑兰|真主党|信达雅/)

const systemEn = openAiTranslationSystemPrompt('auto', 'en', 'paragraph')
assert.match(systemEn, /into English/)
assert.doesNotMatch(systemEn, /Simplified Chinese/)

const systemHeadline = openAiTranslationSystemPrompt('en', 'zh-Hans', 'headline')
assert.equal(systemHeadline, openAiTranslationSystemPrompt('en', 'zh-Hans', 'paragraph'))

const userHeadline = openAiTranslationUserPrompt('Hello world', 'zh-Hans', 'headline')
assert.match(userHeadline, /^原文：\nHello world$/)
assert.doesNotMatch(userHeadline, /source_text/)
assert.equal(userHeadline, openAiTranslationUserPrompt('Hello world', 'zh-Hans', 'paragraph'))

const userBody = openAiTranslationUserPrompt('Hello world', 'zh-Hans', 'paragraph')
assert.match(userBody, /原文：/)
assert.doesNotMatch(userBody, /信达雅|literal|source_text/i)

assert.equal(isHunyuanTranslationModel('hy-mt1.5-7b'), true)
assert.equal(isHunyuanTranslationModel('Hunyuan-MT-7B'), true)
assert.equal(isHunyuanTranslationModel('gpt-4o-mini'), false)
assert.equal(openAiTranslationSystemPrompt('en', 'zh-Hans', 'paragraph', 'hy-mt1.5'), '')
assert.match(
  openAiTranslationUserPrompt('Hello world', 'zh-Hans', 'paragraph', 'hunyuan-mt-7b'),
  /^将以下文本翻译为中文，注意只需要输出翻译后的结果，不要额外解释：\n\nHello world$/,
)

// —— 批量（整篇一次请求）协议 ——
const batchSystem = openAiTranslationBatchSystemPrompt('en', 'zh-Hans', 'gpt-4o-mini')
assert.match(batchSystem, /senior professional translation expert/)
assert.match(batchSystem, /Batch mode/)
assert.match(batchSystem, /into Simplified Chinese/)
assert.match(batchSystem, /Never merge, split, reorder, renumber, or skip segments/)

const batchUser = openAiTranslationBatchUserPrompt(['Hello', 'World'])
assert.equal(batchUser, '原文：\n\n[[1]]\nHello\n\n[[2]]\nWorld')
assert.equal(openAiSegmentMarker(0), '[[1]]')
assert.equal(openAiSegmentMarker(9), '[[10]]')

assert.deepEqual(parseOpenAiSegmentTranslations('[[1]]\n你好\n\n[[2]]\n世界', 2), ['你好', '世界'])
// 模型爱加的开场白在第一个标记之前，直接丢弃
assert.deepEqual(parseOpenAiSegmentTranslations('以下是翻译：\n[[1]]\n你好', 1), ['你好'])
// 段落数不符（漏段 / 被 max_tokens 截断）
assert.equal(parseOpenAiSegmentTranslations('[[1]]\n你好', 2), null)
// 编号重排或重复
assert.equal(parseOpenAiSegmentTranslations('[[2]]\n甲\n\n[[1]]\n乙', 2), null)
assert.equal(parseOpenAiSegmentTranslations('[[1]]\n甲\n\n[[1]]\n乙', 2), null)
// 空译文不放行
assert.equal(parseOpenAiSegmentTranslations('[[1]]\n甲\n\n[[2]]\n   ', 2), null)
assert.equal(parseOpenAiSegmentTranslations('没有任何标记', 1), null)

const originalFetch = globalThis.fetch
const requests: { url: string; body: Record<string, unknown>; authorization: string | null }[] = []

globalThis.fetch = async (input, init) => {
  const headers = new Headers(init?.headers)
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>
  requests.push({
    url: String(input),
    body,
    authorization: headers.get('Authorization'),
  })
  const messages = body.messages as { role: string; content: string }[]
  const user = messages.find((m) => m.role === 'user')?.content ?? ''
  return Response.json({
    choices: [{ message: { content: replyFor(user, (text) => `AI:${text}`) } }],
  })
}

/**
 * 新协议：整篇原文一次请求，模型必须按 `[[n]]` 标记返回。
 * 这里模拟一个守规矩的模型；单段请求（`原文：\n<text>`）仍走旧形状。
 */
function readSegments(user: string): { kind: 'single' | 'batch'; texts: string[] } {
  const batch = user.match(/^原文：\n\n([\s\S]+)$/)
  if (batch) {
    const texts: string[] = []
    const re = /\[\[(\d+)\]\]\n([\s\S]*?)(?=\n\n\[\[\d+\]\]\n|$)/g
    for (const match of batch[1].matchAll(re)) texts.push(match[2].trim())
    return { kind: 'batch', texts }
  }
  const hunyuan = user.match(/不要额外解释：\n\n([\s\S]+)$/)
  if (hunyuan) return { kind: 'single', texts: [hunyuan[1]] }
  const english = user.match(/without additional explanation\.\n\n([\s\S]+)$/)
  if (english) return { kind: 'single', texts: [english[1]] }
  const plain = user.match(/^原文：\n([\s\S]+)$/)
  return { kind: 'single', texts: [plain ? plain[1] : user] }
}

function replyFor(user: string, translate: (text: string) => string): string {
  const { kind, texts } = readSegments(user)
  if (kind === 'single') return translate(texts[0])
  return texts
    .map((text, index) => `${openAiSegmentMarker(index)}\n${translate(text)}`)
    .join('\n\n')
}

const provider = new OpenAiProvider({
  apiKey: 'sk-test',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
})

// 整篇一次请求：两段只发一次 completion，靠 [[n]] 切回各段
const batchIndexes: number[] = []
const result = await provider.translate({
  texts: ['Hello', 'World'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
  onBatch: (_batch, startIndex) => {
    batchIndexes.push(startIndex)
  },
})

assert.deepEqual(result, ['AI:Hello', 'AI:World'])
assert.equal(requests.length, 1, '整篇一次请求，不再每段一次')
assert.equal(requests[0].url, 'https://api.openai.com/v1/chat/completions')
assert.equal(requests[0].authorization, 'Bearer sk-test')
assert.equal(requests[0].body.model, 'gpt-4o-mini')
assert.equal(requests[0].body.stream, false)
assert.equal(requests[0].body.temperature, 0.6)
assert.ok(Array.isArray(requests[0].body.messages))
const batchUserSent = (requests[0].body.messages as { role: string; content: string }[]).find(
  (m) => m.role === 'user',
)?.content
assert.match(String(batchUserSent), /\[\[1\]\]\nHello\n\n\[\[2\]\]\nWorld/)
assert.deepEqual(
  batchIndexes.sort((a, b) => a - b),
  [0, 1],
)

requests.length = 0
const mixed = await provider.translate({
  texts: ['Market rallies on rate cut hopes', 'Investors bought shares after the announcement.'],
  textKinds: ['headline', 'paragraph'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.deepEqual(mixed, [
  'AI:Market rallies on rate cut hopes',
  'AI:Investors bought shares after the announcement.',
])
assert.equal(requests.length, 1, '标题与正文同批时也只发一次请求')
const sys0 = (requests[0].body.messages as { role: string; content: string }[]).find(
  (m) => m.role === 'system',
)?.content
assert.match(String(sys0), /senior professional translation expert/)
assert.match(String(sys0), /Output the translation directly/)
assert.match(String(sys0), /Batch mode/)
assert.doesNotMatch(String(sys0), /信、达、雅|信达雅/)
assert.equal(requests[0].body.temperature, 0.6)
assert.deepEqual(requests[0].body.stop, OPENAI_TRANSLATION_STOP)

// Hunyuan-MT 专用模型不吃标记协议：仍逐段发送
requests.length = 0
const hunyuanProvider = new OpenAiProvider({
  apiKey: 'sk-test',
  endpoint: 'https://api.openai.com/v1',
  model: 'hy-mt1.5-7b',
})
const hunyuanResult = await hunyuanProvider.translate({
  texts: ['Hello'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.deepEqual(hunyuanResult, ['AI:Hello'])
const hunyuanMessages = requests[0].body.messages as { role: string; content: string }[]
assert.equal(
  hunyuanMessages.some((m) => m.role === 'system'),
  false,
)
assert.match(hunyuanMessages[0]?.content ?? '', /将以下文本翻译为中文/)
assert.deepEqual(requests[0].body.stop, OPENAI_TRANSLATION_STOP)

requests.length = 0
const hunyuanMany = await hunyuanProvider.translate({
  texts: ['Hello again', 'World'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.deepEqual(hunyuanMany, ['AI:Hello again', 'AI:World'])
assert.equal(requests.length, 2, '专用翻译模型逐段发送，不带标记')
assert.doesNotMatch(String(hunyuanMessages[0]?.content ?? ''), /\[\[1\]\]/)

await assert.rejects(
  () =>
    provider.translate({
      texts: ['a', 'b'],
      textKinds: ['headline'],
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hans',
    }),
  /textKinds/,
)

await assert.rejects(
  () =>
    new OpenAiProvider({
      apiKey: 'sk',
      endpoint: 'https://api.openai.com/v1',
      model: '',
    }).translate({ texts: ['x'], sourceLanguage: 'en', targetLanguage: 'zh-Hans' }),
  /Model/,
)

let retryableCalls = 0
globalThis.fetch = async () => {
  retryableCalls += 1
  return Response.json({ error: { message: 'quota exceeded' } }, { status: 429 })
}
await assert.rejects(
  () =>
    provider.translate({ texts: ['x'], sourceLanguage: 'en', targetLanguage: 'zh-Hans' }),
  /AI 翻译：quota exceeded/,
)
assert.equal(retryableCalls, 2, '429 should retry the failed segment once')

let nonRetryableCalls = 0
globalThis.fetch = async () => {
  nonRetryableCalls += 1
  return Response.json({ error: { message: 'invalid api key' } }, { status: 401 })
}
await assert.rejects(
  () =>
    provider.translate({ texts: ['x'], sourceLanguage: 'en', targetLanguage: 'zh-Hans' }),
  /AI 翻译：invalid api key/,
)
assert.equal(nonRetryableCalls, 1, 'non-retryable 4xx should fail immediately')

// 分批：短文一批发完；超长文章在段落边界切成几批，批次之间仍受并发上限约束
let active = 0
let maxActive = 0
const longTexts = Array.from({ length: 10 }, (_, i) => `P${i}`.padEnd(4000, 'x'))
globalThis.fetch = async (_input, init) => {
  active++
  maxActive = Math.max(maxActive, active)
  const body = JSON.parse(String(init?.body)) as {
    messages: { role: string; content: string }[]
  }
  await new Promise((r) => setTimeout(r, 15))
  active--
  const user = body.messages.find((m) => m.role === 'user')?.content ?? ''
  return Response.json({
    choices: [{ message: { content: replyFor(user, (text) => `AI:${text.slice(0, 4)}`) } }],
  })
}

const providerDefault = new OpenAiProvider({
  apiKey: 'sk-test',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
})
const defaultResult = await providerDefault.translate({
  texts: longTexts,
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.equal(defaultResult.length, 10)
assert.ok(maxActive <= 2, `default max concurrent ${maxActive}`)

active = 0
maxActive = 0
const providerFive = new OpenAiProvider({
  apiKey: 'sk-test',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  concurrency: 5,
})
await providerFive.translate({ texts: longTexts, sourceLanguage: 'en', targetLanguage: 'zh-Hans' })
assert.ok(maxActive <= 5, `custom max concurrent ${maxActive}`)
assert.ok(maxActive >= 2, `expected some parallelism, got ${maxActive}`)

// 一段坏掉不拖垮整篇：整批请求失败后自动退回逐段，成功段照常落地
const fallbackAttempts: { kind: 'single' | 'batch'; texts: string[] }[] = []
const fallbackCompleted: number[] = []
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as {
    messages: { role: string; content: string }[]
  }
  const user = body.messages.find((message) => message.role === 'user')?.content ?? ''
  const segments = readSegments(user)
  fallbackAttempts.push(segments)
  if (segments.texts.includes('Fail')) {
    return Response.json({ error: { message: 'bad paragraph' } }, { status: 400 })
  }
  await new Promise((resolve) => setTimeout(resolve, 5))
  return Response.json({
    choices: [{ message: { content: replyFor(user, (text) => `AI:${text}`) } }],
  })
}
const fallbackProvider = new OpenAiProvider({
  apiKey: 'sk-test',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  concurrency: 5,
})
await assert.rejects(
  () =>
    fallbackProvider.translate({
      texts: ['One', 'Fail', 'Three'],
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hans',
      onBatch: (_batch, startIndex) => fallbackCompleted.push(startIndex),
    }),
  /已完成 2\/3 段，1 段失败；已完成内容已保留/,
)
assert.deepEqual(
  fallbackCompleted.sort((a, b) => a - b),
  [0, 2],
)
assert.equal(fallbackAttempts[0].kind, 'batch', '第一次整篇一次请求')
assert.deepEqual(fallbackAttempts[0].texts, ['One', 'Fail', 'Three'])
assert.deepEqual(
  fallbackAttempts.slice(1).map((attempt) => attempt.kind),
  ['single', 'single', 'single'],
  '整批失败后退回逐段请求',
)
assert.deepEqual(
  fallbackAttempts.slice(1).flatMap((attempt) => attempt.texts),
  ['One', 'Fail', 'Three'],
)

// 同一 Provider 实例重试时只补失败段：已成功段直接复用，不再重发整篇。
const resumeAttempts: { kind: 'single' | 'batch'; texts: string[] }[] = []
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as {
    messages: { role: string; content: string }[]
  }
  const user = body.messages.find((message) => message.role === 'user')?.content ?? ''
  const segments = readSegments(user)
  resumeAttempts.push(segments)
  await new Promise((resolve) => setTimeout(resolve, 5))
  return Response.json({
    choices: [{ message: { content: replyFor(user, (text) => `AI:${text}`) } }],
  })
}
const resumedIndexes: number[] = []
const resumed = await fallbackProvider.translate({
  texts: ['One', 'Fail', 'Three'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
  onBatch: (_batch, startIndex) => resumedIndexes.push(startIndex),
})
assert.deepEqual(resumed, ['AI:One', 'AI:Fail', 'AI:Three'])
assert.deepEqual(
  resumedIndexes.sort((a, b) => a - b),
  [0, 1, 2],
  'resumed run must still report every segment through onBatch',
)
assert.equal(resumeAttempts.length, 1, '只补失败的那一段')
assert.deepEqual(resumeAttempts[0].texts, ['Fail'])

// 语向不同不能复用：同一文本换目标语言必须重新请求
await fallbackProvider.translate({ texts: ['One'], sourceLanguage: 'en', targetLanguage: 'ja' })
assert.equal(resumeAttempts.length, 2, 'different target language must not hit the cache')
assert.deepEqual(resumeAttempts[1].texts, ['One'])

// 新实例不共享缓存：设置页「测试 AI 翻译」每次都真实发请求
const freshProvider = new OpenAiProvider({
  apiKey: 'sk-test',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  concurrency: 5,
})
await freshProvider.translate({ texts: ['Three'], sourceLanguage: 'en', targetLanguage: 'zh-Hans' })
assert.equal(resumeAttempts.length, 3, 'a new provider instance starts with an empty cache')

// 同一次调用内重复文本只请求一次，结果按原顺序展开，onBatch 仍逐条回调
let dedupCalls = 0
globalThis.fetch = async (_input, init) => {
  dedupCalls++
  const body = JSON.parse(String(init?.body)) as {
    messages: { role: string; content: string }[]
  }
  const user = body.messages.find((m) => m.role === 'user')?.content ?? ''
  await new Promise((r) => setTimeout(r, 5))
  return Response.json({
    choices: [{ message: { content: replyFor(user, (text) => `AI:${text}`) } }],
  })
}
const dedupIndexes: number[] = []
const dedupProvider = new OpenAiProvider({
  apiKey: 'sk-test',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
})
const dedupResult = await dedupProvider.translate({
  texts: ['Same caption', 'Body text', 'Same caption'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
  onBatch: (_batch, startIndex) => {
    dedupIndexes.push(startIndex)
  },
})
assert.deepEqual(dedupResult, ['AI:Same caption', 'AI:Body text', 'AI:Same caption'])
assert.equal(dedupCalls, 1, '重复段在同一批里只占一个标记')
assert.deepEqual(
  dedupIndexes.sort((a, b) => a - b),
  [0, 1, 2],
)

// 文本相同但场景不同（headline vs paragraph）不去重，仍各占一个标记
dedupCalls = 0
const kindSplit = await dedupProvider.translate({
  texts: ['Same words', 'Same words'],
  textKinds: ['headline', 'paragraph'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.deepEqual(kindSplit, ['AI:Same words', 'AI:Same words'])
assert.equal(dedupCalls, 1)

// 模型漏写标记（或被 max_tokens 截断）时退回逐段，结果顺序不乱
const shapeAttempts: { kind: 'single' | 'batch'; texts: string[] }[] = []
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as {
    messages: { role: string; content: string }[]
  }
  const user = body.messages.find((m) => m.role === 'user')?.content ?? ''
  const segments = readSegments(user)
  shapeAttempts.push(segments)
  await new Promise((resolve) => setTimeout(resolve, 5))
  if (segments.kind === 'batch') {
    const truncated = `${openAiSegmentMarker(0)}\nAI:${segments.texts[0]}`
    return Response.json({ choices: [{ message: { content: truncated } }] })
  }
  return Response.json({
    choices: [{ message: { content: replyFor(user, (text) => `AI:${text}`) } }],
  })
}
const shapeProvider = new OpenAiProvider({
  apiKey: 'sk-test',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
})
const shapeResult = await shapeProvider.translate({
  texts: ['Alpha', 'Beta'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.deepEqual(shapeResult, ['AI:Alpha', 'AI:Beta'], '退回逐段后顺序仍然正确')
assert.equal(shapeAttempts[0].kind, 'batch')
assert.deepEqual(
  shapeAttempts.slice(1).map((attempt) => attempt.kind),
  ['single', 'single'],
)

globalThis.fetch = originalFetch

console.log('openai-provider: ok')
