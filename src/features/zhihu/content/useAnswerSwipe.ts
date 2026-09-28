import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import {
  ANSWER_SWIPE_DIRECTION_BIAS,
  ANSWER_SWIPE_DIRECTION_LOCK_PX,
  answerSwipeStartEdge,
  canStartAnswerWheelSequence,
  resolveAnswerSwipeDirection,
  shouldCommitAnswerSwipe,
  type ZhihuAnswerSwipeDirection,
  type ZhihuAnswerSwipeEdge,
} from './answerSwipe'

export type ZhihuAnswerSwipePhase = 'idle' | 'pulling' | 'ready' | 'committing'

interface Options {
  containerRef: RefObject<HTMLElement | null>
  enabled: boolean
  reduced: boolean
  canGo: (direction: ZhihuAnswerSwipeDirection) => boolean
  onCommit: (direction: ZhihuAnswerSwipeDirection) => void
}

interface Gesture {
  startX: number
  startY: number
  edge: ZhihuAnswerSwipeEdge
  direction: ZhihuAnswerSwipeDirection | null
  lock: 'none' | 'vertical'
}

const EDGE_DAMPING = 0.28
const COMMIT_MS = 260
const SETTLE_MS = 240
const WHEEL_FINISH_MS = 150
const TRANSITION_EASING = 'var(--ease-ink)'

function wheelPixels(event: WheelEvent, viewportHeight: number): number {
  if (event.deltaMode === 2) return event.deltaY * viewportHeight
  if (event.deltaMode === 1) return event.deltaY * 16
  return event.deltaY
}

export function useAnswerSwipe({
  containerRef,
  enabled,
  reduced,
  canGo,
  onCommit,
}: Options) {
  const [dragY, setDragY] = useState(0)
  const [transitionMs, setTransitionMs] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [direction, setDirection] = useState<ZhihuAnswerSwipeDirection | null>(null)
  const [phase, setPhase] = useState<ZhihuAnswerSwipePhase>('idle')
  const canGoRef = useRef(canGo)
  const onCommitRef = useRef(onCommit)
  canGoRef.current = canGo
  onCommitRef.current = onCommit

  useEffect(() => {
    const element = containerRef.current
    if (!element || !enabled) return

    const previousTransform = element.style.transform
    const previousTransition = element.style.transition
    const previousWillChange = element.style.willChange
    let gesture: Gesture | null = null
    let activeTouchId: number | null = null
    let activePointerId: number | null = null
    let currentDragY = 0
    let currentDirection: ZhihuAnswerSwipeDirection | null = null
    let currentPhase: ZhihuAnswerSwipePhase = 'idle'
    let currentHeight = 0
    let busy = false
    let settleTimer = 0
    let commitTimer = 0
    let wheelTimer = 0
    let lastWheelAt = Number.NEGATIVE_INFINITY
    let wheelDirection: ZhihuAnswerSwipeDirection | null = null
    let wheelDistance = 0
    let gestureStartedAt = 0
    let frame = 0
    let pendingDragY: number | null = null

    const measure = () => {
      currentHeight = element.clientHeight || element.parentElement?.clientHeight || window.innerHeight || 640
      setViewportHeight(currentHeight)
      return currentHeight
    }

    const clearTimers = () => {
      if (settleTimer) window.clearTimeout(settleTimer)
      if (commitTimer) window.clearTimeout(commitTimer)
      if (wheelTimer) window.clearTimeout(wheelTimer)
      settleTimer = 0
      commitTimer = 0
      wheelTimer = 0
    }

    const flushFrame = () => {
      frame = 0
      if (pendingDragY !== null) {
        setDragY(pendingDragY)
        pendingDragY = null
      }
    }

    const cancelFrame = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = 0
      pendingDragY = null
    }

    const setPhaseSafe = (next: ZhihuAnswerSwipePhase) => {
      if (currentPhase === next) return
      currentPhase = next
      setPhase(next)
    }

    const setDirectionSafe = (next: ZhihuAnswerSwipeDirection | null) => {
      if (currentDirection === next) return
      currentDirection = next
      setDirection(next)
    }

    const apply = (value: number, duration: number) => {
      currentDragY = value
      element.style.willChange = value || duration ? 'transform' : previousWillChange
      element.style.transition = duration ? `transform ${duration}ms ${TRANSITION_EASING}` : 'none'
      element.style.transform = value ? `translate3d(0, ${value}px, 0)` : previousTransform
      setTransitionMs(duration)
      if (duration || value === 0) {
        cancelFrame()
        setDragY(value)
      } else {
        pendingDragY = value
        if (!frame) frame = window.requestAnimationFrame(flushFrame)
      }
    }

    const clearInput = () => {
      gesture = null
      activeTouchId = null
      if (activePointerId !== null && element.hasPointerCapture(activePointerId)) {
        element.releasePointerCapture(activePointerId)
      }
      activePointerId = null
      wheelDirection = null
      wheelDistance = 0
      gestureStartedAt = 0
    }

    const finishReset = () => {
      apply(0, 0)
      element.style.transition = previousTransition
      element.style.willChange = previousWillChange
      setDirectionSafe(null)
      setPhaseSafe('idle')
      busy = false
    }

    const settle = (immediate = false) => {
      clearTimers()
      clearInput()
      if (immediate || reduced || currentDragY === 0) {
        finishReset()
        return
      }
      apply(0, SETTLE_MS)
      settleTimer = window.setTimeout(() => {
        settleTimer = 0
        finishReset()
      }, SETTLE_MS)
    }

    const commit = (target: ZhihuAnswerSwipeDirection) => {
      clearTimers()
      clearInput()
      busy = true
      setPhaseSafe('committing')
      const height = currentHeight || measure()
      const out = target === 'previous' ? height : -height
      const remaining = Math.max(0, Math.abs(out - currentDragY))
      const duration = reduced ? 0 : Math.round(Math.min(COMMIT_MS, Math.max(100, remaining / height * COMMIT_MS)))
      apply(out, duration)
      const finish = () => {
        onCommitRef.current(target)
        finishReset()
      }
      if (!duration) finish()
      else {
        commitTimer = window.setTimeout(() => {
          commitTimer = 0
          finish()
        }, duration)
      }
    }

    const finish = (activeElapsedMs?: number) => {
      const target = currentDirection
      const height = currentHeight || measure()
      const elapsed = activeElapsedMs ?? (gestureStartedAt ? performance.now() - gestureStartedAt : 0)
      if (target && shouldCommitAnswerSwipe(currentDragY, height, canGoRef.current(target), elapsed)) commit(target)
      else settle()
    }

    const begin = (x: number, y: number) => {
      if (busy) return
      const edge = answerSwipeStartEdge(element.scrollTop, element.scrollHeight, element.clientHeight)
      if (edge === 'none') return
      clearTimers()
      measure()
      gestureStartedAt = performance.now()
      gesture = { startX: x, startY: y, edge, direction: null, lock: 'none' }
    }

    const move = (x: number, y: number, prevent: () => void) => {
      if (!gesture || busy) return
      const dx = x - gesture.startX
      const dy = y - gesture.startY
      if (gesture.lock === 'none') {
        const absX = Math.abs(dx)
        const absY = Math.abs(dy)
        if (absX < ANSWER_SWIPE_DIRECTION_LOCK_PX && absY < ANSWER_SWIPE_DIRECTION_LOCK_PX) return
        if (absY <= absX * ANSWER_SWIPE_DIRECTION_BIAS) {
          settle(true)
          return
        }
        const target = resolveAnswerSwipeDirection(gesture.edge, dy)
        if (!target) {
          settle(true)
          return
        }
        gesture.lock = 'vertical'
        gesture.direction = target
        setDirectionSafe(target)
      }
      const target = gesture.direction
      if (!target) return
      prevent()
      const available = canGoRef.current(target)
      const raw = target === 'previous' ? Math.max(0, dy) : Math.min(0, dy)
      const value = available ? raw : raw * EDGE_DAMPING
      apply(Math.max(-currentHeight, Math.min(currentHeight, value)), 0)
      setPhaseSafe(shouldCommitAnswerSwipe(value, currentHeight, available, performance.now() - gestureStartedAt) ? 'ready' : 'pulling')
    }

    const findTouch = (touches: TouchList, identifier: number) => {
      for (let index = 0; index < touches.length; index += 1) {
        const touch = touches.item(index)
        if (touch?.identifier === identifier) return touch
      }
      return null
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        if (gesture) settle(true)
        return
      }
      const touch = event.touches[0]
      activeTouchId = touch.identifier
      begin(touch.clientX, touch.clientY)
      if (!gesture) activeTouchId = null
    }
    const onTouchMove = (event: TouchEvent) => {
      if (activeTouchId === null) return
      const touch = findTouch(event.touches, activeTouchId)
      if (!touch) {
        settle(true)
        return
      }
      move(touch.clientX, touch.clientY, () => {
        if (event.cancelable) event.preventDefault()
      })
    }
    const onTouchEnd = (event: TouchEvent) => {
      if (activeTouchId === null) return
      const ended = findTouch(event.changedTouches, activeTouchId)
      if (!ended) return
      finish()
    }
    const onTouchCancel = () => settle()

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !event.isPrimary) return
      begin(event.clientX, event.clientY)
      if (!gesture) return
      activePointerId = event.pointerId
      element.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || activePointerId !== event.pointerId) return
      move(event.clientX, event.clientY, () => {
        if (event.cancelable) event.preventDefault()
      })
    }
    const onPointerUp = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId) return
      finish()
    }
    const onPointerCancel = (event: PointerEvent) => {
      if (activePointerId === event.pointerId) settle()
    }

    const onWheel = (event: WheelEvent) => {
      if (busy || event.deltaY === 0) return
      const now = performance.now()
      const target: ZhihuAnswerSwipeDirection = event.deltaY > 0 ? 'next' : 'previous'
      const edge = answerSwipeStartEdge(element.scrollTop, element.scrollHeight, element.clientHeight)
      if (!wheelDirection) {
        const elapsed = now - lastWheelAt
        lastWheelAt = now
        if (!canStartAnswerWheelSequence(edge, target, elapsed)) return
        clearTimers()
        measure()
        gestureStartedAt = now
        wheelDirection = target
        wheelDistance = 0
        setDirectionSafe(target)
      } else if (wheelDirection !== target) {
        lastWheelAt = now
        settle()
        return
      } else {
        lastWheelAt = now
      }

      if (event.cancelable) event.preventDefault()
      const pixels = Math.abs(wheelPixels(event, currentHeight))
      wheelDistance += pixels
      const available = canGoRef.current(target)
      const signed = (target === 'previous' ? 1 : -1) * wheelDistance * (available ? 1 : EDGE_DAMPING)
      apply(Math.max(-currentHeight, Math.min(currentHeight, signed)), 0)
      setPhaseSafe(shouldCommitAnswerSwipe(signed, currentHeight, available, now - gestureStartedAt) ? 'ready' : 'pulling')
      if (wheelTimer) window.clearTimeout(wheelTimer)
      wheelTimer = window.setTimeout(() => {
        wheelTimer = 0
        finish(lastWheelAt - gestureStartedAt)
      }, WHEEL_FINISH_MS)
    }

    const abort = () => settle(true)
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') abort()
    }

    measure()
    window.addEventListener('resize', measure)
    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', onTouchEnd)
    element.addEventListener('touchcancel', onTouchCancel)
    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove, { passive: false })
    element.addEventListener('pointerup', onPointerUp)
    element.addEventListener('pointercancel', onPointerCancel)
    element.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('blur', abort)
    window.addEventListener('pagehide', abort)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearTimers()
      cancelFrame()
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', onTouchEnd)
      element.removeEventListener('touchcancel', onTouchCancel)
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', onPointerUp)
      element.removeEventListener('pointercancel', onPointerCancel)
      element.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', measure)
      window.removeEventListener('blur', abort)
      window.removeEventListener('pagehide', abort)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      element.style.transform = previousTransform
      element.style.transition = previousTransition
      element.style.willChange = previousWillChange
    }
  }, [containerRef, enabled, reduced])

  return { dragY, transitionMs, viewportHeight, direction, phase }
}

