import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number
window.cancelAnimationFrame = (id: number) => clearTimeout(id)
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  requestAnimationFrame: window.requestAnimationFrame,
  cancelAnimationFrame: window.cancelAnimationFrame,
  React,
  IS_REACT_ACT_ENVIRONMENT: true,
})

const { createRoot } = await import('react-dom/client')
const { FeedLayoutSwitcher } = await import('../src/components/FeedLayoutSwitcher')
const root = createRoot(document.getElementById('root')!)

let currentLayout = 'cards' as const
let lastChangedLayout: string | null = null

await act(async () => {
  root.render(
    <FeedLayoutSwitcher
      layout={currentLayout}
      onChange={(next) => {
        lastChangedLayout = next
      }}
    />,
  )
})

const container = document.getElementById('root')!
const radioGroup = container.querySelector('[role="radiogroup"]')
assert.ok(radioGroup, '布局切换器必须具有 radiogroup 语义')
assert.equal(radioGroup.getAttribute('aria-label'), '视图布局')

const buttons = container.querySelectorAll('button[role="radio"]')
assert.equal(buttons.length, 2, '必须提供卡片与列表两个选项按钮')

const cardsButton = buttons[0] as HTMLButtonElement
const listButton = buttons[1] as HTMLButtonElement

assert.equal(cardsButton.getAttribute('aria-label'), '卡片视图')
assert.equal(cardsButton.getAttribute('aria-checked'), 'true', '卡片模式下卡片选项应为选中状态')
assert.equal(listButton.getAttribute('aria-label'), '列表视图')
assert.equal(listButton.getAttribute('aria-checked'), 'false', '卡片模式下列表选项应为未选中状态')

// 点击已激活的卡片按钮，应幂等不触发变更
lastChangedLayout = null
await act(async () => {
  cardsButton.click()
})
assert.equal(lastChangedLayout, null, '点击当前已选中的卡片选项不应重复触发变更')

// 点击列表按钮，应触发切换为 classic
await act(async () => {
  listButton.click()
})
assert.equal(lastChangedLayout, 'classic', '点击列表按钮应触发 classic 布局切换')

// 更新为 classic 布局并重新渲染
currentLayout = 'classic'
await act(async () => {
  root.render(
    <FeedLayoutSwitcher
      layout={currentLayout}
      onChange={(next) => {
        lastChangedLayout = next
      }}
    />,
  )
})

assert.equal(cardsButton.getAttribute('aria-checked'), 'false', '经典模式下卡片选项应为未选中状态')
assert.equal(listButton.getAttribute('aria-checked'), 'true', '经典模式下列表选项应为选中状态')

// 点击卡片按钮，应触发切换为 cards
lastChangedLayout = null
await act(async () => {
  cardsButton.click()
})
assert.equal(lastChangedLayout, 'cards', '点击卡片按钮应触发 cards 布局切换')

// 验证 FeedScreen 顶部集成：当传入 onHomeFeedLayoutChange 时，顶部应渲染布局切换器
window.matchMedia = ((_query: string) => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
})) as any
Object.assign(globalThis, { MutationObserver: window.MutationObserver })

const { FeedScreen } = await import('../src/screens/FeedScreen')
let feedLayoutState = 'cards' as const
let feedLayoutChanged: string | null = null

await act(async () => {
  root.render(
    <FeedScreen
      title="有所闻"
      caption="科技资讯"
      articles={[]}
      statuses={[]}
      refreshing={false}
      showLead={false}
      readIds={new Set()}
      laterIds={new Set()}
      homeFeedLayout={feedLayoutState}
      onHomeFeedLayoutChange={(next) => {
        feedLayoutChanged = next
      }}
      onOpen={() => {}}
      onRefresh={async () => {}}
    />,
  )
})

const feedSwitcher = container.querySelector('[role="radiogroup"][aria-label="视图布局"]')
assert.ok(feedSwitcher, 'FeedScreen 顶部必须渲染视图布局切换器')

const feedRadioButtons = feedSwitcher.querySelectorAll('button[role="radio"]')
assert.equal(feedRadioButtons.length, 2)
assert.equal(feedRadioButtons[0]?.getAttribute('aria-checked'), 'true')

await act(async () => {
  (feedRadioButtons[1] as HTMLButtonElement).click()
})
assert.equal(feedLayoutChanged, 'classic', '在 FeedScreen 顶部点击列表选项应触发布局变更')

// 验证无论卡片还是列表模式，顶部均统一保持品牌标题与「更大的世界，更好的判断」标语
await act(async () => {
  root.render(
    <FeedScreen
      title="有所闻"
      caption="科技资讯"
      articles={[]}
      statuses={[]}
      refreshing={false}
      showLead={false}
      readIds={new Set()}
      laterIds={new Set()}
      homeFeedLayout="classic"
      onHomeFeedLayoutChange={() => {}}
      onBrandTap={() => {}}
      onOpen={() => {}}
      onRefresh={async () => {}}
    />,
  )
})

assert.ok(
  container.textContent?.includes('更大的世界，更好的判断'),
  '经典列表模式下顶部标语「更大的世界，更好的判断」也必须始终展示',
)

await act(async () => {
  root.render(
    <FeedScreen
      title="有所闻"
      caption="科技资讯"
      articles={[]}
      statuses={[]}
      refreshing={false}
      showLead={false}
      readIds={new Set()}
      laterIds={new Set()}
      homeFeedLayout="cards"
      onHomeFeedLayoutChange={() => {}}
      onBrandTap={() => {}}
      onOpen={() => {}}
      onRefresh={async () => {}}
    />,
  )
})

assert.ok(
  container.textContent?.includes('更大的世界，更好的判断'),
  '卡片模式下顶部标语「更大的世界，更好的判断」也必须始终展示',
)

// 验证顶部品牌区域视觉平衡设计：使用紧贴图形边界的 tight logo 与底部对齐
const brandButton = container.querySelector('button[aria-label="有所闻 - 返回顶部"]')
assert.ok(brandButton, '顶部应渲染返回顶部的品牌按钮')
assert.ok(brandButton.className.includes('items-end'), '品牌按钮内 Logo 与标语应底部对齐')
assert.ok(brandButton.className.includes('gap-1.5'), '品牌按钮内 Logo 与标语间距应紧凑平衡')
assert.ok(
  brandButton.querySelector('svg[data-brand-logo="tight"]'),
  '品牌按钮内应使用精确贴合图形边界的 tight BrandLogo',
)

console.log('feed-layout-switcher: ok')
