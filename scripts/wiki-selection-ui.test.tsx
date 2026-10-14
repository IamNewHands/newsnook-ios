import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'

registerHooks({ load(url, context, next) {
  if (/\.css$/.test(url)) return { format: 'module', source: 'export default ""', shortCircuit: true }
  return next(url, context)
} })
const { window } = parseHTML('<html><body><div id="root"></div><div class="reader-prose"><p id="text">量子纠缠</p><button id="reader-button">正文按钮</button><input id="input" /></div><div id="blank"></div></body></html>')
const memory = new Map<string, string>()
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) } })
Object.assign(window, { innerWidth: 390, innerHeight: 844 })
let selectionText = '量子纠缠'
let anchor = document.getElementById('text')!.firstChild!
const selection = {
  get isCollapsed() { return !selectionText }, get rangeCount() { return selectionText ? 1 : 0 },
  get anchorNode() { return anchor }, get focusNode() { return anchor },
  toString: () => selectionText,
  getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 100, top: 200, width: 70, height: 24 }) }),
  removeAllRanges: () => { selectionText = '' },
}
Object.assign(window, { getSelection: () => selection })
const { createRoot } = await import('react-dom/client')
const { WikiSelectionLayer } = await import('../src/features/wiki/WikiSelectionLayer')
const { registerEncyclopediaProvider } = await import('../src/features/wiki/encyclopedia')
const { dismissTopHardwareBackLayer } = await import('../src/lib/hardwareBackStack')
registerEncyclopediaProvider({ id: 'test', name: '测试百科', language: 'zh', async lookup(term) {
  return { query: term, title: term, description: '', summary: '词条摘要', url: 'https://example.test/wiki', providerId: 'test', language: 'zh', related: [] }
} })
memory.set('newsnook.wiki.settings.v1', JSON.stringify({ enabled: true, providerId: 'test', directLookup: false, fallbackEnglish: true }))
const root = createRoot(document.getElementById('root')!)
const peek = () => document.querySelector('.wiki-selection-popover')
const wait = () => new Promise(resolve => setTimeout(resolve, 150))
async function event(target: EventTarget, type: string) {
  await act(async () => { target.dispatchEvent(new window.Event(type, { bubbles: true })); await wait() })
}
async function select() {
  selectionText = '量子纠缠'
  anchor = document.getElementById('text')!.firstChild!
  await event(document.getElementById('text')!, 'pointerup')
  assert.ok(peek(), '正文选词显示浮动工具栏')
}
try {
  await act(async () => root.render(<WikiSelectionLayer />))
  await select()
  // Keep the browser selection intact to exercise the delayed pointerup/touchend race.
  await event(document.getElementById('blank')!, 'pointerdown')
  assert.ok(peek() === null, '点击空白应立即关闭工具栏')
  await event(document.getElementById('blank')!, 'pointerup')
  await event(document.getElementById('blank')!, 'touchend')
  assert.ok(peek() === null, '外部点击后的延迟选区读取不能重新打开工具栏')

  await select()
  await event(document.querySelector('.wiki-popover-item')!, 'pointerdown')
  assert.ok(peek(), '工具栏内部点击不能关闭工具栏')
  await act(async () => document.querySelector<HTMLButtonElement>('.wiki-popover-item')!.click())
  assert.ok(document.querySelector('.wiki-entry-summary'), '百科按钮仍能查询词条')
  await event(document.getElementById('blank')!, 'pointerdown')
  assert.ok(document.querySelector('.wiki-sheet'), '正文外部点击监听不能错误关闭词条面板')
  await act(async () => { dismissTopHardwareBackLayer() })

  let copied = ''
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    clipboard: { async writeText(text: string) { copied = text } },
  } })
  await select()
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="复制所选文字"]')!.click())
  assert.equal(copied, '量子纠缠', '复制按钮使用点击前捕获的选中文字')
  assert.ok(peek() === null, '复制后关闭工具栏')

  selectionText = '量子纠缠'
  const nativeEvent = new window.Event('newsnook:wiki-selection', { cancelable: true })
  await act(async () => { window.dispatchEvent(nativeEvent) })
  assert.ok(nativeEvent.defaultPrevented && peek(), '原生选区创建时通知前端并确认由 App 工具栏接管')
  selectionText = ''
  await event(document, 'selectionchange')
  assert.ok(peek() === null, '系统取消选区时关闭工具栏')

  for (const id of ['input', 'reader-button']) {
    anchor = document.getElementById(id)!
    selectionText = '不可接管'
    const editingEvent = new window.Event('newsnook:wiki-selection', { cancelable: true })
    await act(async () => { window.dispatchEvent(editingEvent) })
    assert.equal(editingEvent.defaultPrevented, false, '输入框和按钮选区应保留系统操作')
    assert.ok(peek() === null)
  }
  await act(async () => window.dispatchEvent(new window.Event('newsnook:open-wiki-settings')))
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="启用划词百科"]')!.click())
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭百科"]')!.click())
  anchor = document.getElementById('text')!.firstChild!
  selectionText = '量子纠缠'
  const disabledEvent = new window.Event('newsnook:wiki-selection', { cancelable: true })
  await act(async () => window.dispatchEvent(disabledEvent))
  assert.equal(disabledEvent.defaultPrevented, false, '关闭划词百科后应保留系统选词菜单')
  assert.ok(peek() === null)
  await act(async () => root.unmount())
  await event(document, 'pointerup')
} finally {
  await act(async () => root.unmount())
}
console.log('wiki-selection-ui: ok')

