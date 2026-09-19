import assert from 'node:assert/strict'

import {
  cleanArticleTitleText,
  feedDisplayTitle,
  isBodyLikeArticleTitle,
  normalizeArticleTitle,
  titleCandidateFromText,
} from '../src/lib/articleTitle'
import { parseSourcePayload } from '../src/lib/parseFeed'
import { findSource } from '../src/sources/registry'

const chineseTitle = '我国第三代核电技术再获关键进展'
assert.equal(normalizeArticleTitle(chineseTitle), chineseTitle)

const englishTitle = 'Researchers build a faster and more efficient underwater robot'
assert.equal(normalizeArticleTitle(englishTitle), englishTitle)

assert.equal(
  cleanArticleTitleText('<b>Science &amp; Future</b>&nbsp;&#x1F680;'),
  'Science & Future 🚀',
  'HTML/entity title should become plain display text',
)

const bodyLike = [
  '这个仿真鱼（其实类别归属上，是一个水下机器人）还挺有意思的，基本上完全模拟一条真鱼的生存状态。',
  '甚至还会扑腾溅水，差点溅了我一身，已经分不清是仿真还是仿生了。',
  '#第23届东博会# #平陆运河# #世纪工程# #中国东盟博览会#',
].join('\n')
assert.equal(isBodyLikeArticleTitle(bodyLike), true)
const bodyCandidate = normalizeArticleTitle(bodyLike)
assert.ok(bodyCandidate.length < bodyLike.length)
assert.ok(!bodyCandidate.includes('#第23届东博会#'))
assert.ok(Array.from(bodyCandidate).length <= 73)

const noPunctuation = '超'.repeat(260)
const noPunctuationCandidate = titleCandidateFromText(noPunctuation)
assert.ok(noPunctuationCandidate.endsWith('…'))
assert.ok(Array.from(noPunctuationCandidate).length <= 73)

const unicode = 'AI\u200B 与机器人 🤖🚀 的新进展'
assert.equal(feedDisplayTitle(unicode), 'AI 与机器人 🤖🚀 的新进展')

const source = findSource('ruanyifeng')
assert.ok(source)
const parsed = parseSourcePayload(
  source,
  JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Fixture',
    items: [
      {
        id: 'missing-title',
        url: 'https://example.com/missing-title',
        content_text:
          '这是正文的第一句话，用来生成缺失标题。这里是第二句话，应该保留在摘要而不是全部塞进标题。'.repeat(4),
      },
    ],
  }),
)
assert.equal(parsed.length, 1, 'missing title should fall back to a bounded body candidate')
assert.ok(parsed[0].title.length > 0)
assert.ok(Array.from(parsed[0].title).length <= 73)
assert.ok(parsed[0].summary.length > parsed[0].title.length)

console.log('article title hygiene: ok')
