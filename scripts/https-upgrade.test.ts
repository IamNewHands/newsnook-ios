import assert from 'node:assert/strict'

import {
  googleTranslateProxyUrl,
  httpsUpgradeCandidates,
  requestUrlCandidates,
  resolveRedirectUrl,
} from '../src/lib/http'

assert.deepEqual(httpsUpgradeCandidates('https://www.bbc.co.uk/news/123'), [
  'https://www.bbc.co.uk/news/123',
])

assert.deepEqual(httpsUpgradeCandidates('http://www.bbc.co.uk/news/123'), [
  'https://www.bbc.co.uk/news/123',
])

assert.deepEqual(httpsUpgradeCandidates('http://news.163.com/article/ABC.html'), [
  'https://news.163.com/article/ABC.html',
  'http://news.163.com/article/ABC.html',
])

assert.deepEqual(httpsUpgradeCandidates('http://cdn.example.com/video.mp4'), [
  'http://cdn.example.com/video.mp4',
])

assert.deepEqual(httpsUpgradeCandidates('http://cdn.example.com/live.m3u8'), [
  'http://cdn.example.com/live.m3u8',
])

assert.deepEqual(
  httpsUpgradeCandidates('http://81.69.248.93:1200/bilibili/user/video/67079745'),
  ['http://81.69.248.93:1200/bilibili/user/video/67079745'],
)

assert.deepEqual(
  requestUrlCandidates('http://www.bbc.co.uk/zhongwen/simp/world/2014/09/article'),
  ['https://www.bbc.co.uk/zhongwen/simp/world/2014/09/article'],
)

assert.deepEqual(requestUrlCandidates('https://feeds.bbci.co.uk/zhongwen/trad/rss.xml'), [
  'https://feeds.bbci.co.uk/zhongwen/trad/rss.xml',
])

assert.equal(
  resolveRedirectUrl(
    'https://www.bbc.co.uk/a/b',
    'https://www.bbc.com/a/b',
  ),
  'https://www.bbc.com/a/b',
)

assert.equal(
  resolveRedirectUrl('https://www.bbc.co.uk/a/b', '/c/d'),
  'https://www.bbc.co.uk/c/d',
)

assert.equal(
  googleTranslateProxyUrl(
    'https://www.eatingwell.com/walnuts-vs-almonds-heart-health-12030995',
    'en',
  ),
  'https://www-eatingwell-com.translate.goog/walnuts-vs-almonds-heart-health-12030995?_x_tr_sl=auto&_x_tr_tl=en&_x_tr_hl=en&_x_tr_pto=wapp',
)

assert.equal(
  googleTranslateProxyUrl(
    'https://news.google.com/rss/articles/CBMidTEST',
    'en',
  ),
  null,
)

assert.equal(googleTranslateProxyUrl('not-a-url'), null)

console.log('https-upgrade: ok')
