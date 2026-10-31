import type { TranslationLanguage } from './types'
import { classifyChineseVariant } from './chineseVariantMarks'

export type DetectLanguageResult = {
  language: TranslationLanguage
  /** true 表示置信不足或不在支持列表，已回退 */
  usedFallback: boolean
}

const MIN_SCRIPT_CHARS = 12

const FR_MARKERS = [
  ' le ',
  ' la ',
  ' les ',
  ' des ',
  ' une ',
  ' est ',
  ' dans ',
  ' pour ',
  ' avec ',
  ' que ',
]
const DE_MARKERS = [
  ' der ',
  ' die ',
  ' das ',
  ' und ',
  ' ist ',
  ' nicht ',
  ' ein ',
  ' eine ',
  ' auf ',
  ' für ',
]
const ES_MARKERS = [
  ' el ',
  ' la ',
  ' los ',
  ' las ',
  ' una ',
  ' que ',
  ' del ',
  ' por ',
  ' para ',
  ' con ',
]

function countMarkers(padded: string, markers: string[]): number {
  return markers.reduce((sum, marker) => sum + (padded.includes(marker) ? 1 : 0), 0)
}

/**
 * 轻量原文语言启发式：覆盖应用支持的语种，不引入第三方检测库。
 * 样本过短或置信不足时回退英语并标记 usedFallback。
 */
export function detectLanguage(sample: string): DetectLanguageResult {
  const text = sample.normalize('NFKC')
  let han = 0
  let kana = 0
  let hangul = 0
  let latin = 0

  for (const char of text) {
    if (/[\u3040-\u30ff]/.test(char)) kana += 1
    else if (/[\uac00-\ud7af]/.test(char)) hangul += 1
    else if (/\p{Script=Han}/u.test(char)) han += 1
    else if (/[A-Za-zÀ-ÿ]/.test(char)) latin += 1
  }

  const scriptTotal = han + kana + hangul + latin
  if (scriptTotal < MIN_SCRIPT_CHARS) {
    return { language: 'en', usedFallback: true }
  }

  if (kana >= 3 && kana >= Math.max(2, han * 0.08)) {
    return { language: 'ja', usedFallback: false }
  }
  if (hangul >= 8 || hangul / scriptTotal >= 0.15) {
    return { language: 'ko', usedFallback: false }
  }
  if (han >= 8 || han / scriptTotal >= 0.2) {
    return { language: classifyChineseVariant(text), usedFallback: false }
  }
  if (latin / scriptTotal < 0.45) {
    return { language: 'en', usedFallback: true }
  }

  const padded = ` ${text.toLowerCase().replace(/[^a-zà-ÿ\s]/g, ' ').replace(/\s+/g, ' ')} `
  const fr = countMarkers(padded, FR_MARKERS)
  const de = countMarkers(padded, DE_MARKERS)
  const es = countMarkers(padded, ES_MARKERS)
  const best = Math.max(fr, de, es)
  if (best >= 3) {
    if (fr === best) return { language: 'fr', usedFallback: false }
    if (de === best) return { language: 'de', usedFallback: false }
    return { language: 'es', usedFallback: false }
  }

  return { language: 'en', usedFallback: false }
}

/** 从标题与 HTML 抽一段纯文本供检测。 */
export function sampleTextForDetection(title: string, html: string, maxChars = 3000): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const combined = `${title.trim()} ${stripped}`.trim()
  return combined.slice(0, maxChars)
}
