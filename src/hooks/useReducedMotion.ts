import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function readEink(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.eink === '1'
}

function readMediaQuery(): boolean {
  if (typeof window === 'undefined') return false
  // 测试环境（linkedom）没有 matchMedia；缺失时按「未开启减少动效」处理。
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readMediaQuery)
  const [eink, setEink] = useState(readEink)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(QUERY)
    const onChange = () => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setEink(root.dataset.eink === '1')
    sync()
    // 墨水屏开关是运行时切换的，需要跟着 data-eink 走。
    // 测试环境（linkedom）没有 MutationObserver，此时退化为不监听。
    if (typeof MutationObserver !== 'function') return
    const obs = new MutationObserver(sync)
    obs.observe(root, { attributes: true, attributeFilter: ['data-eink'] })
    return () => obs.disconnect()
  }, [])

  return reduced || eink
}
