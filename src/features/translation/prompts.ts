import type {
  TranslationLanguage,
  TranslationSourceLanguage,
  TranslationTextKind,
} from './types'

/** English labels for the English system prompt (target language is injected, not assumed). */
const LANGUAGE_LABELS: Record<TranslationLanguage, string> = {
  en: 'English',
  'zh-Hans': 'Simplified Chinese',
  'zh-Hant': 'Traditional Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
}

/** Hunyuan-MT official templates use Chinese language names for zh targets. */
const HUNYUAN_ZH_LABELS: Record<TranslationLanguage, string> = {
  en: '英语',
  'zh-Hans': '中文',
  'zh-Hant': '繁体中文',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
}

export function openAiLanguageLabel(code: TranslationLanguage): string {
  return LANGUAGE_LABELS[code]
}

/** Dedicated Hunyuan MT models leak chat-template tokens if given a generic system+XML prompt. */
export function isHunyuanTranslationModel(model: string | undefined): boolean {
  if (!model) return false
  return /hy[\s._-]*mt|hunyuan[\s._-]*(?:mt|translation)/i.test(model)
}

/**
 * Shared system prompt for feed headlines and article body.
 * Hunyuan-MT official docs: do not send a system prompt.
 */
export function openAiTranslationSystemPrompt(
  _sourceLanguage: TranslationSourceLanguage,
  targetLanguage: TranslationLanguage,
  _kind: TranslationTextKind = 'paragraph',
  model?: string,
): string {
  if (isHunyuanTranslationModel(model)) return ''
  const target = openAiLanguageLabel(targetLanguage)
  return [
    `You are a senior professional translation expert. Your task is to accurately translate any source text provided by the user into ${target}.`,
    '',
    'Please strictly adhere to the following principles during translation:',
    '1. Context & Domain Adaptation: Deeply analyze the context, domain, and professional background of the source text to select the most appropriate vocabulary and expressions, ensuring professionalism and accuracy.',
    '2. Tone & Style Fidelity: Accurately capture the tone (e.g., formal, informal, humorous, serious) and writing style of the original text, and replicate them equivalently in the translation.',
    '3. Native Idiomaticity: The translation must perfectly conform to the natural idiomatic habits of native speakers of the target language. Avoid rigid word-for-word translation and "machine translation feel," ensuring the text is authentic and fluent.',
    '4. Neutral & Objective Stance: Maintain the professional objectivity of a translator. Faithfully convey the original information without inserting personal opinions, subjective evaluations, or bias.',
    '',
    'Output Requirement:',
    'Output the translation directly without any explanations, notes, or process descriptions.',
    'Do not wrap the translation in XML or HTML tags. Do not copy source wrapper tags. Do not emit special tokens or leftover markup such as </target_text>, </center>, or <|...|>.',
  ].join('\n')
}

export function openAiTranslationUserPrompt(
  text: string,
  targetLanguage: TranslationLanguage,
  _kind: TranslationTextKind = 'paragraph',
  model?: string,
): string {
  if (isHunyuanTranslationModel(model)) {
    const isChinese = targetLanguage === 'zh-Hans' || targetLanguage === 'zh-Hant'
    if (isChinese) {
      return `将以下文本翻译为${HUNYUAN_ZH_LABELS[targetLanguage]}，注意只需要输出翻译后的结果，不要额外解释：\n\n${text}`
    }
    return `Translate the following segment into ${LANGUAGE_LABELS[targetLanguage]}, without additional explanation.\n\n${text}`
  }
  return `原文：\n${text}`
}
