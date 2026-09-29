import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'

const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  React,
  IS_REACT_ACT_ENVIRONMENT: true,
})

const { createRoot } = await import('react-dom/client')
const { HomeRefreshButton } = await import('../src/components/HomeRefreshButton')

const root = createRoot(document.getElementById('root')!)
let navigations = 0
let refreshes = 0
let releaseRefresh: (() => void) | null = null

async function render(active: boolean, asyncRefresh = false) {
  await act(async () => {
    root.render(
      <HomeRefreshButton
        active={active}
        onNavigateHome={() => { navigations += 1 }}
        onRefresh={() => {
          refreshes += 1
          if (!asyncRefresh) return
          return new Promise<void>((resolve) => { releaseRefresh = resolve })
        }}
        aria-label="首页"
      >
        首页
      </HomeRefreshButton>,
    )
  })
}

async function click() {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button[aria-label="首页"]')!.click()
  })
}

try {
  await render(true)
  await click()
  assert.equal(refreshes, 0, '首页第一次点击不能刷新')
  await click()
  assert.equal(refreshes, 1, '首页第二次连续点击必须刷新一次')
  assert.equal(navigations, 0)

  await render(true, true)
  await click()
  await click()
  assert.equal(refreshes, 2, '异步刷新应正常启动')
  await click()
  await click()
  assert.equal(refreshes, 2, '刷新未完成时再次双击不能发起重复请求')
  releaseRefresh?.()
  await act(async () => { await Promise.resolve() })

  await render(false)
  await click()
  assert.equal(navigations, 1, '不在首页时点击只能返回首页')
  assert.equal(refreshes, 2)

  await render(true)
  await click()
  assert.equal(refreshes, 2, '从子页返回后的第一次首页点击不能沿用旧双击状态')

  const zhihuWorkspace = readFileSync(new URL('../src/features/zhihu/ui/ZhihuWorkspace.tsx', import.meta.url), 'utf8')
  const zhihuFeedScreen = readFileSync(new URL('../src/features/zhihu/ui/ZhihuFeedScreen.tsx', import.meta.url), 'utf8')
  const linuxDoWorkspace = readFileSync(new URL('../src/features/linuxdo/ui/LinuxDoWorkspace.tsx', import.meta.url), 'utf8')
  assert.match(zhihuWorkspace, /<HomeRefreshButton[\s\S]*active=\{current\.route\.screen === 'feed'\}[\s\S]*onRefresh=\{refreshHomeFeed\}/, '知乎底部首页必须接入共享双击刷新按钮')
  assert.match(zhihuWorkspace, /feedHomeRefreshRef\.current\?\.\(\)/, '知乎底部双击刷新必须调用信息流自身的刷新触发器')
  assert.match(zhihuFeedScreen, /trigger:\s*triggerPullRefresh/, '知乎信息流必须暴露统一下拉刷新 hook 的程序化 trigger')
  assert.match(zhihuFeedScreen, /homeRefreshRef\.current = triggerPullRefresh/, '知乎双击刷新必须复用下拉刷新动画与刷新流程')
  assert.match(linuxDoWorkspace, /<HomeRefreshButton[\s\S]*active=\{route\.kind === 'feed'\}[\s\S]*feedHomeRefreshRef\.current/, 'LinuxDO 底部首页必须接入共享双击刷新按钮')
  assert.match(linuxDoWorkspace, /scrollerRef\.current\.scrollTo\(\{ top: 0 \}\)[\s\S]*void load\(true\)/, 'LinuxDO 双击首页必须先滚顶再刷新当前频道')
  assert.match(linuxDoWorkspace, /lastFeedModeRef/, 'LinuxDO 从非首页返回时必须保留此前的首页频道')

  console.log('home refresh button/workspace integration ok')
} finally {
  await act(async () => root.unmount())
}
