import { useEffect, useRef, type RefObject } from 'react'

import { resolvePlayableImageSrc, revokeBlobUrl } from '../features/proxy/hydrateImages'
import {
  DEFERRED_LOAD_TIMEOUT_MS,
  DEFERRED_SRC_ATTR,
  type DeferredHostPhase,
} from '../lib/deferReaderMedia'
import { classifyLoadedImage } from '../lib/normalizeImages'

/**
 * 正文经 dangerouslySetInnerHTML 注入，无法套 React 组件。
 * 这里在 HTML 落地后接管其中的 img：先占位扫光，加载完成再渐显，失败则收起。
 * 小图/徽章按自然尺寸或 data-reader-role 归类，避免被通栏 CSS 放大。
 */
export function useProgressiveImages(
  rootRef: RefObject<HTMLElement | null>,
  html: string,
  enabled = true,
  options?: {
    autoLoad: boolean
    onDeferredPhase?: (url: string, phase: DeferredHostPhase | 'loaded', playableSrc?: string) => void
  },
): void {
  const autoLoad = options?.autoLoad !== false
  const onDeferredPhase = options?.onDeferredPhase
  const inflightRef = useRef(new Map<string, () => void>())

  useEffect(() => {
    if (enabled) return
    inflightRef.current.forEach((cancel) => cancel())
    inflightRef.current.clear()
  }, [enabled])

  useEffect(() => {
    const root = rootRef.current
    if (!root || !enabled || !html) return

    const applyRole = (img: HTMLImageElement) => {
      const stamped = img.getAttribute('data-reader-role')
      if (stamped === 'badge') {
        img.classList.add('reader-img-badge')
        return
      }
      if (stamped === 'related-image' || stamped === 'zhihu-link-image') return
      const role = classifyLoadedImage(img.naturalWidth, img.naturalHeight)
      const zhihuHost = img.closest<HTMLElement>('[data-reader-role="zhihu-image-host"]')
      if (role === 'decorative') {
        img.classList.add('async-img-failed')
        img.classList.remove('reader-img-badge')
        zhihuHost?.classList.add('is-failed')
        return
      }
      if (role === 'badge') {
        img.setAttribute('data-reader-role', 'badge')
        img.classList.add('reader-img-badge')
        zhihuHost?.classList.add('is-badge')
      }
    }

    const settle = (img: HTMLImageElement, ok: boolean) => {
      img.classList.remove('ink-shimmer')
      if (!ok) {
        img.classList.add('async-img-failed')
        img.closest<HTMLElement>('[data-reader-role="zhihu-image-host"]')?.classList.add('is-failed')
        return
      }
      img.classList.add('async-img-done')
      applyRole(img)
    }

    const startDeferredLoad = (url: string) => {
      if (inflightRef.current.has(url)) return

      let cancelled = false
      let handedOff = false
      let playableHeld: string | undefined
      const probe = new Image()

      const abandonHeld = () => {
        if (handedOff) return
        revokeBlobUrl(playableHeld)
        playableHeld = undefined
      }

      const timer = window.setTimeout(() => {
        cancelled = true
        probe.src = ''
        abandonHeld()
        inflightRef.current.delete(url)
        onDeferredPhase?.(url, 'timeout')
      }, DEFERRED_LOAD_TIMEOUT_MS)

      const cancel = () => {
        cancelled = true
        window.clearTimeout(timer)
        probe.src = ''
        abandonHeld()
        inflightRef.current.delete(url)
      }
      inflightRef.current.set(url, cancel)

      const finish = (phase: 'loaded' | 'failed') => {
        if (cancelled) return
        window.clearTimeout(timer)
        inflightRef.current.delete(url)
        if (phase === 'loaded' && playableHeld) {
          handedOff = true
          onDeferredPhase?.(url, 'loaded', playableHeld)
          return
        }
        abandonHeld()
        onDeferredPhase?.(url, 'failed')
      }

      void resolvePlayableImageSrc(url)
        .then((playable) => {
          playableHeld = playable
          if (cancelled) {
            abandonHeld()
            return
          }
          probe.onload = () => finish('loaded')
          probe.onerror = () => finish('failed')
          probe.src = playable
        })
        .catch(() => finish('failed'))
    }

    const onDeferredActivate = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const host = target.closest<HTMLElement>('[data-reader-deferred]')
      if (!host || !root.contains(host)) return
      const img = host.querySelector('img')
      if (!(img instanceof HTMLImageElement)) return
      const url = img.getAttribute(DEFERRED_SRC_ATTR)
      if (!url) return
      event.preventDefault()
      event.stopPropagation()
      if (host.classList.contains('is-loading')) return
      onDeferredPhase?.(url, 'loading')
    }

    root.addEventListener('click', onDeferredActivate, true)

    const cleanups = Array.from(root.querySelectorAll('img')).map((img) => {
      const premarkedBadge = img.getAttribute('data-reader-role') === 'badge'
      const stampedRole = img.getAttribute('data-reader-role')
      const premarkedRelated = stampedRole === 'related-image' || stampedRole === 'zhihu-link-image'
      if (premarkedBadge) img.classList.add('reader-img-badge')

      const deferredUrl = img.getAttribute(DEFERRED_SRC_ATTR)
      const host = img.closest('.reader-deferred-host')
      const isDeferred = Boolean(deferredUrl && !img.getAttribute('src'))

      if (isDeferred && deferredUrl) {
        if (autoLoad || host?.classList.contains('is-loading')) {
          startDeferredLoad(deferredUrl)
        }
        return undefined
      }

      if (img.complete) {
        if (!premarkedBadge && !premarkedRelated) img.classList.add('async-img')
        settle(img, img.naturalWidth > 0)
        return undefined
      }

      if (!premarkedBadge && !premarkedRelated) img.classList.add('async-img', 'ink-shimmer')
      const onLoad = () => settle(img, true)
      const onError = () => settle(img, false)
      img.addEventListener('load', onLoad)
      img.addEventListener('error', onError)
      return () => {
        img.removeEventListener('load', onLoad)
        img.removeEventListener('error', onError)
      }
    })

    return () => {
      root.removeEventListener('click', onDeferredActivate, true)
      cleanups.forEach((dispose) => dispose?.())
    }
  }, [rootRef, html, enabled, autoLoad, onDeferredPhase])

  useEffect(() => {
    return () => {
      inflightRef.current.forEach((cancel) => cancel())
      inflightRef.current.clear()
    }
  }, [])
}
