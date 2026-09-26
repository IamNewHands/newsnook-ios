import assert from 'node:assert/strict'

import {
  COMMIT_RATIO,
  COMMIT_VELOCITY,
  EDGE_WIDTH_PX,
  LOWER_START_RATIO,
  MIN_FLING_DISTANCE_PX,
  SWIPE_BACK_MARK_TTL_MS,
  clampDragX,
  clearSwipeBackNavigationMark,
  isEdgeOnlyStart,
  isEdgeStart,
  isSwipeBackNavigation,
  isSwipeBackStart,
  markSwipeBackNavigation,
  resolveLock,
  shouldCommit,
  velocityX,
} from '../src/lib/edgeSwipeBack'

assert.equal(isEdgeStart(0), true)
assert.equal(isEdgeStart(EDGE_WIDTH_PX), true)
assert.equal(isEdgeStart(EDGE_WIDTH_PX + 1), false)
assert.equal(isEdgeStart(100, EDGE_WIDTH_PX, 100), true)
assert.equal(isEdgeStart(100 + EDGE_WIDTH_PX + 1, EDGE_WIDTH_PX, 100), false)

const readerBounds = { left: 100, top: 200, width: 320, height: 640 }
const lowerStartY = readerBounds.top + readerBounds.height * LOWER_START_RATIO
assert.equal(isSwipeBackStart(100, 240, readerBounds), true)
assert.equal(isSwipeBackStart(260, 240, readerBounds), false)
assert.equal(isSwipeBackStart(260, lowerStartY, readerBounds), true)
assert.equal(isSwipeBackStart(419, 839, readerBounds), true)
assert.equal(isSwipeBackStart(421, 839, readerBounds), false)
assert.equal(isSwipeBackStart(260, 841, readerBounds), false)

// 工作区/列表用「只认左缘」：下半屏整片不再是返回区（否则右滑列表会误返回，
// 并与 Linux.do 的左右滑切标签抢手势）。
assert.equal(isEdgeOnlyStart(100, 240, readerBounds), true)
assert.equal(isEdgeOnlyStart(100 + EDGE_WIDTH_PX, 240, readerBounds), true)
assert.equal(isEdgeOnlyStart(100 + EDGE_WIDTH_PX + 1, 240, readerBounds), false)
assert.equal(isEdgeOnlyStart(260, lowerStartY, readerBounds), false)
assert.equal(isEdgeOnlyStart(99, 240, readerBounds), false)
assert.equal(isEdgeOnlyStart(100, 199, readerBounds), false)
assert.equal(isEdgeOnlyStart(100, 841, readerBounds), false)

assert.equal(resolveLock(5, 5), 'none')
assert.equal(resolveLock(20, 5), 'horizontal')
assert.equal(resolveLock(5, 20), 'vertical')
assert.equal(resolveLock(9, 8.7), 'none')

assert.equal(clampDragX(-10, 320), 0)
assert.equal(clampDragX(100, 320), 100)
assert.equal(clampDragX(400, 320), 320)

assert.equal(shouldCommit(320 * COMMIT_RATIO + 1, 0, 320), true)
assert.equal(shouldCommit(10, 0, 320), false)
assert.equal(shouldCommit(MIN_FLING_DISTANCE_PX, COMMIT_VELOCITY + 0.01, 320), true)
assert.equal(shouldCommit(MIN_FLING_DISTANCE_PX, -COMMIT_VELOCITY - 0.01, 320), false)

assert.equal(velocityX([]), 0)
assert.equal(velocityX([{ x: 4, t: 10 }]), 0)
assert.equal(velocityX([{ x: 0, t: 0 }, { x: 50, t: 100 }]), 0.5)
assert.equal(
  velocityX([
    { x: 0, t: 0 },
    { x: 100, t: 500 },
    { x: 110, t: 550 },
  ]),
  0.2,
)

// 右滑返回的「跳过入场动画」标记：幂等查询 + 时间窗过期。
// 幂等是刚需：React StrictMode 会把新页面渲染两遍，一次性消费会在第二遍失效，
// 入场动画又冒出来。
clearSwipeBackNavigationMark()
assert.equal(isSwipeBackNavigation(1_000), false)

markSwipeBackNavigation(1_000)
assert.equal(isSwipeBackNavigation(1_000), true)
assert.equal(isSwipeBackNavigation(1_050), true)
assert.equal(isSwipeBackNavigation(1_000 + SWIPE_BACK_MARK_TTL_MS), true)
assert.equal(isSwipeBackNavigation(1_001 + SWIPE_BACK_MARK_TTL_MS), false)

// 过期后不能把标记留给下一次打开设置。
clearSwipeBackNavigationMark()
assert.equal(isSwipeBackNavigation(1_000 + SWIPE_BACK_MARK_TTL_MS * 10), false)

// 窗口只兜异常路径，不该长到能跨过一次「关闭设置 → 再打开设置」。
assert.ok(SWIPE_BACK_MARK_TTL_MS <= 2_000, 'mark window must stay short')

console.log('edge-swipe-back: ok')
