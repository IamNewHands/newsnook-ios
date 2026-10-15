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
