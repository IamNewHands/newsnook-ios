import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'

interface DialogLayer {
  element: HTMLElement
  restoreTarget: HTMLElement | null
  previous: DialogLayer | undefined
  lastFocused: HTMLElement | null
}

const layers: DialogLayer[] = []
const focusableSelector = [
  'a[href]', 'area[href]', 'button', 'input:not([type="hidden"])',
  'select', 'textarea', 'iframe', 'object', 'embed', 'summary',
  '[contenteditable="true"]', '[tabindex]',
].join(',')

function topLayer(): DialogLayer | undefined {
  return layers[layers.length - 1]
}

function available(element: HTMLElement | null): element is HTMLElement {
  return !!element?.isConnected
    && !element.matches(':disabled')
    && !element.closest('[inert], [hidden]')
    && element.getClientRects().length > 0
    && element.ownerDocument.defaultView?.getComputedStyle(element).visibility !== 'hidden'
}

function focusInside(layer: DialogLayer) {
  const target = available(layer.lastFocused) && layer.element.contains(layer.lastFocused)
    ? layer.lastFocused
    : layer.element
  target.focus({ preventScroll: true })
}

function tabbableControls(element: HTMLElement): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>(focusableSelector)]
    .filter(control => control.tabIndex >= 0 && available(control))
    .sort((left, right) => {
      const leftOrder = left.tabIndex > 0 ? left.tabIndex : Number.MAX_SAFE_INTEGER
      const rightOrder = right.tabIndex > 0 ? right.tabIndex : Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder
    })
}

/** Keeps browser dialogs in one focus stack, including sibling and nested confirmations. */
export function useBrowserDialogFocus<T extends HTMLElement>(active = true): RefObject<T | null> {
  const element = useRef<T>(null)
  const lastFocused = useRef<HTMLElement | null>(null)
  // Capture before React commits autoFocus; the focused input is not the dialog's opener.
  const restoreTarget = useMemo(() => active && typeof document !== 'undefined'
    && document.activeElement instanceof HTMLElement ? document.activeElement : null, [active])

  useLayoutEffect(() => {
    const dialog = element.current
    if (!active || !dialog) return
    const ownerDocument = dialog.ownerDocument
    const layer: DialogLayer = {
      element: dialog,
      restoreTarget,
      previous: topLayer(),
      lastFocused: lastFocused.current,
    }
    layers.push(layer)

    const onKeyDown = (event: KeyboardEvent) => {
      if (topLayer() !== layer || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
      const controls = tabbableControls(dialog)
      const focusedIndex = controls.indexOf(ownerDocument.activeElement as HTMLElement)
      const nextIndex = event.shiftKey
        ? focusedIndex <= 0 ? controls.length - 1 : focusedIndex - 1
        : focusedIndex < 0 || focusedIndex === controls.length - 1 ? 0 : focusedIndex + 1
      event.preventDefault()
      const next = controls[nextIndex] ?? dialog
      next.focus({ preventScroll: true })
    }
    const onFocusIn = (event: FocusEvent) => {
      if (topLayer() !== layer) return
      if (event.target instanceof HTMLElement && dialog.contains(event.target)) {
        layer.lastFocused = event.target
        return
      }
      // A newly mounted sibling can autoFocus before its layout effect joins the stack.
      queueMicrotask(() => {
        if (topLayer() === layer && dialog.isConnected && !dialog.contains(ownerDocument.activeElement)) {
          focusInside(layer)
        }
      })
    }
    ownerDocument.addEventListener('keydown', onKeyDown, true)
    ownerDocument.addEventListener('focusin', onFocusIn, true)
    if (ownerDocument.activeElement instanceof HTMLElement && dialog.contains(ownerDocument.activeElement)) {
      layer.lastFocused = ownerDocument.activeElement
    } else {
      focusInside(layer)
    }

    return () => {
      ownerDocument.removeEventListener('keydown', onKeyDown, true)
      ownerDocument.removeEventListener('focusin', onFocusIn, true)
      lastFocused.current = layer.lastFocused
      const wasTop = topLayer() === layer
      const index = layers.indexOf(layer)
      if (index >= 0) layers.splice(index, 1)
      if (!wasTop) return
      const resumedLayer = topLayer()
      // Wait for React to remove the dialog and lift inert from its underlying content.
      queueMicrotask(() => {
        if (topLayer() !== resumedLayer) return
        let previous: DialogLayer | undefined = layer
        while (previous) {
          const target = previous.restoreTarget
          if (available(target) && (!resumedLayer || resumedLayer.element.contains(target))) {
            target.focus({ preventScroll: true })
            return
          }
          previous = previous.previous
        }
        if (resumedLayer && !resumedLayer.element.contains(ownerDocument.activeElement)) {
          focusInside(resumedLayer)
        }
      })
    }
  }, [active, restoreTarget])

  return element
}
