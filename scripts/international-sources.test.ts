import assert from 'node:assert/strict'

import { parseSourcePayload } from '../src/lib/parseFeed'
import { cachedListMatchesSourceVersion, type CachedList } from '../src/lib/storage'
import { CATEGORIES, uncoveredSourceIds } from '../src/sources/categories'
import { normalizeSnapshot } from '../src/sources/presets'
import { normalizePreferences } from '../src/sources/preferences/normalize'
import { findSource } from '../src/sources/registry'

const chineseIds = [
  'bbc-zh',
  'nytimes-zh',
  'rfi-zh',
  'dw-top',
  'ftchinese',
  'zaobao-world',
  'voa-zh',
  'cna-intl-zh',
  'theinitium',
] as const

const englishNewsIds = [
  'bbc-world',
  'dw-en',
  'nytimes-world',
  'wsj-world',
  'nikkei-asia',
  'channelnewsasia-world',
  'scmp-china',
  'scmp-news',
  'npr',
  'guardian-world',
  'france24',
  'aljazeera',
  'gnews-world',
] as const

const englishDepthIds = [
  'foreign-affairs',
  'nyrb',
  'bloomberg-opinion',
  'project-syndicate',
  'sinocism',
] as const

for (const id of [...chineseIds, ...englishNewsIds, ...englishDepthIds]) {
  const source = findSource(id)
  assert.ok(source, `${id} must be registered`)
  assert.equal(source.group, 'intl', `${id} must use intl for proxy/network routing`)
}

assert.equal(findSource('bbc-zh-china')?.id, 'bbc-zh', 'legacy BBC China id should resolve to the canonical source')
assert.equal(findSource('bbc-zh-world')?.id, 'bbc-zh', 'legacy BBC World-Chinese id should resolve to the canonical source')

const migratedPrefs = normalizePreferences({
  categorySources: { intl: ['bbc-zh-world', 'bbc-zh-china', 'bbc-zh'] },
  favoriteSourceIds: ['bbc-zh-world', 'bbc-zh'],
})
assert.deepEqual(
  migratedPrefs.customCategories?.find((category) => category.id === 'legacy-v1-intl')?.sourceIds,
  ['bbc-zh'],
)
assert.deepEqual(migratedPrefs.favoriteSourceIds, ['bbc-zh'])

const migratedSnapshot = normalizeSnapshot({
  categoryOrder: ['intl'],
  hiddenCategoryIds: [],
  categorySources: { intl: ['bbc-zh-china', 'bbc-zh-world'] },
  customCategories: [],
  enabledSourceIds: ['bbc-zh-world'],
  favoriteSourceIds: ['bbc-zh-china'],
})
assert.deepEqual(
  migratedSnapshot.customCategories.find((category) => category.id === 'legacy-v1-intl')?.sourceIds,
  ['bbc-zh'],
)
assert.deepEqual(migratedSnapshot.enabledSourceIds, ['bbc-zh'])
assert.deepEqual(migratedSnapshot.favoriteSourceIds, ['bbc-zh'])

const bbcZh = findSource('bbc-zh')!
assert.equal(bbcZh.kind, 'bbc-chinese')
assert.equal(bbcZh.url, 'https://www.bbc.com/zhongwen/simp')
assert.equal(bbcZh.siteUrl, 'https://www.bbc.com/zhongwen/simp')
assert.equal(bbcZh.cacheVersion, 'simp-v1')
assert.ok(!bbcZh.url.includes('/trad'), 'BBC 中文 must never point at the traditional RSS feed')

const bbcNextPayload = {
  props: {
    pageProps: {
      pageData: {
        curations: [
          {
            summaries: [
              {
                type: 'article',
                title: '习近平访美焦点：贸易、AI、台湾与伊朗',
                description: '美国与中国正围绕贸易与人工智能展开新一轮交锋。',
                firstPublished: '2026-09-23T23:30:08.153Z',
                link: 'https://www.bbc.com/zhongwen/articles/example123/simp',
                imageUrl: 'https://ichef.bbci.co.uk/ace/ws/{width}/cpsprodpb/example.jpg.webp',
              },
              {
                type: 'article',
                title: '习近平访美焦点：贸易、AI、台湾与伊朗',
                description: '重复卡片应按文章 id 去重。',
                firstPublished: '2026-09-23T23:30:08.153Z',
                link: 'https://www.bbc.com/zhongwen/articles/example123/simp',
                imageUrl: 'https://ichef.bbci.co.uk/ace/ws/{width}/cpsprodpb/example.jpg.webp',
              },
              {
                type: 'article',
                title: '繁體頁不應進入簡體來源',
                link: 'https://www.bbc.com/zhongwen/articles/example-trad/trad',
              },
              {
                type: 'video',
                title: '视频卡片不进入新闻列表',
                link: 'https://www.bbc.com/zhongwen/videos/example/simp',
              },
            ],
          },
        ],
      },
    },
  },
}
const bbcParsed = parseSourcePayload(
  bbcZh,
  `<script type="application/json" id="__NEXT_DATA__">${JSON.stringify(bbcNextPayload)}</script>`,
)
assert.equal(bbcParsed.length, 1)
assert.equal(bbcParsed[0].title, '习近平访美焦点：贸易、AI、台湾与伊朗')
assert.equal(bbcParsed[0].summary, '美国与中国正围绕贸易与人工智能展开新一轮交锋。')
assert.equal(bbcParsed[0].originUrl, 'https://www.bbc.com/zhongwen/articles/example123/simp')
assert.equal(bbcParsed[0].image, 'https://ichef.bbci.co.uk/ace/ws/976/cpsprodpb/example.jpg.webp')
assert.equal(new Date(bbcParsed[0].publishedAt).toISOString(), '2026-09-23T23:30:08.153Z')
assert.ok(!/[習訪臺與國]/.test(bbcParsed[0].title), 'fixture should remain simplified Chinese')

const legacyBbcCache = {
  items: [],
  cachedAt: Date.now(),
  paging: undefined,
} satisfies CachedList
const simpBbcCache = {
  items: [],
  cachedAt: Date.now(),
  paging: { sourceVersion: 'simp-v1' },
} satisfies CachedList
assert.equal(cachedListMatchesSourceVersion(legacyBbcCache, bbcZh.cacheVersion), false)
assert.equal(cachedListMatchesSourceVersion(simpBbcCache, bbcZh.cacheVersion), true)

const dwZh = findSource('dw-top')!
assert.equal(dwZh.kind, 'feed')
assert.equal(dwZh.url, 'https://rss.dw.com/rdf/rss-chi-all')
assert.notEqual(dwZh.url, findSource('dw-en')!.url)

for (const id of ['nytimes-zh', 'rfi-zh', 'ftchinese', 'voa-zh', 'cna-intl-zh'] as const) {
  assert.equal(findSource(id)!.kind, 'feed', `${id} should use the generic first-party feed parser`)
}
assert.equal(findSource('zaobao-world')!.kind, 'zaobao', 'Zaobao has no usable first-party RSS and needs its first-party HTML adapter')

const worldZh = CATEGORIES.find((category) => category.id === 'world-zh')!
const worldZhPress = CATEGORIES.find((category) => category.id === 'world-zh-press')!
const worldNews = CATEGORIES.find((category) => category.id === 'world-news')!
const worldNewsPress = CATEGORIES.find((category) => category.id === 'world-news-press')!
const worldAsia = CATEGORIES.find((category) => category.id === 'world-asia')!
const worldOpinion = CATEGORIES.find((category) => category.id === 'world-opinion')!
const chinaExternal = CATEGORIES.find((category) => category.id === 'cn-external')!
const bizGlobal = CATEGORIES.find((category) => category.id === 'biz-global')!
const bizIndustry = CATEGORIES.find((category) => category.id === 'biz-industry')!
const depthKnowledge = CATEGORIES.find((category) => category.id === 'depth-knowledge')!

assert.equal(worldZh.label, '中文公共媒体')
assert.equal(worldZhPress.label, '中文报刊通讯')
assert.equal(worldNews.label, '英文公共媒体')
assert.equal(worldNewsPress.label, '英文报刊聚合')
assert.equal(worldAsia.label, '亚太观察')
assert.equal(worldOpinion.label, '国际评论')

for (const id of ['bbc-zh', 'rfi-zh', 'dw-top', 'voa-zh']) {
  assert.ok(worldZh.sourceIds?.includes(id), `${id} must be in 中文公共媒体`)
}
for (const id of ['nytimes-zh', 'cna-intl-zh', 'zaobao-world', 'theinitium']) {
  assert.ok(worldZhPress.sourceIds?.includes(id), `${id} must be in 中文报刊通讯`)
}
assert.ok(bizGlobal.sourceIds?.includes('ftchinese'))
for (const id of ['bbc-world', 'dw-en', 'npr', 'france24', 'aljazeera']) {
  assert.ok(worldNews.sourceIds?.includes(id), `${id} must be in 英文公共媒体`)
}
for (const id of ['nytimes-world', 'wsj-world', 'guardian-world', 'gnews-world']) {
  assert.ok(worldNewsPress.sourceIds?.includes(id), `${id} must be in 英文报刊聚合`)
}
for (const id of ['nikkei-asia', 'channelnewsasia-world', 'scmp-news']) {
  assert.ok(worldAsia.sourceIds?.includes(id), `${id} must be in 亚太观察`)
}
assert.ok(chinaExternal.sourceIds?.includes('scmp-china'))
assert.ok(chinaExternal.sourceIds?.includes('sinocism'))
assert.ok(worldOpinion.sourceIds?.includes('foreign-affairs'))
assert.ok(worldOpinion.sourceIds?.includes('project-syndicate'))
assert.ok(depthKnowledge.sourceIds?.includes('nyrb'))
assert.ok(bizIndustry.sourceIds?.includes('bloomberg-opinion'))
assert.deepEqual(uncoveredSourceIds(), [], 'all built-in sources must remain assigned to a category')

const zaobao = findSource('zaobao-world')!
const zaobaoHtml = `
<ul>
  <li>
    <a class="content-image" aria-label="胡塞军事顾问：若美军支持沙特 胡塞将打击美国利益" href="/news/world/story20260924-9726057"></a>
    <a href="/news/world/story20260924-9726057" aria-label="胡塞军事顾问：若美军支持沙特 胡塞将打击美国利益"><h3>duplicate link</h3></a>
  </li>
  <li>
    <a href="/news/world/story20260923-9725921?ref=listing&amp;src=web" aria-label="克宫：将考虑美国邀请普京参加G20峰会一事"></a>
  </li>
</ul>
`
const parsed = parseSourcePayload(zaobao, zaobaoHtml)
assert.equal(parsed.length, 2, 'Zaobao parser should deduplicate repeated image/title anchors')
assert.equal(parsed[0].title, '胡塞军事顾问：若美军支持沙特 胡塞将打击美国利益')
assert.equal(parsed[0].originUrl, 'https://www.zaobao.com.sg/news/world/story20260924-9726057')
assert.equal(new Date(parsed[0].publishedAt).toISOString().slice(0, 10), '2026-09-24')
assert.equal(parsed[0].hasRealDate, true)
assert.equal(
  parsed[1].originUrl,
  'https://www.zaobao.com.sg/news/world/story20260923-9725921?ref=listing&src=web',
)
assert.equal(new Date(parsed[1].publishedAt).toISOString().slice(0, 10), '2026-09-23')

console.log('international-sources: ok')
