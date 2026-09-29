import assert from 'node:assert/strict'
import {
  findCommentProvider,
  supportsComments,
} from '../src/features/comments/service'
import { eastmoneyCommentProvider, extractEastmoneyNewsId } from '../src/features/comments/providers/eastmoney'
import { neteaseCommentProvider } from '../src/features/comments/providers/netease'
import { zhihuCommentProvider } from '../src/features/comments/providers/zhihu'
import { jandanCommentProvider } from '../src/features/comments/providers/jandan'
import { hackerNewsCommentProvider } from '../src/features/comments/providers/hackerNews'

console.log('--- 测试 1: 各类信源评论适配器准确分发 ---')

// 1. 网易文章
const neteaseArticle = {
  id: 'netease-1',
  sourceId: 'netease-hot',
  originUrl: 'https://m.163.com/news/article/ABCD1234EFGH5678.html',
  neteaseDocId: 'ABCD1234EFGH5678',
}
assert.equal(supportsComments(neteaseArticle), true)
assert.equal(findCommentProvider(neteaseArticle), neteaseCommentProvider)

// 2. 知乎日报文章（即使带有 numeric neteaseDocId 也绝不能被网易拦截）
const zhihuDailyArticle = {
  id: 'zhihu-1',
  sourceId: 'zhihu-daily',
  originUrl: 'https://daily.zhihu.com/story/9791654',
  neteaseDocId: '9791654',
}
assert.equal(supportsComments(zhihuDailyArticle), true)
assert.equal(findCommentProvider(zhihuDailyArticle), zhihuCommentProvider)

// 3. 煎蛋文章
const jandanArticle = {
  id: 'jandan-1',
  sourceId: 'jandan',
  originUrl: 'https://jandan.net/p/108999',
}
assert.equal(supportsComments(jandanArticle), true)
assert.equal(findCommentProvider(jandanArticle), jandanCommentProvider)

// 4. Hacker News 文章
const hnArticle = {
  id: 'hn-1',
  sourceId: 'hn',
  originUrl: 'https://news.ycombinator.com/item?id=38123456',
}
assert.equal(supportsComments(hnArticle), true)
assert.equal(findCommentProvider(hnArticle), hackerNewsCommentProvider)

// 5. 东方财富：原站股吧跟帖（不得被网易 neteaseDocId 误匹配）
const eastmoneyArticle = {
  id: 'em-1',
  sourceId: 'eastmoney-news',
  originUrl: 'https://finance.eastmoney.com/a/202608063833574771.html',
  neteaseDocId: '202608063833574771',
}
assert.equal(extractEastmoneyNewsId(eastmoneyArticle), '202608063833574771')
assert.equal(supportsComments(eastmoneyArticle), true)
assert.equal(findCommentProvider(eastmoneyArticle), eastmoneyCommentProvider)

const eastmoneyKx = {
  id: 'em-kx-1',
  sourceId: 'eastmoney-kx',
  originUrl: 'https://finance.eastmoney.com/a/202608063833669027.html',
}
assert.equal(supportsComments(eastmoneyKx), true)
assert.equal(findCommentProvider(eastmoneyKx), eastmoneyCommentProvider)

// 6. 华尔街见闻快讯 / 财联社电报：原站无跟帖入口，不展示评论
const wscnLive = {
  id: 'wscn-1',
  sourceId: 'wscn-live',
  originUrl: 'https://wallstreetcn.com/livenews/12345',
  neteaseDocId: '12345',
}
assert.equal(supportsComments(wscnLive), false)
assert.equal(findCommentProvider(wscnLive), undefined)

const clsTelegraph = {
  id: 'cls-1',
  sourceId: 'cls-telegraph',
  originUrl: 'https://www.cls.cn/detail/12345',
}
assert.equal(supportsComments(clsTelegraph), false)

// 7. 纯 RSS / 国际新闻（无评论接口，应保持纯净）
const rssArticle = {
  id: 'bbc-1',
  sourceId: 'bbc-zh',
  originUrl: 'https://www.bbc.com/zhongwen/simp/chinese-news-123456',
}
assert.equal(supportsComments(rssArticle), false)
assert.equal(findCommentProvider(rssArticle), undefined)

console.log('✓ 信源评论适配器分发测试全部通过！')
