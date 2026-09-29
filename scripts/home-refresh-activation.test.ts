import assert from 'node:assert/strict'

import { handleHomeNavigationTap } from '../src/lib/homeRefreshActivation'

let navigations = 0
let refreshes = 0
const navigateHome = () => { navigations += 1 }
const refreshHome = () => { refreshes += 1 }

const afterReturnHome = handleHomeNavigationTap({
  isHome: false,
  previousTapAt: 900,
  now: 1_000,
  onNavigateHome: navigateHome,
  onRefresh: refreshHome,
})
assert.equal(afterReturnHome, null, '从子页面点首页只负责返回，不能计入刷新双击')
assert.equal(navigations, 1)
assert.equal(refreshes, 0)

const firstTapAt = handleHomeNavigationTap({
  isHome: true,
  previousTapAt: afterReturnHome,
  now: 1_100,
  onNavigateHome: navigateHome,
  onRefresh: refreshHome,
})
assert.equal(firstTapAt, 1_100, '首页第一次点击只应记录双击起点')
assert.equal(refreshes, 0)

const afterDoubleTap = handleHomeNavigationTap({
  isHome: true,
  previousTapAt: firstTapAt,
  now: 1_430,
  onNavigateHome: navigateHome,
  onRefresh: refreshHome,
})
assert.equal(afterDoubleTap, null, '触发刷新后必须清空双击状态，避免第三击再次触发')
assert.equal(refreshes, 1, '首页 350ms 内第二次点击必须且只能触发一次刷新')

const expiredTapAt = handleHomeNavigationTap({
  isHome: true,
  previousTapAt: 2_000,
  now: 2_351,
  onNavigateHome: navigateHome,
  onRefresh: refreshHome,
})
assert.equal(expiredTapAt, 2_351, '超过双击窗口的点击应成为下一轮第一次点击')
assert.equal(refreshes, 1)

console.log('home navigation double-tap refresh contract ok')
