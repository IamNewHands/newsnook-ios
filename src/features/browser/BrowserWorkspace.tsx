import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import {
  ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, ChevronLeft, Clock3,
  Globe2, Home, Laptop, LoaderCircle, MoreHorizontal, Plus,
  RefreshCw, Settings2, ShieldCheck, Smartphone, Trash2, X,
} from 'lucide-react'
import { useHardwareBackLayer } from '../../hooks/useHardwareBackLayer'
import { ScriptManager } from './ScriptManager'
import { loadUserScripts } from './scripts'

export interface BrowserState { url: string | null; back: boolean; forward: boolean; desktop: boolean }
type BrowserOp = 'back' | 'forward' | 'reload' | 'desktop' | 'url' | 'new' | 'tabs' | 'scriptMenu'
type NativeTab = {index: number; title: string; url: string; active: boolean; loading: boolean}
type BrowserNative = {
  open: (args: { url: string; scripts: ReturnType<typeof loadUserScripts>; embedded: true; top: number; bottom: number }) => Promise<void>
  navigate: (args: { action: BrowserOp; url?: string }) => Promise<void>
  state: () => Promise<BrowserState>
  tabs: () => Promise<{tabs: NativeTab[]}>
  activateTab: (args: {index: number}) => Promise<void>
  removeTab: (args: {index: number}) => Promise<void>
  setBounds: (args: { top: number; bottom: number; visible: boolean }) => Promise<void>
  close: () => Promise<void>
  addListener: (event: 'navigation', callback: (event: { url: string; phase: 'start' | 'end' }) => void) => Promise<PluginListenerHandle>
}
const nativeBrowser = registerPlugin<BrowserNative>('NewsNookBrowser')

type SavedVisit = { url: string; title: string; time: number }
type SearchChoice = 'bing' | 'google' | 'baidu' | 'duckduckgo'
const HISTORY_KEY = 'newsnook:browser:history:v1'
const MARKS_KEY = 'newsnook:browser:bookmarks:v1'
const SEARCH_KEY = 'newsnook:browser:search:v1'
const engines: Record<SearchChoice, { name: string; url: string }> = {
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  baidu: { name: '百度', url: 'https://www.baidu.com/s?wd=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
}
function loadList(key: string): SavedVisit[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(list) ? list.filter((entry): entry is SavedVisit => entry && typeof entry.url === 'string' && typeof entry.time === 'number').slice(0, 500) : []
  } catch { return [] }
}
function resolveAddress(text: string, engine: SearchChoice): string | null {
  const input = text.trim()
  if (!input) return null
  try {
    const guessed = /^https?:\/\//i.test(input) ? input : /^[\w\-.]+\.[a-z]{2,}(?:[:/]|$)/i.test(input) && !/\s/.test(input) ? `https://${input}` : null
    if (guessed) {
      const url = new URL(guessed)
      return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.href : null
    }
    return engines[engine].url + encodeURIComponent(input)
  } catch { return null }
}
function titleOf(address: string): string {
  try { return new URL(address).hostname.replace(/^www\./, '') } catch { return address }
}
function Button({ label, children, onClick, disabled }: { label: string; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
    className="flex size-10 shrink-0 items-center justify-center rounded-xl text-paper-muted transition-colors hover:bg-haze hover:text-paper active:scale-95 disabled:opacity-30">
    {children}
  </button>
}

export function BrowserWorkspace({ onExit }: { onExit: () => void }) {
  const viewport = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const loaded = useRef(false)
  const busy = useRef(false)
  const [address, setAddress] = useState('')
  const [current, setCurrent] = useState('')
  const [nativeState, setNativeState] = useState<BrowserState>({ url: null, back: false, forward: false, desktop: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [panel, setPanel] = useState<'menu' | 'history' | 'bookmarks' | 'settings' | 'scripts' | 'tabs' | null>(null)
  const [tabs, setTabs] = useState<NativeTab[]>([])
  const [history, setHistory] = useState(() => loadList(HISTORY_KEY))
  const [marks, setMarks] = useState(() => loadList(MARKS_KEY))
  const [search, setSearch] = useState<SearchChoice>(() => {
    const saved = localStorage.getItem(SEARCH_KEY)
    return saved && saved in engines ? saved as SearchChoice : 'bing'
  })
  const [scriptCount, setScriptCount] = useState(() => loadUserScripts().filter(s => s.enabled).length)
  const isAndroid = Capacitor.getPlatform() === 'android'
  const active = Boolean(current)
  const marked = marks.some(item => item.url === current)
  const pageTitle = useMemo(() => titleOf(current), [current])
  const closing = useRef(false)

  const saveVisit = useCallback((url: string) => {
    if (!/^https?:\/\//.test(url)) return
    setHistory(prev => {
      const next = [{ url, title: titleOf(url), time: Date.now() }, ...prev.filter(item => item.url !== url)].slice(0, 400)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }, [])
  const updateNativeState = useCallback(() => {
    if (loaded.current) {
      void nativeBrowser.state().then(setNativeState).catch(() => undefined)
      void nativeBrowser.tabs().then(result => setTabs(result.tabs)).catch(() => undefined)
    }
  }, [])
  const getBounds = useCallback(() => {
    const rect = viewport.current?.getBoundingClientRect()
    return rect ? { top: Math.max(0, rect.top), bottom: Math.max(0, window.innerHeight - rect.bottom) } : { top: 116, bottom: 80 }
  }, [])
  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    loaded.current = false
    void nativeBrowser.close().catch(() => undefined).finally(onExit)
  }, [onExit])
  useHardwareBackLayer(true, () => {
    if (panel) { setPanel(null); return true }
    if (loaded.current && nativeState.back) { void nativeBrowser.navigate({ action: 'back' }); return true }
    close()
    return true
  })
  useEffect(() => {
    let disposed = false
    let handle: PluginListenerHandle | undefined
    if (isAndroid) {
      void nativeBrowser.addListener('navigation', event => {
        if (disposed) return
        setCurrent(event.url)
        setAddress(event.url)
        setLoading(event.phase === 'start')
        if (event.phase === 'start') saveVisit(event.url)
        updateNativeState()
      }).then(h => { if (disposed) void h.remove(); else handle = h })
    }
    return () => {
      disposed = true
      void handle?.remove()
      loaded.current = false
      void nativeBrowser.close().catch(() => undefined)
    }
  }, [isAndroid, saveVisit, updateNativeState])
  useEffect(() => {
    if (!loaded.current) return
    const sync = () => { void nativeBrowser.setBounds({ ...getBounds(), visible: !panel }).catch(() => undefined) }
    sync()
    window.addEventListener('resize', sync)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
    if (viewport.current) observer?.observe(viewport.current)
    return () => { window.removeEventListener('resize', sync); observer?.disconnect() }
  }, [current, panel, getBounds])
  const openAddress = useCallback(async (value: string) => {
    const url = resolveAddress(value, search)
    if (!url) { setError('地址无效，请输入网址或关键词'); return }
    if (!isAndroid) { setError('原生网页浏览器目前支持 Android'); return }
    if (busy.current) return
    busy.current = true
    setError(''); setPanel(null); setLoading(true)
    setAddress(url)
    try {
      if (loaded.current) {
        await nativeBrowser.setBounds({ ...getBounds(), visible: true })
        await nativeBrowser.navigate({ action: 'url', url })
      } else {
        await nativeBrowser.open({ url, scripts: loadUserScripts().filter(s => s.enabled), embedded: true, ...getBounds() })
        loaded.current = true
      }
      setCurrent(url)
      saveVisit(url)
      updateNativeState()
    } catch (err) { setError(err instanceof Error ? err.message : '页面打开失败'); setLoading(false) }
    finally { busy.current = false }
  }, [getBounds, isAndroid, saveVisit, search, updateNativeState])
  const action = (name: BrowserOp) => {
    if (!loaded.current) return
    void nativeBrowser.navigate({ action: name }).then(updateNativeState).catch(err => setError(String(err)))
  }
  const setPanelVisible = (next: typeof panel) => {
    setPanel(p => p === next ? null : next)
  }
  const goHome = () => {
    setPanel(null)
    if (loaded.current) {
      void nativeBrowser.close().catch(() => undefined)
      loaded.current = false
    }
    setCurrent(''); setAddress(''); setNativeState({ url: null, back: false, forward: false, desktop: false })
  }
  const toggleMark = () => {
    if (!current) return
    setMarks(prev => {
      const next = marked ? prev.filter(item => item.url !== current) : [{ url: current, title: pageTitle, time: Date.now() }, ...prev]
      localStorage.setItem(MARKS_KEY, JSON.stringify(next))
      return next
    })
  }
  const clearHistory = () => { localStorage.removeItem(HISTORY_KEY); setHistory([]) }
  const menuItems: { label: string; secondary: string; icon: typeof Bookmark; action: () => void }[] = [
    { label: '新建标签', secondary: '创建独立网页标签', icon: Plus, action: () => {setPanel(null);action('new')} },
    { label: '切换标签', secondary: '管理已打开的页面', icon: Globe2, action: () => {updateNativeState();setPanel('tabs')} },
    { label: '主页', secondary: '常用网址与搜索', icon: Home, action: goHome },
    { label: marked ? '取消收藏' : '收藏当前页面', secondary: pageTitle || '保存网址', icon: Bookmark, action: toggleMark },
    { label: '浏览历史', secondary: `${history.length} 条记录`, icon: Clock3, action: () => setPanel('history') },
    { label: '书签', secondary: `${marks.length} 个网址`, icon: BookmarkCheck, action: () => setPanel('bookmarks') },
    { label: '用户脚本', secondary: `${scriptCount} 个已启用`, icon: ShieldCheck, action: () => setPanel('scripts') },
    { label: '脚本菜单', secondary: '执行网页中的脚本命令', icon: ShieldCheck, action: () => { setPanel(null); action('scriptMenu') } },
    { label: '浏览器设置', secondary: '搜索引擎与桌面模式', icon: Settings2, action: () => setPanel('settings') },
  ]

  return <div role="dialog" aria-label="NewsNook 网页浏览器" aria-modal="true" className="fixed inset-0 z-[95] flex min-w-0 flex-col overflow-hidden bg-ink" style={{ paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)' }}>
    <header className="z-10 shrink-0 border-b border-haze bg-ink-raised px-2 pt-2 pb-2.5 shadow-sm">
      <div className="flex items-center gap-1">
        <Button label="关闭浏览器" onClick={close}><ChevronLeft size={23} /></Button>
        <span className="mr-1 hidden font-display text-base tracking-wide text-paper min-[390px]:inline">网页</span>
        <div className="flex h-10 min-w-0 flex-1 items-center rounded-xl border border-haze bg-ink px-3 focus-within:border-cinnabar/55">
          {loading ? <LoaderCircle size={15} className="mr-2 shrink-0 animate-spin text-cinnabar" /> : <Globe2 size={15} className="mr-2 shrink-0 text-paper-faint" />}
          <input ref={input} aria-label="地址或搜索" type="text" enterKeyHint="go" value={address} onChange={event => setAddress(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') { input.current?.blur(); void openAddress(address) } }}
            placeholder="搜索或输入网址" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            className="w-full min-w-0 bg-transparent text-[14px] text-paper outline-none placeholder:text-paper-faint" />
          {address && <button aria-label="清空地址" type="button" onClick={() => {setAddress('');input.current?.focus()}}><X size={15} className="text-paper-faint" /></button>}
        </div>
        <Button label="前往" onClick={() => void openAddress(address)}><ArrowRight size={20} /></Button>
        <Button label="浏览器菜单" onClick={() => setPanelVisible('menu')}><MoreHorizontal size={22} /></Button>
      </div>
      {error && <p role="alert" className="mt-2 px-11 text-[12px] text-cinnabar">{error}</p>}
    </header>

    <div ref={viewport} className="relative min-h-0 flex-1 overflow-hidden bg-ink">
      {!active && <div className="mx-auto flex h-full max-w-xl flex-col overflow-y-auto px-6 pt-10 pb-6">
        <span className="font-mono text-[10px] font-medium tracking-[0.25em] text-cinnabar">NEWSNOOK / WEB</span>
        <h1 className="mt-3 font-display text-[34px] font-normal leading-tight text-paper">探索网页，<span className="italic">随心阅读</span></h1>
        <p className="mt-3 text-[13px] text-paper-muted">开放网页 · 用户脚本 · 自由定制</p>
        <div className="mt-8 grid grid-cols-2 gap-2.5">
          {[['Linux.do', 'https://linux.do/'], ['知乎', 'https://www.zhihu.com/'], ['ChatGPT', 'https://chatgpt.com/'], ['Bing', 'https://www.bing.com/']].map(([label,url]) =>
            <button key={url} type="button" onClick={() => void openAddress(url)} className="group flex min-h-20 flex-col justify-between rounded-2xl border border-haze bg-ink-raised p-4 text-left transition-colors hover:border-cinnabar/45 hover:bg-haze">
              <Globe2 size={19} strokeWidth={1.5} className="text-cinnabar" /><span className="font-medium text-[13px] text-paper">{label}</span>
            </button>)}
        </div>
        <div className="mt-8 flex items-center justify-between"><h2 className="text-sm font-semibold text-paper">最近访问</h2><button type="button" onClick={() => setPanel('history')} className="text-xs text-paper-faint">查看全部</button></div>
        <div className="mt-3 space-y-1">{history.slice(0, 5).map(item => <button type="button" key={item.url} onClick={() => void openAddress(item.url)} className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-haze"><Clock3 size={16} className="text-paper-faint" /><span className="min-w-0 flex-1 truncate text-[12px] text-paper-muted">{item.title}</span><ArrowRight size={14} className="text-paper-faint" /></button>)}{history.length === 0 && <p className="pt-2 text-[12px] text-paper-faint">访问的网站将在这里显示</p>}</div>
      </div>}
      {active && loading && <div className="absolute top-0 left-0 h-[2px] w-1/2 animate-pulse bg-cinnabar" />}
    </div>

    <nav aria-label="浏览器控制" className="z-10 flex shrink-0 items-center justify-around border-t border-haze bg-ink-raised px-2 py-2">
      <Button label="后退" disabled={!nativeState.back} onClick={() => action('back')}><ArrowLeft size={19} /></Button>
      <Button label="前进" disabled={!nativeState.forward} onClick={() => action('forward')}><ArrowRight size={19} /></Button>
      <Button label="重新加载" disabled={!active} onClick={() => action('reload')}><RefreshCw size={19} /></Button>
      <Button label="收藏" disabled={!active} onClick={toggleMark}>{marked ? <BookmarkCheck size={19} className="text-cinnabar"/> : <Bookmark size={19}/>}</Button>
      <Button label="用户脚本" onClick={() => setPanelVisible('scripts')}><ShieldCheck size={19} /></Button>
      <Button label="标签页" onClick={() => {updateNativeState();setPanelVisible('tabs')}}><span className="flex size-[22px] items-center justify-center rounded-md border border-current font-mono text-[12px]">{tabs.length || 1}</span></Button>
    </nav>

    {panel === 'menu' && <div className="absolute inset-0 z-30 flex items-end bg-black/60" onClick={() => setPanel(null)} role="presentation">
      <section className="w-full rounded-t-3xl border border-haze bg-ink-raised px-4 pt-5 pb-7 shadow-2xl" onClick={event => event.stopPropagation()} aria-label="浏览器菜单">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-xl text-paper">网页工具</h2><Button label="关闭菜单" onClick={() => setPanel(null)}><X size={19}/></Button></div>
        <div className="grid grid-cols-2 gap-2">{menuItems.map(item => <button key={item.label} type="button" onClick={item.action} className="flex min-h-20 items-start gap-3 rounded-xl border border-haze bg-ink px-3 py-3 text-left"><item.icon size={17} className="mt-1 shrink-0 text-cinnabar" /><span className="min-w-0"><span className="block text-sm text-paper">{item.label}</span><span className="mt-1 block text-[12px] text-paper-faint">{item.secondary}</span></span></button>)}</div>
        <button type="button" disabled={!active} onClick={() => {setPanel(null);action('desktop')}} className="mt-3 flex w-full items-center justify-between rounded-xl border border-haze bg-ink p-3 text-sm text-paper disabled:opacity-40"><span className="flex items-center gap-3">{nativeState.desktop ? <Laptop size={18}/> : <Smartphone size={18}/>}桌面版网页</span><span className="font-mono text-xs text-cinnabar">{nativeState.desktop ? '已启用' : '未启用'}</span></button>
      </section>
    </div>}

    {panel === 'tabs' && <div className="absolute inset-0 z-30 flex flex-col bg-ink" style={{paddingTop:'var(--sat)',paddingBottom:'var(--sab)'}}>
      <header className="flex items-center justify-between border-b border-haze bg-ink-raised p-3"><Button label="返回浏览器" onClick={() => setPanel(null)}><ChevronLeft size={22}/></Button><h2 className="font-display text-lg text-paper">网页标签 · {tabs.length}</h2><Button label="关闭" onClick={() => setPanel(null)}><X size={20}/></Button></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4"><div className="grid grid-cols-2 gap-3">{tabs.map(tab => <div key={tab.index} className={`flex h-32 flex-col justify-between rounded-2xl border p-3 ${tab.active ? 'border-cinnabar bg-cinnabar/10' : 'border-haze bg-ink-raised'}`}>
        <div className="flex items-start justify-between gap-2"><Globe2 size={18} className={tab.active?'text-cinnabar':'text-paper-faint'}/><button type="button" aria-label={`关闭标签 ${tab.title}`} onClick={() => {void nativeBrowser.removeTab({index:tab.index}).then(() => {updateNativeState();if(tabs.length<=1)goHome()}).catch(err => setError(String(err)))}} className="text-paper-faint"><X size={16}/></button></div>
        <button type="button" className="min-w-0 text-left" onClick={() => {void nativeBrowser.activateTab({index:tab.index}).then(() => {updateNativeState();setPanel(null)}).catch(err => setError(String(err)))}}><span className="block truncate text-[13px] font-medium text-paper">{tab.title || titleOf(tab.url)}</span><span className="mt-1 block truncate font-mono text-xs text-paper-faint">{tab.url}</span></button>
      </div>)}</div></div>
      <button type="button" disabled={tabs.length>=6} onClick={() => {setPanel(null);action('new')}} className="mx-5 mb-4 flex items-center justify-center gap-2 rounded-xl bg-cinnabar py-3 text-sm font-semibold text-white disabled:opacity-35"><Plus size={18}/>新建标签页</button>
    </div>}

    {(panel === 'history' || panel === 'bookmarks') && <div className="absolute inset-0 z-30 flex flex-col bg-ink" style={{paddingTop:'var(--sat)',paddingBottom:'var(--sab)'}}>
      <header className="flex items-center justify-between border-b border-haze bg-ink-raised p-3"><Button label="返回浏览器" onClick={() => setPanel(null)}><ChevronLeft size={22}/></Button><h2 className="font-display text-lg text-paper">{panel === 'history' ? '浏览历史' : '书签'}</h2><Button label="关闭" onClick={() => setPanel(null)}><X size={20}/></Button></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{(panel === 'history' ? history : marks).map(item => <div key={item.url} className="flex items-center gap-3 border-b border-haze/55 py-3">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => void openAddress(item.url)}><span className="block truncate text-sm text-paper">{item.title}</span><span className="mt-1 block truncate font-mono text-[12px] text-paper-faint">{item.url}</span></button>
        <button type="button" aria-label="删除" onClick={() => {if(panel==='history'){const next=history.filter(x=>x.url!==item.url);setHistory(next);localStorage.setItem(HISTORY_KEY,JSON.stringify(next))}else{const next=marks.filter(x=>x.url!==item.url);setMarks(next);localStorage.setItem(MARKS_KEY,JSON.stringify(next))}}}><Trash2 size={16} className="text-paper-faint" /></button>
      </div>)}{(panel==='history'?history:marks).length===0 && <p className="pt-12 text-center text-sm text-paper-faint">暂无记录</p>}</div>
      {panel === 'history' && history.length>0 && <button type="button" onClick={() => {if(window.confirm('清空全部浏览历史？')) clearHistory()}} className="mx-5 mb-5 rounded-xl border border-haze py-3 text-sm text-paper-muted">清除全部历史</button>}
    </div>}

    {panel === 'settings' && <div className="absolute inset-0 z-30 flex flex-col bg-ink" style={{paddingTop:'var(--sat)',paddingBottom:'var(--sab)'}}>
      <header className="flex items-center justify-between border-b border-haze bg-ink-raised p-3"><Button label="返回浏览器" onClick={() => setPanel(null)}><ChevronLeft size={22}/></Button><h2 className="font-display text-lg text-paper">浏览器设置</h2><Button label="关闭" onClick={() => setPanel(null)}><X size={20}/></Button></header>
      <div className="flex-1 overflow-y-auto px-6 py-6"><div className="font-mono text-[10px] tracking-[0.15em] text-cinnabar">SEARCH ENGINE</div><h3 className="mt-1 text-base text-paper">默认搜索引擎</h3><div className="mt-4 grid grid-cols-2 gap-2">{(Object.entries(engines) as [SearchChoice,{name:string,url:string}][]).map(([id,engine])=><button type="button" key={id} onClick={()=>{setSearch(id);localStorage.setItem(SEARCH_KEY,id)}} className={`rounded-xl border px-4 py-3 text-left text-sm ${search===id?'border-cinnabar bg-cinnabar/10 text-paper':'border-haze bg-ink-raised text-paper-muted'}`}>{engine.name}</button>)}</div>
        <div className="mt-8 border-t border-haze pt-6"><div className="font-mono text-[10px] tracking-[0.15em] text-cinnabar">DISPLAY</div><button type="button" disabled={!active} onClick={() => {setPanel(null);action('desktop')}} className="mt-3 flex w-full items-center justify-between rounded-xl border border-haze bg-ink-raised px-4 py-3 text-sm text-paper disabled:opacity-40"><span>桌面版网页</span><span className="text-cinnabar">{nativeState.desktop ? '开启' : '关闭'}</span></button></div>
        <div className="mt-8 border-t border-haze pt-6"><p className="text-sm font-semibold text-paper">隐私与数据</p><p className="mt-2 text-xs leading-relaxed text-paper-faint">网页访问历史仅保留在本设备，与 NewsNook 的文章阅读记录分开存储。</p><button type="button" onClick={() => {if(window.confirm('清除浏览历史？')) clearHistory()}} className="mt-4 rounded-xl border border-haze px-4 py-3 text-sm text-paper-muted">清除浏览历史</button></div>
      </div>
    </div>}
    {panel === 'scripts' && <ScriptManager onClose={() => setPanel(null)} onChanged={() => setScriptCount(loadUserScripts().filter(s => s.enabled).length)} />}
  </div>
}
