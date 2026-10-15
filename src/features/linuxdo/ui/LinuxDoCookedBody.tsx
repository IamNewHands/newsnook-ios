import { createElement, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'

import { useProgressiveImages } from '../../../hooks/useProgressiveImages'
import { linuxDoMediaStatusNote, resolveLinuxDoImageSrc } from '../media/imageSource'
import { installLinuxDoEmbeddedVideoFullscreen } from './embeddedVideoFullscreen'

/**
 * 渲染 Linux.do 的 cooked HTML：帖子正文、资料页简介、动态摘要、搜索结果摘要。
 *
 * 主站图片落在 Cloudflare 托管挑战后面，宿主 WebView 的跨站 `<img>` 与 `CapacitorHttp`
 * 兜底都拿不到放行，因此这里统一接上 `resolveLinuxDoImageSrc`（借 LinuxDoSession 的
 * 会话 Cookie / 隐藏同源传输取字节）。论坛排版 CSS 由调用方用 `.linuxdo-post-prose`
 * 之类的外层类名决定，本组件只负责图片管线、内嵌视频全屏接管与投票条/分类点的内联样式。
 *
 * `as` 默认 `div`；搜索结果行整行是 `<button>`，内嵌的块级元素会被 HTML 解析规则
 * 顶出去（button 只允许 phrasing content），那里必须传 `span`。
 */
export function LinuxDoCookedBody({
  html,
  className,
  onClick,
  as = 'div',
}: {
  html: string
  className?: string
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void
  as?: 'div' | 'span'
}) {
  const rootRef = useRef<HTMLElement | null>(null)
  // React compares dangerouslySetInnerHTML by object identity. A fresh { __html }
  // on every read-state/notification render rewrites innerHTML and restarts embedded
  // iframes (Bilibili, YouTube, etc.) even when the post HTML has not changed.
  const stableHtml = useMemo(() => ({ __html: html }), [html])
  useProgressiveImages(rootRef, html, Boolean(html), {
    autoLoad: true,
    forceNativeFallback: true,
    imageReferer: 'https://linux.do/',
    resolveImage: resolveLinuxDoImageSrc,
    failureNote: linuxDoMediaStatusNote,
  })

  useEffect(() => {
    const root = rootRef.current
    return root ? installLinuxDoEmbeddedVideoFullscreen(root) : undefined
  }, [html])

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

  return createElement(as, {
    ref: rootRef,
    className,
    onClick,
    dangerouslySetInnerHTML: stableHtml,
  })
}
