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

/**
 * 一次请求翻多段时的段落标记。模型必须原样保留标记，
 * 客户端靠它把译文切回对应段落（见 `parseOpenAiSegmentTranslations`）。
 */
export function openAiSegmentMarker(index: number): string {
  return `[[${index + 1}]]`
}

/**
 * 批量翻译的 system prompt：在单段规则上追加「保序协议」。
 *
 * 为什么需要协议：一次请求塞进整篇能省掉几十次往返（也顺带让译文有全文上下文），
 * 但必须能把返回的一整块文本切回各段落。标记是 ASCII 的 `[[n]]`，
 * 比 JSON/XML 更不容易被模型改写；一旦模型漏写、重排或吞掉标记，
 * 客户端会退回逐段请求，不会把错位的译文塞进正文。
 */
export function openAiTranslationBatchSystemPrompt(
  sourceLanguage: TranslationSourceLanguage,
  targetLanguage: TranslationLanguage,
  model?: string,
): string {
  const base = openAiTranslationSystemPrompt(sourceLanguage, targetLanguage, 'paragraph', model)
  const target = openAiLanguageLabel(targetLanguage)
  const rules = [
    'Batch mode: the user message contains several segments, each introduced by a marker of the form [[1]], [[2]], ....',
    `Translate every segment into ${target} and output each translation preceded by exactly the same marker, kept verbatim, on its own line.`,
    'Never merge, split, reorder, renumber, or skip segments. Never translate, explain, or drop the markers.',
    'Output nothing before the first marker and nothing except the marked translations.',
  ]
  return base ? [base, '', ...rules].join('\n') : rules.join('\n')
}

/** 批量翻译的 user prompt：`原文：` + 每段一行标记一行原文。 */
export function openAiTranslationBatchUserPrompt(texts: readonly string[]): string {
  const segments = texts.map((text, index) => `${openAiSegmentMarker(index)}\n${text}`)
  return `原文：\n\n${segments.join('\n\n')}`
}
