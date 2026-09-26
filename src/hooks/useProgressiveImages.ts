import { useEffect, useRef, type RefObject } from 'react'

import { resolvePlayableImageSrc, revokeBlobUrl } from '../features/proxy/hydrateImages'
import {
  DEFERRED_LOAD_TIMEOUT_MS,
  DEFERRED_SRC_ATTR,
  type DeferredHostPhase,
} from '../lib/deferReaderMedia'
import { classifyLoadedImage } from '../lib/normalizeImages'

type ImageRetryState = {
  urls: string[]
  index: number
  nativeTried: boolean
  busy: boolean
}

function safeHttpImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

function imageFallbackUrls(img: HTMLImageElement): string[] {
  const values: string[] = []
  const current = safeHttpImageUrl(img.currentSrc || img.getAttribute('src'))
  if (current) values.push(current)
  const raw = img.getAttribute('data-reader-image-fallbacks')
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        for (const value of parsed) {
          const safe = safeHttpImageUrl(value)
          if (safe) values.push(safe)
        }
      }
    } catch {
      // 第三方正文属性不可信；解析失败只丢弃备用源。
    }
  }
  return [...new Set(values)]
}

/**
 * 正文经 dangerouslySetInnerHTML 注入，无法套 React 组件。
 * 这里在 HTML 落地后接管其中的 img：先占位扫光，加载完成再渐显。
 * 对知乎这类有防盗链/多套图片地址的正文，可在直连失败后自动尝试备用 URL，
 * 再用原生 OkHttp + Referer 拉取为 blob；最终失败仍保留可点按重试占位。
 */
export function useProgressiveImages(
  rootRef: RefObject<HTMLElement | null>,
  html: string,
  enabled = true,
  options?: {
    autoLoad?: boolean
    onDeferredPhase?: (url: string, phase: DeferredHostPhase | 'loaded', playableSrc?: string) => void
    forceNativeFallback?: boolean
    imageReferer?: string
    /** 自定义失败兜底：源站自带会话/挑战通道时接管（Linux.do 用原生插件取字节）。 */
    resolveImage?: (url: string) => Promise<string>
    /**
     * 最终失败时给占位写一行可读原因（写到 `data-reader-image-error`，由 CSS 显示）。
     * 真机上没有日志面板，这行文案是排查取字节链路断在哪一步的唯一现场证据。
     */
    failureNote?: (url: string) => string | undefined
  },
): void {
  const autoLoad = options?.autoLoad !== false
  const onDeferredPhase = options?.onDeferredPhase
  const forceNativeFallback = options?.forceNativeFallback === true
  const imageReferer = options?.imageReferer
  const resolveImage = options?.resolveImage
  const failureNote = options?.failureNote
  const inflightRef = useRef(new Map<string, () => void>())

  useEffect(() => {
    if (enabled) return
    const inflight = inflightRef.current
    inflight.forEach((cancel) => cancel())
    inflight.clear()
  }, [enabled])

  useEffect(() => {
    const root = rootRef.current
    if (!root || !enabled || !html) return

    let disposed = false
    const ownedBlobUrls = new Set<string>()
    const retryStates = new WeakMap<HTMLImageElement, ImageRetryState>()

    const zhihuHostOf = (img: HTMLImageElement) =>
      img.closest<HTMLElement>('[data-reader-role="zhihu-image-host"]')
    const linuxDoHostOf = (img: HTMLImageElement) =>
      img.closest<HTMLElement>('[data-linuxdo-role="image-block"], [data-linuxdo-role="image-paragraph"]')

    const clearVisualState = (img: HTMLImageElement) => {
      img.classList.remove('async-img-failed', 'async-img-done')
      img.classList.add('ink-shimmer')
      const host = zhihuHostOf(img)
      host?.classList.remove('is-failed', 'is-decorative')
      const linuxDoHost = linuxDoHostOf(img)
      linuxDoHost?.classList.remove('is-failed', 'is-loaded')
      linuxDoHost?.removeAttribute('data-reader-image-error')
      linuxDoHost?.classList.add('is-loading', 'ink-shimmer')
    }

    const applyRole = (img: HTMLImageElement) => {
      const stamped = img.getAttribute('data-reader-role')
      const linuxDoRole = img.getAttribute('data-linuxdo-role')
      if (linuxDoRole === 'content-image' || linuxDoRole === 'onebox-image') return
      if (stamped === 'badge') {
        img.classList.add('reader-img-badge')
        return
      }
      if (stamped === 'related-image' || stamped === 'zhihu-link-image') return
      const role = classifyLoadedImage(img.naturalWidth, img.naturalHeight)
      const zhihuHost = zhihuHostOf(img)
      if (role === 'decorative') {
        img.classList.add('async-img-failed')
        img.classList.remove('reader-img-badge')
        zhihuHost?.classList.add('is-decorative')
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
      const host = zhihuHostOf(img)
      const linuxDoHost = linuxDoHostOf(img)
      linuxDoHost?.classList.remove('is-loading', 'ink-shimmer')
      if (!ok) {
        img.classList.add('async-img-failed')
        img.classList.remove('async-img-done')
        host?.classList.add('is-failed')
        linuxDoHost?.classList.remove('is-loaded')
        linuxDoHost?.classList.add('is-failed')
        if (linuxDoHost) {
          const state = retryStates.get(img)
          const firstUrl = state?.urls[0] ?? img.getAttribute('src') ?? ''
          linuxDoHost.setAttribute('data-reader-image-error', (failureNote?.(firstUrl) ?? '').trim() || '未知原因')
        }
        return
      }
      img.classList.remove('async-img-failed')
      img.classList.add('async-img-done')
      host?.classList.remove('is-failed')
      linuxDoHost?.classList.remove('is-failed')
      linuxDoHost?.removeAttribute('data-reader-image-error')
      linuxDoHost?.classList.add('is-loaded')
      applyRole(img)
    }

    const setImageSource = (img: HTMLImageElement, state: ImageRetryState, url: string) => {
      if (disposed) return
      state.busy = false
      clearVisualState(img)
      img.src = url
    }

    const tryNativeFallback = async (img: HTMLImageElement, state: ImageRetryState, url: string) => {
      if (state.busy || disposed) return
      state.busy = true
      clearVisualState(img)
      try {
        // 源站自带会话/挑战通道时先逐个问它（含 HTML 里声明的备用地址，例如 Linux.do
        // 的 optimized 变体）；全都原样返回（管不了这些地址）再走通用原生兜底。
        if (resolveImage) {
          const candidates = state.urls.length ? state.urls : [url]
          for (const candidate of candidates) {
            const resolved = await resolveImage(candidate)
            if (disposed) return
            if (resolved !== candidate) {
              // 自定义 resolver 的 blob 归它自己的缓存所有，卸载时不能撤销。
              setImageSource(img, state, resolved)
              return
            }
          }
        }
        if (forceNativeFallback) {
          const playable = await resolvePlayableImageSrc(url, {
            forceNative: true,
            referer: imageReferer,
          })
          if (disposed) {
            revokeBlobUrl(playable)
            return
          }
          if (playable !== url) {
            if (playable.startsWith('blob:')) ownedBlobUrls.add(playable)
            setImageSource(img, state, playable)
            return
          }
        }
      } catch {
        // 进入最终失败状态，由占位提供人工重试。
      }
      state.busy = false
      settle(img, false)
    }

    // 自定义 resolver 本身就是兜底通道，不要求调用方再显式打开 forceNativeFallback。
    const hasFallback = forceNativeFallback || Boolean(resolveImage)

    const advanceAfterError = (img: HTMLImageElement) => {
      const state = retryStates.get(img)
      if (!state || disposed) {
        settle(img, false)
        return
      }
      // 兜底链路（自定义 resolver / 原生兜底）正在跑：这次 error 只是上一张候选图收尾。
      // 链路自己会在结束时给出结果（成功换 src、失败才 settle），这里不能抢先把图判死。
      if (state.busy) return
      if (state.index + 1 < state.urls.length) {
        state.index += 1
        setImageSource(img, state, state.urls[state.index]!)
        return
      }
      if (hasFallback && !state.nativeTried && state.urls.length > 0) {
        state.nativeTried = true
        void tryNativeFallback(img, state, state.urls[0]!)
        return
      }
      settle(img, false)
    }

    const retryFailedImage = (img: HTMLImageElement) => {
      const state = retryStates.get(img)
      if (!state || state.busy || !state.urls.length) return
      state.index = 0
      state.nativeTried = hasFallback
      clearVisualState(img)
      if (hasFallback) {
        void tryNativeFallback(img, state, state.urls[0]!)
      } else {
        // 重新赋值会让 WebView 再走一次自己的 HTTP cache/revalidation。
        img.removeAttribute('src')
        window.requestAnimationFrame(() => setImageSource(img, state, state.urls[0]!))
      }
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

      void resolvePlayableImageSrc(url, {
        forceNative: forceNativeFallback,
        referer: imageReferer,
      })
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

    const onRootActivate = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element)) return

      const deferredHost = target.closest<HTMLElement>('[data-reader-deferred]')
      if (deferredHost && root.contains(deferredHost)) {
        const img = deferredHost.querySelector('img')
        if (!(img instanceof HTMLImageElement)) return
        const url = img.getAttribute(DEFERRED_SRC_ATTR)
        if (!url) return
        event.preventDefault()
        event.stopPropagation()
        if (deferredHost.classList.contains('is-loading')) return
        onDeferredPhase?.(url, 'loading')
        return
      }

      const failedHost = target.closest<HTMLElement>(
        '[data-reader-role="zhihu-image-host"].is-failed, [data-linuxdo-role="image-block"].is-failed, [data-linuxdo-role="image-paragraph"].is-failed',
      )
      if (!failedHost || !root.contains(failedHost)) return
      const failedImage = failedHost.querySelector('img')
      if (!(failedImage instanceof HTMLImageElement)) return
      event.preventDefault()
      event.stopPropagation()
      retryFailedImage(failedImage)
    }

    root.addEventListener('click', onRootActivate, true)

    const cleanups = Array.from(root.querySelectorAll('img')).map((img) => {
      const premarkedBadge = img.getAttribute('data-reader-role') === 'badge'
      const stampedRole = img.getAttribute('data-reader-role')
      const premarkedRelated = stampedRole === 'related-image' || stampedRole === 'zhihu-link-image'
      if (premarkedBadge) img.classList.add('reader-img-badge')

      const deferredUrl = img.getAttribute(DEFERRED_SRC_ATTR)
      const host = img.closest('.reader-deferred-host')
      const isDeferred = Boolean(deferredUrl && !img.getAttribute('src'))

      if (isDeferred && deferredUrl) {
        if (autoLoad || host?.classList.contains('is-loading')) startDeferredLoad(deferredUrl)
        return undefined
      }

      const urls = imageFallbackUrls(img)
      retryStates.set(img, { urls, index: 0, nativeTried: false, busy: false })
      if (!premarkedBadge && !premarkedRelated) {
        img.classList.add('async-img')
        clearVisualState(img)
      }

      const onLoad = () => {
        const state = retryStates.get(img)
        if (state) state.busy = false
        settle(img, true)
      }
      const onError = () => advanceAfterError(img)
      img.addEventListener('load', onLoad)
      img.addEventListener('error', onError)

      if (img.complete) {
        if (img.naturalWidth > 0) onLoad()
        else advanceAfterError(img)
      }

      return () => {
        img.removeEventListener('load', onLoad)
        img.removeEventListener('error', onError)
      }
    })

    return () => {
      disposed = true
      root.removeEventListener('click', onRootActivate, true)
      cleanups.forEach((dispose) => dispose?.())
      ownedBlobUrls.forEach((url) => revokeBlobUrl(url))
      ownedBlobUrls.clear()
    }
  }, [rootRef, html, enabled, autoLoad, forceNativeFallback, imageReferer, resolveImage, failureNote, onDeferredPhase])

  useEffect(() => {
    const inflight = inflightRef.current
    return () => {
      inflight.forEach((cancel) => cancel())
      inflight.clear()
    }
  }, [])
}
