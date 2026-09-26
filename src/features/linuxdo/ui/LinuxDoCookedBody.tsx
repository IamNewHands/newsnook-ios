import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'

import { useProgressiveImages } from '../../../hooks/useProgressiveImages'
import { linuxDoMediaFailureNote, resolveLinuxDoImageSrc } from '../media/imageSource'

/**
 * 渲染 Linux.do 的 cooked HTML：帖子正文、资料页简介、动态摘要、搜索结果摘要。
 *
 * 主站图片落在 Cloudflare 托管挑战后面，宿主 WebView 的跨站 `<img>` 与 `CapacitorHttp`
 * 兜底都拿不到放行，因此这里统一接上 `resolveLinuxDoImageSrc`（借 LinuxDoSession 的
 * 会话 Cookie / 隐藏同源传输取字节）。论坛排版 CSS 由调用方用 `.linuxdo-post-prose`
 * 之类的外层类名决定，本组件只负责图片管线与投票条/分类点的内联样式。
 */
export function LinuxDoCookedBody({
  html,
  className,
  onClick,
}: {
  html: string
  className?: string
  onClick?: (event: ReactMouseEvent<HTMLDivElement>) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  useProgressiveImages(rootRef, html, Boolean(html), {
    autoLoad: true,
    forceNativeFallback: true,
    imageReferer: 'https://linux.do/',
    resolveImage: resolveLinuxDoImageSrc,
    failureNote: linuxDoMediaFailureNote,
  })

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    root.querySelectorAll<HTMLElement>('[data-linuxdo-role="poll-bar"]').forEach((bar) => {
      const percent = bar.getAttribute('data-linuxdo-poll-percent')
      if (percent) bar.style.width = `${percent}%`
    })
    root.querySelectorAll<HTMLElement>('[data-linuxdo-role="quote-category-dot"]').forEach((dot) => {
      const color = dot.getAttribute('data-linuxdo-category-color')
      if (color) dot.style.backgroundColor = color
    })
  }, [html])

  return (
    <div
      ref={rootRef}
      className={className}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
