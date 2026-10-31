import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Converter as fromSimplified } from 'opencc-js/cn2t'
import { Converter as fromTraditional } from 'opencc-js/t2cn'
import { classifyChineseVariant } from '../src/features/translation/chineseVariantMarks'
import { detectLanguage } from '../src/features/translation/detectLanguage'

const toSimplified = fromTraditional({ from: 'tw', to: 'cn' })
const toTraditional = fromSimplified({ from: 'cn', to: 'tw' })
const reference = (sample: string): 'zh-Hans' | 'zh-Hant' => {
  let traditional = 0
  let simplified = 0
  for (const char of sample) {
    if (!/\p{Script=Han}/u.test(char)) continue
    if (toSimplified(char) !== char) traditional += 1
    if (toTraditional(char) !== char) simplified += 1
  }
  if (traditional >= 2 && traditional > simplified) return 'zh-Hant'
  if (traditional > 0 && simplified === 0) return 'zh-Hant'
  return 'zh-Hans'
}
const samples = [
  '', 'OpenAI GPT-6', '中华人民共和国', '中華人民共和國', '软件开发', '軟體開發',
  '國際財經新聞', '国际财经新闻', '網絡閱讀', '网络阅读', '香港經濟分析', '新聞網站',
  '測試繁體混用数字簡化字', '簡體字 mixed Traditional 新聞', '𠀀𠀁𠀂𪚥㐷',
  '今天的科技新闻讲解', '從技術到工程的迭代改進', '林臺灣網絡資訊',
]
let seed = 0x1234abcdef
for (let i = 0; i < 250; i++) {
  let sample = ''
  for (let j = 0; j < 60; j++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const point = i % 2 ? 0x3400 + (seed % 0x6b00) : 0x20000 + (seed % 0xfa00)
    sample += String.fromCodePoint(point)
  }
  samples.push(sample)
}
for (const sample of samples) {
  assert.equal(classifyChineseVariant(sample), reference(sample), `variant mismatch on ${sample}`)
}
for (const sample of samples.filter(x => x.length >= 12)) {
  if (/^[\p{Script=Han}]+$/u.test(sample)) {
    assert.equal(detectLanguage(sample).language, reference(sample))
  }
}
const detector = readFileSync('src/features/translation/detectLanguage.ts', 'utf8')
const feed = readFileSync('src/features/translation/useFeedTranslation.ts', 'utf8')
assert.doesNotMatch(detector, /from ['"]\.\/chineseVariant['"]/, 'Language detection must not import full OpenCC at startup')
assert.doesNotMatch(feed, /^import \{ normalizeChineseVariant \} from ['"]\.\/chineseVariant['"]/m)
assert.match(feed, /import\(['"]\.\/chineseVariant['"]\)/)
console.log('Lightweight Chinese variant classifier matches OpenCC and stays outside startup dictionaries')
