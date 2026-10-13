import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act, useState } from 'react'

const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
})
window.HTMLElement.prototype.getBoundingClientRect = () => ({
  left: 0, top: 0, bottom: 180, right: 220, width: 220, height: 180,
}) as DOMRect
Object.assign(window, { innerWidth: 390, innerHeight: 844 })
// React's input event feature detection needs the browser's oninput property.
Object.assign(window.document, { oninput: null })

const { createRoot } = await import('react-dom/client')
const { PresetSwitcher } = await import('../src/components/PresetSwitcher')
const presetModel = await import('../src/sources/presets')
const sourceModel = await import('../src/sources/preferences')
const { dismissTopHardwareBackLayer } = await import('../src/lib/hardwareBackStack')

let storedPresets = presetModel.buildFreshInstallPresetsState()
for (const name of ['晨读', '晚读', '周末']) {
  storedPresets = presetModel.createBlankUserPreset(storedPresets, name).state
}
let storedPrefs = sourceModel.DEFAULT_PREFERENCES
for (const [name, kind] of [
  ['站点甲', 'web-catalog'], ['RSS', 'feed'], ['站点乙', 'web-catalog'],
] as const) {
  storedPrefs = sourceModel.addCustomSource(storedPrefs, {
    name, kind, url: `https://${name === '站点甲' ? 'a' : name === '站点乙' ? 'b' : 'rss'}.example.test`,
  }).nextPrefs
}
let selections = 0
let replacePrefs: (prefs: typeof storedPrefs) => void
function Harness() {
  const [presets, setPresets] = useState(storedPresets)
  const [prefs, setPrefs] = useState(storedPrefs)
  replacePrefs = setPrefs
  return <PresetSwitcher
    activeName="周末"
    items={[
      ...presetModel.BUILTIN_PRESETS.map((item) => ({ ...item, active: false })),
      ...presets.userPresets.map((item) => ({ ...item, active: item.id === presets.activePresetId })),
    ]}
    onSelect={() => { selections += 1 }}
    onManage={() => undefined}
    onRenamePreset={(id, name) => {
      storedPresets = presetModel.renameUserPreset(presets, id, name)
      setPresets(storedPresets)
    }}
    onMovePreset={(id, direction) => {
      storedPresets = presetModel.moveUserPreset(presets, id, direction)
      setPresets(storedPresets)
    }}
    cmsSites={prefs.customSources?.filter((source) => source.kind === 'web-catalog') ?? []}
    onSelectCms={() => { selections += 1 }}
    onRenameCms={(id, name) => {
      storedPrefs = sourceModel.renameSource(prefs, id, name)
      setPrefs(storedPrefs)
    }}
    onMoveCms={(id, direction) => {
      storedPrefs = sourceModel.moveCmsSource(prefs, id, direction)
      setPrefs(storedPrefs)
    }}
  />
}

const root = createRoot(document.getElementById('root')!)
function button(text: string): HTMLButtonElement {
  const match = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((node) => node.textContent?.includes(text))
  assert.ok(match, `expected button: ${text}`)
  return match
}
async function click(element: HTMLElement) {
  await act(async () => element.click())
}
async function pointer(element: HTMLElement, type: string, y = 100) {
  await act(async () => {
    element.dispatchEvent(Object.assign(new window.Event(type, { bubbles: true }), {
      clientX: 100, clientY: y, isPrimary: true, pointerType: 'touch', button: 0,
    }))
  })
}
async function longPress(element: HTMLElement) {
  await pointer(element, 'pointerdown')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 520)) })
  await pointer(element, 'pointerup')
}
async function enterName(name: string) {
  // Use the input's real React change handler through a bubbling input event.
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!
  await act(async () => {
    // linkedom does not default an input without a type attribute to text.
    input.type = 'text'
    // Bypass React's tracker, as a browser's user input does.
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, name)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}
async function renameTo(name: string) {
  await enterName(name)
  await click(button('保存'))
}
function cardNames() {
  return [...document.querySelectorAll('ul > li button span.font-display')].map((node) => node.textContent)
}

try {
  await act(async () => root.render(<Harness />))
  await click(document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!)
  const morning = button('晨读')
  await longPress(morning)
  assert.ok(document.querySelector('[role="menu"]'), '长按自定义预设应打开管理菜单')
  await click(morning)
  assert.equal(selections, 0, '长按释放后的 click 不得应用预设')
  assert.equal([...document.querySelectorAll('[role="menuitem"]')].some((node) => node.textContent === '向前移动'), false,
    '首项不能继续前移')
  await click(button('向后移动'))
  assert.deepEqual(cardNames(), ['晚读', '晨读', '周末'])
  assert.equal(storedPresets.activePresetId, storedPresets.userPresets[2].id, '移动不得改变当前预设')
  await longPress(button('晨读'))
  await click(button('重命名预设'))
  const prompt = document.querySelector('input')!.closest('[role="presentation"]') as HTMLElement
  assert.ok(Number(prompt.style.zIndex) > 80, '输入弹窗必须位于布局切换抽屉之上')
  await renameTo('清晨')
  assert.ok(document.body.textContent?.includes('清晨'), '保存后应立即显示新名称')
  assert.equal(storedPresets.userPresets[1].name, '清晨')
  await longPress(button('清晨'))
  await act(async () => {
    window.dispatchEvent(Object.assign(new window.Event('keydown'), { key: 'Escape' }))
  })
  assert.equal(document.querySelector('[role="menu"]'), null)
  assert.ok(document.querySelector('[role="dialog"]'), 'Escape 只应关闭最上层菜单')
  await act(async () => {
    button('清晨').dispatchEvent(Object.assign(new window.Event('keydown', { bubbles: true }), {
      key: 'F10', shiftKey: true,
    }))
  })
  await click(button('重命名预设'))
  await enterName('   ')
  assert.equal(button('保存').disabled, true, '空白名称不能保存')
  await act(async () => { assert.equal(dismissTopHardwareBackLayer(), true) })
  assert.equal(document.querySelector('input'), null, '返回键应先关闭改名弹窗')
  assert.deepEqual(cardNames(), ['晚读', '清晨', '周末'], '取消重命名保留原名称和列表')

  await click(button('CMS 站点'))
  await longPress(button('站点乙'))
  await click(button('向前移动'))
  assert.deepEqual(cardNames(), ['站点乙', '站点甲'])
  assert.deepEqual(storedPrefs.customSources?.map((source) => source.name), ['站点乙', 'RSS', '站点甲'],
    'CMS 排序应跨过 RSS，保持 RSS 的位置和数据')
  await act(async () => {
    button('站点乙').dispatchEvent(Object.assign(new window.Event('contextmenu', { bubbles: true }), {
      clientX: 100, clientY: 100,
    }))
  })
  await click(button('向后移动'))
  assert.deepEqual(cardNames(), ['站点甲', '站点乙'], '右键菜单也可以调整 CMS 顺序')
  await longPress(button('站点乙'))
  await click(button('向前移动'))
  await longPress(button('站点乙'))
  await click(button('重命名站点'))
  await renameTo('影视收藏')
  assert.equal(storedPrefs.customSources?.[0].name, '影视收藏')
  assert.equal(storedPrefs.customSources?.[0].url, 'https://b.example.test', '改名不得改变订阅地址')
  assert.deepEqual(cardNames(), ['影视收藏', '站点甲'])
  await longPress(button('影视收藏'))
  await act(async () => { assert.equal(dismissTopHardwareBackLayer(), true) })
  assert.equal(document.querySelector('[role="menu"]'), null)
  assert.ok(document.querySelector('[role="dialog"]'), '返回键只关闭管理菜单')

  const card = button('站点甲')
  await pointer(card, 'pointerdown')
  await pointer(card, 'pointermove', 140)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 520)) })
  await pointer(card, 'pointerup')
  assert.equal(document.querySelector('[role="menu"]'), null, '滚动卡片应取消长按')
  await click(card)
  assert.equal(selections, 1, '短按仍然打开站点')

  // Reopen after serialized state restoration: names and ordering must survive.
  storedPresets = presetModel.normalizePresetsState(JSON.parse(JSON.stringify(storedPresets)))!
  storedPrefs = sourceModel.normalizePreferences(JSON.parse(JSON.stringify(storedPrefs)))
  await act(async () => root.render(<Harness key="restored" />))
  await click(document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!)
  assert.deepEqual(cardNames(), ['晚读', '清晨', '周末'])
  await click(button('CMS 站点'))
  assert.deepEqual(cardNames(), ['影视收藏', '站点甲'])
  const firstCmsId = storedPrefs.customSources![0].id
  assert.equal(sourceModel.moveCmsSource(storedPrefs, firstCmsId, -1), storedPrefs)
  assert.equal(sourceModel.moveCmsSource(storedPrefs, storedPrefs.customSources![2].id, 1), storedPrefs)
  assert.equal(sourceModel.moveCmsSource(storedPrefs, storedPrefs.customSources![1].id, 1), storedPrefs)
  assert.equal(sourceModel.moveCmsSource(storedPrefs, 'missing', 1), storedPrefs)
  assert.equal(presetModel.moveUserPreset(storedPresets, storedPresets.userPresets[0].id, -1), storedPresets)
  assert.equal(presetModel.moveUserPreset(storedPresets, storedPresets.userPresets[2].id, 1), storedPresets)
  assert.equal(presetModel.moveUserPreset(storedPresets, presetModel.BUILTIN_PRESETS[0].id, 1), storedPresets)
  assert.equal(presetModel.moveUserPreset(storedPresets, 'missing', 1), storedPresets)
  // A source may disappear during a cloud pull while its overlay is visible.
  await longPress(button('影视收藏'))
  await act(async () => replacePrefs(sourceModel.deleteCustomSource(storedPrefs, firstCmsId)))
  assert.equal(document.querySelector('[role="menu"]'), null, '目标删除后菜单应消失')
  await act(async () => { assert.equal(dismissTopHardwareBackLayer(), true) })
  assert.equal(document.querySelector('[role="dialog"]'), null, '目标消失后抽屉仍能正常返回')
  await act(async () => replacePrefs(storedPrefs))
  await click(document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!)
  await click(button('CMS 站点'))
  await longPress(button('影视收藏'))
  await click(button('重命名站点'))
  await act(async () => replacePrefs(sourceModel.deleteCustomSource(storedPrefs, firstCmsId)))
  assert.equal(document.querySelector('input'), null, '目标删除后改名弹窗应消失')
  await act(async () => { assert.equal(dismissTopHardwareBackLayer(), true) })
  assert.equal(document.querySelector('[role="dialog"]'), null)
  console.log('preset switcher actions: ok')
} finally {
  await act(async () => root.unmount())
}
