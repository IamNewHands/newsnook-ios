import { useCallback, useEffect, useRef, useState } from 'react'
import { setBodyPinned } from '../lib/bodyCache'
import { haptics } from '../lib/haptics'
import { loadLaterArticles, saveLaterArticles } from '../lib/storage'
import type { Article } from '../lib/types'

/** Own explicit save/remove actions; startup bulk reconciliation remains with App. */
export function useLaterArticles(notifyCacheChange: () => void) {
  const [later, setLater] = useState<Article[]>(() => loadLaterArticles())
  const laterRef = useRef(later)
  useEffect(() => saveLaterArticles(later), [later])

  const toggleLater = useCallback((article: Article) => {
    if (laterRef.current.some((item) => item.id === article.id)) {
      const next = laterRef.current.filter((item) => item.id !== article.id)
      laterRef.current = next
      setLater(next)
      setBodyPinned(article.id, false)
      void haptics.tick()
      notifyCacheChange()
      return
    }

    const next = [article, ...laterRef.current]
    laterRef.current = next
    setLater(next)
    // An explicit save must protect an existing body before idle reconciliation.
    setBodyPinned(article.id, true)
    void haptics.success()
  }, [notifyCacheChange])

  const removeLater = useCallback((id: string) => {
    const next = laterRef.current.filter((item) => item.id !== id)
    laterRef.current = next
    setLater(next)
    setBodyPinned(id, false)
    void haptics.tick()
    notifyCacheChange()
  }, [notifyCacheChange])

  return { later, laterRef, toggleLater, removeLater }
}
