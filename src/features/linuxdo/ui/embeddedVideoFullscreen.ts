import { registerHardwareBackLayer } from '../../../lib/hardwareBackStack'

/**
 * Android WebView receives genuine fullscreen requests from this app-owned
 * control. Bilibili's cross-origin mobile iframe sometimes only attempts
 * device rotation, never calling the Web Fullscreen API at all.
 *
 * The iframe stays at its original DOM node throughout playback: we neither
 * recreate it nor change its src, so fullscreen must not restart the video.
 */
type NativeEmbeddedVideoBridge = {
  setEmbeddedVideoFullscreen?: (active: boolean) => void
}

function nativeBridge(): NativeEmbeddedVideoBridge | undefined {
  return (window as Window & { NewsNookNative?: NativeEmbeddedVideoBridge }).NewsNookNative
}

export function installLinuxDoEmbeddedVideoFullscreen(root: HTMLElement): () => void {
  // Most posts contain no videos; avoid installing document-level handlers for
  // every ordinary comment in a long Discourse thread.
  if (!root.querySelector('[data-linuxdo-video-fullscreen-toggle]')) return () => {}
  let unregisterFallbackBack: (() => void) | null = null
  const controls = () => Array.from(root.querySelectorAll<HTMLButtonElement>('[data-linuxdo-video-fullscreen-toggle]'))

  const updateControls = () => {
    const full = document.fullscreenElement
    controls().forEach((control) => {
      const host = control.closest<HTMLElement>('[data-linuxdo-video-fullscreen]')
      const expanded = !!host && (host === full || host.classList.contains('is-fullscreen-fallback'))
      control.setAttribute('aria-label', expanded ? '退出 Bilibili 视频全屏' : '全屏播放 Bilibili 视频')
      control.setAttribute('title', expanded ? '退出全屏' : '全屏播放')
      const label = control.querySelector('span')
      if (label) label.textContent = expanded ? '退出' : '全屏'
    })
  }

  const restoreFallback = () => {
    unregisterFallbackBack?.()
    unregisterFallbackBack = null
    const hosts = root.querySelectorAll<HTMLElement>('[data-linuxdo-video-fullscreen].is-fullscreen-fallback')
    if (!hosts.length) return
    hosts.forEach((host) => host.classList.remove('is-fullscreen-fallback'))
    nativeBridge()?.setEmbeddedVideoFullscreen?.(false)
  }

  const onClick = (event: MouseEvent) => {
    const element = event.target
    if (!(element instanceof Element)) return
    const button = element.closest<HTMLButtonElement>('[data-linuxdo-video-fullscreen-toggle]')
    if (!button || !root.contains(button)) return
    const host = button.closest<HTMLElement>('[data-linuxdo-video-fullscreen]')
    if (!host) return
    event.preventDefault()
    event.stopPropagation()

    if (host.classList.contains('is-fullscreen-fallback')) {
      restoreFallback()
      updateControls()
      return
    }
    if (document.fullscreenElement === host) {
      void document.exitFullscreen().catch(() => {})
      return
    }

    // Must be invoked synchronously inside the trusted click event. Awaiting
    // anything first would lose transient user activation in Android WebView.
    const enter = host.requestFullscreen?.bind(host)
    const applyFallback = () => {
      if (!root.isConnected || !host.isConnected) return
      host.classList.add('is-fullscreen-fallback')
      nativeBridge()?.setEmbeddedVideoFullscreen?.(true)
      unregisterFallbackBack?.()
      unregisterFallbackBack = registerHardwareBackLayer(() => {
        restoreFallback()
        updateControls()
        return true
      })
      updateControls()
    }
    if (!enter) {
      applyFallback()
      return
    }
    try {
      void enter().then(updateControls).catch(applyFallback)
    } catch {
      applyFallback()
    }
  }

  const onFullscreenChange = () => updateControls()
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && root.querySelector('.is-fullscreen-fallback')) {
      event.preventDefault()
      restoreFallback()
      updateControls()
    }
  }

  const onPageHidden = () => {
    if (document.visibilityState === 'hidden') {
      restoreFallback()
      updateControls()
    }
  }
  root.addEventListener('click', onClick, true)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('visibilitychange', onPageHidden)
  return () => {
    root.removeEventListener('click', onClick, true)
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('visibilitychange', onPageHidden)
    restoreFallback()
  }
}
