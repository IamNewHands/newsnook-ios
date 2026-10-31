import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { stripTags } from '../src/lib/htmlText'

import { parseGenericFeed } from '../src/lib/parseFeed/generic'
import { resolveArticleBody } from '../src/lib/resolveBody'
import { recoverFeedContent } from '../src/lib/resolveBody/feedContent'
import { normalizeFeedLayout } from '../src/lib/resolveBody/feedLayout'
import { classifyFeedBody, FEED_EXCERPT_RECHECK_MS, isExcerptUpgrade, isLegacyLooseFeedBody, isPreferredFeedBody, shouldRecheckCachedExcerpt, shouldReplaceCachedBody } from '../src/lib/feedBodyEvidence'
import { shouldRenderStandaloneCover } from '../src/lib/articlePreview'
import type { NewsSource } from '../src/sources/registry'

const source: NewsSource = {
  id: 'custom_rss_general', name: '短内容混合订阅', label: '短文', group: 'custom',
  kind: 'feed', isCustom: true, enabled: true, url: 'https://feeds.example.org/updates.rss',
}
// The first two items reproduce the original two real-world syndication
// fragments. The third deliberately uses a different site/provider.
const cases = [
  {
    url: 'https://m.okjike.com/originalPosts/6ad053b00038b7cd5e9d027a',
    text: '但是也有论文为证，有篇论文叫 Panic Season（《恐慌季》），说美国历史上股崩往往集中在 8~10 月，比如 1857 年、1873 年、1907 年，以及 1929。',
    img: 'https://cdnv2.ruguoapp.com/FrPY2qfDR79ADjUNQKLc-IwbXFpIv3.png?imageMogr2/auto-orient',
  },
  {
    url: 'https://m.okjike.com/originalPosts/6acba4abcfb5d08b3e5cbe0a',
    text: '这张图可以起个名字叫《高敏感人格存在之意义》：人类进化全凭“想多了”和不停的内耗。',
    img: 'https://cdnv2.ruguoapp.com/FhDlM2FTDubT0qb5xO0S3kpSHzr_v3.heic?imageMogr2/format/jpeg',
  },
  {
    url: 'https://community.example.com/discussions/348',
    text: '这是一条来自完全不同网站的短内容，通过标准 RSS 提供自己的文本和配图。',
    img: 'https://community.example.com/images/348.png',
  },
] as const
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>短内容</title>${cases.map((v, i) =>
  `<item><title>内容 ${i}</title><link>${v.url}</link><description><![CDATA[${v.text}<br><br><br><img src="${v.img}" referrerpolicy="no-referrer">]]></description></item>`,
).join('')}</channel></rss>`
const posts = parseGenericFeed(source, rss, Date.now())
assert.equal(posts.length, 3)
for (const [index, article] of posts.entries()) {
  assert.equal(article.feedBodyEvidence, 'structured', 'short text + editorial breaks is a body regardless of provider')
  const normalized = await resolveArticleBody(article, undefined, [source])
  assert.equal(normalized.bodySource, 'feed', 'a complete feed body must win over a potentially blocked publisher page')
  const { document } = parseHTML(`<html><body><div id="target">${normalized.contentHtml}</div></body></html>`)
  const root = document.getElementById('target')!
  assert.equal(root.children.length, 2)
  assert.equal(root.firstElementChild?.tagName, 'P')
  assert.equal(root.lastElementChild?.tagName, 'FIGURE')
  assert.ok(root.querySelector('p')?.textContent?.includes(cases[index].text))
  assert.equal(root.querySelectorAll('img').length, 1)
  assert.equal(shouldRenderStandaloneCover(article.image, normalized.contentHtml, article.originUrl), false)
  assert.doesNotMatch(normalized.contentHtml, /付费墙|原站正文暂不可读取/)
}

// A compact list stores evidence, not the large HTML body; on reopening a
// matching item can be recovered from the same source's current syndication.
let calls = 0
const compact = { ...posts[1], contentHtml: undefined }
const recovered = await recoverFeedContent(compact, source, undefined, async () => {
  calls++
  return rss
})
assert.equal(calls, 1)
assert.equal(recovered.contentHtml, posts[1].contentHtml)
assert.equal(recovered.feedBodyEvidence, 'structured')
assert.equal(await resolveArticleBody(recovered, undefined, [source]).then((v) => v.bodySource), 'feed')
const absent = await recoverFeedContent({ ...compact, id: 'old-post' }, source, undefined, async () => rss)
assert.equal(absent.contentHtml, undefined, 'do not silently use another post when a historical entry falls out of the feed')
assert.equal((await recoverFeedContent({ ...compact, feedBodyEvidence: 'unknown' }, source, undefined, async () => rss)).contentHtml, posts[1].contentHtml, 'old/unknown list metadata can recover from an available feed')
const aborted = new AbortController()
aborted.abort()
await assert.rejects(recoverFeedContent(compact, source, aborted.signal, async () => rss), /Abort|aborted/i)

// Both explicit RSS full content and JSON/Atom standard content fields are
// sufficient evidence independently of body length or the publisher hostname.
const encodedXml = `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>短文章</title><link>https://writer.example.net/posts/1</link><description>简短摘要</description><content:encoded><![CDATA[<p>完整短文章：已经写完。</p>]]></content:encoded></item></channel></rss>`
const encoded = parseGenericFeed(source, encodedXml, Date.now())[0]
assert.equal(encoded.feedBodyEvidence, 'declared')
assert.equal((await resolveArticleBody(encoded, undefined, [source])).bodySource, 'feed')
const jsonFeed = JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', items: [
  { id: 'p2', url: 'https://blog.example.org/notes/2', title: '短文', content_html: '<p>很短，但已写完。</p>' },
] })
const jsonArticle = parseGenericFeed(source, jsonFeed, Date.now())[0]
assert.equal(jsonArticle.feedBodyEvidence, 'declared')
assert.equal((await resolveArticleBody(jsonArticle, undefined, [source])).bodySource, 'feed')
const plainRss = parseGenericFeed(source, `<rss><channel><item><title>纯文字</title><link>https://notes.example.org/plain</link><description><![CDATA[第一段包含特殊符号：2 < 3。\n\n第二段仍保持换行。]]></description></item></channel></rss>`, Date.now())[0]
assert.equal(plainRss.feedBodyEvidence, 'unknown', 'plain RSS description cannot prove full text')
assert.match(plainRss.contentHtml ?? '', /<p>第一段/)
assert.match(plainRss.contentHtml ?? '', /&lt;/, 'plain RSS text is escaped before HTML rendering')
assert.match(plainRss.contentHtml ?? '', /<p>第二段/)
const plainJson = JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', items: [
  { id: 'plain', title: '纯文本 JSON', url: 'https://notes.example.org/plain-json', content_text: 'A < B & C\n\nD is safe.' },
] })
const plainJsonEntry = parseGenericFeed(source, plainJson, Date.now())[0]
assert.equal(plainJsonEntry.feedBodyEvidence, 'declared')
const jsonResolved = await resolveArticleBody(plainJsonEntry, undefined, [source])
assert.equal(jsonResolved.bodySource, 'feed')
assert.match(jsonResolved.contentHtml, /A &lt; B &amp; C/)
const plainMarkupJson = JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', items: [
  { id: 'literal', title: '文字非 HTML', url: 'https://notes.example.org/plain-markup', content_text: '字面 <img src="https://example.org/bad.jpg"> 不得变成图片' },
] })
const literalText = parseGenericFeed(source, plainMarkupJson, Date.now())[0]
assert.match(literalText.contentHtml ?? '', /&lt;img/)
assert.equal((await resolveArticleBody(literalText, undefined, [source])).contentHtml.includes('<img'), false)
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>纯短内容</title><link href="https://notes.example.org/1"/><content type="html"><![CDATA[<p>完整的 Atom 短内容。</p>]]></content></entry></feed>`
const atomArticle = parseGenericFeed(source, atom, Date.now())[0]
assert.equal(atomArticle.feedBodyEvidence, 'declared')
assert.equal((await resolveArticleBody(atomArticle, undefined, [source])).bodySource, 'feed')

const teaserText = 'Research found that selected companies rely on low-latency systems. '.repeat(14)
const teaser = `<p>${teaserText}</p><p><a href="https://news.example.org/full">Read the full article</a></p>`
assert.equal(classifyFeedBody(teaser, 'content'), 'teaser', 'even declared content with a CTA is not sufficient proof of full text')
assert.equal(classifyFeedBody('<p>Summary</p><img src="https://example.org/thumb.jpg">', 'description'), 'unknown', 'a thumbnail does not prove the article is complete')
assert.equal(classifyFeedBody('段落一<br><br>段落二但尚未证明完整', 'description'), 'unknown', 'line breaks alone cannot certify a description as full')
assert.equal(classifyFeedBody('<p>Excerpt...</p>', 'description'), 'teaser')
const teaserArticle = parseGenericFeed(source, `<rss><channel><item><title>长新闻</title><link>https://news.example.org/1</link><description><![CDATA[${teaser}]]></description></item></channel></rss>`, Date.now())[0]
assert.equal(teaserArticle.feedBodyEvidence, 'teaser')
assert.equal(isPreferredFeedBody(teaserArticle.feedBodyEvidence), false)
assert.equal(shouldReplaceCachedBody(teaserArticle, { html: '<p>Publisher article.</p>', bodySource: 'readability' }), false)
assert.equal(shouldReplaceCachedBody(posts[0], { html: '<p>Broken publisher text.</p>', bodySource: 'readability' }), true)
assert.equal(shouldReplaceCachedBody(posts[0], { html: posts[0].contentHtml!, bodySource: 'feed' }), true)
assert.equal(shouldReplaceCachedBody(posts[0], { html: '<p>Correctly formatted.</p>', bodySource: 'feed' }), false)
assert.equal(isLegacyLooseFeedBody(posts[0].contentHtml!), true)

const multi = normalizeFeedLayout('首行文字<br>第二行保留换行<br><br>新的段落<br><br><img src="https://example.org/a.png"><br><br><img src="https://example.org/b.png">')
const { document } = parseHTML(`<html><body><div id="multi">${multi}</div></body></html>`)
const root = document.getElementById('multi')!
assert.equal(root.querySelectorAll('p').length, 2)
assert.equal(root.querySelectorAll('br').length, 1)
assert.equal(root.querySelectorAll('figure').length, 2)
assert.equal(root.querySelectorAll('img').length, 2)
const emojiMarkup = normalizeFeedLayout('第一个字<img src="https://cdn.example.org/emoji.png" width="24" height="24">后一个字<br><br><img src="https://cdn.example.org/wide.jpg" width="900">')
const { document: emojiDocument } = parseHTML(`<div id="emoji">${emojiMarkup}</div>`)
const emojiRoot = emojiDocument.getElementById('emoji')!
assert.equal(emojiRoot.querySelectorAll('figure').length, 1, 'small inline icons must not become standalone figures')
assert.ok(emojiRoot.firstElementChild?.querySelector('img[width="24"]'), 'small inline emoji remains in text flow')
assert.ok(emojiRoot.lastElementChild?.querySelector('img[width="900"]'), 'large editorial image keeps its own block')
const structuredHtml = '<p><strong>Strong</strong> <a href="https://example.org">link</a></p><blockquote><p>Quote</p></blockquote><ul><li>List</li></ul>'
assert.equal(normalizeFeedLayout(structuredHtml), structuredHtml, 'already structured editorial HTML remains intact')
const unsafePost = { ...posts[0], contentHtml: '<script>alert(1)</script>短文<br><br><img src="https://example.org/photo.png" onerror="alert(1)">' }
const safe = await resolveArticleBody(unsafePost, undefined, [source])
assert.doesNotMatch(safe.contentHtml, /<script\b|onerror=|javascript:/i, 'normalization must not bypass the normal sanitization pipeline')

// An ordinary RSS description is not evidence of completeness: when the
// publisher provides an actual long article, Readability remains authoritative.
const originalFetch = globalThis.fetch
try {
  const articleText = '<p>' + '完整新闻正文包含新信息、背景与数据，且由原站按标准段落完整呈现。'.repeat(25) + '</p>'
  const publisherHtml = `<html><head><title>真实长文章</title></head><body><main><article><h1>真实长文章</h1>${articleText}${articleText}${articleText}</article></main></body></html>`
  globalThis.fetch = async () => new Response(publisherHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  const news = parseGenericFeed(source, `<rss><channel><item><title>真实长文章</title><link>https://news.example.org/article/full</link><description><![CDATA[<p>这段摘要只展示最主要的背景，不代表文章已经完整。</p><img src="https://news.example.org/cover.png">]]></description></item></channel></rss>`, Date.now())[0]
  assert.equal(news.feedBodyEvidence, 'unknown')
  const extracted = await resolveArticleBody(news, undefined, [source])
  assert.equal(extracted.bodySource, 'readability', 'a mere description must never override successful publisher extraction')
  assert.ok(extracted.contentHtml.includes('完整新闻正文包含新信息'))
} finally {
  globalThis.fetch = originalFetch
}

// If publisher extraction fails for an ambiguous source description, keep the
// available body rather than announcing a paywall that was never established.
try {
  globalThis.fetch = async () => new Response('not allowed', { status: 403 })
  const ambiguous = parseGenericFeed(source, `<rss><channel><item><title>标题</title><link>https://news.example.org/article/unknown</link><description><![CDATA[<p>这是一条尚不能确定是否为全文的新闻摘要，可以保留内容但不能标成全文。</p><img src="https://news.example.org/photo.png">]]></description></item></channel></rss>`, Date.now())[0]
  assert.equal(ambiguous.feedBodyEvidence, 'unknown')
  const result = await resolveArticleBody(ambiguous, undefined, [source])
  assert.equal(result.bodySource, 'feed-excerpt', 'unconfirmed feed text survives publisher errors with an honest excerpt label')
  assert.ok(result.contentHtml.includes('不能标成全文'))
  const blockedTeaser = await resolveArticleBody(teaserArticle, undefined, [source])
  assert.equal(blockedTeaser.bodySource, 'blocked', 'explicit read-full-article teasers are not misrepresented as full feed bodies')
  assert.doesNotMatch(blockedTeaser.contentHtml, /付费墙/, 'generic HTTP failures are not proof of a paywall')
} finally {
  globalThis.fetch = originalFetch
}

// Regression audit: a 1,500-char RSS description ending in ellipsis must
// never beat a publisher article just because it exceeds the old threshold.
const longDescription = `<p>${'This is only an excerpt despite looking detailed. '.repeat(32)}...</p>`
const longTeaser = parseGenericFeed(source, `<rss><channel><item><title>Long preview</title><link>https://news.example.net/preview</link><description><![CDATA[${longDescription}]]></description></item></channel></rss>`, Date.now())[0]
assert.equal(longTeaser.feedBodyEvidence, 'teaser')
{
  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response('rejected', { status: 403 })
    const actual = await resolveArticleBody(longTeaser, undefined, [source])
    assert.notEqual(actual.bodySource, 'feed', 'an explicit long teaser is not a complete feed article')
  } finally {
    globalThis.fetch = oldFetch
  }
}
// A short image-bearing description is weaker than a proven 3,000-char
// Readability result already held in the device body cache.
const previouslyRead = { html: '<p>' + 'Verified original publisher text. '.repeat(110) + '</p>', bodySource: 'readability' }
assert.equal(shouldReplaceCachedBody(posts[0], previouslyRead), false,
  'refresh must not discard a longer publisher article merely because a feed has a thumbnail')
const sourceText = stripTags(posts[0].contentHtml ?? '')
const fragmentedArticle = {
  html: [...sourceText].reduce<string[]>((rows, ch, i) => {
    if (i % 6 === 0) rows.push('')
    rows[rows.length - 1] += ch
    return rows
  }, []).map((line) => `<p>${line}</p>`).join('') + '<p>Additional unrelated UI fragment</p>',
  bodySource: 'readability',
}
assert.equal(shouldReplaceCachedBody(posts[0], fragmentedArticle), true,
  'obviously fragmented Readability paragraphs are repaired by clean syndicated markup')
assert.equal(shouldReplaceCachedBody(posts[0], { html: fragmentedArticle.html.replace(sourceText.slice(0, 6), 'other text'), bodySource: 'readability' }), false,
  'unrelated fragmented documents cannot be replaced by a shorter syndication snippet')

// Cached tentative excerpts are readable offline, refreshed after a bounded
// interval, and force-refreshable upon network reconnection.
const currentTime = 1800000000000
assert.equal(shouldRecheckCachedExcerpt('feed', currentTime - 4 * FEED_EXCERPT_RECHECK_MS, currentTime), false)
assert.equal(shouldRecheckCachedExcerpt('feed-excerpt', currentTime, currentTime), false)
assert.equal(shouldRecheckCachedExcerpt('feed-excerpt', currentTime - FEED_EXCERPT_RECHECK_MS - 1, currentTime), true)
assert.equal(shouldRecheckCachedExcerpt('feed-excerpt', currentTime, currentTime, true), true)
assert.equal(isExcerptUpgrade('<p>Existing excerpt text</p>', { contentHtml: '<p>Short</p>', bodySource: 'readability' }), false)
assert.equal(isExcerptUpgrade('<p>Existing excerpt text</p>', { contentHtml: '<p>' + 'Full publisher text '.repeat(45) + '</p>', bodySource: 'readability' }), true)
assert.equal(isExcerptUpgrade('<p>Existing excerpt text</p>', { contentHtml: '<p>Existing excerpt text</p>', bodySource: 'feed-excerpt' }), false)

console.log('feed-body general completeness and layout: ok')
