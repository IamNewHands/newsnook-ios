import {Haptics, ImpactStyle} from '@capacitor/haptics'
import {useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject} from 'react'

/** The sheet covers the browser chrome, not the Android status bar. */
export function agentSheetLimits(visibleHeight:number,topInset:number){
  const max=Math.max(180,Math.floor(visibleHeight-Math.max(0,topInset)))
  const min=Math.min(max,Math.max(220,Math.min(300,Math.round(max*.38))))
  const half=Math.min(max,Math.max(min,Math.round(max*.56)))
  return {min,half,max}
}
export function agentKeyboardOffset(parentBottom:number,visibleBottom:number){
  return Math.max(0,Math.round(parentBottom-visibleBottom))
}
export function constrainAgentSheet(value:number,limits:ReturnType<typeof agentSheetLimits>){
  return Math.min(limits.max,Math.max(limits.min,Math.round(value)))
}
export function settleAgentSheet(value:number,limits:ReturnType<typeof agentSheetLimits>){
  const clamped=constrainAgentSheet(value,limits)
  const points=[limits.min,limits.half,limits.max]
  const closest=points.reduce((best,point)=>Math.abs(point-clamped)<Math.abs(best-clamped)?point:best,points[0])
  // No mandatory detents: short, deliberate drags must preserve their exact size.
  return Math.abs(closest-clamped)<=22?closest:clamped
}

export function useAgentSheet(sheetRef:RefObject<HTMLElement|null>){
  const [height,setHeight]=useState(()=>typeof window==='undefined'?450:Math.round(window.innerHeight*.54))
  const [dragging,setDragging]=useState(false)
  const committed=useRef(height)
  const preferred=useRef(height)
  const fullscreenPreferred=useRef(false)
  const gesture=useRef<{pointerId:number;startY:number;startHeight:number;current:number;fullscreenNotified:boolean}|null>(null)
  const frame=useRef<number|null>(null)
  const pending=useRef<number|null>(null)
  const limits=useCallback(()=>{
    const sheet=sheetRef.current
    const parent=sheet?.parentElement
    const top=parent?parseFloat(getComputedStyle(parent).paddingTop)||0:0
    return agentSheetLimits(window.visualViewport?.height||window.innerHeight,top)
  },[sheetRef])
  const currentHeight=useCallback(()=>{
    const measured=sheetRef.current?.getBoundingClientRect().height||0
    return measured>0?measured:committed.current
  },[sheetRef])
  const writeHeight=useCallback((value:number)=>{
    const next=constrainAgentSheet(value,limits())
    pending.current=next
    if(frame.current!==null)return
    frame.current=requestAnimationFrame(()=>{
      frame.current=null
      if(pending.current!==null&&sheetRef.current)sheetRef.current.style.height=pending.current+'px'
    })
  },[limits,sheetRef])
  const snapTo=useCallback((value:number,resize=false)=>{
    if(frame.current!==null){cancelAnimationFrame(frame.current);frame.current=null}
    pending.current=null
    const range=limits()
    if(!resize){
      preferred.current=value
      fullscreenPreferred.current=value>=range.max-16
    }
    const target=resize?(fullscreenPreferred.current?range.max:preferred.current):value
    const next=constrainAgentSheet(target,range)
    committed.current=next
    if(sheetRef.current)sheetRef.current.style.height=next+'px'
    setHeight(next)
  },[limits,sheetRef])
  useEffect(()=>{
    const onResize=()=>{
      const view=window.visualViewport
      const parentBottom=sheetRef.current?.parentElement?.getBoundingClientRect().bottom??window.innerHeight
      const visibleBottom=(view?.offsetTop||0)+(view?.height||window.innerHeight)
      if(sheetRef.current)sheetRef.current.style.bottom=agentKeyboardOffset(parentBottom,visibleBottom)+'px'
      snapTo(preferred.current,true)
    }
    onResize()
    window.addEventListener('resize',onResize)
    window.visualViewport?.addEventListener('resize',onResize)
    return ()=>{
      window.removeEventListener('resize',onResize)
      window.visualViewport?.removeEventListener('resize',onResize)
      if(frame.current!==null)cancelAnimationFrame(frame.current)
    }
  },[snapTo,sheetRef])
  const onPointerDown=(event:PointerEvent<HTMLElement>)=>{
    if(event.button!==0||gesture.current)return
    event.preventDefault()
    const startHeight=currentHeight()
    gesture.current={pointerId:event.pointerId,startY:event.clientY,startHeight,current:startHeight,fullscreenNotified:false}
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  const onPointerMove=(event:PointerEvent<HTMLElement>)=>{
    const active=gesture.current
    if(!active||active.pointerId!==event.pointerId)return
    const next=constrainAgentSheet(active.startHeight+active.startY-event.clientY,limits())
    active.current=next
    if(!active.fullscreenNotified&&next>=limits().max-12){
      active.fullscreenNotified=true
      void Haptics.impact({style:ImpactStyle.Light}).catch(()=>undefined)
    }
    if(next<limits().max-48)active.fullscreenNotified=false
    writeHeight(next)
  }
  const onPointerEnd=(event:PointerEvent<HTMLElement>)=>{
    const active=gesture.current
    if(!active||active.pointerId!==event.pointerId)return
    const settled=settleAgentSheet(active.current,limits())
    gesture.current=null
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
    snapTo(settled)
  }
  const expand=()=>snapTo(isFull?limits().half:limits().max)
  const isFull=height>=limits().max-16
  return {height,dragging,isFull,expand,snapTo,limits,onPointerDown,onPointerMove,onPointerEnd}
}
