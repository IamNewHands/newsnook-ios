import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function readEink(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.eink === '1'
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  )
  const [eink, setEink] = useState(readEink)

  useEffect(() => {
    const media = window.matchMedia(QUERY)
    const onChange = () => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setEink(root.dataset.eink === '1')
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(root, { attributes: true, attributeFilter: ['data-eink'] })
    return () => obs.disconnect()
  }, [])

  return reduced || eink
}
