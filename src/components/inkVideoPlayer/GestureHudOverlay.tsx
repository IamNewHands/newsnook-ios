/**
 * Compact gesture feedback. Only brightness affects the media itself; the HUD never
 * adds a viewport-wide scrim. Keep overlays readable above letterboxed footage.
 */
import type { ReactNode } from 'react'
import { ChevronsLeft, ChevronsRight, RotateCw, Scan, Sun, Volume2, VolumeX } from 'lucide-react'
import { formatTime, type GestureHud } from './playback'

function Notice({ children, placement = 'center' }: { children: ReactNode; placement?: 'center' | 'top' }) {
  return <div data-ink-hud={placement} className={`ink-gesture-notice ink-gesture-notice--${placement}`} role="status" aria-live="off"><div className="ink-gesture-notice-body">{children}</div></div>
}

export function GestureHudOverlay({ hud, duration }: { hud: GestureHud; duration: number }) {
  if (hud.kind === 'volume' || hud.kind === 'brightness') {
    const value = Math.max(0, Math.min(1, hud.value))
    const Icon = hud.kind === 'brightness' ? Sun : value === 0 ? VolumeX : Volume2
    return <div className={`ink-gesture-level ink-gesture-level--${hud.kind}`} data-ink-hud={hud.kind} role="status" aria-label={`${hud.kind === 'volume' ? '音量' : '亮度'} ${Math.round(value * 100)}%`}>
      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
      <div className="ink-gesture-level-track"><div className="ink-gesture-level-fill" style={{ height: `${value * 100}%` }} /></div>
      <span className="ink-gesture-level-value">{Math.round(value * 100)}%</span>
    </div>
  }
  if (hud.kind === 'seek') {
    const seconds = Math.round(hud.offset)
    return <Notice placement="top">
      {seconds < 0 ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
      <span className="ink-gesture-time">{formatTime(hud.target)}</span>
      <span className="ink-gesture-secondary">/ {formatTime(duration)}</span>
      <span className="ink-gesture-delta">{seconds >= 0 ? '+' : ''}{seconds}s</span>
    </Notice>
  }
  if (hud.kind === 'zoom') {
    return <Notice><Scan size={17} /><span className="ink-gesture-time">{Math.round(hud.scale * 100)}%</span>{hud.rotation !== 0 && <span className="ink-gesture-delta">{hud.rotation}°</span>}</Notice>
  }
  if (hud.kind === 'mode') return <Notice><RotateCw size={16} /><span>{hud.label}</span></Notice>
  return null
}
