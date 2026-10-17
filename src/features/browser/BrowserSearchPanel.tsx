import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ArrowUpLeft, Check, Clock3, Copy, Search, X } from 'lucide-react'
import { browserSearchDestination, browserSearchProviders, type BrowserSearchCategory } from './browserSearchCatalog'
import { BROWSER_ENGINES, browserHostLabel, type BrowserSearchChoice } from './browserPreferences'
import type { BrowserVisit } from './browserHistory'
import { BrowserIconButton, BrowserSiteIcon } from './BrowserPrimitives'
import { useBrowserDialogFocus } from './useBrowserDialogFocus'

export function BrowserSearchPanel({current, initialValue, engine, history, pending, error, onClose, onOpen, onCopy}: {
  current: string; initialValue: string; engine: BrowserSearchChoice; history: BrowserVisit[]
  pending: boolean; error: string; onClose: () => void
  onOpen: (value: string) => Promise<boolean>; onCopy: (value: string) => void
}) {
  const section = useBrowserDialogFocus<HTMLElement>()
  const [value, setValue] = useState(initialValue)
  const [category, setCategory] = useState<BrowserSearchCategory>('常用')
  const input = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const draftRevision = useRef(0)
  const submitting = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {mounted.current = false}
  }, [])
  const changeValue = (next: string) => {draftRevision.current++; setValue(next)}
  const query = value.trim()
  const results = useMemo(() => {
    const needle = query.toLocaleLowerCase()
    return history.filter(item => !needle || (item.title + ' ' + item.url).toLocaleLowerCase().includes(needle)).slice(0, 5)
  }, [history, query])
  useEffect(() => {
    input.current?.focus()
    if (initialValue) input.current?.select()
  }, [initialValue])
  const submit = async (destination: string) => {
    if (pending || submitting.current) return
    submitting.current = true
    const revision = draftRevision.current
    try {
      const opened = await onOpen(destination)
      if (opened && mounted.current && draftRevision.current === revision) {
        input.current?.blur()
        onClose()
      }
    } finally {submitting.current = false}
  }

  return <section ref={section} tabIndex={-1} role="dialog" aria-modal="true" aria-label="搜索与地址"
    className="browser-search absolute inset-0 z-40 flex flex-col bg-ink outline-none"
    style={{paddingTop:'var(--sat)', paddingBottom:'var(--sab)'}}>
    <form className="flex shrink-0 items-center gap-1.5 border-b border-haze bg-ink-raised px-3 py-2"
      onSubmit={event => {event.preventDefault(); if (query) void submit(value)}}>
      <div className="flex min-w-0 flex-1 items-center rounded-2xl border border-haze bg-ink pl-3 focus-within:border-paper-muted">
        <Search size={18} className="mr-2 shrink-0 text-paper-muted"/>
        <input ref={input} aria-label="搜索或输入网址" value={value} onChange={event => changeValue(event.target.value)}
          placeholder="搜索或输入网址" enterKeyHint="go" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-paper outline-none"/>
        {value && <BrowserIconButton label="清空搜索" onClick={() => {changeValue(''); input.current?.focus()}}><X size={18}/></BrowserIconButton>}
      </div>
      <button type="button" onClick={onClose} className="min-h-11 shrink-0 px-2 text-[14px] text-paper">取消</button>
    </form>
    {current && <div className="flex shrink-0 items-center gap-2 border-b border-haze bg-ink-raised px-4 py-1">
      <button type="button" onClick={() => {changeValue(current); input.current?.focus(); input.current?.select()}}
        className="min-h-11 min-w-0 flex-1 text-left">
        <span className="block text-[12px] text-paper-muted">当前网址</span>
        <span className="block truncate text-[13px] text-paper">{current}</span>
      </button>
      <BrowserIconButton label="复制当前网址" onClick={() => onCopy(current)}><Copy size={18}/></BrowserIconButton>
    </div>}
    <div role="tablist" aria-label="搜索分类" className="flex shrink-0 gap-1 overflow-x-auto border-b border-haze bg-ink-raised px-3">
      {(['常用','搜索','AI','学术'] as const).map(item =>
        <button key={item} role="tab" type="button" aria-selected={category === item} onClick={() => setCategory(item)}
          className={'min-h-12 flex-1 whitespace-nowrap border-b-2 px-4 text-[14px] transition-colors ' + (category === item ? 'border-cinnabar font-semibold text-paper' : 'border-transparent text-paper-muted')}>{item}</button>)}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-6">
      {error && <p role="alert" className="mb-3 rounded-xl border border-cinnabar/30 px-3 py-2 text-[14px] text-paper">{error}</p>}
      {query && <button type="button" disabled={pending} onClick={() => void submit(value)}
        className="mb-4 flex min-h-14 w-full items-center gap-3 rounded-2xl bg-ink-raised px-4 text-left text-[14px] text-paper disabled:opacity-50">
        <Search size={19} className="shrink-0 text-paper-muted"/>
        <span className="min-w-0 flex-1 truncate">{value}</span><ArrowRight size={19}/>
      </button>}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {browserSearchProviders(category).map(provider => <button key={provider.id} type="button" disabled={pending}
          onClick={() => void submit(browserSearchDestination(provider, value))}
          className={'flex min-h-16 min-w-0 items-center gap-2.5 rounded-2xl border px-3 py-2 text-left transition-colors active:bg-haze disabled:opacity-50 ' + (provider.id === engine ? 'border-paper-muted/40 bg-ink-raised' : 'border-transparent bg-ink-raised')}>
          <BrowserSiteIcon url={provider.home} name={provider.name} size="small"/>
          <span className="min-w-0 flex-1 break-words text-[14px] leading-snug text-paper">{provider.name}</span>
          {provider.id === engine && <Check size={14} className="shrink-0 text-paper-muted" aria-label="默认搜索"/>}
        </button>)}
      </div>
      {results.length > 0 && <div className="mt-6">
        <h3 className="mb-1 text-[13px] font-medium text-paper-muted">{query ? '匹配的历史' : '最近访问'}</h3>
        {results.map(item => <div key={item.url} className="flex items-center gap-2 border-b border-haze/60">
          <button type="button" onClick={() => void submit(item.url)} disabled={pending} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2 text-left">
            <Clock3 size={17} className="shrink-0 text-paper-muted"/>
            <span className="min-w-0"><span className="block truncate text-[14px] text-paper">{item.title}</span><span className="mt-0.5 block truncate text-[12px] text-paper-muted">{browserHostLabel(item.url)}</span></span>
          </button>
          <BrowserIconButton label={'填入网址 ' + browserHostLabel(item.url)} onClick={() => {changeValue(item.url); input.current?.focus()}}><ArrowUpLeft size={18}/></BrowserIconButton>
        </div>)}
      </div>}
      {!query && !results.length && <p className="mt-5 text-[13px] text-paper-muted">默认使用 {BROWSER_ENGINES[engine].name} 搜索</p>}
    </div>
  </section>
}
