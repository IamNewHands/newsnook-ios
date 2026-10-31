import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BotMessageSquare, Film, Home, LogOut, MoreHorizontal, Play, RefreshCw, X } from 'lucide-react'
import '../../../src/index.css'
import '../../../src/features/browser/browser.css'
import { BrowserAddressBar, BrowserMediaStrip } from '../../../src/features/browser/BrowserAddressBar'
import { BrowserIconButton, BrowserSheet } from '../../../src/features/browser/BrowserPrimitives'

const params = new URLSearchParams(location.search)
const initial = Number(params.get('count') ?? '2')
const top = params.get('position') === 'top'
const current='https://cilixiong.com/movies/pegasus-2'
export function Preview() {
  const [count, setCount] = useState(Number.isFinite(initial) ? initial : 0)
  const [panel, setPanel] = useState(false)
  const [address, setAddress] = useState(false)
  const [privateMode, setPrivateMode] = useState(params.get('private') === '1')
  const [tabId] = useState(7)
  const toolbar = <nav aria-label="浏览器控制" className="browser-toolbar relative z-10 shrink-0 border-y border-haze bg-ink-raised">
    {!top && <BrowserMediaStrip count={count} open={panel} onOpen={()=>setPanel(true)}/>}
    <div className="browser-toolbar-row flex h-14 items-center gap-0.5 px-1.5">
      <BrowserIconButton label="返回有所闻" onClick={()=>{}}><LogOut size={20} strokeWidth={1.8}/></BrowserIconButton>
      <BrowserIconButton label="主页" className="browser-toolbar-compact-optional" onClick={()=>{}}><Home size={20} strokeWidth={1.8}/></BrowserIconButton>
      <BrowserAddressBar active current={current} privateMode={privateMode} mediaCount={count}
        mediaTabId={tabId} mediaPage={current} mediaPanelOpen={panel}
        onOpenSite={()=>{}} onSearch={()=>setAddress(true)} onOpenMedia={()=>setPanel(true)}/>
      <BrowserIconButton label="刷新" onClick={()=>{}}><RefreshCw size={19}/></BrowserIconButton>
      <BrowserIconButton label="标签页" onClick={()=>{}}><span className="flex size-[18px] items-center justify-center rounded-[4px] border-[1.5px] border-current text-[10.5px] font-bold">1</span></BrowserIconButton>
      <BrowserIconButton label="AI 浏览助手" className="browser-toolbar-compact-optional" onClick={()=>{}}><BotMessageSquare size={22} strokeWidth={1.9} aria-hidden="true"/></BrowserIconButton>
      <BrowserIconButton label="网页工具" onClick={()=>{}}><MoreHorizontal size={20}/></BrowserIconButton>
    </div>
    {top && <BrowserMediaStrip count={count} open={panel} onOpen={()=>setPanel(true)}/>}
  </nav>
  return <div data-theme={params.get('theme') === 'light' ? 'light' : 'dark'} className="browser-workspace fixed inset-0 z-[95] flex min-w-0 flex-col overflow-hidden bg-ink text-paper">
    {!top && <div style={{height:15,background:'var(--color-ink)'}}/>}
    {top && toolbar}
    <div data-browser-viewport className="relative min-h-0 flex-1 overflow-hidden" style={{background:'#222428'}}>
      <div style={{height:268,padding:'22px 24px',fontSize:16,lineHeight:1.8,background:'#202329',textAlign:'left',color:'#c0c2cd'}}>屈巴音布鲁克。老头乐的员工厉小海，正在一场崭新的赛车旅程中寻找自己的方向。</div>
      <div style={{position:'relative',height:245,background:'#22252a'}}>
        <div style={{position:'absolute',left:0,right:0,top:10,bottom:40,background:'linear-gradient(150deg,#777c85,#343640 50%,#1a1c20)'}}>
          <span style={{position:'absolute',top:'40%',left:'45%',fontSize:38}}>▶</span>
        </div>
        <div style={{position:'absolute',bottom:8,left:16,right:16,height:3,background:'#72767c'}}/>
      </div>
      <div style={{padding:'26px 24px',color:'#cbd0d3'}}>飞驰人生2 · 电影资源与在线播放</div>
    </div>
    {!top && toolbar}
    <div style={{height:20,background:'#f4f4f2'}}/>
    <div style={{position:'absolute',top:45,left:12,display:'flex',gap:5,zIndex:30,opacity:.01}}>
      <button aria-label="增加视频" onClick={()=>setCount(n=>n+1)}>+</button>
      <button aria-label="清空视频" onClick={()=>setCount(0)}>-</button>
      <button aria-label="切换隐私" onClick={()=>setPrivateMode(m=>!m)}>P</button>
    </div>
    {panel && <BrowserSheet title="媒体资源" onClose={()=>setPanel(false)}>
      <div className="mb-3 flex items-center justify-between text-[13px] text-paper-muted"><span>发现 {count} 个资源</span><span>重新扫描</span></div>
      {Array.from({length:Math.min(count,3)}).map((_,i)=><div key={i} className="flex min-h-[74px] items-center gap-3 border-b border-haze py-3"><Film size={20}/><div className="min-w-0 flex-1 text-[14px]">视频文件 · {1080-i*360}p</div><button type="button" aria-label={'播放 视频文件 · ' + (1080-i*360) + 'p'} onClick={()=>setPanel(false)} className="browser-media-play" title="播放"><Play size={20} strokeWidth={1.9} aria-hidden="true"/></button></div>)}
    </BrowserSheet>}
    {address && <div role="dialog" aria-label="搜索与地址" style={{position:'absolute',inset:0,background:'rgba(0,0,0,.6)',display:'grid',placeItems:'center'}}><button onClick={()=>setAddress(false)}><X/>搜索与地址</button></div>}
  </div>
}
createRoot(document.getElementById('root')!).render(<Preview/>)
