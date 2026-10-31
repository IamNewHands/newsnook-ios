import type { WindowBounds, WindowRect } from './types'

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const aspect = (ratio: number) => Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9

/** Floating video has no separate title bar: the entire rect belongs to the media. */
export function constrainWindow(rect: Pick<WindowRect, 'x' | 'y' | 'width'>, bounds: WindowBounds, ratio: number): WindowRect {
  const maxWidth = Math.max(1, Math.min(640, bounds.width, bounds.height * aspect(ratio)))
  const width = clamp(rect.width, Math.min(200, maxWidth), maxWidth)
  const height = Math.min(bounds.height, width / aspect(ratio))
  return {
    width, height,
    x: clamp(rect.x, bounds.x, bounds.x + Math.max(0, bounds.width - width)),
    y: clamp(rect.y, bounds.y, bounds.y + Math.max(0, bounds.height - height)),
  }
}

export function initialWindow(bounds: WindowBounds, ratio: number): WindowRect {
  const width = clamp(bounds.width * 0.65, 240, 360)
  const rect = constrainWindow({ x: bounds.x + bounds.width - width, y: bounds.y + bounds.height - width / aspect(ratio) - 64, width }, bounds, ratio)
  return rect
}
