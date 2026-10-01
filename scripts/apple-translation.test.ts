import assert from 'node:assert/strict'

import {
  TRANSLATION_PROVIDERS,
  normalizeTranslationPrefs,
  translationProviderLabel,
} from '../src/features/translation/config'
import { isAppleTranslationAvailable } from '../src/features/translation/native'
import {
  AppleTranslationProvider,
  appleLanguage,
  createTranslationProvider,
  ensureAppleLanguagePack,
} from '../src/features/translation/providers'
import type { AppleLanguageState } from '../src/features/translation/native'
import type { TranslationLanguage } from '../src/features/translation/types'
import { isLocalTranslationProviderId } from '../src/features/translation/types'

const LANGUAGES: TranslationLanguage[] = [
  'en',
  'zh-Hans',
  'zh-Hant',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
]

// 1. 系统翻译的语言标识必须是 BCP-47 原样（zh-Hans / zh-Hant 不能在系统侧被合并成 zh）。
for (const code of LANGUAGES) {
  assert.equal(appleLanguage(code), code, `appleLanguage(${code}) 应保持原样`)
}

// 2. apple 是本地引擎：设置页不显示云端 Key 字段，服务层也会先做语言检测。
assert.equal(isLocalTranslationProviderId('apple'), true)
assert.equal(isLocalTranslationProviderId('google'), false)

// 3. 注册表里有条目，且文案与「完全离线」定位一致。
const entry = TRANSLATION_PROVIDERS.find((provider) => provider.id === 'apple')
assert.ok(entry, 'TRANSLATION_PROVIDERS 必须包含 apple')
assert.equal(entry?.label, 'iOS 内置离线翻译')
assert.match(entry?.caption ?? '', /离线/)
assert.equal(translationProviderLabel('apple'), 'iOS 内置离线翻译')

// 4. 偏好归一化接受 apple，非法值仍然回落到默认。
assert.equal(normalizeTranslationPrefs({ provider: 'apple' }).provider, 'apple')
assert.equal(normalizeTranslationPrefs({ provider: 'nope' }).provider, 'mlkit')

// 5. 工厂返回 apple 引擎（不触碰原生）。
const provider = createTranslationProvider('apple')
assert.ok(provider instanceof AppleTranslationProvider)
assert.equal(provider.id, 'apple')

// 6. 非 iOS 原生环境下能力探测为 false，且翻译给出可行动的中文错误而不是静默空结果。
assert.equal(isAppleTranslationAvailable(), false)
await assert.rejects(
  () =>
    new AppleTranslationProvider().translate({
      texts: ['hello'],
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hans',
    }),
  /当前系统不支持 iOS 内置翻译/,
)

// 7. 语言包由 iOS 管：未安装时翻译前必须先请系统弹下载框，装好了就不要再弹。
function fakeApi(initial: AppleLanguageState) {
  const statusCalls: string[] = []
  const prepareCalls: string[] = []
  return {
    statusCalls,
    prepareCalls,
    getLanguageStatus: async ({ sourceLanguage, targetLanguage }: {
      sourceLanguage: TranslationLanguage
      targetLanguage: TranslationLanguage
    }) => {
      statusCalls.push(`${sourceLanguage}->${targetLanguage}`)
      return initial
    },
    prepareLanguagePack: async ({ sourceLanguage, targetLanguage }: {
      sourceLanguage: TranslationLanguage
      targetLanguage: TranslationLanguage
    }) => {
      prepareCalls.push(`${sourceLanguage}->${targetLanguage}`)
      return { status: 'installed', ready: true } satisfies AppleLanguageState
    },
  }
}

const notInstalled = fakeApi({ status: 'supported', ready: false })
await ensureAppleLanguagePack(notInstalled, 'en', 'zh-Hans')
assert.deepEqual(notInstalled.statusCalls, ['en->zh-Hans'])
assert.deepEqual(notInstalled.prepareCalls, ['en->zh-Hans'], '未安装语言包要请系统下载')

const installed = fakeApi({ status: 'installed', ready: true })
await ensureAppleLanguagePack(installed, 'en', 'zh-Hans')
assert.deepEqual(installed.prepareCalls, [], '已安装就不该再弹系统下载框')

const unsupported = fakeApi({ status: 'unsupported', ready: false })
await ensureAppleLanguagePack(unsupported, 'en', 'zh-Hans')
assert.deepEqual(unsupported.prepareCalls, [], '系统不支持的语对不要白弹下载框')

console.log('apple-translation: ok')
