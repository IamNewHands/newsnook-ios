import { useEffect, useState } from 'react'

import { resolveLinuxDoImageSrc } from '../media/imageSource'

/**
 * React 直接渲染的 Linux.do 图片（如资料页勋章）用这个 hook 解析。
 * 非主站（CDN）、非原生或解析失败时原样返回，网页端与公开 CDN 行为不变。
 */
export function useLinuxDoImageSrc(url?: string): string | undefined {
  const [resolved, setResolved] = useState(url)

  useEffect(() => {
    if (!url) {
      setResolved(undefined)
      return
    }
    setResolved(url)
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
