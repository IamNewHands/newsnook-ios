import { Capacitor, registerPlugin } from '@capacitor/core'

import type { TranslationLanguage } from './types'

export interface MlKitModelState {
  ready: boolean
  downloadedLanguages: string[]
}

export interface BergamotModelState {
  ready: boolean
  modelKey?: string
  downloadedModels?: string[]
  engineReady?: boolean
  engineError?: string
}

export interface BergamotEngineState {
  engineReady: boolean
  engineError?: string
}

/** iOS 系统翻译的语对状态：已装语言包 / 系统支持但未下载 / 系统不支持。 */
export type AppleLanguageStatus = 'installed' | 'supported' | 'unsupported'

export interface AppleLanguageState {
  status: AppleLanguageStatus
  ready: boolean
}

export interface AppleTranslationApi {
  getLanguageStatus(options: {
    sourceLanguage: TranslationLanguage
    targetLanguage: TranslationLanguage
  }): Promise<AppleLanguageState>
  prepareLanguagePack(options: {
    sourceLanguage: TranslationLanguage
    targetLanguage: TranslationLanguage
  }): Promise<AppleLanguageState>
  translate(options: {
    texts: string[]
    sourceLanguage: TranslationLanguage
    targetLanguage: TranslationLanguage
  }): Promise<{ translations: string[] }>
}

export const AppleTranslation = registerPlugin<AppleTranslationApi>('AppleTranslation')

interface MlKitTranslationPlugin {
  getModelState(options: {
    sourceLanguage: TranslationLanguage
    targetLanguage: TranslationLanguage
  }): Promise<MlKitModelState>
  downloadModel(options: {
    sourceLanguage: TranslationLanguage
    targetLanguage: TranslationLanguage
    wifiOnly: boolean
  }): Promise<MlKitModelState>
  deleteModel(options: {
    sourceLanguage: TranslationLanguage
    targetLanguage: TranslationLanguage
  }): Promise<MlKitModelState>
  translate(options: {
    texts: string[]
    sourceLanguage: TranslationLanguage
    targetLanguage: TranslationLanguage
  }): Promise<{ translations: string[] }>
}

export const MlKitTranslation = registerPlugin<MlKitTranslationPlugin>('MlKitTranslation')

interface BergamotTranslationPlugin {
  getEngineState(): Promise<BergamotEngineState>
  getModelState(options: {
    sourceLanguage: TranslationLanguage
    targetLanguage: TranslationLanguage
  }): Promise<BergamotModelState>
  downloadModel(options: {
    sourceLanguage: TranslationLanguage
    targetLanguage: TranslationLanguage
    wifiOnly: boolean
  }): Promise<BergamotModelState>
  deleteModel(options: {
    sourceLanguage: TranslationLanguage
    targetLanguage: TranslationLanguage
  }): Promise<BergamotModelState>
  translate(options: {
    texts: string[]
    sourceLanguage: TranslationLanguage
    targetLanguage: TranslationLanguage
  }): Promise<{ translations: string[] }>
}

export const BergamotTranslation =
  registerPlugin<BergamotTranslationPlugin>('BergamotTranslation')

/** 由 Android flavor 决定；cloud 包里插件类与 ML Kit 依赖都不存在。 */
export function isLocalTranslationAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('MlKitTranslation')
}

/** 由 Android local flavor 决定；cloud 包里插件类与原生运行时都不存在。 */
export function isBergamotTranslationAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BergamotTranslation')
}

/**
 * iOS 18 起系统才提供 Translation 框架。原生插件类带 `@available(iOS 18.0, *)`，
 * 低版本系统上根本不会被注册，所以这里的探测结果就是设备的真实能力，
 * 不需要另外猜系统版本。
 */
export function isAppleTranslationAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AppleTranslation')
}
