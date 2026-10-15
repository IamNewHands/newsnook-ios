import assert from 'node:assert/strict'

import { stripEmbedNoise, stripEmptyArticleBlocks } from '../src/lib/sanitize'

const france24Noise = `
<p>Scientists study Greenland's melting ice with new instruments.</p>
<p>To display this content from YouTube, you must enable advertisement tracking and audience measurement.</p>
<p>One of your browser extensions seems to be blocking the video player from loading. To watch this content, you may need to disable it on this site.</p>
<p>Researchers say the data will help climate models.</p>
`

const cleaned = stripEmbedNoise(france24Noise)
assert.match(cleaned, /Scientists study Greenland/)
assert.match(cleaned, /Researchers say the data/)
assert.doesNotMatch(
  cleaned,
  /advertisement tracking|browser extensions seems to be blocking/i,
  '应去掉 YouTube 同意与广告拦截占位文案',
)

const youtubeConsentNoise = `
<p>Intro paragraph kept.</p>
<section>
  <p>To watch this video, please enable advertisement cookies and tracking for YouTube.</p>
</section>
<aside>
  <p>This content is not available because one of your browser extensions is blocking YouTube.</p>
</aside>
<p>Closing paragraph kept.</p>
`

const cleanedConsent = stripEmbedNoise(youtubeConsentNoise)
assert.match(cleanedConsent, /Intro paragraph kept/)
assert.match(cleanedConsent, /Closing paragraph kept/)
assert.doesNotMatch(
  cleanedConsent,
  /advertisement cookies|blocking YouTube/i,
  '应去掉更宽泛的 YouTube 同意 / 拦截异常文案',
)

assert.equal(
  stripEmbedNoise('<p>正常正文，没有嵌入噪声。</p>'),
  '<p>正常正文，没有嵌入噪声。</p>',
)

const publisherSpacing = `
<p data-check-id="1">第一段正文。</p>
<p data-check-id="2"><br/></p>
<p>&nbsp;</p>
<p data-check-id="3">第二段正文。</p>
<ul></ul>
<p><img src="cover.jpg" alt="封面"></p>
`
const compact = stripEmptyArticleBlocks(publisherSpacing)
assert.doesNotMatch(compact, /<p[^>]*>(?:\s|&nbsp;|<br\s*\/?\s*>)*<\/p>/i)
assert.doesNotMatch(compact, /<ul>\s*<\/ul>/i)
assert.match(compact, /第一段正文/)
assert.match(compact, /第二段正文/)
assert.match(compact, /<img src="cover\.jpg"/)

console.log('embed-noise tests passed')
