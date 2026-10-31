import { useState } from 'react'

import { articleCoverUrl } from '../lib/articleAudio'
import { recoverArticleCover } from '../lib/articleCoverRecovery'
import type { Article } from '../lib/types'

type Recovery = {
  original: string
  status: 'recovering' | 'ready' | 'failed'
  replacement?: string
}

/** 只在图片彻底失败时补救；同一缩略图最多尝试一张替代图。 */
export function useArticleCover(article: Article) {
  const original = articleCoverUrl(article.image)
  const [recovery, setRecovery] = useState<Recovery | null>(null)
  const current = recovery?.original === original ? recovery : null
  const cover = current?.status === 'failed' ? undefined : current?.replacement ?? original

  const onFailed = () => {
    if (!original) return
    if (current) {
      if (current.status === 'ready') {
        setRecovery({ original, status: 'failed' })
      }
      return
    }

    setRecovery({ original, status: 'recovering' })
    void recoverArticleCover(article, original).then((replacement) => {
      setRecovery((previous) => previous?.original === original
        ? { original, status: replacement ? 'ready' : 'failed', replacement }
        : previous)
    })
  }

  return { cover, onFailed }
}
