import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
import type { ReadingHistoryEntry } from '../src/features/readingHistory/store'
import type { Article } from '../src/lib/types'

;(globalThis as typeof globalThis & { React: typeof React }).React = React
const { HistoryScreen } = await import('../src/screens/settings/HistoryScreen')

const at = Date.now()
const article: Article = {
  id: 'article-01', title: '从工程实践到长标题截断测试：储能系统与能源网络架构的思考',
  summary: '测试摘要，验证在窄屏中可以自然换行并不会被右侧图片和按钮过度挤压。',
  publishedAt: at, hasRealDate: true, sourceId: 'feed-1', sourceName: '新能源观察',
  sourceLabel: '新能源观察', sourceGroup: 'custom', originUrl: 'https://example.com/post',
}
const history: ReadingHistoryEntry[] = [
  { key: 'a', kind: 'article', origin: 'feed', article, title: article.title, sourceLabel: '新能源观察',
    excerpt: article.summary, readAt: at, firstReadAt: at, visits: 3, image: 'https://example.com/cover.png' },
  { key: 'b', kind: 'linuxdo', origin: 'linuxdo', topicId: 8, slug: 'demo', title: 'Linux.do 测试文章',
    sourceLabel: 'Linux.do', readAt: at - 1000, firstReadAt: at - 1000, visits: 1 },
  { key: 'c', kind: 'zhihu', origin: 'zhihu', ref: { kind: 'answer', id: '98' }, title: '知乎回答标题',
    sourceLabel: '知乎', readAt: at - 2000, firstReadAt: at - 2000, visits: 1 },
  { key: 'd', kind: 'article', origin: 'cms', article, title: 'CMS 长文章',
    sourceLabel: '某站专栏', readAt: at - 3000, firstReadAt: at - 3000, visits: 1 },
]
const noop = () => {}
const html = renderToStaticMarkup(<HistoryScreen history={history} onOpen={noop} onBack={noop}
  onRemove={noop} onClear={noop} onBatchRemove={noop} onRestore={noop} />)
const { document } = parseHTML(html)
const shell = document.querySelector('.history-archive-shell')
assert.ok(shell, '必须在设置外壳上隔离最近阅读整页样式')
const toolbar = document.querySelector('.history-archive-toolbar')
const scroller = document.querySelector('.paper-settings-shell-scroll')
assert.ok(toolbar && scroller, '必须存在固定检索工具栏和单独滚动的阅读列表')
assert.equal(toolbar.closest('.paper-settings-shell-toolbar')?.nextElementSibling, scroller, '工具栏应当位于滚动列表之前')
assert.ok(!scroller.contains(toolbar), '搜索筛选区不能随文章滚动消失')
assert.ok(document.querySelector('.history-archive-head-count')?.textContent?.includes('4'), '篇数应与标题位于同一行')
assert.equal(document.querySelector('.paper-settings-shell-caption'), null, '去掉旧版标题下解释性副文案')
assert.ok(document.querySelector('button[aria-label="更多操作"]'), '清空入口收起到顶部更多菜单')
assert.ok(document.querySelector('.history-archive-search'), '搜索使用示意稿的全宽布局')
assert.equal(document.querySelectorAll('.history-archive-filter').length, 5)
assert.equal(document.querySelectorAll('.history-archive-entry').length, 4)
assert.equal(document.querySelectorAll('.history-entry-more').length, 4, '每条记录应有独立更多操作')
assert.equal(document.querySelectorAll('.history-entry-source-sign').length, 4, '来源显示紧凑单字图标')
assert.equal(document.querySelectorAll('.history-archive-entry > button[aria-label^="打开"]').length, 4)
assert.equal(document.querySelectorAll('.history-editorial-summary').length, 0, '不得保留旧版统计栏')
for (const button of document.querySelectorAll('button')) {
  assert.equal(button.querySelector('button'), null, '不能在按钮内部嵌套按钮')
}
for (const label of ['最近阅读', '选择', '资讯 / RSS', 'Linux.do', '知乎', '专栏 / CMS', '最近浏览', '重温 3 次']) {
  assert.ok(shell.textContent?.includes(label), `业务 UI 丢失：${label}`)
}
const styles = readFileSync('src/styles/history-editorial.css', 'utf8')
assert.doesNotMatch(styles, /#[a-f0-9]{3,8}\b/i, '最近阅读不能写死十六进制调色板')
assert.doesNotMatch(styles, /\b(?:rgb|rgba|hsl|hsla)\(\s*\d/i, '最近阅读颜色不能脱离主题 token')
assert.match(styles, /--history-bg:\s*var\(--tone-ink\)/, '背景必须从全局主题获取')
assert.match(styles, /--history-accent:\s*var\(--tone-cinnabar\)/, '强调色应随主题方案变化')
assert.match(styles, /--history-rule:\s*var\(--tone-haze\)/, '分隔线应随主题方案变化')
assert.match(styles, /--history-accent-wash:\s*rgb\(var\(--tone-cinnabar-rgb\)/, '选中背景应随主题强调色变化')
assert.match(styles, /--history-accent-on:\s*var\(--tone-ink\)/, '主按钮对比文字应使用当前主题底色')
assert.match(styles, /--paper-bg:\s*var\(--tone-ink\)/, '必须覆盖通用设置外壳的固定 ink 配色')
assert.match(styles, /--color-ink:\s*var\(--tone-ink\)/, '必须覆盖通用设置外壳 Tailwind 颜色别名')
assert.match(styles, /--color-paper:\s*var\(--tone-paper\)/)
assert.match(styles, /:root\[data-theme\]\[data-scheme\] \.paper-settings-shell\.history-archive-shell/, '覆盖应高于设置页对 ink 方案的特别样式')
assert.doesNotMatch(styles, /data-scheme=['"](?:ink|celadon|pearl)['"]/, '最近阅读不允许定义与特定主题绑定的特例配色')
console.log('reading-history UI: editorial layout and semantic theme tokens OK')
