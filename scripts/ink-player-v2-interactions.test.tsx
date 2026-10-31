import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import type { MediaResourceDescriptor } from '../src/features/mediaSniffer/types'

const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window, document:window.document, Node:window.Node, Element:window.Element,
  HTMLElement:window.HTMLElement, MutationObserver:window.MutationObserver, React,
  IS_REACT_ACT_ENVIRONMENT:true, ResizeObserver:class {observe(){} disconnect(){}},
})
window.getComputedStyle = (()=>({overflow:'visible',overflowY:'visible',getPropertyValue:()=>'0px'})) as typeof getComputedStyle
const createElement = document.createElement.bind(document)
document.createElement = ((name:string,options?:ElementCreationOptions)=>{
  const element=createElement(name,options)
  if(name==='video')Object.assign(element,{
    currentTime:20,duration:90,paused:true,muted:false,readyState:1,videoWidth:1280,videoHeight:720,
    buffered:{length:0},playbackRate:1,defaultPlaybackRate:1,canPlayType:()=>'',load(){this.paused=true},
    async play(){this.paused=false;this.dispatchEvent(new window.Event('play'))},
    pause(){this.paused=true;this.dispatchEvent(new window.Event('pause'))},
  })
  return element
}) as typeof document.createElement
const {createRoot} = await import('react-dom/client')
const {InkVideoPlayer} = await import('../src/components/InkVideoPlayer')
const src='https://example.com/one.mp4'
const sources:MediaResourceDescriptor[] = [src,'https://example.com/two.mp4'].map((url,i)=>({
  id:String(i+1),url,type:'progressive',pageUrl:'https://example.com/article',score:100-i,
  videoTracks:[{kind:'video',width:1280-i*320,height:720-i*180}],audioTracks:[],subtitles:[],drm:false,drmKeySystems:[],
}))
const root=createRoot(document.getElementById('root')!)
const click=async(label:string)=>{
  const button=document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  assert.ok(button,'missing '+label)
  await act(async()=>{button.click();await Promise.resolve()})
}
const next=async()=>{await act(async()=>{await Promise.resolve()})}
try {
  await act(async()=>root.render(<InkVideoPlayer src={src} title="正在观看" resources={sources} mediaPageHost={false} />))
  let video=document.querySelector('video')!
  assert.ok(video,'video exists')
  await act(async()=>video.dispatchEvent(new window.Event('canplay')))
  assert.ok(document.querySelector('[data-video-condensed]'),'player reacts to measured viewport')
  await click('静音')
  assert.equal(video.muted,true)
  await click('取消静音')
  assert.equal(video.muted,false)
  await click('全屏')
  assert.ok(document.querySelector('[data-video-fullscreen="true"]'),'fullscreen entered')
  assert.ok(document.querySelector('button[aria-label="媒体资源"]'),'fullscreen resources remain accessible')
  await click('媒体资源')
  assert.ok(document.querySelector('[data-ink-player-source-sheet]'),'fullscreen source selector is inside stage')
  assert.ok(document.querySelector('button[aria-label="关闭媒体资源"]'),'source selector has an explicit close')
  const rows=[...document.querySelectorAll<HTMLButtonElement>('.ink-player-source-row')]
  assert.equal(rows.length,2)
  assert.equal(rows[0].getAttribute('aria-current'),'true')
  await act(async()=>rows[1].click())
  await next()
  video=document.querySelector('video')!
  assert.ok(video,'selected media still renders a video')
  await act(async()=>video.dispatchEvent(new window.Event('canplay')))
  assert.equal(document.querySelectorAll('video').length,1)
  assert.equal(document.querySelector('[data-ink-player-source-sheet]'),null)
  await click('屏幕方向')
  assert.equal(document.querySelectorAll('.ink-player-rotation-menu [role="menuitemradio"]').length,3)
  const options=document.querySelectorAll<HTMLButtonElement>('.ink-player-rotation-menu [role="menuitemradio"]')
  await act(async()=>{options[2].click();await Promise.resolve()})
  assert.equal(document.querySelector('.ink-player-rotation-menu'),null)
  assert.ok(document.querySelector('[data-video-fullscreen="true"]'),'orientation selection must not close fullscreen')
  await click('退出全屏')
  assert.equal(document.querySelector('[data-video-fullscreen="true"]'),null)
}finally{await act(async()=>root.unmount())}
console.log('ink-player-v2-interactions: ok')
