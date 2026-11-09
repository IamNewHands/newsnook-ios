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
