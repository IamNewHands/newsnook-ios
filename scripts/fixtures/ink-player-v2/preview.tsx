import React, { useContext, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../src/index.css'
import { InkVideoPlayer } from '../../../src/components/InkVideoPlayer'
import { FloatingVideoProvider } from '../../../src/features/floatingVideo/FloatingVideoProvider'
import { VideoSessionManagerContext } from '../../../src/features/floatingVideo/context'
import type { MediaResourceDescriptor } from '../../../src/features/mediaSniffer/types'

const url = new URL('/scripts/fixtures/ink-player-v2/scenery.mp4', location.origin).href
const resource: MediaResourceDescriptor = {
  id: 'visual-source', type: 'progressive', url, pageUrl:location.href, score:100,
  videoTracks:[{kind:'video',width:640,height:360}], audioTracks:[], subtitles:[], drm:false, drmKeySystems:[],
}
const other: MediaResourceDescriptor = { ...resource, id:'alternate', score:90, url: url+'?variant=2',
  videoTracks:[{kind:'video',width:480,height:270}] }

function Scene() {
  const mgr = useContext(VideoSessionManagerContext)
  const scene = new URLSearchParams(location.search).get('scene') ?? 'inline'
  const [tab,setTab] = useState('阅读')
  useEffect(() => {
    if (!mgr) return
    const timer = setInterval(() => {
      const session = mgr.getSnapshot()[0]
      if (!session) return
      if (scene === 'floating') mgr.float(session.id)
      if (scene === 'page') mgr.openPage(session.id)
      clearInterval(timer)
    }, 100)
    return () => clearInterval(timer)
  }, [mgr,scene])
  return <div style={{minHeight:'100vh',background:'#f5f5f2',color:'#282b30',padding:'0 0 80px',fontFamily:'system-ui,sans-serif'}}>
    <header style={{height:57,background:'#fff',borderBottom:'1px solid #e7e5e0',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 20px'}}>
       <strong style={{fontFamily:'serif',fontSize:21}}>有所闻</strong><nav style={{display:'flex',gap:15}}><button onClick={()=>setTab('阅读')}>阅读</button><button onClick={()=>setTab('发现')}>发现</button></nav>
    </header>
    <article style={{width:'min(750px,calc(100% - 32px))',margin:'40px auto 0'}}>
      <div style={{fontSize:11,color:'#8d8074',marginBottom:12}}>影像 · 发现</div>
      <h1 style={{fontFamily:'serif',fontSize:'clamp(24px,4vw,37px)',fontWeight:560,margin:'0 0 17px'}}>走进山海之间，寻找清晨的第一束光</h1>
      <p style={{fontSize:13,color:'#8c8e91',marginBottom:25}}>影像精选 · 2026.10.25</p>
      <p style={{fontSize:15,lineHeight:1.8,marginBottom:20}}>山谷在日出前醒来。云层缓慢移开，远处的峰峦渐渐显出轮廓，水面仍旧安静。</p>
      <InkVideoPlayer
        src={url} poster={'/scripts/fixtures/ink-player-v2/poster.jpg'} title="走进山海之间 · 清晨的光线" resources={[resource,other]} mediaPageHost={false}
      />
      <p style={{fontSize:15,lineHeight:1.8,marginTop:28}}>画面之上的工具应该足够安静。当你不需要控制时，注意力属于视频。</p>
    </article>
  </div>
}
function App(){return <FloatingVideoProvider><Scene /></FloatingVideoProvider>}
createRoot(document.getElementById('root')!).render(<App />)
