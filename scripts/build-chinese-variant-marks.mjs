#!/usr/bin/env node
/** Extract the exact single-Han-character conversion classification from OpenCC.
 * Runs only during development. The full phrase dictionaries remain lazy-loaded
 * by translation and never enter the cold home-screen dependency graph.
 */
import { Converter as fromSimplified } from 'opencc-js/cn2t'
import { Converter as fromTraditional } from 'opencc-js/t2cn'
import { writeFileSync } from 'node:fs'

const toSimplified = fromTraditional({ from: 'tw', to: 'cn' })
const toTraditional = fromSimplified({ from: 'cn', to: 'tw' })
const han = /\p{Script=Han}/u
let traditionalMarks = ''
let simplifiedMarks = ''
// Enumerate all scalar values because Script=Han includes supplementary CJK.
for (let point = 0; point <= 0x10ffff; point++) {
  const char = String.fromCodePoint(point)
  if (!han.test(char)) continue
  if (toSimplified(char) !== char) traditionalMarks += char
  if (toTraditional(char) !== char) simplifiedMarks += char
}
const output = `/** Generated from opencc-js single-character mappings.\n * Regenerate with: node scripts/build-chinese-variant-marks.mjs\n * Only for language classification; full OpenCC phrase conversion stays lazy.\n */\nconst traditionalMarks = new Set(${JSON.stringify(traditionalMarks)})\nconst simplifiedMarks = new Set(${JSON.stringify(simplifiedMarks)})\n\n/** Equivalent to OpenCC per-character variant counting, without eagerly loading its large dictionaries. */\nexport function classifyChineseVariant(sample: string): 'zh-Hans' | 'zh-Hant' {\n  let traditional = 0\n  let simplified = 0\n  for (const char of sample) {\n    if (!/\\p{Script=Han}/u.test(char)) continue\n    if (traditionalMarks.has(char)) traditional += 1\n    if (simplifiedMarks.has(char)) simplified += 1\n  }\n  if (traditional >= 2 && traditional > simplified) return 'zh-Hant'\n  if (traditional > 0 && simplified === 0) return 'zh-Hant'\n  return 'zh-Hans'\n}\n`
writeFileSync('src/features/translation/chineseVariantMarks.ts', output)
console.log('Generated Chinese-variant marks:', traditionalMarks.length, 'traditional characters,', simplifiedMarks.length, 'simplified characters; size:', Buffer.byteLength(output))
