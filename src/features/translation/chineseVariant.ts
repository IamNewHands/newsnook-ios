import { Converter as fromSimplified } from 'opencc-js/cn2t'
import { Converter as fromTraditional } from 'opencc-js/t2cn'

import type { TranslationLanguage } from './types'

const toSimplified = fromTraditional({ from: 'tw', to: 'cn' })
const toTraditional = fromSimplified({ from: 'cn', to: 'tw' })

/** 目标为简/繁中文时，将译文规范到对应字形（覆盖 ML Kit 等同码导致不转换的情况）。 */
export function normalizeChineseVariant(
  text: string,
  targetLanguage: TranslationLanguage,
): string {
  if (targetLanguage === 'zh-Hans') return toSimplified(text)
  if (targetLanguage === 'zh-Hant') return toTraditional(text)
  return text
}

// Keep the existing public API while sharing the cheap, exact per-character detector.
export { classifyChineseVariant } from './chineseVariantMarks'
