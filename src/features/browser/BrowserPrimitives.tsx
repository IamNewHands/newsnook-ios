import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, Globe2, X } from 'lucide-react'
import { shortcutFaviconUrl } from './browserHistory'
import { useBrowserDialogFocus } from './useBrowserDialogFocus'

export function BrowserIconButton({label, children, onClick, disabled = false}: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean
}) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
    className="browser-icon-button flex size-11 shrink-0 items-center justify-center rounded-xl text-paper transition-colors active:bg-haze disabled:opacity-30">
    {children}
  </button>
}

export function BrowserSiteIcon({url, name, size = 'normal'}: {url: string; name?: string; size?: 'small' | 'normal'}) {
  const [failed, setFailed] = useState(false)
  const source = shortcutFaviconUrl(url)
  useEffect(() => setFailed(false), [url])
  return <span className={'flex shrink-0 items-center justify-center rounded-xl bg-haze/60 text-paper-muted ' + (size === 'small' ? 'size-8' : 'size-12')}>
    {source && !failed
      ? <img src={source} alt="" loading="lazy" referrerPolicy="no-referrer" className={size === 'small' ? 'size-5 object-contain' : 'size-6 object-contain'} onError={() => setFailed(true)}/>
      : name ? <span aria-hidden className="text-base font-semibold">{Array.from(name)[0]?.toUpperCase()}</span> : <Globe2 size={21}/>}
  </span>
}

export function BrowserSheet({title, children, onClose}: {title: string; children: ReactNode; onClose: () => void}) {
  const section = useBrowserDialogFocus<HTMLElement>()
  return <div className="browser-overlay absolute inset-0 z-50 flex items-end justify-center bg-black/50" role="presentation" onClick={onClose}>
    <section ref={section} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
      className="browser-sheet flex max-h-[85%] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border-t border-haze bg-ink-raised outline-none"
      style={{paddingBottom: 'max(var(--sab, 0px), 12px)'}} onClick={event => event.stopPropagation()}>
      <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-haze" aria-hidden/>
      <header className="flex shrink-0 items-center gap-3 px-4 pt-1.5 pb-2">
        <h2 className="min-w-0 flex-1 text-[17px] font-semibold text-paper">{title}</h2>
        <BrowserIconButton label={'关闭' + title} onClick={onClose}><X size={21}/></BrowserIconButton>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-2">{children}</div>
    </section>
  </div>
}

export function BrowserPageHeader({title, onBack, children}: {title: string; onBack: () => void; children?: ReactNode}) {
  return <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-haze bg-ink-raised px-2">
    <BrowserIconButton label="返回浏览器" onClick={onBack}><ArrowLeft size={21}/></BrowserIconButton>
    <h2 className="min-w-0 flex-1 text-[17px] font-semibold text-paper">{title}</h2>
    {children}
  </header>
}
