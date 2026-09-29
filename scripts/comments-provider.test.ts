import assert from 'node:assert/strict'
import {
  commentsLabelFor,
  findCommentProvider,
  shouldShowCommentEntry,
  supportsComments,
} from '../src/features/comments/service'
import { eastmoneyCommentProvider, extractEastmoneyNewsId } from '../src/features/comments/providers/eastmoney'
import { neteaseCommentProvider } from '../src/features/comments/providers/netease'
import { zhihuCommentProvider } from '../src/features/comments/providers/zhihu'
import { jandanCommentProvider } from '../src/features/comments/providers/jandan'
import { hackerNewsCommentProvider } from '../src/features/comments/providers/hackerNews'
import {
  extractGcoresTarget,
  gcoresCommentProvider,
  parseGcoresComments,
  parseGcoresRecordCount,
} from '../src/features/comments/providers/gcores'
import {
  parseV2exReplies,
  parseV2exTopicReplyCount,
  v2exCommentProvider,
} from '../src/features/comments/providers/v2ex'
import {
  parseWordpressCommentCount,
  parseWordpressComments,
  parseWordpressPostId,
  wordpressCommentProvider,
  wordpressEndpoint,
  wordpressNumericIdFromUrl,
  wordpressSlugCandidates,
  wordpressSlugFromUrl,
} from '../src/features/comments/providers/wordpress'
import {
  isSubstackHost,
  parseSubstackComments,
  parseSubstackPosts,
  substackCommentProvider,
  substackSlugFromUrl,
} from '../src/features/comments/providers/substack'
import {
  parseSolidotCommentCount,
  parseSolidotComments,
  solidotCommentProvider,
} from '../src/features/comments/providers/solidot'
import {
  parseZhishifenziCommentCount,
  parseZhishifenziComments,
  zhishifenziCommentProvider,
} from '../src/features/comments/providers/zhishifenzi'

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

console.log('--- 测试 2: 各来源评论称呼取词（跟贴 / 评论 / 吐槽 / 讨论） ---')

assert.equal(commentsLabelFor(neteaseArticle), '跟贴')
assert.equal(commentsLabelFor(eastmoneyArticle), '跟贴')
assert.equal(commentsLabelFor(eastmoneyKx), '跟贴')
assert.equal(commentsLabelFor(zhihuDailyArticle), '评论')
assert.equal(commentsLabelFor(jandanArticle), '吐槽')
assert.equal(commentsLabelFor(hnArticle), '讨论')
// 无评论来源不得出现评论入口，取词回退到中性「评论」
assert.equal(commentsLabelFor(rssArticle), '评论')
assert.equal(commentsLabelFor(clsTelegraph), '评论')

console.log('--- 测试 3: 平台族（WordPress / Substack）分发与入口门控 ---')

// WordPress：按已登记主机命中（取证：syncedreview.com / qbitai.com / pansci.asia / theue.me ...）
const wpArticle = {
  id: 'wp-1',
  sourceId: 'synced',
  originUrl: 'https://syncedreview.com/2025/08/14/which-agent-causes-task-failures/',
}
assert.equal(supportsComments(wpArticle), true)
assert.equal(findCommentProvider(wpArticle), wordpressCommentProvider)
assert.equal(commentsLabelFor(wpArticle), '评论')

// Substack：*.substack.com 与自有域名都命中
const substackArticle = {
  id: 'sub-1',
  sourceId: 'thezvi',
  originUrl: 'https://thezvi.substack.com/p/monthly-roundup-46-september-2026',
}
assert.equal(supportsComments(substackArticle), true)
assert.equal(findCommentProvider(substackArticle), substackCommentProvider)

const substackCustom = {
  id: 'sub-2',
  sourceId: 'oneusefulthing',
  originUrl: 'https://www.oneusefulthing.org/p/the-overhang',
}
assert.equal(findCommentProvider(substackCustom), substackCommentProvider)

// 未登记主机不得被平台族误匹配（WordPress REST 返回 HTML 外壳的站点）
const notWp = {
  id: 'wp-no',
  sourceId: 'sspai',
  originUrl: 'https://sspai.com/post/123456',
}
assert.equal(supportsComments(notWp), false)

// 入口门控：requiresCommentCount 的来源必须确知评论数 > 0 才显示入口
assert.equal(shouldShowCommentEntry(wpArticle, undefined), false)
assert.equal(shouldShowCommentEntry(wpArticle, 0), false)
assert.equal(shouldShowCommentEntry(wpArticle, 3), true)
assert.equal(shouldShowCommentEntry(substackArticle, 0), false)
assert.equal(shouldShowCommentEntry(substackArticle, 23), true)
// 站点专属来源保持现状：计数未知也显示入口
assert.equal(shouldShowCommentEntry(neteaseArticle, undefined), true)
assert.equal(shouldShowCommentEntry(hnArticle, undefined), true)
// 无适配来源永不显示
assert.equal(shouldShowCommentEntry(rssArticle, 12), false)

console.log('--- 测试 4: WordPress 解析（真实响应样本） ---')

assert.equal(
  wordpressSlugFromUrl('https://syncedreview.com/2025/08/14/which-agent-causes-task-failures/'),
  'which-agent-causes-task-failures',
)
// qbitai 文章地址带 .html，slug 需去后缀重试
assert.deepEqual(wordpressSlugCandidates('https://www.qbitai.com/2026/09/493865.html'), [
  '493865.html',
  '493865',
])
assert.deepEqual(wordpressSlugCandidates('https://syncedreview.com/2025/08/14/some-slug/'), ['some-slug'])
assert.equal(
  wordpressEndpoint('syncedreview.com', 'pretty', 'comments', { post: 47256, per_page: 20 }),
  'https://syncedreview.com/wp-json/wp/v2/comments?post=47256&per_page=20',
)
assert.equal(
  wordpressEndpoint('woshipm.com', 'query', 'comments', { post: 1 }),
  'https://woshipm.com/?rest_route=/wp/v2/comments&post=1',
)
assert.equal(parseWordpressPostId('[{"id":47256,"link":"https://x/"}]'), 47256)
// 数字段直取时上游返回单对象而非数组
assert.equal(parseWordpressPostId('{"id":493865,"slug":"%e8%99%8e"}'), 493865)
assert.equal(parseWordpressPostId('<!DOCTYPE html>'), undefined)
// qbitai 类站点：URL 数字段即 post id（slug 是中文标题，?slug= 查不到）
assert.equal(wordpressNumericIdFromUrl('https://www.qbitai.com/2026/09/493865.html'), '493865')
assert.equal(wordpressNumericIdFromUrl('https://syncedreview.com/2025/08/14/some-slug/'), undefined)
assert.equal(
  wordpressEndpoint('qbitai.com', 'pretty', 'posts/493865', { _fields: 'id' }),
  'https://qbitai.com/wp-json/wp/v2/posts/493865?_fields=id',
)

const wpCommentsFixture = JSON.stringify([
  {
    id: 517788,
    parent: 0,
    author_name: 'Darcie',
    date: '2026-09-21T06:51:54',
    content: { rendered: '<p>The &#8216;when&#8217; half of Who&amp;When is <a href="https://x/">hard</a>.</p>\n' },
    author_avatar_urls: { '48': 'https://secure.gravatar.com/avatar/abc?s=48' },
  },
  {
    id: 517800,
    parent: 517788,
    author_name: 'Reply Guy',
    date: '2026-09-21T07:10:00',
    content: { rendered: '<p>Agreed<br>especially the second half</p>' },
  },
])
const wpParsed = parseWordpressComments(wpCommentsFixture)
assert.equal(wpParsed.length, 2)
assert.equal(wpParsed[0].author, 'Darcie')
assert.equal(wpParsed[0].content, 'The \u2018when\u2019 half of Who&When is hard.')
assert.equal(wpParsed[0].avatar, 'https://secure.gravatar.com/avatar/abc?s=48')
assert.equal(wpParsed[0].quotes, undefined)
// 子评论把父评论转成盖楼引用
assert.equal(wpParsed[1].quotes?.length, 1)
assert.equal(wpParsed[1].quotes?.[0].author, 'Darcie')
assert.equal(wpParsed[1].content, 'Agreed\nespecially the second half')
// 计数：id 列表长度（无响应头可用）
assert.equal(parseWordpressCommentCount('[{"id":1},{"id":2},{"id":3}]'), 3)
assert.equal(parseWordpressCommentCount('[]'), 0)
assert.equal(parseWordpressCommentCount('oops'), undefined)

console.log('--- 测试 5: Substack 解析（真实响应样本） ---')

assert.equal(
  substackSlugFromUrl('https://thezvi.substack.com/p/monthly-roundup-46-september-2026'),
  'monthly-roundup-46-september-2026',
)
assert.equal(isSubstackHost('https://interconnects.ai/p/the-current-balance-of-power-in-open'), true)
assert.equal(isSubstackHost('https://www.lastweekin.ai/p/last-week-in-ai-344'), true)
assert.equal(isSubstackHost('https://stratechery.com/2026/x/'), false)

const substackPostsFixture = JSON.stringify([
  { id: 215721533, slug: 'monthly-roundup-46-september-2026', comment_count: 23 },
  { id: 215700000, slug: 'other-post', comment_count: 0 },
])
const substackPosts = parseSubstackPosts(substackPostsFixture)
assert.equal(substackPosts.length, 2)
assert.equal(substackPosts[0].id, 215721533)
assert.equal(substackPosts[0].commentCount, 23)

const substackCommentsFixture = JSON.stringify({
  comments: [
    {
      id: 342302113,
      body: 'Green car seats are all reserved.',
      date: '2026-09-21T13:55:45.045Z',
      name: 'Zhang',
      handle: 'zhang',
      photo_url: 'https://substackcdn.com/image/abc.jpeg',
      reaction_count: 12,
      children: [
        {
          id: 342302200,
          body: 'Nested reply body',
          date: '2026-09-21T14:00:00.000Z',
          name: 'Li',
          reaction_count: 1,
        },
      ],
    },
  ],
  automod_hidden_comments: [],
})
const substackParsed = parseSubstackComments(substackCommentsFixture)
assert.equal(substackParsed.length, 2)
assert.equal(substackParsed[0].author, 'Zhang')
assert.equal(substackParsed[0].avatar, 'https://substackcdn.com/image/abc.jpeg')
assert.equal(substackParsed[0].voteCount, 12)
assert.equal(substackParsed[0].isHot, true)
assert.equal(substackParsed[1].author, 'Li')
assert.equal(substackParsed[1].content, 'Nested reply body')
assert.equal(parseSubstackComments('{"comments":[]}').length, 0)
assert.equal(parseSubstackComments('<html>').length, 0)

console.log('--- 测试 6: 机核 gcores（JSON:API）---')

const gcoresArticle = {
  id: 'gcores-1',
  sourceId: 'gcores',
  originUrl: 'https://www.gcores.com/articles/220062',
}
assert.equal(findCommentProvider(gcoresArticle), gcoresCommentProvider)
assert.equal(commentsLabelFor(gcoresArticle), '评论')
assert.deepEqual(extractGcoresTarget(gcoresArticle), { kind: 'articles', id: '220062' })
assert.deepEqual(extractGcoresTarget({ originUrl: 'https://www.gcores.com/radios/220055' }), {
  kind: 'radios',
  id: '220055',
})
assert.equal(extractGcoresTarget({ originUrl: 'https://www.gcores.com/users/1' }), undefined)

const gcoresFixture = JSON.stringify({
  data: [
    {
      id: '6408373',
      type: 'comments',
      attributes: {
        body: '终于！！！！',
        depth: 0,
        'likes-count': 12,
        'created-at': '2026-09-22T17:59:55.000+08:00',
      },
      relationships: { user: { data: { type: 'users', id: '994196' } }, parent: { data: null } },
    },
    {
      id: '6408400',
      type: 'comments',
      attributes: {
        body: '<p>同意，<a href="https://x/">第二幕</a>太难</p>',
        depth: 1,
        'likes-count': 0,
        'created-at': '2026-09-22T18:05:00.000+08:00',
      },
      relationships: {
        user: { data: { type: 'users', id: '994200' } },
        parent: { data: { type: 'comments', id: '6408373' } },
      },
    },
  ],
  included: [
    { id: '994196', type: 'users', attributes: { nickname: '禄神發禄水', thumb: 'de577af2-750-750.jpg', location: '四川' } },
    { id: '994200', type: 'users', attributes: { nickname: 'Aki_Hiko', thumb: 'abc-750-750.jpg' } },
  ],
  meta: { 'record-count': 8 },
})
const gcoresParsed = parseGcoresComments(gcoresFixture)
assert.equal(gcoresParsed.length, 2)
assert.equal(gcoresParsed[0].author, '禄神發禄水')
assert.equal(gcoresParsed[0].avatar, 'https://image.gcores.com/de577af2-750-750.jpg')
assert.equal(gcoresParsed[0].location, '四川')
assert.equal(gcoresParsed[0].content, '终于！！！！')
assert.equal(gcoresParsed[0].voteCount, 12)
assert.equal(gcoresParsed[0].isHot, true)
assert.equal(gcoresParsed[0].quotes, undefined)
// 子评论把父评论转成盖楼引用，且 HTML 被清洗
assert.equal(gcoresParsed[1].content, '同意，第二幕太难')
assert.equal(gcoresParsed[1].quotes?.length, 1)
assert.equal(gcoresParsed[1].quotes?.[0].author, '禄神發禄水')
assert.equal(parseGcoresRecordCount(gcoresFixture), 8)
assert.equal(parseGcoresRecordCount('<html>'), undefined)

console.log('--- 测试 7: V2EX 回复 ---')

const v2exArticle = {
  id: 'v2ex-1',
  sourceId: 'v2ex',
  originUrl: 'https://www.v2ex.com/t/1243998#reply13',
}
assert.equal(findCommentProvider(v2exArticle), v2exCommentProvider)
assert.equal(commentsLabelFor(v2exArticle), '回复')

const v2exFixture = JSON.stringify([
  {
    id: 1,
    content: 'raw content',
    content_rendered: 'Hello <strong>V2EX</strong><br>second line',
    created: 1790063681,
    member: { username: 'hahahabro', avatar_large: 'https://cdn.v2ex.com/avatar/x_large.png' },
  },
  {
    id: 2,
    content_rendered: '',
    created: 1790063700,
    member: { username: 'someone' },
  },
])
const v2exParsed = parseV2exReplies(v2exFixture)
// 第二条 content_rendered 为空、content 缺失 → 跳过
assert.equal(v2exParsed.length, 1)
assert.equal(v2exParsed[0].author, 'hahahabro')
assert.equal(v2exParsed[0].avatar, 'https://cdn.v2ex.com/avatar/x_large.png')
assert.equal(v2exParsed[0].content, 'Hello V2EX\nsecond line')
assert.equal(parseV2exTopicReplyCount('[{"id":1243998,"replies":12}]'), 12)
assert.equal(parseV2exTopicReplyCount('{"message":"Token not found"}'), undefined)
assert.equal(parseV2exReplies('<html>').length, 0)

// 入口门控：两个新站点专属来源同样要求确知有评论
assert.equal(shouldShowCommentEntry(gcoresArticle, undefined), false)
assert.equal(shouldShowCommentEntry(gcoresArticle, 0), false)
assert.equal(shouldShowCommentEntry(gcoresArticle, 8), true)
assert.equal(shouldShowCommentEntry(v2exArticle, 12), true)
assert.equal(shouldShowCommentEntry(v2exArticle, 0), false)

console.log('--- 测试 8: Solidot / 知识分子（服务端直出 HTML）---')

const solidotArticle = {
  id: 'solidot-1',
  sourceId: 'solidot',
  originUrl: 'https://www.solidot.org/story?sid=84911',
}
assert.equal(findCommentProvider(solidotArticle), solidotCommentProvider)
assert.equal(commentsLabelFor(solidotArticle), '评论')

// 真实响应片段（2026-09-22 抓取 sid=84911，1 条评论）
const solidotFixture = `<!-- comments start -->
<div class="statement"><a href="/story?sid=84911">古代语言的多样性远超今日</a> | <b>1</b>条评论</div>
<form action="/story?sid=84911" method="GET" id=form0 name="form0"></form>
<div class="statement"><b>声明:</b> 下面的评论属于其发表者所有，不代表本站的观点和立场。</div>
<div class="reply_list">
<form id=form1 name=form1>
<ul class="reply_ul">
<li id="tree_296690">
<div id="comment_296690" class="list_com">
<div class="ct_tittle smallct_tit"><div class="mid_bgtittle"></div><div class="bg_htit"><h2>很正常(得分:1 )</h2></div></div>
<div class="talk_time">
<a class="same_the" href="/~Craynic">Craynic</a>(18046)
<span class="expression"><a href="/my/check?uid=18046"><img alt="Neutral" src="https://icon.solidot.org/images/default/neutral.gif"></a></span>
<span>发表于2026年07月27日 13时22分 星期一</span>
</div>
<div class="p_text">
           	没有沟通需要的语言就会慢慢消亡                   </div>
<div class="reply_chice">[ <a class="same_the" href="/comments/?sid=84911&op=reply&type=story&pid=296690">回复本条</a> ]</div>
</div>
</li>
</ul>
</form>
</div>
<!-- comments end -->`
assert.equal(parseSolidotCommentCount(solidotFixture), 1)
// 零评论文章：区间为空 → 0（入口据此隐藏）
assert.equal(parseSolidotCommentCount('<!-- comments start --> <!-- comments end -->'), 0)
const solidotParsed = parseSolidotComments(solidotFixture)
assert.equal(solidotParsed.length, 1)
assert.equal(solidotParsed[0].id, '296690')
assert.equal(solidotParsed[0].author, 'Craynic')
// 标题里的分数被清掉，只留标题本身
assert.equal(solidotParsed[0].content, '很正常\n没有沟通需要的语言就会慢慢消亡')
assert.equal(solidotParsed[0].voteCount, 1)
assert.match(solidotParsed[0].createTimeRaw ?? '', /2026年07月27日/)
assert.equal(parseSolidotComments('<html></html>').length, 0)

const zhishifenziArticle = {
  id: 'zsfz-1',
  sourceId: 'zhishifenzi',
  originUrl: 'http://www.zhishifenzi.com/media/media/22.html',
}
assert.equal(findCommentProvider(zhishifenziArticle), zhishifenziCommentProvider)
assert.equal(commentsLabelFor(zhishifenziArticle), '评论')

// 真实响应片段（2026-09-22 抓取 /media/media/22.html，1 条评论）
const zhishifenziFixture = `<div class="no"><span>1</span> 条评论</div>
<div class="comments_content">
<ul>
<li class="heng">
<div class="row">
<div class="col-md-1"><a class="release_box_face"><img alt="" src="http://pic.zhishifenzi.com/y/6b/zsfz1534482137.7213602.jpg"></a></div>
<div class="col-md-11">
<div><span style="color: #1788c4"><a target='_blank' href='/u/50.html'>叶水送</a></span> <span style="color: #777">2018/09/05</span></div>
<p style="color:#222; padding: 10px 0px; line-height: 22px;">挺不错的一个技术，日本学者。..</p>
<div ip="124.79.66.202"><a href='javascript:void(0);' level='1' pid='197' onclick='replycomment(this)'>回复</a></div>
<div class="listcomments" original_id="197"></div>
<div class="text-center hidden reply"><button type="button" class="btn btn-default btn-xs" page="1" onclick="readmorereplycomment(this)">查看更多回复</button></div>
</div>
</div>
</li>
</ul>
<div class="text-center hidden"><button type="button" page="1" category="media" aid="22" onclick="readmorecomment(this)">查看更多评论</button></div>
</div>`
assert.equal(parseZhishifenziCommentCount(zhishifenziFixture), 1)
assert.equal(parseZhishifenziCommentCount('<div class="comments_content"></div>'), 0)
const zhishifenziParsed = parseZhishifenziComments(zhishifenziFixture)
assert.equal(zhishifenziParsed.length, 1)
assert.equal(zhishifenziParsed[0].id, '197')
assert.equal(zhishifenziParsed[0].author, '叶水送')
assert.equal(zhishifenziParsed[0].avatar, 'http://pic.zhishifenzi.com/y/6b/zsfz1534482137.7213602.jpg')
assert.equal(zhishifenziParsed[0].content, '挺不错的一个技术，日本学者。..')
assert.match(zhishifenziParsed[0].createTimeRaw ?? '', /2018\/09\/05/)
assert.equal(parseZhishifenziComments('<html></html>').length, 0)

// 门控：两个来源都要求确知评论数 > 0
assert.equal(shouldShowCommentEntry(solidotArticle, undefined), false)
assert.equal(shouldShowCommentEntry(solidotArticle, 0), false)
assert.equal(shouldShowCommentEntry(solidotArticle, 1), true)
assert.equal(shouldShowCommentEntry(zhishifenziArticle, 0), false)
assert.equal(shouldShowCommentEntry(zhishifenziArticle, 1), true)

console.log('--- 测试 9: D 类来源防误匹配（无评论就绝不出现入口）---')

// 这些来源实测没有可程序化获取的评论（见 docs/news-sources.md §8.2）。
// 锁定它们必须保持「无适配」，防止日后新增主机匹配把它们误伤成有入口。
const noCommentSources: { sourceId: string; originUrl: string }[] = [
  { sourceId: 'sspai', originUrl: 'https://sspai.com/post/114551' },
  { sourceId: 'ithome', originUrl: 'https://www.ithome.com/1/005/913.htm' },
  { sourceId: 'huxiu', originUrl: 'https://www.huxiu.com/article/4893260.html' },
  { sourceId: 'tmtpost', originUrl: 'https://www.tmtpost.com/8148800.html' },
  { sourceId: 'leiphone', originUrl: 'https://www.leiphone.com/category/industrynews/4V3AYUarwL4RCE5O.html' },
  { sourceId: 'guokr', originUrl: 'https://www.guokr.com/article/470290/' },
  { sourceId: 'jiqizhixin', originUrl: 'https://www.jiqizhixin.com/articles/2026-09-22-14' },
  { sourceId: 'geekpark', originUrl: 'http://www.geekpark.net/news/370797' },
  { sourceId: 'kr36', originUrl: 'https://36kr.com/p/3994358604856328' },
  { sourceId: 'ifanr', originUrl: 'https://www.ifanr.com/1681475' },
  { sourceId: 'jazzyear', originUrl: 'https://www.jazzyear.com/article_info.html?id=1848' },
  { sourceId: 'appinn', originUrl: 'https://www.appinn.com/neovim-10-btc-donation/' },
  { sourceId: 'quanta', originUrl: 'https://www.quantamagazine.org/some-post-20260921/' },
  { sourceId: 'arstechnica', originUrl: 'https://arstechnica.com/security/2026/09/some-post/' },
  { sourceId: 'verge', originUrl: 'https://www.theverge.com/991659/some-post' },
  { sourceId: 'cls-telegraph', originUrl: 'https://www.cls.cn/detail/12345' },
  { sourceId: 'wscn-live', originUrl: 'https://wallstreetcn.com/livenews/12345' },
  { sourceId: 'bbc-zh', originUrl: 'https://www.bbc.com/zhongwen/simp/chinese-news-123456' },
  { sourceId: 'guardian-world', originUrl: 'https://www.theguardian.com/world/2026/sep/22/some-post' },
  { sourceId: 'paulgraham', originUrl: 'https://www.paulgraham.com/someessay.html' },
]
for (const item of noCommentSources) {
  assert.equal(supportsComments(item), false, `${item.sourceId} 不应有评论入口`)
  assert.equal(findCommentProvider(item), undefined, `${item.sourceId} 不应命中任何 provider`)
  // 计数再怎么给也不显示
  assert.equal(shouldShowCommentEntry(item, 42), false, `${item.sourceId} 不应显示入口`)
}

// A 类代表来源取词锁定（各站自称不同，UI 文案随之变化）
for (const [item, label] of [
  [{ sourceId: 'solidot', originUrl: 'https://www.solidot.org/story?sid=84911' }, '评论'],
  [{ sourceId: 'zhishifenzi', originUrl: 'http://www.zhishifenzi.com/media/media/22.html' }, '评论'],
  [{ sourceId: 'v2ex', originUrl: 'https://www.v2ex.com/t/1243998' }, '回复'],
  [{ sourceId: 'jandan', originUrl: 'https://jandan.net/p/108999' }, '吐槽'],
  [{ sourceId: 'hn', originUrl: 'https://news.ycombinator.com/item?id=38123456' }, '讨论'],
  [{ sourceId: 'netease-hot', originUrl: 'https://m.163.com/news/article/ABCD1234EFGH5678.html' }, '跟贴'],
] as const) {
  assert.equal(commentsLabelFor(item), label, `${item.sourceId} 取词应为 ${label}`)
}

console.log('✓ 信源评论适配器分发测试全部通过！')
