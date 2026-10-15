/**
 * The first part of Android's left edge can be owned by the system back gesture.
 * A 48px hit area keeps the upper part of the reader feeling like an edge gesture;
 * the lower reading area has a more ergonomic full-width start zone.
 */
export const EDGE_WIDTH_PX = 48
/** The lower half of the reader is an intentionally generous, full-width back zone. */
export const LOWER_START_RATIO = 0.5
/** Keep this close to the platform touch slop so the surface starts following early. */
export const DIRECTION_LOCK_PX = 7
/** Wait while the gesture is diagonal instead of prematurely giving it to scrolling. */
export const HORIZONTAL_BIAS = 1.08
/** A deliberate drag should pass roughly one third of the viewport. */
export const COMMIT_RATIO = 0.32
/** A short, intentional right fling can commit before the distance threshold. */
export const COMMIT_VELOCITY = 0.5
export const MIN_FLING_DISTANCE_PX = 14
export const VELOCITY_WINDOW_MS = 100

export interface GestureSample {
  x: number
  t: number
}

export interface SwipeBackBounds {
  left: number
  top: number
  width: number
  height: number
}

export function isEdgeStart(
  clientX: number,
  edgeWidthPx = EDGE_WIDTH_PX,
  originLeft = 0,
): boolean {
  const localX = clientX - originLeft
  return localX >= 0 && localX <= edgeWidthPx
}

/**
 * Keep the familiar edge gesture everywhere, while making the lower half of the
 * reading surface available across its full width. This avoids forcing the thumb
 * into a narrow edge target after the reader has scrolled into the article body.
 */
export function isSwipeBackStart(
  clientX: number,
  clientY: number,
  bounds: SwipeBackBounds,
  edgeWidthPx = EDGE_WIDTH_PX,
): boolean {
  const localX = clientX - bounds.left
  const localY = clientY - bounds.top
  const inside =
    localX >= 0 &&
    localX <= bounds.width &&
    localY >= 0 &&
    localY <= bounds.height

  if (!inside) return false
  return (
    isEdgeStart(clientX, edgeWidthPx, bounds.left) ||
    localY >= bounds.height * LOWER_START_RATIO
  )
}

/**
 * 只认左缘窄条起步：列表 / 工作区用这个。
 *
 * `isSwipeBackStart` 把容器下半屏整片也算返回区，那是阅读器的人体工学取舍
 * （拇指够不到窄边）。但列表和工作区下半屏就是内容区：右滑整片返回既不符合
 * iOS 习惯，也会跟 Linux.do 的「左右滑切换标签」抢同一个手势。
 */
export function isEdgeOnlyStart(
  clientX: number,
  clientY: number,
  bounds: SwipeBackBounds,
  edgeWidthPx = EDGE_WIDTH_PX,
): boolean {
  const localX = clientX - bounds.left
  const localY = clientY - bounds.top
  const inside =
    localX >= 0 &&
    localX <= bounds.width &&
    localY >= 0 &&
    localY <= bounds.height
  return inside && isEdgeStart(clientX, edgeWidthPx, bounds.left)
}

export function resolveLock(
  dx: number,
  dy: number,
): 'none' | 'horizontal' | 'vertical' {
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  if (absX < DIRECTION_LOCK_PX && absY < DIRECTION_LOCK_PX) return 'none'
  if (absX >= absY * HORIZONTAL_BIAS) return 'horizontal'
  if (absY >= absX * HORIZONTAL_BIAS) return 'vertical'
  return 'none'
}

/** The page follows the finger 1:1 and never exposes space beyond its width. */
export function clampDragX(dx: number, width: number): number {
  if (width <= 0) return 0
  return Math.min(width, Math.max(0, dx))
}

/**
 * Estimate only the most recent part of the gesture. Using the full drag distance
 * with the time since the last move produces enormous, false fling velocities.
 */
export function velocityX(samples: readonly GestureSample[]): number {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  let first = samples[0]

  for (let index = samples.length - 2; index >= 0; index -= 1) {
    const candidate = samples[index]
    if (last.t - candidate.t > VELOCITY_WINDOW_MS) break
    first = candidate
  }

  const elapsed = last.t - first.t
  return elapsed > 0 ? (last.x - first.x) / elapsed : 0
}

export function shouldCommit(offset: number, releaseVelocityX: number, width: number): boolean {
  if (width <= 0) return false
  if (offset >= width * COMMIT_RATIO) return true
  return offset >= MIN_FLING_DISTANCE_PX && releaseVelocityX >= COMMIT_VELOCITY
}

/**
 * 「这次挂载是右滑返回的结果」的时效窗口。
 *
 * 标记在 commit 动画收尾、调用 onBack 之前打下，接收方是同一次 React 提交里
 * 新挂载的那一层，正常只差几十毫秒。窗口只用来兜住异常路径，不是行为阈值。
 */
export const SWIPE_BACK_MARK_TTL_MS = 600

let swipeBackMarkedAt = 0

/** 右滑返回即将触发导航：下一个挂载的页面据此跳过「从右滑入」的入场动画。 */
export function markSwipeBackNavigation(now = Date.now()): void {
  swipeBackMarkedAt = now
}

/**
 * 查询当前是否处在右滑返回的时效窗口内。
 *
 * 故意做成**幂等查询**而不是「消费一次」：React StrictMode 会把新页面的渲染跑
 * 两遍，一次性消费会在第二遍变成 false，入场动画又冒出来。标记靠时间窗自行
 * 过期——设置页可能直接退到没有外壳的层级（关闭设置），那种情况没人查询它，
 * 不能把标记留给下一次打开设置。
 */
export function isSwipeBackNavigation(now = Date.now()): boolean {
  return swipeBackMarkedAt > 0 && now - swipeBackMarkedAt <= SWIPE_BACK_MARK_TTL_MS
}

/** 测试用：清掉标记，避免用例之间互相影响。 */
export function clearSwipeBackNavigationMark(): void {
  swipeBackMarkedAt = 0
}
