import { useState } from 'react'
import { ArrowRight, Bookmark, Check, ChevronRight, Clock3, MoreHorizontal, Plus, Search, ShieldCheck } from 'lucide-react'
import type { BrowserShortcut, BrowserVisit } from './browserHistory'
import { browserHostLabel } from './browserPreferences'
import { BrowserIconButton, BrowserSiteIcon } from './BrowserPrimitives'

export function BrowserStartPage({shortcuts, recent, onSearch, onOpen, onAddShortcut, onShortcutOptions, onHistoryOptions, onPanel}: {
  shortcuts: BrowserShortcut[]; recent: BrowserVisit[]
  onSearch: () => void; onOpen: (url: string) => void; onAddShortcut: () => void
  onShortcutOptions: (index: number) => void; onHistoryOptions: (visit: BrowserVisit) => void
  onPanel: (panel: 'history' | 'bookmarks' | 'scripts') => void
}) {
  const [managing, setManaging] = useState(false)
  return <div className="browser-start mx-auto h-full w-full max-w-2xl overflow-y-auto overscroll-contain px-5 pt-7 pb-6">
    <div className="flex items-center gap-3 px-1">
      <img src="/favicon.svg" alt="" className="size-10 object-contain"/>
      <span className="text-[21px] font-semibold tracking-tight text-paper">浏览器</span>
    </div>
    <button type="button" aria-label="首页搜索或输入网址" onClick={onSearch}
      className="mt-6 flex min-h-16 w-full items-center gap-3 rounded-2xl border border-haze bg-ink-raised px-4 text-left text-[15px] text-paper-muted transition-colors active:bg-haze">
      <Search size={21}/><span className="min-w-0 flex-1">搜索或输入网址</span><ArrowRight size={20}/>
    </button>
    <div className="mt-3 grid grid-cols-3 gap-2">
      {([{label:'书签',panel:'bookmarks',icon:Bookmark},{label:'历史',panel:'history',icon:Clock3},{label:'用户脚本',panel:'scripts',icon:ShieldCheck}] as const).map(item =>
        <button key={item.panel} type="button" onClick={() => onPanel(item.panel)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl text-[14px] text-paper-muted transition-colors active:bg-haze">
          <item.icon size={18} strokeWidth={1.8}/>{item.label}
        </button>)}
    </div>
    <div className="mt-4 flex items-center justify-between">
      <h2 className="text-[14px] font-semibold text-paper">快捷访问</h2>
      <button type="button" onClick={() => setManaging(!managing)} className="min-h-11 px-2 text-[13px] text-paper-muted">
        {managing ? '完成' : '管理'}
      </button>
    </div>
    <div className="grid grid-cols-4 gap-x-2 gap-y-3 pt-1">
      {shortcuts.map((shortcut, index) => <button key={shortcut.url} type="button"
        onContextMenu={event => {event.preventDefault(); onShortcutOptions(index)}}
        onClick={() => managing ? onShortcutOptions(index) : onOpen(shortcut.url)}
        className="relative flex min-w-0 flex-col items-center gap-2 rounded-xl py-2 text-center transition-colors active:bg-haze">
        <BrowserSiteIcon url={shortcut.url} name={shortcut.name}/>
        {managing && <span className="absolute top-0 right-1 flex size-5 items-center justify-center rounded-full border border-haze bg-ink-raised text-paper"><MoreHorizontal size={13}/></span>}
        <span className="w-full truncate text-[13px] font-medium text-paper">{shortcut.name}</span>
      </button>)}
      {shortcuts.length < 8 && <button type="button" aria-label="添加快捷方式" onClick={onAddShortcut}
        className="flex min-w-0 flex-col items-center gap-2 rounded-xl py-2 text-center text-paper-muted active:bg-haze">
        <span className="flex size-12 items-center justify-center rounded-xl border border-dashed border-paper-faint/40"><Plus size={22}/></span>
        <span className="text-[13px]">添加</span>
      </button>}
    </div>
    <div className="mt-6 flex items-center justify-between">
      <h2 className="text-[14px] font-semibold text-paper">最近访问</h2>
      <button type="button" onClick={() => onPanel('history')} className="flex min-h-11 items-center gap-1 text-[13px] text-paper-muted">全部<ChevronRight size={15}/></button>
    </div>
    {recent.length ? <ul className="divide-y divide-haze/70">
      {recent.map(item => <li key={item.url} className="flex items-center gap-2">
        <button type="button" onClick={() => onOpen(item.url)} onContextMenu={event => {event.preventDefault(); onHistoryOptions(item)}}
          className="flex min-h-[72px] min-w-0 flex-1 items-center gap-3 py-3 text-left">
          <BrowserSiteIcon url={item.url} name={item.title} size="small"/>
          <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium text-paper">{item.title}</span><span className="mt-1 block truncate text-[12px] text-paper-muted">{browserHostLabel(item.url)}</span></span>
        </button>
        <BrowserIconButton label={'管理历史 ' + browserHostLabel(item.url)} onClick={() => onHistoryOptions(item)}><MoreHorizontal size={18}/></BrowserIconButton>
      </li>)}
    </ul> : <p className="py-5 text-[14px] text-paper-muted">暂无浏览记录</p>}
    {managing && <p role="status" className="mt-3 flex items-center gap-1.5 text-[13px] text-paper-muted"><Check size={15}/>点按快捷方式进行编辑或排序</p>}
  </div>
}
