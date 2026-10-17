import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver,
  React,
  IS_REACT_ACT_ENVIRONMENT: true,
})
const { createRoot } = await import('react-dom/client')
const { BrowserPlacesPanel } = await import('../src/features/browser/BrowserPlacesPanel')
const { BrowserTabsPanel } = await import('../src/features/browser/BrowserTabsPanel')
const { BrowserSettingsPanel } = await import('../src/features/browser/BrowserSettingsPanel')
const root = createRoot(window.document.getElementById('root')!)

function button(label: string) {
  const control = [...window.document.querySelectorAll('button')].find(item =>
    item.getAttribute('aria-label') === label || item.textContent?.trim() === label)
  assert.ok(control, `缺少按钮：${label}`)
  return control
}

async function click(control: Element) {
  await act(async () => {
    control.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }))
  })
}

async function pressKey(control: Element, key: string) {
  const event = new window.Event('keydown', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'key', { value: key })
  await act(async () => { control.dispatchEvent(event) })
}

async function search(value: string) {
  const input = window.document.querySelector('input[type="search"]') as HTMLInputElement | null
  assert.ok(input, '历史和书签提供搜索')
  await act(async () => {
    input.value = value
    input.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true }))
  })
}

const now = new Date(2026, 9, 17, 15, 30).getTime()
const entries = [
  { title: '构建可读的网页', url: 'https://developer.mozilla.org/zh-CN/docs/Web', time: now },
  { title: '设计记录', url: 'https://design.example.com/notes', time: now - 86_400_000 },
]
const calls = {
  back: 0,
  clear: 0,
  restore: 0,
  opened: [] as string[],
  removed: [] as string[],
  options: [] as string[],
  selected: [] as number[],
  closed: [] as number[],
  newTab: 0,
  engines: [] as string[],
  positions: [] as boolean[],
  desktop: 0,
}
const placesProps = {
  entries,
  hiddenHostCount: 2,
  onBack: () => { calls.back++ },
  onOpen: (url: string) => { calls.opened.push(url) },
  onRemove: (url: string) => { calls.removed.push(url) },
  onClear: () => { calls.clear++ },
  onRestoreHidden: () => { calls.restore++ },
  onHistoryOptions: (entry: typeof entries[number]) => { calls.options.push(entry.url) },
}
const tabs = [
  { index: 0, id: 42, title: 'Mozilla 开发者网络', url: entries[0].url, active: true, loading: false },
  { index: 1, id: 77, title: '设计记录', url: entries[1].url, active: false, loading: true },
]
const tabProps = {
  pending: false,
  onBack: () => { calls.back++ },
  onSelect: (tab: typeof tabs[number]) => { calls.selected.push(tab.id) },
  onRemove: (tab: typeof tabs[number]) => { calls.closed.push(tab.id) },
  onNew: () => { calls.newTab++ },
}
const settingsProps = {
  search: 'bing' as const,
  bottomAddress: false,
  desktop: false,
  hasPage: false,
  historyCount: 2,
  onBack: () => { calls.back++ },
  onSearchChange: (id: string) => { calls.engines.push(id) },
  onAddressPositionChange: (bottom: boolean) => { calls.positions.push(bottom) },
  onDesktopChange: () => { calls.desktop++ },
  onClearHistory: () => { calls.clear++ },
}

try {
  await act(async () => root.render(<BrowserPlacesPanel kind="history" {...placesProps} />))
  assert.equal(window.document.querySelectorAll('header button[aria-label="返回浏览器"]').length, 1)
  assert.equal(window.document.querySelectorAll('time').length, 2, '历史展示每条记录的真实访问时间')
  assert.equal(window.document.querySelectorAll('[data-date-group]').length, 2, '历史按日期分组')
  await click(button('打开：构建可读的网页'))
  assert.deepEqual(calls.opened, [entries[0].url])
  await click(button('更多操作：构建可读的网页'))
  assert.deepEqual(calls.options, [entries[0].url])
  assert.equal(calls.opened.length, 1, '更多入口不会打开网页')
  await click(button('删除：设计记录'))
  assert.deepEqual(calls.removed, [entries[1].url])
  await click(button('恢复首页隐藏的网站'))
  assert.equal(calls.restore, 1)
  await search('设计')
  assert.ok(window.document.body.textContent?.includes('设计记录'))
  assert.ok(!window.document.body.textContent?.includes('构建可读的网页'), '按标题即时过滤')
  await search('MDN不存在')
  assert.ok(window.document.body.textContent?.includes('没有找到相关记录'))
  await search('DEVELOPER.MOZILLA')
  assert.ok(window.document.body.textContent?.includes('构建可读的网页'), '网址搜索不区分大小写')
  assert.ok(!window.document.body.textContent?.includes('设计记录'))
  await click(button('清空搜索'))
  assert.ok(window.document.body.textContent?.includes('设计记录'))
  await click(button('清空浏览历史'))
  assert.equal(calls.clear, 1, '清空交由父级确认和执行')
  await click(button('返回浏览器'))
  assert.equal(calls.back, 1)
  await act(async () => root.render(<BrowserPlacesPanel key="bookmarks" kind="bookmarks" {...placesProps} />))
  assert.ok(!window.document.querySelector('button[aria-label^="更多操作："]'), '书签不混入历史选项')
  assert.ok(!window.document.querySelector('button[aria-label="恢复首页隐藏的网站"]'))
  await search('设计')
  assert.ok(window.document.body.textContent?.includes('设计记录'))
  assert.ok(!window.document.body.textContent?.includes('构建可读的网页'), '书签支持搜索')
  await click(button('删除：设计记录'))
  assert.equal(calls.removed.length, 2)
  await click(button('清空书签'))
  assert.equal(calls.clear, 2)
  await act(async () => root.render(<BrowserPlacesPanel key="empty-history" kind="history" {...placesProps} entries={[]} hiddenHostCount={0} />))
  assert.ok(window.document.body.textContent?.includes('暂无浏览历史'))
  assert.ok(!window.document.querySelector('button[aria-label="清空浏览历史"]'))
  await act(async () => root.render(<BrowserPlacesPanel key="empty-bookmarks" kind="bookmarks" {...placesProps} entries={[]} />))
  assert.ok(window.document.body.textContent?.includes('暂无书签'))

  await act(async () => root.render(<BrowserTabsPanel tabs={tabs} {...tabProps} />))
  assert.equal(window.document.querySelector('h2')?.textContent, '标签页')
  assert.equal(window.document.querySelectorAll('button[aria-current="page"]').length, 1)
  assert.ok(window.document.body.textContent?.includes('developer.mozilla.org'))
  await click(button('打开标签页：设计记录'))
  assert.deepEqual(calls.selected, [77])
  await click(button('关闭标签页：设计记录'))
  assert.deepEqual(calls.closed, [77])
  assert.deepEqual(calls.selected, [77], '关闭卡片不会触发切换')
  await click(button('新建标签页'))
  assert.equal(calls.newTab, 1)
  const sixTabs = Array.from({ length: 6 }, (_, index) => ({
    ...tabs[0], index, id: index + 100, active: index === 0, title: `标签 ${index + 1}`,
  }))
  await act(async () => root.render(<BrowserTabsPanel tabs={sixTabs} {...tabProps} />))
  assert.ok(button('新建标签页').hasAttribute('disabled'))
  await click(button('新建标签页'))
  assert.equal(calls.newTab, 1, '六标签上限不触发新建')
  assert.ok(window.document.body.textContent?.includes('最多同时打开 6 个标签页'))
  await act(async () => root.render(<BrowserTabsPanel tabs={tabs} {...tabProps} pending />))
  assert.ok(button('打开标签页：设计记录').hasAttribute('disabled'))
  assert.ok(button('关闭标签页：设计记录').hasAttribute('disabled'))
  assert.ok(button('新建标签页').hasAttribute('disabled'))
  await act(async () => root.render(<BrowserTabsPanel tabs={[]} {...tabProps} />))
  assert.ok(window.document.body.textContent?.includes('主页'), '没有原生标签时显示当前主页')
  assert.equal(window.document.querySelectorAll('button[aria-label^="关闭标签页："]').length, 0)
  await click(button('返回主页'))
  assert.equal(calls.back, 2)
  await click(button('新建标签页'))
  assert.equal(calls.newTab, 2, '主页仍可新建标签')

  await act(async () => root.render(<BrowserSettingsPanel {...settingsProps} />))
  assert.equal(window.document.querySelectorAll('[role="radio"]').length, 6)
  assert.equal(window.document.querySelectorAll('[role="radio"][aria-checked="true"]').length, 2)
  await click(button('Google'))
  assert.deepEqual(calls.engines, ['google'])
  await pressKey(button('Bing'), 'ArrowLeft')
  assert.equal(calls.engines.at(-1), 'duckduckgo', '方向键循环选择搜索引擎')
  await pressKey(button('Google'), 'Home')
  assert.equal(calls.engines.at(-1), 'duckduckgo', '已选首项不重复写入')
  await pressKey(button('Bing'), 'End')
  assert.equal(calls.engines.at(-1), 'duckduckgo', 'End 键选择最后的搜索引擎')
  await click(button('底部'))
  assert.deepEqual(calls.positions, [true])
  const desktop = window.document.querySelector('[role="switch"]')
  assert.ok(desktop)
  assert.equal(desktop.getAttribute('aria-label'), '桌面版网页')
  assert.ok(desktop.hasAttribute('disabled'))
  await click(desktop)
  assert.equal(calls.desktop, 0, '没有网页时禁用桌面模式')
  await click(button('清除浏览历史'))
  assert.equal(calls.clear, 3)
  await act(async () => root.render(<BrowserSettingsPanel {...settingsProps} search="google" bottomAddress hasPage desktop />))
  assert.equal(button('Google').getAttribute('aria-checked'), 'true')
  assert.equal(button('底部').getAttribute('aria-checked'), 'true')
  const activeSwitch = window.document.querySelector('[role="switch"]')!
  assert.equal(activeSwitch.getAttribute('aria-checked'), 'true')
  await click(activeSwitch)
  assert.equal(calls.desktop, 1)
  await act(async () => root.render(<BrowserSettingsPanel {...settingsProps} hasPage pending />))
  const pendingSwitch = window.document.querySelector('[role="switch"]')!
  assert.ok(pendingSwitch.hasAttribute('disabled'), '原生操作等待时禁用桌面模式')
  await click(pendingSwitch)
  assert.equal(calls.desktop, 1, '等待状态不会再次提交桌面模式切换')
  await act(async () => root.render(<BrowserSettingsPanel {...settingsProps} historyCount={0} />))
  assert.ok(button('清除浏览历史').hasAttribute('disabled'))
  await click(button('清除浏览历史'))
  assert.equal(calls.clear, 3, '空历史没有可执行的清除操作')
  console.log('browser product panels: history/bookmark filtering and actions, dates, tab limits, independent close, settings callbacks and disabled states OK')
} finally {
  await act(async () => root.unmount())
}
