import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import type { Article } from '../src/lib/types'
import type { ReadingHistoryEntry } from '../src/features/readingHistory/store'

const { window } = parseHTML('<html data-theme="light" data-scheme="ink"><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
  React, IS_REACT_ACT_ENVIRONMENT: true,
})
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) })
const { createRoot } = await import('react-dom/client')
const { HistoryScreen } = await import('../src/screens/settings/HistoryScreen')
const now = Date.now()
const article: Article = {
  id: 'test-article', title: '完整测试标题', summary: '测试摘要', publishedAt: now,
  hasRealDate: true, sourceId: 'test', sourceName: '测试订阅', sourceLabel: '测试订阅',
  sourceGroup: 'custom', originUrl: 'https://example.org/post',
}
const initial: ReadingHistoryEntry[] = [
  { key: 'first', kind: 'article', article, origin: 'feed', title: article.title,
    sourceLabel: article.sourceLabel, readAt: now, firstReadAt: now, visits: 1 },
  { key: 'second', kind: 'linuxdo', topicId: 23, slug: 'test', origin: 'linuxdo',
    title: 'Linux.do 主题', sourceLabel: 'Linux.do', readAt: now - 1000, firstReadAt: now - 1000, visits: 2 },
]
const root = createRoot(window.document.getElementById('root')!)
let opened: string | undefined
let removed: string[] = []
let cleared = 0
const renderScreen = async (entries: ReadingHistoryEntry[] = initial) => {
  await act(async () => root.render(<HistoryScreen history={entries}
    onBack={() => {}}
    onOpen={(entry) => { opened = entry.key }}
    onRemove={(key) => { removed.push(key) }}
    onBatchRemove={(keys) => { removed = [...removed, ...keys] }}
    onClear={() => { cleared++ }}
    onRestore={() => {}}
  />))
}
const click = async (selector: string) => {
  const target = window.document.querySelector(selector)
  assert.ok(target, `缺少交互控件: ${selector}`)
  await act(async () => { target.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true })) })
}
try {
  await renderScreen()
  await click('.history-archive-open')
  assert.equal(opened, 'first', '正常模式点击文章必须进入原业务阅读器')
  await click('.history-archive-manage')
  assert.ok(window.document.querySelector('.history-archive-check'), '管理模式有复选框')
  await click('.history-archive-check')
  assert.ok(window.document.querySelector('.history-archive-head-count')?.textContent?.includes('已选 1 篇'),
    '点左侧复选框应立即选择记录')
  await click('.history-archive-check')
  assert.ok(window.document.querySelector('.history-archive-head-count')?.textContent?.includes('已选 0 篇'),
    '再次点复选框应取消选择')
  await click('.history-archive-select-all')
  assert.ok(window.document.querySelector('.history-archive-head-count')?.textContent?.includes('已选 2 篇'),
    '全选保留')
  await click('.history-archive-delete-selected')
  assert.ok(window.document.body.textContent?.includes('删除选中的 2 篇记录'), '批量删除确认仍存在')
  await click('.history-archive-sheet-danger')
  assert.deepEqual(removed.sort(), ['first','second'], '批量删除必须回调既有业务')
  await click('.history-archive-header-more')
  await click('.history-archive-menu button')
  assert.ok(window.document.body.textContent?.includes('清空全部阅读记录'), '清空仍需确认')
  await click('.history-archive-sheet-danger')
  assert.equal(cleared, 1, '清空回调仍存在')
} finally {
  await act(async () => root.unmount())
}
console.log('reading-history interactions: open, checkbox, select all, batch delete, clear OK')
