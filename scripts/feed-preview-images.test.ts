import assert from 'node:assert/strict'
import { it } from 'node:test'
import { parseSourcePayload } from '../src/lib/parseFeed'
import type { NewsSource } from '../src/sources/registry'

const source: NewsSource = { id: 'test', name: 'Test', label: 'Test', group: 'custom', kind: 'feed', url: 'https://example.org/rss', enabled: true }
const parse = (media: string, body = '') => parseSourcePayload(source, `<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>News</title><link>https://example.org/news</link>${media}<description><![CDATA[${body}]]></description></item></channel></rss>`)[0]

assert.equal(parse('<media:group><media:content url="https://example.org/video.mp4" type="video/mp4"/><media:thumbnail url="https://example.org/photo.jpg"/></media:group>')?.image, 'https://example.org/photo.jpg', 'nested Media RSS thumbnail must reach the news card')
assert.equal(parse('<media:content url="https://example.org/video.mp4" type="video/mp4"/><media:content url="https://example.org/photo.jpg" type="image/jpeg"/>')?.image, 'https://example.org/photo.jpg', 'video URL must not be selected as a cover')
assert.equal(parse('', '<img src="data:image/gif;base64,R0lG" data-src="https://example.org/photo.jpg">')?.image, 'https://example.org/photo.jpg', 'lazy body image must replace the tracking placeholder')
assert.equal(parse('<enclosure url="https://example.org/document.pdf" type="application/pdf"/>')?.image, undefined, 'non-image attachment must not create an empty preview')
assert.equal(parse('', '<p>Text only</p>')?.image, undefined)
console.log('feed-preview-images: ok')

for (const name of ['data-actualsrc', 'data-url', 'data-preview']) {
  it(`extracts the same lazy ${name} image as the reader`, () => {
    assert.equal(parse('', `<img ${name}="/photo.jpg">`)?.image, 'https://example.org/photo.jpg')
  })
}

it('skips HTTP placeholders and badges before a deeply nested content image', () => {
  const body = '<img src="/placeholder.png"><img width="1" height="1" src="/track.gif"><img src="/avatar/user.jpg">' +
    '<section>'.repeat(25) + '<img src="/photo.jpg">' + '</section>'.repeat(25)
  assert.equal(parse('', body)?.image, 'https://example.org/photo.jpg')
})

it('checks description images even when content:encoded contains only text', () => {
  const article = parse('<content:encoded><![CDATA[<p>Full text without pictures</p>]]></content:encoded>', '<img src="/photo.jpg">')
  assert.equal(article?.image, 'https://example.org/photo.jpg')
  assert.equal(article?.contentHtml, '<p>Full text without pictures</p>', 'image fallback must not replace the chosen body')
})

it('extracts Atom image enclosures', () => {
  const article = parseSourcePayload(source, '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>News</title><link href="https://example.org/news"/><link rel="enclosure" type="image/jpeg" href="/photo.jpg"/></entry></feed>')[0]
  assert.equal(article?.image, 'https://example.org/photo.jpg')
})

it('preserves nested Atom XHTML content and its images', () => {
  const article = parseSourcePayload(source, '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>News</title><link href="https://example.org/news"/><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><section><p>Body text</p><img src="/photo.jpg"/></section></div></content></entry></feed>')[0]
  assert.equal(article?.image, 'https://example.org/photo.jpg')
  assert.match(article?.contentHtml ?? '', /Body text/)
})

it('preserves Atom XHTML mixed text and the order of paragraphs and images', () => {
  const article = parseSourcePayload(source, '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>News</title><link href="https://example.org/news"/><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">Start <p>First <b>bold</b> tail</p><img src="/photo.jpg"/><p>Second</p> End</div></content></entry></feed>')[0]
  assert.match(article?.contentHtml ?? '', /Start <p>First <b>bold<\/b> tail<\/p><img[^>]+>(?:<\/img>)?<p>Second<\/p> End/)
})

it('accepts text thumbnail fields used by the Huxiu RSS fixture', () => {
  assert.equal(parse('<thumbnail>https://example.org/photo.jpg</thumbnail>')?.image, 'https://example.org/photo.jpg')
})

it('extracts encoded lazy image URLs supported by the reader', () => {
  const advance = btoa(JSON.stringify([{ Url: 'https://example.org/photo.jpg' }]))
  assert.equal(parse('', `<img data-advance="${advance}">`)?.image, 'https://example.org/photo.jpg')
})

it('falls back to a body image when a JSON Feed image is a placeholder', () => {
  const article = parseSourcePayload(source, JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', items: [{ title: 'News', url: 'https://example.org/news', image: 'data:image/gif;base64,R0lG', content_html: '<img src="/photo.jpg">' }] }))[0]
  assert.equal(article?.image, 'https://example.org/photo.jpg')
})
