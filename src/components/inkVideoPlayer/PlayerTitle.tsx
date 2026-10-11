import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

export function PlayerTitle({ title }: { title: string }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [distance, setDistance] = useState(0)

  useLayoutEffect(() => {
    const track = trackRef.current
    const text = textRef.current
    if (!track || !text) return
    let disposed = false
    const measure = () => {
      if (!disposed) setDistance(Math.max(0, text.scrollWidth - track.clientWidth))
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(track)
    observer?.observe(text)
    window.addEventListener('resize', measure)
    void document.fonts?.ready.then(measure)
    return () => {
      disposed = true
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [title])

  return <div ref={trackRef} className="ink-video-title scroll-hidden" title={title}>
    <span
      ref={textRef}
      data-scrolling={distance > 1 ? 'true' : undefined}
      style={{ '--title-distance': `${distance}px`, '--title-duration': `${Math.max(8, distance / 28 + 4)}s` } as CSSProperties}
    >{title}</span>
  </div>
}
