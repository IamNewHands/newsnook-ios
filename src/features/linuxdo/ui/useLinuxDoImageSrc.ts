import { useEffect, useState } from 'react'

import { isLinuxDoHostedMedia, resolveLinuxDoImageSrc } from '../media/imageSource'

/**
 * React 直接渲染的 Linux.do 图片（如资料页勋章）用这个 hook 解析。
 * 非主站（CDN）、非原生或解析失败时原样返回，网页端与公开 CDN 行为不变。
 *
 * 这里保留主机过滤：本 hook 是**提前**解析（不经过「直连失败」这个信号），CDN 头像直连即可，
 * 不该为它们多发一次插件调用。正文图走的是 useProgressiveImages 的失败兜底，那条路不过滤。
 */
export function useLinuxDoImageSrc(url?: string): string | undefined {
  const [resolved, setResolved] = useState(url)

  useEffect(() => {
    if (!url) {
      setResolved(undefined)
      return
    }
    setResolved(url)
    if (!isLinuxDoHostedMedia(url)) return
    let active = true
    void resolveLinuxDoImageSrc(url)
      .then((next) => {
        if (active && next !== url) setResolved(next)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [url])

  return resolved
}
