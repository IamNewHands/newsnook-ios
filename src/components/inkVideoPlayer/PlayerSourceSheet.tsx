import { useEffect, useRef } from 'react'
import { Check, ListVideo, X } from 'lucide-react'
import type { MediaResourceDescriptor } from '../../features/mediaSniffer/types'
import { playbackIdentity } from './lifecycle'

/** Video-stage sheet: works inside the browser fullscreen top layer and Android's fixed fullscreen. */
export function PlayerSourceSheet({
  resources, activeUrl, activeFormat, onClose, onSelect,
}: {
  resources: MediaResourceDescriptor[]
  activeUrl: string
  activeFormat: MediaResourceDescriptor['type']
  onClose: () => void
  onSelect: (resource: MediaResourceDescriptor) => void
}) {
  const activeKey = playbackIdentity(activeUrl, activeFormat)
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // Keep the fullscreen dialog reachable by keyboard without unmounting the media.
    const opener = document.activeElement
    closeButton.current?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  return (
    <div className="ink-player-stage-sheet" data-ink-player-source-sheet="" role="presentation" onPointerDown={event => event.stopPropagation()}>
      <button type="button" className="ink-player-sheet-dismiss" aria-label="关闭媒体资源" onClick={onClose} />
      <section className="ink-player-stage-panel" role="dialog" aria-modal="true" aria-label="媒体资源" onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}>
        <header className="ink-player-stage-panel-heading">
          <div className="ink-player-panel-mark"><ListVideo size={19} strokeWidth={1.8} /></div>
          <div className="ink-player-panel-heading-copy"><strong>媒体资源</strong><span>{resources.length} 个可用视频源</span></div>
          <button ref={closeButton} type="button" className="ink-player-sheet-close" onClick={onClose} aria-label="关闭媒体资源"><X size={20} /></button>
        </header>
        <div className="ink-player-panel-items">
          {resources.map((resource, index) => {
            const active = playbackIdentity(resource.url, resource.type) === activeKey
            const track = resource.videoTracks.find(item => item.width || item.height)
            return <button type="button" key={resource.id || resource.url + index} aria-current={active ? 'true' : undefined}
              className="ink-player-source-row" data-active={active || undefined} onClick={() => {
                onSelect(resource)
                onClose()
              }}>
              <span className="ink-player-source-icon">{resource.type === 'hls' ? 'HLS' : resource.type === 'dash' ? 'DASH' : 'MP4'}</span>
              <span className="ink-player-source-copy">
                <strong>{track?.height ? `${track.height}P` : `视频源 ${index + 1}`}{resource.isAd ? ' · 广告' : ''}</strong>
                <small>{resource.url}</small>
              </span>
              {active && <Check size={17} className="ink-player-source-selected" strokeWidth={2} />}
            </button>
          })}
        </div>
      </section>
    </div>
  )
}
