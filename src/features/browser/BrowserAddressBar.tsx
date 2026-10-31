import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Film, Globe2, LockKeyhole, Search, Shield } from 'lucide-react'
import { browserHostLabel } from './browserPreferences'

/** An in-memory, tab-scoped announcement. Never stores URLs or private media in persistent storage. */
const ANNOUNCEMENT_MS = 2500
const MAX_ANNOUNCED_PAGES = 120

function rememberPage(target: Set<string>, page: string) {
  target.add(page)
  if (target.size <= MAX_ANNOUNCED_PAGES) return
  const oldest = target.values().next().value
  if (oldest) target.delete(oldest)
}

export function browserMediaMatchesPage(current: string, mediaPage: string | undefined): boolean {
  if (!/^https?:\/\//i.test(current) || !mediaPage) return false
  try {
    const page = new URL(current)
    const observed = new URL(mediaPage)
    page.hash = ''
    observed.hash = ''
    return page.href === observed.href
  } catch {
    return false
  }
}

/** Narrow screens keep the URL legible: the media action gets its own slim toolbar row. */
export function BrowserMediaStrip({count, open, onOpen}: {count: number; open: boolean; onOpen: () => void}) {
  if (count < 1) return null
  return <button type="button" className="browser-media-strip" onClick={onOpen}
    aria-label={'媒体资源，发现 ' + count + ' 个视频，查看列表'} aria-haspopup="dialog" aria-expanded={open}>
    <span className="browser-media-strip-icon"><Film size={17} strokeWidth={1.8} aria-hidden="true"/></span>
    <span className="browser-media-strip-text">发现 {count} 个视频</span>
    <span className="browser-media-strip-count" aria-hidden="true">{count > 9 ? '9+' : count}</span>
    <ChevronRight size={15} strokeWidth={1.7} aria-hidden="true" className="browser-media-strip-arrow"/>
  </button>
}

export function BrowserAddressBar({
  active, current, privateMode, mediaCount, mediaTabId, mediaPage, mediaPanelOpen,
  onOpenSite, onSearch, onOpenMedia,
}: {
  active: boolean
  current: string
  privateMode: boolean
  mediaCount: number
  mediaTabId?: number
  mediaPage?: string
  mediaPanelOpen: boolean
  onOpenSite: () => void
  onSearch: () => void
  onOpenMedia: () => void
}) {
  const available = active && mediaTabId != null && browserMediaMatchesPage(current, mediaPage) ? mediaCount : 0
  // Ignore fragment navigations while keeping page identity separate for each native tab.
  const identity = mediaPage ? mediaPage.split('#', 1)[0] : ''
  const pageKey = available > 0 ? mediaTabId + '|' + identity : null
  const announced = useRef(new Set<string>())
  const viewed = useRef(new Set<string>())
  const [announcement, setAnnouncement] = useState<string | null>(null)

  useEffect(() => {
    if (!pageKey) { setAnnouncement(null); return }
    if (mediaPanelOpen) {
      // The user may have entered via the overflow menu before the badge appeared.
      rememberPage(announced.current, pageKey)
      rememberPage(viewed.current, pageKey)
      setAnnouncement(null)
      return
    }
    if (announced.current.has(pageKey)) return
    rememberPage(announced.current, pageKey)
    setAnnouncement(pageKey)
    const timer = window.setTimeout(() => setAnnouncement(key => key === pageKey ? null : key), ANNOUNCEMENT_MS)
    return () => window.clearTimeout(timer)
  }, [pageKey, mediaPanelOpen])

  const openMedia = () => {
    if (pageKey) rememberPage(viewed.current, pageKey)
    setAnnouncement(null)
    onOpenMedia()
  }
  const announcedNow = pageKey !== null && announcement === pageKey && !mediaPanelOpen
  const unread = pageKey !== null && !viewed.current.has(pageKey)
  const countText = available > 9 ? '9+' : String(available)
  const label = '媒体资源，发现 ' + available + ' 个视频'

  return <div className={'browser-address flex h-11 min-w-0 flex-1 items-center rounded-xl bg-haze/60 text-paper ' + (privateMode ? 'ring-1 ring-paper-muted/35' : '')}
    data-browser-media-count={available} data-browser-media-prompt={announcedNow ? '' : undefined}>
      {active ? <button type="button" aria-label={privateMode ? '隐私模式与网站信息' : '网站信息'} onClick={onOpenSite}
        className="browser-address-site flex h-11 w-10 shrink-0 items-center justify-center rounded-l-xl text-paper-muted">
        {privateMode ? <Shield size={17}/> : /^https:/i.test(current) ? <LockKeyhole size={15}/> : <Globe2 size={17}/>}
      </button> : <span className="flex w-10 shrink-0 justify-center text-paper-muted">{privateMode ? <Shield size={17}/> : <Search size={17}/>}</span>}
      <button type="button" aria-label="搜索或输入网址" onClick={onSearch}
        className="browser-address-text flex h-11 min-w-0 flex-1 items-center gap-1.5 pr-1 text-left">
        {privateMode && <span className="shrink-0 text-[12px] font-semibold text-paper-muted">隐私</span>}
        <span className="browser-address-label block min-w-0 truncate text-[14px] font-medium">
          <span className={announcedNow ? 'browser-address-host-during-hint' : ''}>{active ? browserHostLabel(current) : privateMode ? '搜索或网址' : '搜索或输入网址'}</span>
          {announcedNow && <span className="browser-media-address-hint">发现 {available} 个视频</span>}
        </span>
      </button>
      {available > 0 && <button type="button" onClick={openMedia} aria-label={label + '，查看列表'}
        title={label} aria-haspopup="dialog" aria-expanded={mediaPanelOpen}
        className={'browser-media-indicator relative flex h-11 w-10 shrink-0 items-center justify-center rounded-r-xl ' + (unread ? 'browser-media-indicator-new' : '')}>
        <Film size={19} strokeWidth={1.8} aria-hidden="true"/>
        <span aria-hidden="true" className="browser-media-indicator-count">{countText}</span>
      </button>}
      {announcedNow && <span className="sr-only" role="status">{label}</span>}
  </div>
}
