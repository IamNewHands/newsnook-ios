import assert from 'node:assert/strict'

import { neteasePageEntryCount, parseSourcePayload } from '../src/lib/parseFeed'
import { findSource } from '../src/sources/registry'

const source = findSource('netease')!
assert.ok(source)

const payload = JSON.stringify({
  T1348647909107: [
    {
      title: '17亿元全额返还！深圳取消购房退税 企业称“利润未减”',
      source: '南方都市报',
      postid: 'L4ER2D7M05129QAF',
      docid: 'L4ER2D7M05129QAF',
      digest: '正文后续可能含 <!--VIDEO#0--> 内嵌视频，列表仍是文章。',
      url: 'https://m.163.com/news/article/L4ER2D7M05129QAF.html',
      ptime: '2026-08-16 07:36:06',
    },
    {
      title: '3对男女在KTV抱团跳舞 一男子从背后搂着女子紧贴扭动',
      source: '火炼树',
      skipType: 'video',
      skipID: 'VV3I62VO5',
      videoID: 'VV3I62VO5',
      postid: 'V3I62VO5050835RB',
      docid: '9IG74V5H00963VRO_VV3I62VO5updateDoc',
      boardid: 'video_bbs',
      videosource: '新媒体',
      digest: '',
      videoinfo: {
        vid: 'VV3I62VO5',
        title: '女孩没有舞伴 站桌子上与3对情侣一起热舞',
        description: '女孩没有舞伴 站桌子上与3对情侣一起热舞',
        videosource: '新媒体',
        m3u8_url: 'http://flv0.bn.netease.com/example/movie_index.m3u8',
      },
    },
    {
      title: '某歌厅休息区，一群大爷在喝茶',
      source: '小A看世界',
      skipType: 'video',
      videoID: 'VN3HNB1MT',
      skipID: 'VN3HNB1MT',
      postid: 'N3HNB1MT050835RB',
      docid: '9IG74V5H00963VRO_VN3HNB1MTupdateDoc',
      boardid: 'video_bbs',
      videosource: '其他',
      videoinfo: { vid: 'VN3HNB1MT', m3u8_url: 'http://flv0.bn.netease.com/b.m3u8' },
    },
    {
      title: '央视记录片：现场画面',
      source: '央视新闻',
      skipType: 'video',
      videoID: 'VNEWS001',
      skipID: 'VNEWS001',
      postid: 'L4NEWSVID05129QAF',
      docid: 'L4NEWSVID05129QAF',
      boardid: 'news2_bbs',
      videosource: '央视新闻',
      videoinfo: {
        vid: 'VNEWS001',
        videosource: '央视新闻',
        m3u8_url: 'http://flv0.bn.netease.com/news.m3u8',
      },
    },
    {
      title: '这个仿真鱼其实是一个水下机器人。它还会扑腾溅水，差点溅了我一身。#东博会# #平陆运河# #世纪工程#'.repeat(3),
      docid: 'YDJ0937UPNM44YXY',
      skipType: 'rec',
      skipID: 'YDJ0937UPNM44YXY',
      boardid: 'app_bbs',
      ptime: '2026-09-19 10:15:20',
    },
    {
      title: '图集应继续跳过',
      skipType: 'photoset',
      skipID: '00AN0001',
    },
  ],
})

const articles = parseSourcePayload(source, payload)
const titles = articles.map((item) => item.title)

assert.ok(titles.includes('17亿元全额返还！深圳取消购房退税 企业称“利润未减”'))
assert.equal(
  articles.find((item) => item.title.includes('17亿元'))?.contentType,
  'article',
  '正文可能内嵌视频的稿件必须仍是文章条目',
)
assert.ok(!titles.some((title) => title.includes('KTV')))
assert.ok(!titles.some((title) => title.includes('歌厅')))
assert.ok(titles.includes('央视记录片：现场画面'))
assert.equal(articles.find((item) => item.title.includes('央视'))?.contentType, 'video')
assert.ok(!titles.some((title) => title.includes('仿真鱼')), 'App 社区 rec 卡不能混入媒体信源')
assert.equal(articles.length, 2)
assert.equal(neteasePageEntryCount(payload), 6, '分页仍按原始条目数，避免滤掉不支持卡片后提前耗尽')

console.log('netease ugc video filter: ok')
