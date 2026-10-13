import assert from 'node:assert/strict'

import {
  COMMIT_RATIO,
  COMMIT_VELOCITY,
  EDGE_WIDTH_PX,
  LOWER_START_RATIO,
  MIN_FLING_DISTANCE_PX,
  clampDragX,
  isEdgeStart,
  isSwipeBackStart,
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

console.log('edge-swipe-back: ok')
