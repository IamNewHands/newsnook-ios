import { parseHTML } from 'linkedom'

/**
 * The Bilibili mobile player implements its own fullscreen / orientation button
 * inside a cross-origin iframe. It does not consistently invoke Android WebView's
 * standard fullscreen callback. Supply a parent-origin fullscreen control on
 * the same iframe (never clone or reload the player after playback begins).
 *
 * IMPORTANT: only call AFTER generic sanitization has rebuilt trusted embeds.
 * The injected controls are app-authored UI, not permitted user-supplied markup.
 */
export function addLinuxDoVideoFullscreenControls(html: string): string {
  if (!html.includes('data-reader-role="trusted-video-embed"')) return html
  const { document } = parseHTML(`<html><body>${html}</body></html>`)
  let wrapped = false

  document.body.querySelectorAll('iframe[data-reader-role="trusted-video-embed"]').forEach((frame) => {
    const src = frame.getAttribute('src')
    if (!src) return
    try {
      const url = new URL(src)
      if (url.protocol !== 'https:' || !(
        (url.hostname === 'player.bilibili.com' && url.pathname === '/player.html') ||
        ((url.hostname === 'www.bilibili.com' || url.hostname === 'bilibili.com') &&
          /^\/blackboard\/(?:html5mobileplayer|newplayer)\.html$/.test(url.pathname))
      )) return
    } catch { return }

    const host = document.createElement('div')
    host.setAttribute('data-linuxdo-video-fullscreen', '')
    const control = document.createElement('button')
    control.setAttribute('type', 'button')
    control.setAttribute('data-linuxdo-video-fullscreen-toggle', '')
    control.setAttribute('aria-label', '全屏播放 Bilibili 视频')
    control.setAttribute('title', '全屏播放')
    control.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/></svg><span>全屏</span>'
    frame.replaceWith(host)
    host.append(frame, control)
    wrapped = true
  })

  return wrapped ? document.body.innerHTML : html
}
