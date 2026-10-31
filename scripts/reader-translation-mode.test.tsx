import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number
window.cancelAnimationFrame = (id: number) => clearTimeout(id)
window.matchMedia = (_query: string) =>
  ({
    matches: false,
    media: _query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList
class MockMutationObserver {
  observe() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  DOMParser: window.DOMParser,
  MutationObserver: MockMutationObserver,
  NodeFilter: { SHOW_TEXT: 4 },
  requestAnimationFrame: window.requestAnimationFrame,
  cancelAnimationFrame: window.cancelAnimationFrame,
  matchMedia: window.matchMedia,
  React,
  IS_REACT_ACT_ENVIRONMENT: true,
})

const { createRoot } = await import('react-dom/client')
const { TranslationService } = await import('../src/features/translation/service')
const { ReaderTranslationBar } = await import('../src/components/ReaderTranslationBar')
const { ReaderTranslationMenu } = await import('../src/components/ReaderTranslationMenu')
import type { TranslationProvider } from '../src/features/translation/types'

// 1. 验证 TranslationService 双模输出（compareHtml 与 replaceHtml 均在内存就绪，支撑 0ms 切模）
const mockProvider: TranslationProvider = {
  id: 'mlkit',
  async translate(request) {
    return request.texts.map((t) => `【译】${t}`)
  },
}

const service = new TranslationService(mockProvider)
const result = await service.translateArticle(
  'Sample Title',
  '<p>First paragraph.</p><p><img src="pic.jpg" alt="photo">Second paragraph.</p>',
  {
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
    displayMode: 'compare',
  },
)

assert.equal(result.title, '【译】Sample Title')
assert.ok(result.compareHtml, '必须生成 compareHtml')
assert.ok(result.replaceHtml, '必须生成 replaceHtml')

// compareHtml 包含原文以及插入的 reader-translation span
assert.match(result.compareHtml, /First paragraph\./)
assert.match(result.compareHtml, /class="reader-translation"[^>]*>【译】First paragraph\./)
assert.match(result.compareHtml, /src="pic\.jpg"/)

// replaceHtml 包含翻译后的正文，保留原有图片媒体
assert.match(result.replaceHtml, /【译】First paragraph\./)
assert.doesNotMatch(result.replaceHtml, /reader-translation/)
assert.match(result.replaceHtml, /src="pic\.jpg"/)
assert.match(result.replaceHtml, /【译】Second paragraph\./)

// 2. 验证 ReaderTranslationBar 悬浮胶囊交互
const container = document.getElementById('root')!
const root = createRoot(container)

let selectedMode: string | null = null
let dismissed = false

await act(async () => {
  root.render(
    <ReaderTranslationBar
      visible={true}
      currentMode="compare"
      onSelectMode={(mode) => {
        selectedMode = mode
      }}
      onDismiss={() => {
        dismissed = true
      }}
    />,
  )
})

const bar = container.querySelector('aside[aria-label="正文翻译切换快捷栏"]')
assert.ok(bar, '应渲染翻译切换快捷栏')

const barButtons = container.querySelectorAll('aside button')
assert.ok(barButtons.length >= 3, '至少应有原文、双语、纯译文三个选项按钮')

const originalBtn = Array.from(barButtons).find((b) => b.textContent?.includes('原文')) as HTMLButtonElement
const compareBtn = Array.from(barButtons).find((b) => b.textContent?.includes('双语')) as HTMLButtonElement
const replaceBtn = Array.from(barButtons).find((b) => b.textContent?.includes('纯译文')) as HTMLButtonElement

assert.ok(originalBtn && compareBtn && replaceBtn, '三个模式按钮均应存在')
assert.equal(compareBtn.getAttribute('aria-checked'), 'true', '双语模式时双语按钮应为 checked')
assert.equal(replaceBtn.getAttribute('aria-checked'), 'false')

// 点击纯译文
selectedMode = null
await act(async () => {
  replaceBtn.click()
})
assert.equal(selectedMode, 'replace', '点击纯译文应通知 replace 模式')

// 点击原文
selectedMode = null
await act(async () => {
  originalBtn.click()
})
assert.equal(selectedMode, 'original', '点击原文应通知 original 模式')

// 点击关闭胶囊
const dismissBtn = container.querySelector('button[aria-label="隐藏快捷切换栏"]') as HTMLButtonElement
assert.ok(dismissBtn, '应提供关闭收起胶囊按钮')
await act(async () => {
  dismissBtn.click()
})
assert.equal(dismissed, true, '点击收起应触发 onDismiss 回调')

// 3. 验证 ReaderTranslationMenu 气泡菜单
let _menuClosed = false
let settingsOpened = false
let menuSelectedMode: string | null = null

await act(async () => {
  root.render(
    <ReaderTranslationMenu
      open={true}
      currentMode="replace"
      onClose={() => {
        _menuClosed = true
      }}
      onSelectMode={(mode) => {
        menuSelectedMode = mode
      }}
      translationPrefs={{
        provider: 'google',
        sourceLanguage: 'en',
        targetLanguage: 'zh-Hans',
        displayMode: 'replace',
        cloud: { google: { apiKey: '', endpoint: '' }, deeplx: { endpoint: '' } },
        ai: { speedRead: { enabled: false, provider: 'openai', model: 'gpt-4o-mini' }, translation: { enabled: false, provider: 'openai', model: 'gpt-4o-mini' }, readAloud: { enabled: false, provider: 'openai', model: 'gpt-4o-mini' }, customProviders: [] },
      }}
      onOpenSettings={() => {
        settingsOpened = true
      }}
    />,
  )
})

const menuDialog = container.querySelector('div[role="dialog"]')
assert.ok(menuDialog, '应有 dialog 属性的气泡菜单')

const backdropBtn = container.querySelector('button[aria-label="关闭翻译菜单"]') as HTMLButtonElement
assert.ok(backdropBtn, '必须有背景遮罩关闭按钮')
await act(async () => {
  backdropBtn.click()
})
assert.equal(_menuClosed, true, '点击遮罩应触发 onClose')

const menuButtons = container.querySelectorAll('div[role="dialog"] button')
const menuCompareBtn = Array.from(menuButtons).find((b) => b.textContent?.includes('双语对照')) as HTMLButtonElement
const menuReplaceBtn = Array.from(menuButtons).find((b) => b.textContent?.includes('仅显示译文')) as HTMLButtonElement
const menuOriginalBtn = Array.from(menuButtons).find((b) => b.textContent?.includes('查看原文')) as HTMLButtonElement

assert.ok(menuCompareBtn && menuReplaceBtn && menuOriginalBtn, '气泡菜单必须包含全部 3 个模式选项')
assert.equal(menuReplaceBtn.getAttribute('aria-checked'), 'true', '当前为 replace 模式时仅显示译文应为 checked')

menuSelectedMode = null
_menuClosed = false
await act(async () => {
  menuCompareBtn.click()
})
assert.equal(menuSelectedMode, 'compare', '点击双语对照应切换到 compare 模式')
assert.equal(_menuClosed, true, '点击模式选项后弹框应自动关闭')

// 点击设置入口
const settingsBtn = Array.from(menuButtons).find((b) => b.textContent?.includes('设置')) as HTMLButtonElement
assert.ok(settingsBtn, '菜单底部应提供偏好设置入口')
await act(async () => {
  settingsBtn.click()
})
assert.equal(settingsOpened, true, '点击设置入口应调用 onOpenSettings')

// 4. 验证设置页 (TranslationScreen) 与阅读器翻译模式底层机制双向互通
const { TranslationScreen } = await import('../src/screens/settings/TranslationScreen')

let currentPrefs = {
  provider: 'google' as const,
  sourceLanguage: 'en' as const,
  targetLanguage: 'zh-Hans' as const,
  displayMode: 'compare' as const,
  cloud: { google: { apiKey: '', endpoint: '' }, deeplx: { endpoint: '' } },
  ai: {
    speedRead: { enabled: false, provider: 'openai' as const, model: 'gpt-4o-mini' },
    translation: { enabled: false, provider: 'openai' as const, model: 'gpt-4o-mini' },
    readAloud: { enabled: false, provider: 'openai' as const, model: 'gpt-4o-mini' },
    customProviders: [],
  },
}

let settingsChangedPrefs: typeof currentPrefs | null = null

await act(async () => {
  root.render(
    <TranslationScreen
      prefs={currentPrefs}
      onChange={(next) => {
        settingsChangedPrefs = next
      }}
      onBack={() => {}}
    />,
  )
})

const modeSectionRadios = container.querySelectorAll('ul.grid button[role="radio"]')
assert.equal(modeSectionRadios.length, 2, '设置页中应渲染双语对照与仅显示译文两个呈现选项')

const settingsCompareBtn = Array.from(modeSectionRadios).find((b) => b.textContent?.includes('双语对照')) as HTMLButtonElement
const settingsReplaceBtn = Array.from(modeSectionRadios).find((b) => b.textContent?.includes('仅显示译文')) as HTMLButtonElement

assert.ok(settingsCompareBtn && settingsReplaceBtn, '设置页中两个呈现按钮均应存在')
assert.equal(settingsCompareBtn.getAttribute('aria-checked'), 'true', '当前偏好为 compare 时设置页双语对照应为 checked')
assert.equal(settingsReplaceBtn.getAttribute('aria-checked'), 'false', '仅显示译文应为 unchecked')

// 在设置页中点击切换到「仅显示译文」
await act(async () => {
  settingsReplaceBtn.click()
})
assert.ok(settingsChangedPrefs, '点击应触发偏好变更')
assert.equal(settingsChangedPrefs.displayMode, 'replace', '设置页中切换应更新 displayMode 为 replace')

// 反向验证：文章内切换触发 onTranslationPrefsChange 更新全局偏好后，设置页读取该偏好并体现选中态
currentPrefs = { ...currentPrefs, displayMode: 'replace' }
await act(async () => {
  root.render(
    <TranslationScreen
      prefs={currentPrefs}
      onChange={(next) => {
        settingsChangedPrefs = next
      }}
      onBack={() => {}}
    />,
  )
})

const updatedCompareBtn = Array.from(container.querySelectorAll('ul.grid button[role="radio"]')).find((b) => b.textContent?.includes('双语对照')) as HTMLButtonElement
const updatedReplaceBtn = Array.from(container.querySelectorAll('ul.grid button[role="radio"]')).find((b) => b.textContent?.includes('仅显示译文')) as HTMLButtonElement

assert.equal(updatedReplaceBtn.getAttribute('aria-checked'), 'true', '文章内修改同步到底层偏好后，设置页应立即显示仅显示译文为选中')
assert.equal(updatedCompareBtn.getAttribute('aria-checked'), 'false', '双语对照应为未选中')

console.log('reader-translation-mode: ok')
