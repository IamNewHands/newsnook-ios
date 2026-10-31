import assert from 'node:assert/strict'
import React, {act} from 'react'
import {parseHTML} from 'linkedom'
import {HUD_LINGER_MS} from '../src/components/inkVideoPlayer/playback'

/** A deferred native bridge completion must never replace an active pinch's HUD. */
const {window}=parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis,{
  window,document:window.document,Node:window.Node,Element:window.Element,HTMLElement:window.HTMLElement,
  MutationObserver:window.MutationObserver,React,IS_REACT_ACT_ENVIRONMENT:true,
  ResizeObserver:class{observe(){}disconnect(){}},
  requestAnimationFrame:(cb:FrameRequestCallback)=>setTimeout(()=>cb(performance.now()),0),
  cancelAnimationFrame:clearTimeout,
})
Object.assign(window,{innerWidth:400,innerHeight:800})
window.getComputedStyle=(()=>({overflow:'visible',overflowY:'visible',getPropertyValue:()=> '0px'})) as typeof getComputedStyle
const baseCreate=document.createElement.bind(document)
document.createElement=((tag:string,opts?:ElementCreationOptions)=>{
  const element=baseCreate(tag,opts)
  if(tag==='video') Object.assign(element,{
    currentTime:20,duration:90,paused:true,readyState:1,videoWidth:1280,videoHeight:720,
    buffered:{length:0},volume:1,muted:false,playbackRate:1,defaultPlaybackRate:1,
    canPlayType:()=>'',
    load(){this.paused=true},
    async play(){this.paused=false;this.dispatchEvent(new window.Event('play'))},
    pause(){this.paused=true;this.dispatchEvent(new window.Event('pause'))},
  })
  return element
}) as typeof document.createElement
const {Capacitor,registerPlugin}=await import('@capacitor/core')
Object.assign(Capacitor,{
  isNativePlatform:()=>true,
  getPlatform:()=> 'android',
  isPluginAvailable:(name:string)=>name==='DeviceMediaControls' || name==='MediaSniffer' || name==='App',
})
let resolveBrightness:((value:{value:number})=>void)|null=null
let requestedBrightness:number|null=null
const nativeControls={
  async getBrightness(){return {value:1}},
  async setBrightness({value}:{value:number}){requestedBrightness=value;return await new Promise<{value:number}>(resolve=>{resolveBrightness=resolve})},
  async clearBrightness(){},async getVolume(){return {value:1}},
  async setVolume({value}:{value:number}){return {value}},
  async setVideoFullscreen(){},async lockOrientation(){},async unlockOrientation(){},
  async getBattery(){return {level:.72,charging:false}},
}
registerPlugin('DeviceMediaControls',{web:()=>nativeControls,android:()=>nativeControls})
registerPlugin('MediaSniffer',{web:()=>({
  async preparePlayback(){},async releasePlayback(){},
  async setLiveSurfaceSuppressed(){},async refreshPlaybackOrigins(){},
}),android:()=>({async preparePlayback(){},async releasePlayback(){},async setLiveSurfaceSuppressed(){}})})
registerPlugin('App',{web:()=>({async addListener(){return{async remove(){}}}}),android:()=>({async addListener(){return{async remove(){}}}})})
const {createRoot}=await import('react-dom/client')
const {InkVideoPlayer}=await import('../src/components/InkVideoPlayer')
const root=createRoot(document.getElementById('root')!)
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
try {
  await act(async()=>root.render(<InkVideoPlayer src="https://example.com/native.mp4" title="原生异步回归" mediaPageHost={false}/>))
  const video=document.querySelector('video')!
  await act(async()=>video.dispatchEvent(new window.Event('canplay')))
  await act(async()=>document.querySelector<HTMLButtonElement>('button[aria-label="全屏"]')!.click())
  assert.equal(document.querySelector('[data-video-fullscreen]')?.getAttribute('data-video-fullscreen'),'true')
  await act(async()=>video.play())
  const surface=document.querySelector<HTMLElement>('[data-video-gesture-surface]')!
  const captured=new Set<number>()
  Object.assign(surface,{
    getBoundingClientRect(){return {left:0,top:0,width:400,height:800,right:400,bottom:800,x:0,y:0}},
    setPointerCapture(id:number){captured.add(id)},
    hasPointerCapture(id:number){return captured.has(id)},
    releasePointerCapture(id:number){captured.delete(id)},
  })
  const pointer=async(type:string,id:number,x:number,y:number)=>{
    const event=new window.Event(type,{bubbles:true,cancelable:true})
    Object.assign(event,{pointerId:id,clientX:x,clientY:y,pointerType:'touch',button:0,buttons:1,isPrimary:id===1})
    await act(async()=>{surface.dispatchEvent(event);await Promise.resolve()})
  }
  const hud=()=>document.querySelector('[data-ink-hud]')?.getAttribute('data-ink-hud')||''
  await pointer('pointerdown',1,85,210)
  await pointer('pointermove',1,86,310)
  assert.equal(requestedBrightness !== null,true,'native brightness write must start on first downward gesture')
  assert.ok(resolveBrightness,'a native write is still in flight')
  await pointer('pointerdown',2,280,310)
  await pointer('pointermove',2,340,310)
  assert.equal(hud(),'center','the pinch replaces the level HUD')
  await act(async()=>{resolveBrightness!({value:requestedBrightness!});await Promise.resolve()})
  assert.equal(hud(),'center','late native completion cannot overwrite the zoom HUD')
  await pointer('pointerup',1,86,310)
  await pointer('pointerup',2,340,310)
  await act(async()=>sleep(HUD_LINGER_MS+90))
  assert.equal(hud(),'','post-pinch HUD fades even after a late native write')
  console.log('ink-player-native-gesture-regression: pending bridge write cannot resurrect brightness HUD after pinch')
}finally{await act(async()=>root.unmount())}
