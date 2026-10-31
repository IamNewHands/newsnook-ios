import {useEffect,useLayoutEffect,useRef,useState,type RefObject,type KeyboardEvent} from 'react'
import {
  AlertCircle, ArrowUp, Bot, Check, CheckCheck, ChevronDown, ChevronRight, CircleCheck, CircleHelp,
  CircleMinus, Copy, Eye, EyeOff, FileText, Hand, LoaderCircle, Maximize2, Minimize2,
  Pause, Play, Settings2, Square, X,
} from 'lucide-react'
import {AgentMarkdown} from './AgentMarkdown'
import {useAgentSheet} from './agentSheet'
import {
  loadAgentConfig,runReActAgent,saveAgentConfig,
  type AgentConfig,type AgentTab,type AgentToolName,
} from './browserAgent'
import {
  createBrowserAgentRuntime,type BrowserAgentRuntime,type AgentStep,type AgentHandoff,
  type AgentApproval,type AgentArtifact,type AgentPhase,
} from './agentRuntime'

interface Props {
  tabId?:number
  loading?:boolean
  progress?:number
  tabs:AgentTab[]
  sheetRef:RefObject<HTMLElement|null>
  minimized:boolean
  onMinimize:()=>void
  onNeedAttention:()=>void
  onBusyChange:(busy:boolean)=>void
  onOperatingChange?:(operating:boolean)=>void
  onBrowserConfig:(request:Record<string,unknown>,signal:AbortSignal,approve:(reason:string)=>Promise<boolean>)=>Promise<unknown>
  onSearch:(query:string)=>Promise<boolean>
  searchUrl:(query:string)=>string
  onNavigate:(url:string)=>Promise<boolean>
  onBack:()=>Promise<boolean>
  onForward:()=>Promise<boolean>
  onNewTab:(url:string)=>Promise<boolean>
  onSwitchTab:(index:number)=>Promise<boolean>
  onCloseTab:(index:number)=>Promise<boolean>
  onClose:()=>void
}
interface AgentTurn {id:string;goal:string;status:'completed'|'failed'|'stopped';answer?:string;detail?:string;steps:AgentStep[];artifacts:AgentArtifact[]}
type RunOutcome='running'|'completed'|'failed'|'stopped'

const LABELS:Partial<Record<AgentToolName,string>>={
  browser_config:'正在管理浏览器配置',browser_search:'正在搜索网页',browser_open_url:'正在打开网址',browser_observe:'正在阅读网页',
  browser_click:'正在点击网页',browser_type:'正在输入文字',browser_choose:'正在选择选项',
  browser_submit:'正在提交表单',browser_scroll:'正在滚动阅读',browser_back:'正在返回',
  browser_forward:'正在前进',browser_tabs:'正在查看标签页',browser_new_tab:'正在打开新标签',
  browser_switch_tab:'正在切换标签页',browser_close_tab:'正在关闭标签页',
  browser_screenshot:'正在观察网页画面',browser_tap:'正在操作网页画面',
}
const STEP_STATUS={running:'进行中',succeeded:'已完成',failed:'失败',cancelled:'已取消'} as const
const HANDOFF_TITLES={login:'请先完成登录',captcha:'请完成网页验证',file_picker:'请选择文件',manual:'由你操作网页'} as const
const FILE_STATUS:Record<string,string>={
  pending:'等待处理',queued:'等待下载',downloading:'下载中',running:'正在处理',
  downloaded:'下载完成',completed:'已完成',complete:'已完成',succeeded:'已完成',ready:'可用',
  selected:'已选择',uploaded:'已交给网页',processing:'正在处理',failed:'处理失败',
  paused:'下载已暂停',interrupted:'下载已中断',cancelled:'已取消',canceled:'已取消',expired:'文件已失效',unavailable:'文件不可用',
}
function phaseLabel(phase:AgentPhase,finishing=false){
  switch(phase){
    case 'running':return '执行中'
    case 'pausing':return '正在暂停'
    case 'paused':return '已暂停'
    case 'handoff':return '等待你操作'
    case 'resuming':return '正在恢复'
    case 'stopping':return finishing?'正在结束任务':'正在停止'
    case 'stopped':return finishing?'已完成':'已停止'
  }
}
function siteName(url?:string){
  if(!url)return ''
  try{return new URL(url).host}catch{return ''}
}
function fileSize(size:number){
  if(!Number.isFinite(size)||size<0)return ''
  if(size<1024)return size+' B'
  if(size<1024*1024)return (size/1024).toFixed(1)+' KB'
  return (size/(1024*1024)).toFixed(size<10*1024*1024?1:0)+' MB'
}
function fileStatus(file:AgentArtifact){
  if(file.status==='ready'&&file.source==='download')return '下载完成'
  if(file.status==='ready'&&file.source==='selected')return '已选择'
  return FILE_STATUS[file.status]||'文件已登记'
}
function turnLabel(turn:AgentTurn){
  if(turn.status==='completed')return '浏览结果'
  if(turn.status==='failed')return '任务未完成'
  return turn.steps.some(step=>step.outcome==='unknown')?'已停止，结果待确认':'任务已停止'
}
function StepList({steps,paused=false}:{steps:AgentStep[];paused?:boolean}){
  if(!steps.length)return null
  return <ol className="agent-step-list">
    {steps.map(step=>{
      const unknown=step.outcome==='unknown'
      const resultLabel=unknown?(step.status==='cancelled'?'已停止，结果待确认':'结果待核实'):STEP_STATUS[step.status]
      const waiting=paused&&step.status==='running'
      const Icon=step.status==='running'?waiting?Pause:LoaderCircle:unknown?CircleHelp:step.status==='succeeded'?CircleCheck:step.status==='cancelled'?CircleMinus:AlertCircle
      return <li key={step.id} className="agent-step" data-agent-step={step.id} data-state={step.status} data-paused={waiting||undefined}
        aria-label={step.label+'：'+(waiting?'已暂停':resultLabel)}>
        <details className="agent-step-record">
          <summary className="agent-step-summary">
            <span className="agent-step-icon"><Icon size={16} aria-hidden="true" className={step.status==='running'&&!waiting?'animate-spin':undefined}/></span>
            <span className="agent-step-copy">{step.label}<span className="agent-step-status">{waiting?'已暂停':resultLabel}</span></span>
            <ChevronRight className="agent-step-chevron" size={15} aria-hidden="true"/>
          </summary>
          <div className="agent-step-content">
            <p className="agent-step-tool">{step.tool}</p>
            {step.detail&&<section><h5>{step.status==='failed'?'失败原因':'执行情况'}</h5><p className="agent-step-detail">{step.detail}</p></section>}
            {step.input&&<section><h5>调用参数</h5><pre>{step.input}</pre></section>}
            {step.result&&<section><h5>返回结果</h5><pre>{step.result}</pre></section>}
            {!step.detail&&!step.result&&<p className="agent-step-detail">{step.status==='running'?'正在执行，结果将在返回后显示。':step.status==='failed'?'未提供更详细的错误信息。':'该步骤未保留详细返回内容。'}</p>}
          </div>
        </details>
      </li>
    })}
  </ol>
}
function ArtifactList({artifacts}:{artifacts:AgentArtifact[]}){
  if(!artifacts.length)return null
  return <section className="mt-4" aria-label="任务文件" data-agent-artifacts>
    <h4 className="text-[12px] font-medium text-paper-muted">文件</h4>
    <ul className="agent-file-list">{artifacts.map(file=><li key={file.fileId} className="agent-file" data-agent-file={file.fileId}>
      <span className="agent-file-icon"><FileText size={17} aria-hidden="true"/></span>
      <div className="agent-file-copy"><p className="agent-file-name">{file.name}</p>
        <p className="agent-file-detail">{[fileStatus(file),fileSize(file.size)].filter(Boolean).join(' · ')}</p>
        {file.error&&<p className="agent-step-detail text-cinnabar">{file.error}</p>}
      </div>
    </li>)}</ul>
  </section>
}

export function BrowserAgentPanel({tabId,tabs,sheetRef,minimized,onMinimize,onNeedAttention,onBusyChange,onOperatingChange,onBrowserConfig,onSearch,searchUrl,onNavigate,onClose}:Props){
  const [config,setConfig]=useState<AgentConfig>({endpoint:'https://api.openai.com/v1',apiKey:'',model:'gpt-4.1'})
  const [goal,setGoal]=useState('')
  const [busy,setBusy]=useState(false)
  const [phase,setPhase]=useState<AgentPhase>('stopped')
  const [editing,setEditing]=useState(false)
  const [configReady,setConfigReady]=useState(false)
  const [status,setStatus]=useState('')
  const [turns,setTurns]=useState<AgentTurn[]>([])
  const [activeGoal,setActiveGoal]=useState('')
  const [error,setError]=useState('')
  const [saving,setSaving]=useState(false)
  const [showKey,setShowKey]=useState(false)
  const [copied,setCopied]=useState<number|null>(null)
  const [closePrompt,setClosePrompt]=useState(false)
  const [controlPending,setControlPending]=useState(false)
  const [stopPending,setStopPending]=useState(false)
  const [steps,setSteps]=useState<AgentStep[]>([])
  const [artifacts,setArtifacts]=useState<AgentArtifact[]>([])
  const [approval,setApproval]=useState<AgentApproval|null>(null)
  const [handoff,setHandoff]=useState<AgentHandoff|null>(null)
  const scrollRef=useRef<HTMLDivElement>(null)
  const dialogRef=useRef<HTMLDivElement>(null)
  const lastTurnId=useRef<string|undefined>(undefined)
  const runSequence=useRef(0)
  const lastActiveGoal=useRef('')
  const live=useRef(true)
  const stepsRef=useRef<AgentStep[]>([])
  const artifactsRef=useRef<AgentArtifact[]>([])
  const outcome=useRef<RunOutcome>('stopped')
  const activeRun=useRef<{id:string;goal:string;detail?:string;configError?:boolean}|null>(null)
  const approvalResolve=useRef<((approved:boolean)=>void)|null>(null)
  const handoffResolve=useRef<((choice:'continue'|'stop')=>void)|null>(null)
  const controller=useRef<AbortController|null>(null)
  const runtimeRef=useRef<BrowserAgentRuntime|null>(null)
  const stopping=useRef<{runtime:BrowserAgentRuntime;promise:Promise<void>}|null>(null)
  const committedMinimized=useRef(minimized)
  const pageExposureWaiters=useRef(new Set<()=>void>())
  const {height,dragging,isFull,expand,onPointerDown,onPointerMove,onPointerEnd,snapTo,limits}=useAgentSheet(sheetRef)

  useLayoutEffect(()=>{
    committedMinimized.current=minimized
    if(minimized)pageExposureWaiters.current.forEach(resolve=>resolve())
  },[minimized])
  useEffect(()=>{
    let mounted=true
    void loadAgentConfig().then(value=>{if(mounted)setConfig(value)})
      .catch(failure=>{if(mounted)setStatus(failure instanceof Error?failure.message:String(failure))})
      .finally(()=>{if(mounted)setConfigReady(true)})
    return ()=>{mounted=false}
  },[])
  useEffect(()=>{
    live.current=true
    return ()=>{
      live.current=false
      controller.current?.abort()
      approvalResolve.current?.(false)
      handoffResolve.current?.('stop')
      const runtime=runtimeRef.current
      if(runtime)void stopRuntime(runtime).catch(()=>undefined)
    }
  },[])
  useEffect(()=>onBusyChange(busy),[busy,onBusyChange])
  const operating=busy&&phase==='running'&&!approval&&!closePrompt
  useEffect(()=>{
    onOperatingChange?.(operating)
    return ()=>onOperatingChange?.(false)
  },[operating,onOperatingChange])
  useEffect(()=>{
    const transcript=scrollRef.current
    const latestTurnId=turns[turns.length-1]?.id
    const newTurn=Boolean(latestTurnId&&latestTurnId!==lastTurnId.current)
    const newGoal=Boolean(activeGoal&&lastActiveGoal.current!==activeGoal)
    lastTurnId.current=latestTurnId
    lastActiveGoal.current=activeGoal
    if(!transcript||minimized||handoff)return
    if(newTurn){
      const entries=transcript.querySelectorAll<HTMLElement>('[data-agent-turn]')
      const target=entries[entries.length-1]
      if(target){
        const offset=target.getBoundingClientRect().top-transcript.getBoundingClientRect().top+transcript.scrollTop
        transcript.scrollTop=Math.max(0,offset-12)
      }
    }else if(newGoal||((busy||activeGoal)&&transcript.scrollHeight-transcript.scrollTop-transcript.clientHeight<145)){
      transcript.scrollTop=transcript.scrollHeight
    }
  },[turns,activeGoal,steps,status,minimized,busy,handoff,artifacts])
  useEffect(()=>{
    if(!handoff||minimized)return
    const transcript=scrollRef.current,sheet=sheetRef.current
    let active=true
    const reveal=()=>{
      const target=transcript?.querySelector<HTMLElement>('[data-agent-handoff]')
      if(transcript&&target)transcript.scrollTop=Math.max(0,target.getBoundingClientRect().top-transcript.getBoundingClientRect().top+transcript.scrollTop-12)
    }
    const fit=()=>{
      if(!active)return
      const target=transcript?.querySelector<HTMLElement>('[data-agent-handoff]')
      if(transcript&&sheet&&target){
        const controlsHeight=sheet.getBoundingClientRect().height-transcript.getBoundingClientRect().height
        const readableHeight=controlsHeight+target.getBoundingClientRect().height+24
        snapTo(Math.max(limits().min,Math.ceil(readableHeight)))
      }
      reveal()
    }
    const frame=requestAnimationFrame(fit)
    void document.fonts?.ready.then(fit)
    sheet?.addEventListener('transitionend',reveal)
    return ()=>{active=false;cancelAnimationFrame(frame);sheet?.removeEventListener('transitionend',reveal)}
  },[handoff,minimized,sheetRef,snapTo,limits])
  useEffect(()=>{
    if((!approval&&!closePrompt)||minimized)return
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null
    const dialog=dialogRef.current
    const sheet=sheetRef.current
    const focus=()=>{(dialog?.querySelector<HTMLButtonElement>('button:not(:disabled)')||dialog)?.focus()}
    const frame=requestAnimationFrame(focus)
    const keydown=(event:globalThis.KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();event.stopPropagation()
        if(stopPending)return
        if(approval)approvalResolve.current?.(false)
        else setClosePrompt(false)
      }else if(event.key==='Tab'){
        const buttons=Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[])
        if(!buttons.length){event.preventDefault();return}
        const first=buttons[0],last=buttons[buttons.length-1]
        if(event.shiftKey&&(document.activeElement===first||!dialog?.contains(document.activeElement))){event.preventDefault();last.focus()}
        else if(!event.shiftKey&&(document.activeElement===last||!dialog?.contains(document.activeElement))){event.preventDefault();first.focus()}
      }
    }
    document.addEventListener('keydown',keydown,true)
    return ()=>{
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown',keydown,true)
      if(previous?.isConnected&&!sheet?.hidden)previous.focus()
    }
  },[approval,closePrompt,minimized,stopPending,sheetRef])

  function stopRuntime(runtime:BrowserAgentRuntime):Promise<void>{
    if(stopping.current?.runtime===runtime)return stopping.current.promise
    const promise=Promise.resolve().then(()=>runtime.stop()).catch(failure=>{
      if(stopping.current?.promise===promise)stopping.current=null
      throw failure
    })
    stopping.current={runtime,promise}
    return promise
  }
  const isCurrent=(abort:AbortController)=>live.current&&controller.current===abort
  const exposePage=(abort:AbortController):Promise<void>=>{
    if(!isCurrent(abort)||abort.signal.aborted)return Promise.reject(new DOMException('任务已停止','AbortError'))
    if(committedMinimized.current)return Promise.resolve()
    return new Promise<void>((resolve,reject)=>{
      let settled=false
      const finish=(cancelled=false)=>{
        if(settled)return
        settled=true
        pageExposureWaiters.current.delete(ready)
        abort.signal.removeEventListener('abort',cancel)
        if(cancelled)reject(new DOMException('任务已停止','AbortError'))
        else resolve()
      }
      const ready=()=>finish()
      const cancel=()=>finish(true)
      pageExposureWaiters.current.add(ready)
      abort.signal.addEventListener('abort',cancel,{once:true})
      // The runtime checks native bounds after this React commit before dispatching input.
      onMinimize()
    })
  }
  const releaseRun=(abort:AbortController)=>{
    if(controller.current!==abort)return
    const record=activeRun.current
    if(live.current&&record&&outcome.current!=='completed'){
      const retainedSteps:AgentStep[]=stepsRef.current.map(step=>step.status==='running'
        ?{...step,status:'cancelled',outcome:step.outcome||'unknown',detail:step.detail||'未收到最终操作结果'}:step)
      const turn:AgentTurn={id:record.id,goal:record.goal,detail:record.detail,status:outcome.current==='failed'?'failed':'stopped',steps:retainedSteps,artifacts:artifactsRef.current}
      setTurns(previous=>[...previous.filter(item=>item.id!==record.id).slice(-7),turn])
      setActiveGoal('')
    }
    activeRun.current=null
    controller.current=null;runtimeRef.current=null;stopping.current=null
    if(!live.current)return
    setBusy(false);setPhase('stopped');setControlPending(false);setStopPending(false)
    setApproval(null);setHandoff(null)
    if(!record?.configError)setError('')
    if(outcome.current==='completed')setStatus('已完成')
    else if(outcome.current==='stopped')setStatus('已停止')
    onNeedAttention()
  }
  const stop=async():Promise<boolean>=>{
    const abort=controller.current
    if(!abort)return true
    if(outcome.current==='running')outcome.current='stopped'
    setPhase('stopping');setStopPending(true);setError('')
    abort.abort()
    approvalResolve.current?.(false)
    handoffResolve.current?.('stop')
    try{
      const runtime=runtimeRef.current
      if(runtime)await stopRuntime(runtime)
      releaseRun(abort)
      return true
    }catch{
      if(isCurrent(abort)){
        setStopPending(false);setError('尚未确认任务停止，请重试停止。');setStatus('停止尚未确认')
        onNeedAttention()
      }
      return false
    }
  }
  const pause=async(takeover=false)=>{
    const abort=controller.current,runtime=runtimeRef.current
    if(!abort||!runtime||abort.signal.aborted||controlPending)return
    setControlPending(true);setError('');setPhase('pausing')
    try{
      await runtime.pause()
      if(!isCurrent(abort)||abort.signal.aborted)return
      if(takeover){
        const current=tabs.find(tab=>tab.active)
        setHandoff({id:'manual-'+Date.now(),kind:'manual',reason:'完成网页操作后，点击继续任务。',tabId:current?.id,url:current?.url,title:current?.title})
        setPhase('handoff');snapTo(limits().min)
      }else setPhase('paused')
    }catch(failure){
      if(isCurrent(abort)&&!abort.signal.aborted)setError(failure instanceof Error?failure.message:'暂停失败，请重试')
    }finally{if(isCurrent(abort))setControlPending(false)}
  }
  const resume=async()=>{
    const abort=controller.current,runtime=runtimeRef.current
    if(!abort||!runtime||abort.signal.aborted||controlPending)return
    setControlPending(true);setError('');setPhase('resuming')
    if(handoffResolve.current){handoffResolve.current('continue');return}
    try{
      await runtime.resume()
      if(isCurrent(abort)&&!abort.signal.aborted){setHandoff(null);setPhase('running')}
    }catch(failure){
      if(isCurrent(abort)&&!abort.signal.aborted){setPhase(handoff?'handoff':'paused');setError(failure instanceof Error?failure.message:'恢复失败，请重试')}
    }finally{if(isCurrent(abort))setControlPending(false)}
  }
  const requestApproval=(request:AgentApproval,signal:AbortSignal,abort:AbortController)=>new Promise<boolean>(resolve=>{
    if(signal.aborted||!isCurrent(abort)){resolve(false);return}
    approvalResolve.current?.(false)
    let settled=false
    const done=(approved:boolean)=>{
      if(settled)return
      settled=true
      signal.removeEventListener('abort',cancel)
      if(approvalResolve.current===done)approvalResolve.current=null
      if(isCurrent(abort))setApproval(null)
      resolve(approved&&!signal.aborted)
    }
    const cancel=()=>done(false)
    approvalResolve.current=done
    signal.addEventListener('abort',cancel,{once:true})
    setApproval(request);onNeedAttention()
  })
  const requestHandoff=(request:AgentHandoff,signal:AbortSignal,abort:AbortController)=>new Promise<'continue'|'stop'>(resolve=>{
    if(signal.aborted||!isCurrent(abort)){resolve('stop');return}
    handoffResolve.current?.('stop')
    let settled=false
    const done=(choice:'continue'|'stop')=>{
      if(settled)return
      settled=true
      signal.removeEventListener('abort',cancel)
      if(handoffResolve.current===done)handoffResolve.current=null
      resolve(signal.aborted?'stop':choice)
    }
    const cancel=()=>done('stop')
    handoffResolve.current=done
    signal.addEventListener('abort',cancel,{once:true})
    setHandoff(request);setPhase('handoff');setControlPending(false)
    onNeedAttention();snapTo(limits().min)
  })

  const run=async()=>{
    if(controller.current)return
    if(!goal.trim()){setStatus('请输入你想完成的任务');return}
    const request=goal.trim(),abort=new AbortController(),turnId='run-'+(++runSequence.current)
    controller.current=abort;outcome.current='running';stepsRef.current=[];artifactsRef.current=[]
    activeRun.current={id:turnId,goal:request}
    setBusy(true);setPhase('running');setError('');setActiveGoal(request);setSteps([]);setArtifacts([])
    setHandoff(null);setApproval(null);setCopied(null);setStatus('正在准备…')
    let runtime:BrowserAgentRuntime|null=null
    try{
      const runtimeConfig=await loadAgentConfig()
      if(abort.signal.aborted)throw new DOMException('任务已停止','AbortError')
      if(!runtimeConfig.apiKey||!runtimeConfig.model||!runtimeConfig.endpoint){
        if(activeRun.current)activeRun.current.configError=true
        setEditing(true)
        throw new Error('请先保存 API 地址、模型和密钥')
      }
      runtime=createBrowserAgentRuntime({
        signal:abort.signal,onSearch,onNavigate,searchUrl,
        onBrowserConfig:(request,signal)=>onBrowserConfig(request,signal,async reason=>requestApproval({id:'browser-config-'+Date.now(),reason,tool:'browser_config'},signal,abort)),
        onExposePage:()=>exposePage(abort),
        onApproval:(request,signal)=>requestApproval(request,signal,abort),
        onHandoff:(request,signal)=>requestHandoff(request,signal,abort),
        onStep:step=>{
          if(!isCurrent(abort))return
          const index=stepsRef.current.findIndex(item=>item.id===step.id)
          const next=index<0?[...stepsRef.current,step]:stepsRef.current.map(item=>item.id===step.id?step:item)
          stepsRef.current=next;setSteps(next)
          setTurns(previous=>previous.map(turn=>turn.id===turnId?{...turn,steps:next}:turn))
        },
        onPhase:next=>{
          if(!isCurrent(abort)||(abort.signal.aborted&&next!=='stopping'&&next!=='stopped'))return
          setPhase(next)
          if(next==='running'){setHandoff(null);setControlPending(false)}
          else if(next==='paused'||next==='handoff'){
            setControlPending(false)
            if(next==='paused')onNeedAttention()
          }
        },
        onControlError:message=>{
          if(isCurrent(abort)&&!abort.signal.aborted){setError(message);onNeedAttention()}
        },
        onArtifacts:next=>{
          if(!isCurrent(abort))return
          artifactsRef.current=next;setArtifacts(next)
          setTurns(previous=>previous.map(turn=>turn.id===turnId?{...turn,artifacts:next}:turn))
        },
      })
      runtimeRef.current=runtime
      const onActivity=runtime.onActivity
      runtime.onActivity=message=>{
        onActivity?.(message)
        if(isCurrent(abort)&&!abort.signal.aborted)setStatus(LABELS[message as AgentToolName]||(message.startsWith('browser_')?'正在操作网页':message))
      }
      const initial=await runtime.start()
      const result=await runReActAgent(runtimeConfig,request,{browser:initial,uiTabId:tabId,
        previousTurns:turns.slice(-3).map(turn=>({goal:turn.goal,status:turn.status,answer:turn.answer?.slice(0,1600),detail:turn.detail?.slice(0,300),
          steps:turn.steps.map(step=>({tool:step.tool,status:step.status,outcome:step.outcome,detail:step.outcome==='unknown'||step.status==='failed'?step.detail?.slice(0,200):undefined})),
          files:turn.artifacts.map(file=>({fileId:file.fileId,name:file.name,mime:file.mime,size:file.size,status:file.status})),
        }))},runtime,abort.signal)
      if(abort.signal.aborted)throw new DOMException('任务已停止','AbortError')
      if(isCurrent(abort)){
        outcome.current='completed'
        setTurns(previous=>[...previous.slice(-7),{id:turnId,goal:request,status:'completed',answer:result,steps:stepsRef.current,artifacts:artifactsRef.current}])
        setGoal('');setActiveGoal('');setStatus('正在结束任务')
      }
    }catch(failure){
      if(isCurrent(abort)&&!abort.signal.aborted){
        outcome.current='failed'
        const message=failure instanceof Error?failure.message:'浏览任务失败'
        if(activeRun.current)activeRun.current.detail=message
        setError(message);setStatus('任务未完成')
      }
    }finally{
      try{
        if(runtime)await stopRuntime(runtime)
        releaseRun(abort)
      }catch{
        if(isCurrent(abort)){setPhase('stopping');setStopPending(false);setError('尚未确认任务停止，请重试停止。');setStatus('停止尚未确认');onNeedAttention()}
      }
    }
  }
  const save=async()=>{
    if(saving)return
    setSaving(true);setError('')
    try{await saveAgentConfig(config);setEditing(false);setStatus('配置已保存')}
    catch(failure){const message=failure instanceof Error?failure.message:'保存失败';setError(message);setStatus(message)}
    finally{setSaving(false)}
  }
  const copyResult=async(index:number,markdown:string)=>{
    try{await navigator.clipboard.writeText(markdown);setCopied(index)}
    catch{setError('无法复制内容，请重试')}
  }
  const keyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{
    if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void run()}
  }
  const requestClose=()=>{if(busy){setClosePrompt(true);return}onClose()}
  const canResume=phase==='paused'||phase==='handoff'
  const phaseText=phaseLabel(phase,outcome.current==='completed')
  const confirmationOpen=Boolean(approval||closePrompt)

  return <section ref={sheetRef} aria-label="AI 浏览助手" role="region" hidden={minimized}
    data-agent-sheet data-dragging={dragging?'true':'false'} data-fullscreen={isFull?'true':'false'}
    className="agent-sheet" style={{height:height+'px',maxHeight:'calc(100dvh - var(--sat))'}}>
    <div className="contents" inert={confirmationOpen} aria-hidden={confirmationOpen||undefined}>
    <div role="separator" tabIndex={0} aria-label="拖动调整 AI 面板高度" aria-orientation="horizontal"
      aria-valuenow={Math.round(height)} aria-valuemin={limits().min} aria-valuemax={limits().max}
      className="agent-grip-area shrink-0" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onDoubleClick={expand}
      onKeyDown={event=>{
        if(event.key==='ArrowUp'||event.key==='ArrowDown'){
          event.preventDefault();snapTo(height+(event.key==='ArrowUp'?40:-40))
        }else if(event.key==='Home'){event.preventDefault();snapTo(limits().min)}
        else if(event.key==='End'){event.preventDefault();snapTo(limits().max)}
      }}>
      <span className="agent-grip"/>
    </div>
    <header className="agent-header flex shrink-0 items-center gap-2"
      onPointerDown={event=>{if(!(event.target as Element).closest('button'))onPointerDown(event)}}
      onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
      onDoubleClick={event=>{if(!(event.target as Element).closest('button'))expand()}}>
      <span className="agent-header-mark flex size-8 shrink-0 items-center justify-center rounded-xl"><Bot size={18} strokeWidth={1.75} aria-hidden="true"/></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><h2 className="truncate text-[15px] font-semibold tracking-[-.015em]">AI 浏览助手</h2>
          {busy&&(canResume?phase==='handoff'?<Hand size={14} className="shrink-0 text-paper-muted" aria-hidden="true"/>:<Pause size={14} className="shrink-0 text-paper-muted" aria-hidden="true"/>:<LoaderCircle size={14} className="shrink-0 animate-spin text-cinnabar" aria-hidden="true"/>)}</div>
        <p className="truncate text-[12px] leading-[1.4] text-paper-muted">{editing?'模型与连接设置':tabs.length?'当前网页 · '+(tabs.find(tab=>tab.active)?.title||'浏览器'): '随时开始浏览任务'}</p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button type="button" aria-label={editing?'返回任务':'API 设置'} aria-pressed={editing} disabled={busy&&!editing||!configReady}
          className="agent-icon-button agent-settings-toggle" onClick={()=>{setError('');setEditing(value=>!value)}}><Settings2 size={19}/></button>
        <button type="button" aria-label={isFull?'恢复半屏':'展开全屏'} aria-pressed={isFull} className="agent-icon-button" onClick={expand}>
          {isFull?<Minimize2 size={19}/>:<Maximize2 size={19}/>}</button>
        <button type="button" aria-label="收起 AI 面板" className="agent-icon-button" onClick={onMinimize}><ChevronDown size={21}/></button>
        <button type="button" aria-label="关闭 AI 浏览助手" className="agent-icon-button agent-close" onClick={requestClose}><X size={20}/></button>
      </div>
    </header>
    {editing?<div className="agent-transcript px-5 py-5" data-agent-settings>
      <div className="mb-5"><h3 className="text-[18px] font-semibold">模型设置</h3><p className="mt-1 text-[13px] leading-relaxed text-paper-muted">连接支持工具调用的 OpenAI 兼容模型。</p></div>
      <form className="grid gap-4 text-[13px]" onSubmit={event=>{event.preventDefault();void save()}}>
        <label className="grid gap-1.5 font-medium">API 地址
          <input aria-label="Agent Base URL" spellCheck={false} autoCapitalize="off" autoCorrect="off" className="agent-field min-h-11 px-3 text-[14px] font-normal" value={config.endpoint} onChange={event=>setConfig(previous=>({...previous,endpoint:event.target.value}))} placeholder="https://api.openai.com/v1" />
        </label>
        <label className="grid gap-1.5 font-medium">模型
          <input aria-label="Agent Model" spellCheck={false} autoCapitalize="off" autoCorrect="off" className="agent-field min-h-11 px-3 text-[14px] font-normal" value={config.model} onChange={event=>setConfig(previous=>({...previous,model:event.target.value}))} placeholder="支持工具调用的模型名称"/>
        </label>
        <label className="grid gap-1.5 font-medium">API Key
          <div className="relative"><input aria-label="Agent API Key" type={showKey?'text':'password'} autoComplete="off" spellCheck={false} className="agent-field min-h-11 px-3 pr-11 text-[14px] font-normal" value={config.apiKey} onChange={event=>setConfig(previous=>({...previous,apiKey:event.target.value}))}/>
            <button type="button" aria-label={showKey?'隐藏 API Key':'显示 API Key'} className="absolute inset-y-0 right-1 flex w-10 items-center justify-center text-paper-muted" onClick={()=>setShowKey(value=>!value)}>{showKey?<EyeOff size={17}/>:<Eye size={17}/>}</button></div>
        </label>
        <label className="flex min-h-10 items-center justify-between gap-3"><span className="min-w-0"><span className="block font-medium">允许局域网 HTTP</span><span className="block text-[12px] leading-relaxed text-paper-muted">仅用于本地模型，密钥将以明文传输</span></span>
          <input type="checkbox" aria-label="允许局域网 HTTP" checked={config.allowLanHttp===true} onChange={event=>setConfig(previous=>({...previous,allowLanHttp:event.target.checked}))} className="size-5 accent-cinnabar"/></label>
        <label className="flex min-h-10 items-center justify-between gap-3"><span className="min-w-0"><span className="block font-medium">允许远程 HTTP API</span><span className="block text-[12px] leading-relaxed text-paper-muted">密钥与请求内容明文传输，仅用于可信服务。</span></span>
          <input type="checkbox" aria-label="允许远程 HTTP API" checked={config.allowInsecureHttp===true} onChange={event=>setConfig(previous=>({...previous,allowInsecureHttp:event.target.checked}))} className="size-5 accent-cinnabar"/></label>
        {error&&<div role="alert" className="flex gap-2 text-[13px] leading-relaxed text-cinnabar"><AlertCircle size={17} className="mt-0.5 shrink-0"/>{error}</div>}
        <div className="mt-1 flex justify-end gap-2"><button type="button" className="agent-secondary" onClick={()=>{setEditing(false);setError('')}}>取消</button>
          <button type="submit" disabled={saving} className="agent-primary">{saving?<LoaderCircle size={16} className="animate-spin"/>:<Check size={16}/>}保存配置</button></div>
      </form>
    </div>:<>
      <div ref={scrollRef} className="agent-transcript" data-agent-transcript>
        {turns.length===0&&!activeGoal&&<div className="px-5 pb-6 pt-7">
          <h3 className="text-[20px] font-semibold tracking-[-.025em] leading-snug">浏览任务</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {(tabId?['总结当前网页','查找相关资料']:['搜索今日科技资讯','查找某个网站']).map(suggestion=><button type="button" key={suggestion} onClick={()=>setGoal(suggestion)} className="rounded-full border border-haze px-3.5 py-2 text-[13px] text-paper-muted transition-colors active:bg-haze">{suggestion}</button>)}
          </div>
        </div>}
        {turns.map((turn,index)=><div key={turn.id} data-agent-turn data-agent-turn-status={turn.status} className="px-5 pt-5">
          <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-md bg-haze/70 px-3.5 py-3 text-[14px] leading-relaxed text-paper">{turn.goal}</div>
          <div className="mt-5 pb-2">
            <div className="mb-3 flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-[12px] font-semibold text-paper-muted">{turn.status==='completed'?<Bot size={15}/>:turn.status==='failed'?<AlertCircle size={15}/>:<CircleMinus size={15}/>}<span>{turnLabel(turn)}</span></span>
              {turn.answer&&<button type="button" aria-label="复制 AI 回答" className="agent-icon-button" onClick={()=>{void copyResult(index,turn.answer||'')}}>
                {copied===index?<CheckCheck size={16}/>:<Copy size={16}/>}</button>}</div>
            {turn.answer&&<AgentMarkdown markdown={turn.answer} onNavigate={onNavigate}/>}
            {turn.detail&&<p className="text-[13px] leading-relaxed text-paper-muted">{turn.detail}</p>}
            {turn.steps.length>0&&<details open={turn.status!=='completed'}><summary className="agent-history-toggle"><ChevronRight size={14} aria-hidden="true"/>操作记录（{turn.steps.length}）</summary><StepList steps={turn.steps}/></details>}
            <ArtifactList artifacts={turn.artifacts}/>
          </div>
          {index<turns.length-1&&<div className="mt-4 border-t border-haze"/>}
        </div>)}
        {activeGoal&&<div className="px-5 pb-5 pt-5" data-agent-active-task>
          {handoff&&<div className="agent-handoff" data-agent-handoff>
            <h3 className="agent-handoff-title"><Hand size={17} aria-hidden="true"/>{HANDOFF_TITLES[handoff.kind]}</h3>
            <p className="agent-handoff-reason">{handoff.reason}</p>
            {siteName(handoff.url)&&<p className="agent-handoff-site">{siteName(handoff.url)}</p>}
          </div>}
          <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-md bg-haze/70 px-3.5 py-3 text-[14px] leading-relaxed text-paper">{activeGoal}</div>
          {busy&&phase==='running'&&!steps.some(step=>step.status==='running')&&<div className="mt-4 flex items-start gap-2 text-[13px] leading-relaxed" data-agent-running>
            <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin text-cinnabar" aria-hidden="true"/><span role="status">{status}</span>
          </div>}
          {steps.length>3&&<details><summary className="agent-history-toggle"><ChevronRight size={14} aria-hidden="true"/>此前步骤（{steps.length-3}）</summary><StepList steps={steps.slice(0,-3)} paused={canResume}/></details>}
          <StepList steps={steps.slice(-3)} paused={canResume}/>
          <ArtifactList artifacts={artifacts}/>
        </div>}
        {error&&<div role="alert" className="mx-5 my-4 flex items-start gap-2 rounded-xl border border-haze p-3 text-[13px] leading-relaxed text-cinnabar"><AlertCircle size={17} className="shrink-0"/>{error}</div>}
      </div>
      {busy?<div className="agent-task-controls" data-agent-controls data-phase={phase}>
        <span className="agent-task-control-status" role="status">
          {['pausing','resuming','stopping'].includes(phase)?<LoaderCircle size={15} className="shrink-0 animate-spin" aria-hidden="true"/>:phase==='handoff'?<Hand size={15} aria-hidden="true"/>:phase==='paused'?<Pause size={15} aria-hidden="true"/>:null}
          {phaseText}
        </span>
        <div className="agent-task-actions">
          {phase==='running'&&<>
            <button type="button" className="agent-secondary" disabled={controlPending} onClick={()=>{void pause()}}><Pause size={15}/>暂停</button>
            <button type="button" className="agent-secondary" disabled={controlPending} onClick={()=>{void pause(true)}}><Hand size={15}/>接管</button>
          </>}
          {canResume&&<>
            <button type="button" className="agent-secondary" disabled={controlPending} onClick={onMinimize}>操作网页</button>
            <button type="button" className="agent-primary" disabled={controlPending} onClick={()=>{void resume()}}><Play size={15}/>继续任务</button>
          </>}
          <button type="button" className="agent-icon-button" aria-label="停止任务" title="停止任务" disabled={stopPending} onClick={()=>{void stop()}}>
            <Square size={16} fill="currentColor"/>
          </button>
        </div>
      </div>:<div className="agent-composer px-4 pb-3 pt-3" data-agent-composer>
        <div className="flex items-end gap-2 rounded-[17px] border border-haze bg-ink p-1.5 pl-3">
          <textarea aria-label="AI 浏览任务" rows={2} value={goal} onChange={event=>setGoal(event.target.value)} onKeyDown={keyDown}
            placeholder="搜索、阅读或操作网页…" className="min-h-[44px] max-h-[120px] min-w-0 flex-1 resize-none bg-transparent px-0 py-2 text-[14px] leading-[1.55] text-paper outline-none placeholder:text-paper-faint"/>
          <button type="button" disabled={!configReady||!goal.trim()} onClick={()=>{void run()}} aria-label="开始任务"
            className="agent-primary !size-11 !min-h-11 !shrink-0 !rounded-[12px] !p-0" title="开始任务"><ArrowUp size={20} strokeWidth={2.5}/></button>
        </div>
        <div className="mt-2 px-1 text-[12px] leading-5 text-paper-muted"><span role="status">{status||'就绪'}</span></div>
      </div>}
    </>}
    </div>
    {(approval||closePrompt)&&<div className="absolute inset-0 z-30 flex items-end justify-center bg-ink/40 px-4 pb-[calc(var(--sab)+18px)]" role="presentation">
      <div ref={dialogRef} role="alertdialog" tabIndex={-1} aria-modal="true" aria-labelledby="agent-confirm-title" aria-describedby="agent-confirm-reason"
        className="max-h-[calc(100dvh-64px)] w-full max-w-md overflow-y-auto overscroll-contain rounded-[19px] border border-haze bg-ink-raised p-5 shadow-lg">
        <h3 id="agent-confirm-title" className="text-[16px] font-semibold">{approval?'确认网页操作':'停止当前任务？'}</h3>
        <p id="agent-confirm-reason" className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-[1.65] text-paper-muted">{approval?.reason||'关闭后任务将停止。收起面板可保留任务。'}</p>
        {approval?.target&&<p className="mt-2 break-words text-[13px] leading-relaxed">{approval.target}</p>}
        {approval&&siteName(approval.url)&&<p className="mt-1 text-[12px] text-paper-muted">{siteName(approval.url)}</p>}
        {closePrompt&&error&&<p role="alert" className="mt-2 text-[13px] leading-relaxed text-cinnabar">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="agent-secondary" disabled={stopPending} onClick={()=>{if(approval)approvalResolve.current?.(false);else setClosePrompt(false)}}>{approval?'拒绝':'返回任务'}</button>
          <button type="button" className="agent-primary" disabled={stopPending} onClick={()=>{
            if(approval)approvalResolve.current?.(true)
            else void stop().then(stopped=>{if(stopped){setClosePrompt(false);onClose()}})
          }}>{approval?'允许这一步':stopPending?'正在停止':'停止并关闭'}</button>
        </div>
      </div>
    </div>}
  </section>
}
