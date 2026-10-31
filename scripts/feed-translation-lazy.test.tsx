import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mock } from 'node:test'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import { DEFAULT_TRANSLATION_PREFS } from '../src/features/translation/config'
import { clearFeedTranslations, loadCachedFeedTranslation, saveCachedFeedTranslation } from '../src/features/translation/feedTranslationStorage'
import type { TranslationPrefs } from '../src/features/translation/types'
import type { Article } from '../src/lib/types'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function withinTimeout(promise: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out waiting for translation module loading')), 3000)
    })])
  } finally {
    clearTimeout(timer)
  }
}

const workStarted = deferred()
const workGate = deferred()
const providerStarted = deferred()
const providerGate = deferred()
let delayProvider = false
let workLoads = 0
let providerLoads = 0
let dictionaryLoads = 0
const languageModuleLoads = new Set<string>()
Object.assign(globalThis, { __feedTranslationLazyTest: { workGate, providerGate } })

// Run the real work, provider and dictionary modules. Only hold module evaluation
// so disabling translation can race an actual dynamic import without changing production code.
const hooks = registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context)
    const modulePath = new URL(url).pathname
    if (/\/features\/translation\/(quality|detectLanguage|chineseVariantMarks)\.ts$/.test(modulePath)) {
      languageModuleLoads.add(modulePath.split('/').pop()!)
    }
    if (modulePath.endsWith('/features/translation/feedTranslationWork.ts')) {
      workLoads++
      workStarted.resolve()
      const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source as Uint8Array).toString('utf8')
      return { ...loaded, source: 'await globalThis.__feedTranslationLazyTest.workGate.promise;\n' + source }
    }
    if (modulePath.endsWith('/features/translation/providers.ts')) {
      providerLoads++
      providerStarted.resolve()
      if (delayProvider) {
        const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source as Uint8Array).toString('utf8')
        return { ...loaded, source: 'await globalThis.__feedTranslationLazyTest.providerGate.promise;\n' + source }
      }
    }
    if (new URL(url).pathname.endsWith('/features/translation/chineseVariant.ts')) dictionaryLoads++
    return loaded
  },
})

const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
const document = window.document
const storage = new Map<string, string>()
Object.assign(globalThis, {
  window, document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver, React, IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
    get length() { return storage.size },
    key: (index: number) => [...storage.keys()][index] ?? null,
  },
})

const requests: { texts: string[]; signal?: AbortSignal | null }[] = []
const translatedTitle = '科學家發現太陽系外的一顆新行星'
mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
  const body = JSON.parse(String(options.body)) as { q: string[] }
  requests.push({ texts: body.q, signal: options.signal })
  return { status: 200, json: async () => ({ data: { translations: body.q.map(() => ({ translatedText: translatedTitle })) } }) }
})

const { createRoot } = await import('react-dom/client')
const { useFeedTranslation } = await import('../src/features/translation/useFeedTranslation')
const root = createRoot(document.getElementById('root')!)
const prefs: TranslationPrefs = {
  ...DEFAULT_TRANSLATION_PREFS,
  provider: 'google',
  cloud: { ...DEFAULT_TRANSLATION_PREFS.cloud, google: { apiKey: 'test-key', endpoint: 'https://example.test/translation' } },
}
const makeArticle = (id: string, title: string): Article => ({
  id, title, summary: '', publishedAt: Date.now(), hasRealDate: true,
  sourceId: 'test', sourceName: 'Test', sourceLabel: 'Test', sourceGroup: 'intl',
  originUrl: 'https://example.test/' + id,
})
const article = makeArticle('fresh', 'Scientists discover a new planet far beyond our solar system')
const cachedArticle = makeArticle('cached', 'A previously translated headline is already available offline')
let result!: ReturnType<typeof useFeedTranslation>
function Harness({ articles, enabled = true }: { articles: Article[]; enabled?: boolean }) {
  result = useFeedTranslation(articles, prefs, { enabled })
  return <output data-translating={String(result.isTranslating)}>{[...result.translations.values()].map(item => item.title).join('|')}</output>
}

async function render(articles: Article[], enabled = true) {
  await act(async () => root.render(<Harness articles={articles} enabled={enabled}/>))
}
async function flush() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

try {
  clearFeedTranslations()
  await render([article], false)
  assert.equal(workLoads, 0, 'importing and rendering a disabled feed must not load the work module')
  assert.equal(languageModuleLoads.size, 0, 'a disabled feed must not load quality checks, language detection or variant marks')
  assert.equal(providerLoads, 0, 'importing and rendering a disabled feed must not load provider implementations')
  assert.equal(dictionaryLoads, 0)
  assert.equal(result.isTranslating, false)

  await render([])
  assert.equal(workLoads, 0, 'an empty feed does not load work selection')
  assert.equal(languageModuleLoads.size, 0, 'an empty feed does not load language detection')

  await render([article])
  await withinTimeout(workStarted.promise)
  assert.equal(providerLoads, 0, 'providers stay deferred while work selection is loading')
  assert.equal(requests.length, 0)
  await render([article], false)
  await act(async () => {
    workGate.resolve()
    await import('../src/features/translation/feedTranslationWork')
  })
  await flush()
  assert.equal(workLoads, 1)
  assert.deepEqual([...languageModuleLoads].sort(), ['chineseVariantMarks.ts', 'detectLanguage.ts', 'quality.ts'])
  assert.equal(providerLoads, 0, 'cancelling a pending work import must not load providers')
  assert.equal(dictionaryLoads, 0, 'cancelling a pending work import must not load phrase dictionaries')
  assert.equal(requests.length, 0, 'cancelled work selection must not start a translation job')
  assert.equal(loadCachedFeedTranslation(article.id, 'zh-Hans'), null)
  assert.equal(result.translations.size, 0)
  assert.equal(result.isTranslating, false)

  await render([makeArticle('chinese', '已经是中文的标题无需启动翻译')])
  saveCachedFeedTranslation({ articleId: cachedArticle.id, title: '离线缓存的中文译文', targetLanguage: 'zh-Hans', translatedAt: Date.now() })
  await render([cachedArticle])
  assert.match(document.body.textContent ?? '', /离线缓存的中文译文/)
  assert.equal(providerLoads, 0, 'empty, target-language and cached-only lists do not load providers')
  assert.equal(dictionaryLoads, 0, 'cached translations do not need phrase dictionaries')
  assert.equal(requests.length, 0)

  delayProvider = true
  await render([article])
  await withinTimeout(providerStarted.promise)
  assert.equal(result.isTranslating, true)
  assert.equal(requests.length, 0, 'the pending import has not started an HTTP request')
  await render([article], false)
  assert.equal(result.isTranslating, false, 'disabling translation clears the pending state immediately')
  await act(async () => {
    providerGate.resolve()
    await Promise.all([import('../src/features/translation/providers'), import('../src/features/translation/chineseVariant')])
  })
  await flush()
  assert.equal(requests.length, 0, 'a cancelled module load must not start a stale translation job')
  assert.equal(loadCachedFeedTranslation(article.id, 'zh-Hans'), null)
  assert.equal(result.translations.size, 0)
  assert.equal(result.isTranslating, false)

  await render([article])
  for (let attempt = 0; attempt < 20 && result.isTranslating; attempt++) await flush()
  assert.equal(requests.length, 1, 'a later enabled job uses the loaded provider normally')
  assert.deepEqual(requests[0].texts, [article.title])
  assert.equal(requests[0].signal?.aborted, false)
  assert.equal(result.isTranslating, false)
  assert.equal(result.translations.get(article.id)?.title, '科学家发现太阳系外的一颗新行星')
  assert.equal(loadCachedFeedTranslation(article.id, 'zh-Hans')?.title, '科学家发现太阳系外的一颗新行星')
  await render([article, cachedArticle])
  assert.equal(requests.length, 1, 'finished translations remain reusable after the article list changes')
  assert.equal(result.translations.get(cachedArticle.id)?.title, '离线缓存的中文译文')
  console.log('Feed translation lazy loading: no-work language/provider import avoidance, cancellation during work/provider loading, normalization and cache reuse passed')
} finally {
  workGate.resolve()
  providerGate.resolve()
  await act(async () => root.unmount())
  hooks.deregister()
  mock.restoreAll()
  delete (globalThis as Record<string, unknown>).__feedTranslationLazyTest
}
