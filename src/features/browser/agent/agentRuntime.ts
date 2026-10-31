import {
  agentApprovalReason, browserAgentAction, browserAgentSession, browserAgentState, subscribeBrowserAgentEvents,
  type AgentElement, type AgentObservation, type AgentOperation, type AgentScreenshot,
  type AgentSessionState, type AgentToolArguments, type AgentToolName, type AgentToolResult, type ReActRuntime, type AgentFileArtifact, type AgentEventHandlers, type AgentFileImage,
} from './browserAgent'
import {agentStepData,agentStepError} from './agentStepDetails'

export type AgentPhase = 'running'|'pausing'|'paused'|'handoff'|'resuming'|'stopping'|'stopped'
export interface AgentStep {id:string;tool:AgentToolName;label:string;status:'running'|'succeeded'|'failed'|'cancelled';detail?:string;input?:string;result?:string;outcome?:'not_executed'|'executed'|'unknown'}
export interface AgentApproval {id:string;reason:string;tool:AgentToolName;tabId?:number;url?:string;target?:string}
export interface AgentHandoff {id:string;kind:'login'|'captcha'|'file_picker'|'manual';reason:string;tabId?:number;url?:string;title?:string}
export type AgentArtifact = AgentFileArtifact
export interface AgentBridge {
  state:typeof browserAgentState
  session:(action:'start'|'pause'|'resume'|'stop',runId:string)=>Promise<AgentSessionState>
  action:(args:AgentOperation)=>Promise<Record<string,unknown>>
  subscribe?:(handlers:AgentEventHandlers)=>Promise<()=>Promise<void>>
}
export interface BrowserAgentRuntimeOptions {
  signal:AbortSignal
  onBrowserConfig?:(request:AgentToolArguments,signal:AbortSignal)=>Promise<unknown>
  onSearch:(query:string)=>Promise<boolean>
  onNavigate:(url:string)=>Promise<boolean>
  searchUrl:(query:string)=>string
  onApproval:(request:AgentApproval,signal:AbortSignal)=>Promise<boolean>
  onHandoff:(request:AgentHandoff,signal:AbortSignal)=>Promise<'continue'|'stop'>
  onStep?:(step:AgentStep)=>void
  onPhase?:(phase:AgentPhase)=>void
  onArtifacts?:(files:AgentArtifact[])=>void
  onControlError?:(message:string)=>void
  onExposePage?:()=>Promise<void>
  bridge?:AgentBridge
}
export interface BrowserAgentRuntime extends ReActRuntime {
  start:()=>Promise<unknown>
  pause:()=>Promise<void>
  resume:()=>Promise<void>
  stop:()=>Promise<void>
  waitUntilReady:(signal:AbortSignal)=>Promise<void>
}

export const AGENT_TOOL_LABELS:Record<AgentToolName,string>={
  browser_config:'管理浏览器配置',browser_search:'搜索网页',browser_open_url:'打开网址',browser_observe:'读取网页',browser_click:'点击网页',
  browser_type:'填写内容',browser_choose:'选择选项',browser_submit:'提交表单',browser_scroll:'滚动网页',
  browser_back:'返回上一页',browser_forward:'前进',browser_tabs:'查看标签页',browser_new_tab:'新建标签页',
  browser_switch_tab:'切换标签页',browser_close_tab:'关闭标签页',browser_screenshot:'观察网页画面',
  browser_tap:'点击网页画面',browser_gesture:'操作网页手势',browser_touch:'操作多点触控',browser_key:'使用键盘',browser_wait:'等待页面变化',
  browser_request_handoff:'等待你操作',browser_files:'查看任务文件',browser_upload_files:'上传文件',
  browser_read_file:'读取文件',browser_cancel_download:'取消下载',
}
function stopped(){return new DOMException('任务已停止','AbortError')}
function text(value:unknown,empty=false):string {
  if(typeof value!=='string' || (!empty&&!value.trim()) || value.length>16000)throw new Error('文字参数无效或过长')
  return value
}
function url(value:unknown):string {
  const parsed=new URL(text(value))
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('只能打开有效的 HTTP/HTTPS 网页')
  return parsed.href
}
function delay(ms:number,signal:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(stopped());return}
    const abort=()=>{clearTimeout(timer);reject(stopped())}
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},ms)
    signal.addEventListener('abort',abort,{once:true})
  })
}

/** Model IDs are local to this observation; dispatch preserves the original frame reference. */
export function normalizeAgentObservation(raw:AgentObservation):AgentObservation {
  if(!raw || typeof raw.snapshot!=='string' || !Array.isArray(raw.elements) || !raw.viewport)throw new Error('网页观察结果无效')
  const elements:AgentElement[]=[]
  const seen=new Set<string>()
  const texts:string[]=[]
  for(const frame of [raw,...(raw.frames||[])]){
    const frameId=frame.frameId||'main'
    if(seen.has(frameId))continue
    seen.add(frameId)
    if(frame.text)texts.push((frame===raw?'':`[框架 ${frameId} ${frame.url}]\n`)+frame.text.slice(0,12000))
    for(const element of frame.elements||[]){
      if(elements.length>=480)break
      const frameDocumentId=frame.frameDocumentId||(frame===raw?raw.frames?.find(item=>item.frameId===frameId)?.documentId:undefined)||frame.documentId
      elements.push({...element,id:elements.length,localId:element.id,frameId,frameDocumentId,frameSnapshot:frame.snapshot,frameUrl:frame.url})
    }
  }
  return {...raw,elements,text:texts.join('\n').slice(0,24000),frames:undefined}
}

/** Owns execution independently of React renders. All post-start actions use the native run lease. */
export function createBrowserAgentRuntime(options:BrowserAgentRuntimeOptions):BrowserAgentRuntime {
  const bridge:AgentBridge=options.bridge||{state:browserAgentState,session:browserAgentSession,action:browserAgentAction,subscribe:subscribeBrowserAgentEvents}
  const signal=options.signal
  const runId='agent-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)
  let sequence=0, started=false,contextVersion=0
  let phase:AgentPhase='running'
  let lastPage:AgentObservation|null=null, lastShot:AgentScreenshot|null=null
  let initialNavigation:Promise<boolean>|null=null
  let nativeStarting:Promise<AgentSessionState>|null=null
  let subscription:Promise<()=>Promise<void>>|null=null
  let filePicking=false
  let stopPromise:Promise<void>|null=null
  let control:Promise<void>=Promise.resolve()
  const waiters=new Set<{resolve:()=>void;reject:(error:Error)=>void}>()
  const uncertain=new Set<string>(),denied=new Set<string>()
  const unresolvedDocuments=new Set<string>()
  const actionContexts=new WeakMap<object,AgentObservation|null>()
  const artifacts=new Map<string,AgentArtifact>()
  const id=()=>runId+'-'+(++sequence)
  const emitPhase=(value:AgentPhase)=>{phase=value;options.onPhase?.(value)}
  const assertActive=()=>{if(signal.aborted||phase==='stopping'||phase==='stopped')throw stopped()}
  const documentKey=(page:AgentObservation|null)=>page?.documentId||page?.url||''
  const invalidate=()=>{lastPage=null;lastShot=null;contextVersion++}
  const fingerprintFor=(name:AgentToolName,args:AgentToolArguments,page=lastPage)=>{
    const target=page?.elements.find(item=>item.id===args.id)
    return name+'|'+(page?.documentId||page?.url||'')+'|'+JSON.stringify(target?
      {...args,id:undefined,target:{frameId:target.frameId,text:target.text,href:target.href,type:target.type}}:args)
  }
  const ready=()=>{emitPhase('running');for(const waiter of [...waiters])waiter.resolve()}
  const fileContext=()=>JSON.stringify([...artifacts.values()].map(item=>({fileId:item.fileId,status:item.status,error:item.error,name:item.name,mime:item.mime,source:item.source,size:item.status==='ready'?item.size:undefined})).sort((left,right)=>left.fileId.localeCompare(right.fileId)))
  const publishFiles=(items:AgentArtifact[],replace=false)=>{
    const before=fileContext()
    if(replace)artifacts.clear()
    for(const item of items)if(item&&typeof item.fileId==='string'&&item.fileId)artifacts.set(item.fileId,item)
    // Terminal changes must reach a new model decision; progress bytes alone must not starve one.
    if(before!==fileContext())contextVersion++
    options.onArtifacts?.([...artifacts.values()])
  }
  const listen=async()=>{
    if(!bridge.subscribe)return
    if(!subscription)subscription=bridge.subscribe({
      session:event=>{
        if(event.runId!==runId||phase==='stopped'||phase==='stopping')return
        if(event.state==='paused'){
          invalidate()
          if(event.error){emitPhase('pausing');options.onControlError?.('尚未确认暂停：'+event.error)}
          else if(phase!=='handoff')emitPhase('paused')
        }else if(event.state==='stopped'){
          invalidate();emitPhase('stopping')
          for(const waiter of [...waiters])waiter.reject(stopped())
        }
      },
      file:event=>{
        if(event.runId!==runId||phase==='stopped')return
        if(event.file)publishFiles([event.file])
        if(phase==='stopping')return
        if(event.event==='file_chooser_opened'&&phase==='running'){filePicking=true;emitPhase('handoff')}
        if(filePicking&&['file_chooser_completed','file_chooser_cancelled','file_chooser_failed'].includes(event.event)){
          filePicking=false
          if(phase==='handoff')ready()
        }
      },
    })
    await subscription
  }
  const waitUntilReady=async(waitSignal:AbortSignal=signal)=>{
    assertActive()
    if(waitSignal.aborted)throw stopped()
    if(phase==='running')return
    await new Promise<void>((resolve,reject)=>{
      const waiter={resolve:()=>{cleanup();resolve()},reject:(error:Error)=>{cleanup();reject(error)}}
      const abort=()=>waiter.reject(stopped())
      const cleanup=()=>{waiters.delete(waiter);waitSignal.removeEventListener('abort',abort)}
      waiters.add(waiter);waitSignal.addEventListener('abort',abort,{once:true})
    })
    assertActive()
  }
  const exposePage=async(tabId:number|undefined,choosingFiles=false)=>{
    if(!options.onExposePage)return
    const version=contextVersion
    await options.onExposePage()
    // React committing a minimized sheet is not the native layout acknowledgment.
    // Wait for the actual WebView bounds before sending coordinates or opening a picker.
    const deadline=Date.now()+5000
    do{
      assertActive()
      if(version!==contextVersion||phase!=='running'&&!(choosingFiles&&phase==='handoff'))throw new Error('网页控制状态已变化，请重新观察后继续')
      const current=await bridge.state()
      assertActive()
      if(version!==contextVersion||phase!=='running'&&!(choosingFiles&&phase==='handoff'))throw new Error('网页控制状态已变化，请重新观察后继续')
      if(current.state.tabId!==tabId)throw new Error('标签页已变化，请重新观察')
      const view=current.state.agentViewport
      if(!view)throw new Error('浏览器未提供可见区域，请更新应用后继续')
      const rect=view.visibleRect
      if(view.visible&&!view.occluded&&!view.layoutPending&&view.width>0&&view.height>0&&rect.left===0&&rect.top===0&&rect.right===view.width&&rect.bottom===view.height)return
      await delay(50,signal)
    }while(Date.now()<deadline)
    throw new Error('网页尚未完整显示，请收起面板后重试')
  }
  const native=async(args:AgentOperation):Promise<Record<string,unknown>>=>{
    if(phase==='pausing'||phase==='paused'||(phase==='handoff'&&args.action!=='choose_files'))await waitUntilReady(signal)
    assertActive()
    const pageAtDispatch=lastPage
    try{
      if(['screenshot','click','type','choose','submit','scroll','tap','gesture','key','choose_files'].includes(args.action))await exposePage(args.tabId,args.action==='choose_files')
      const result=await bridge.action({...args,runId,requestId:id()})
      if(signal.aborted||phase==='stopping'||phase==='stopped')throw Object.assign(stopped(),{dispatched:result.dispatched===true})
      if(typeof result.error==='string')throw Object.assign(new Error(result.error),{code:result.code,dispatched:result.dispatched,requiresScreenshot:result.requiresScreenshot})
      actionContexts.set(result,pageAtDispatch)
      return result
    }catch(error){
      throw Object.assign(error instanceof Error?error:new Error(String(error)),{pageAtDispatch})
    }
  }
  const startNative=async()=>{
    assertActive()
    if(started)return
    await listen();assertActive()
    if(!nativeStarting)nativeStarting=bridge.session('start',runId).then(result=>{started=true;return result})
    await nativeStarting
    assertActive()
    // A pause can be requested while the native start acknowledgment is still in flight.
    if(phase==='pausing'||phase==='paused'||phase==='handoff')await bridge.session('pause',runId)
  }
  const observe=async(wait=false):Promise<{page:AgentObservation|null;tabs:Awaited<ReturnType<typeof browserAgentState>>['tabs']}>=>{
    const deadline=Date.now()+(wait?25000:0)
    do {
      assertActive()
      const current=await bridge.state()
      assertActive()
      if(!current.state.tabId){invalidate();return {page:null,tabs:current.tabs}}
      if(current.state.error)throw new Error(current.state.error)
      if(!current.state.loading){
        await startNative()
        const raw=await native({action:'observe',tabId:current.state.tabId}) as unknown as AgentObservation
        lastPage=normalizeAgentObservation({...raw,tabId:current.state.tabId})
        contextVersion++
        lastShot=null
        return {page:lastPage,tabs:current.tabs}
      }
      if(!wait)throw new Error('网页正在加载，请等待页面变化')
      await delay(250,signal)
    }while(Date.now()<deadline)
    throw new Error('网页加载超时，结果尚未确认')
  }
  const requirePage=async()=>{
    if(!lastPage)await observe(true)
    if(!lastPage)throw new Error('当前没有网页，请先搜索或打开网址')
    return lastPage
  }
  const element=(args:AgentToolArguments,page:AgentObservation)=>{
    if(!Number.isInteger(args.id))throw new Error('无效元素编号，请重新观察')
    const found=page.elements.find(item=>item.id===args.id)
    if(!found)throw new Error('元素不存在，请重新观察网页')
    return found
  }
  const requestApproval=async(tool:AgentToolName,reason:string,target?:AgentElement)=>{
    const sourceUrl=target?.frameUrl||lastPage?.url
    const fingerprint=tool+'|'+(sourceUrl||'')+'|'+(target?.text||reason)
    if(denied.has(fingerprint))throw new Error('你已拒绝该操作，本任务不会再次尝试')
    const approved=await options.onApproval({id:id(),reason,tool,tabId:lastPage?.tabId,url:sourceUrl,target:target?.text},signal)
    assertActive()
    if(!approved){denied.add(fingerprint);throw new Error('你已拒绝该操作')}
  }
  const bound=(page:AgentObservation,target?:AgentElement):Partial<AgentOperation>=>({tabId:page.tabId,documentId:page.documentId,
    frameId:target?.frameId,frameDocumentId:target?.frameDocumentId,snapshot:target?.frameSnapshot||page.snapshot,id:target?.localId})
  const finishAction=async(operation:Record<string,unknown>,fingerprint:string):Promise<AgentToolResult>=>{
    const source=actionContexts.get(operation)||lastPage
    lastShot=null
    try{return {result:{operation,outcome:'executed',observation:await observe(true)}}}
    catch(error){
      if(signal.aborted||phase==='stopping'||phase==='stopped')throw stopped()
      uncertain.add(fingerprint)
      unresolvedDocuments.add(documentKey(source))
      return {result:{operation,outcome:'unknown',observationError:error instanceof Error?error.message:String(error),nextAction:'先观察或人工确认结果，禁止重放相同操作'}}
    }
  }
  const pause=():Promise<void>=>{
    const job=control.then(async()=>{
      assertActive()
      if(phase==='paused'||phase==='handoff')return
      emitPhase('pausing')
      await nativeStarting
      assertActive()
      if(started)await bridge.session('pause',runId)
      assertActive();invalidate();emitPhase('paused')
    })
    control=job.catch(()=>{})
    return job
  }
  const resume=():Promise<void>=>{
    const job=control.then(async()=>{
      assertActive()
      if(phase==='running')return
      emitPhase('resuming')
      if(started)await bridge.session('resume',runId)
      assertActive();invalidate()
      try{if(started)await observe(false)}catch(error){if(signal.aborted)throw error}
      assertActive();ready()
    })
    control=job.catch(()=>{})
    return job
  }
  const stop=():Promise<void>=>{
    if(stopPromise)return stopPromise
    emitPhase('stopping')
    for(const waiter of [...waiters])waiter.reject(stopped())
    stopPromise=(async()=>{
      await control.catch(()=>{})
      await initialNavigation?.catch(()=>{})
      await nativeStarting?.catch(()=>{})
      // The native stop ACK is the ownership boundary. Never report stopped earlier.
      if(started)await bridge.session('stop',runId)
      invalidate();emitPhase('stopped')
      const unsubscribe=await subscription?.catch(()=>null)
      if(unsubscribe)await unsubscribe().catch(()=>{})
    })().catch(error=>{stopPromise=null;throw error})
    return stopPromise
  }
  const handoff=async(kind:AgentHandoff['kind'],reason:string):Promise<AgentToolResult>=>{
    const current=lastPage
    await pause();emitPhase('handoff')
    const response=await options.onHandoff({id:id(),kind,reason,tabId:current?.tabId,url:current?.url,title:current?.title},signal)
    assertActive()
    if(response!=='continue'){await stop();throw stopped()}
    await resume()
    // This explicit handoff returns control only after the user has inspected the uncertain result.
    uncertain.clear();unresolvedDocuments.clear()
    return {result:{resumed:true,observation:await observe(true)}}
  }
  const files=async():Promise<AgentArtifact[]>=>{
    const page=await requirePage()
    const result=await native({action:'files',...bound(page)})
    const items=Array.isArray(result.files)?result.files as unknown as AgentArtifact[]:[]
    publishFiles(items,true)
    return items
  }
  const operate=async(name:AgentToolName,args:AgentToolArguments,expectedContextVersion?:number):Promise<AgentToolResult>=>{
    await waitUntilReady(signal)
    if(expectedContextVersion!==undefined&&expectedContextVersion!==contextVersion)throw new Error('模型依据的网页或文件状态已变化，请根据新观察重新决定')
    let fingerprint=fingerprintFor(name,args)
    if(uncertain.has(fingerprint))throw new Error('上次操作已经发出但结果未确认，请观察或人工确认，不能重复执行')
    if(name==='browser_config'){
      if(!options.onBrowserConfig)throw new Error('浏览器配置管理尚未就绪')
      const result=await options.onBrowserConfig(args,signal)
      if(args.action==='apply'){
        invalidate()
        // A configuration write changes app state, not necessarily the current page.
        // Do not attempt a DOM read here; script changes may reload the WebView.
      }
      return {result}
    }
    if(name==='browser_observe')return {result:await observe()}
    if(name==='browser_tabs')return {result:await bridge.state()}
    if(name==='browser_request_handoff')return handoff(args.kind as AgentHandoff['kind'],text(args.reason))
    if(name==='browser_search'||name==='browser_open_url'||name==='browser_new_tab'){
      const query=name==='browser_search'?text(args.query):''
      const target=url(name==='browser_search'?options.searchUrl(query):args.url)
      if(!started){
        const current=await bridge.state()
        if(current.state.tabId)await startNative()
        else {
          assertActive()
          initialNavigation=name==='browser_search'?options.onSearch(query):options.onNavigate(target)
          const opened=await initialNavigation
          initialNavigation=null;assertActive()
          if(!opened)throw new Error('网页打开失败')
          await startNative();invalidate()
          return {result:{url:target,observation:await observe(true)}}
        }
      }
      const current=await bridge.state()
      const source=await requirePage()
      if(source.tabId!==current.state.tabId)throw new Error('标签页已变化，请重新观察')
      const operation=await native({action:name==='browser_new_tab'?'new_tab':'navigate',...bound(source),url:target})
      invalidate();return finishAction(operation,fingerprint)
    }
    if(name==='browser_wait'){
      const timeout=args.timeoutMs==null?10000:Number(args.timeoutMs)
      if(!Number.isInteger(timeout)||timeout<0||timeout>30000)throw new Error('等待时间必须在0到30000毫秒之间')
      const wanted=args.text==null?'':text(args.text),urlPart=args.urlContains==null?'':text(args.urlContains)
      if(!wanted&&!urlPart){
        await delay(timeout,signal)
        await waitUntilReady(signal)
        return {result:await observe(true)}
      }
      const deadline=Date.now()+timeout
      let observation:Awaited<ReturnType<typeof observe>>|undefined
      let observationError:string|undefined
      do{
        await waitUntilReady(signal)
        try{observation=await observe(false);observationError=undefined}catch(error){if(signal.aborted)throw error;observation=undefined;observationError=agentStepError(error)}
        if(observation?.page && (!wanted||observation.page.text.includes(wanted))&&(!urlPart||observation.page.url.includes(urlPart)))return {result:observation}
        if(Date.now()>=deadline)break
        await delay(Math.min(350,Math.max(0,deadline-Date.now())),signal)
      }while(Date.now()<=deadline)
      return {result:{matched:false,observation,observationError,message:'等待 '+timeout+' 毫秒后，条件尚未满足'}}
    }
    if(!lastPage&&(['browser_click','browser_type','browser_choose','browser_submit','browser_upload_files'].includes(name)||name==='browser_scroll'&&args.id!=null))throw new Error('请先观察网页，获得当前元素编号后再操作')
    const page=await requirePage()
    fingerprint=fingerprintFor(name,args,page)
    if(uncertain.has(fingerprint))throw new Error('上次操作已经发出但结果未确认，请观察或人工确认，不能重复执行')
    if(unresolvedDocuments.size>0&&['browser_click','browser_type','browser_choose','browser_submit','browser_tap','browser_gesture','browser_touch','browser_key','browser_upload_files'].includes(name))
      throw new Error('上次操作结果未确认。可读取、等待或滚动检查；须人工接管确认后才能继续更改页面，不能通过换页或其他工具重放')
    if(name==='browser_files')return {result:{files:await files()}}
    if(name==='browser_read_file'){
      const pageIndex=args.page==null?0:Number(args.page)
      const maxBytes=args.maxBytes==null?65536:Number(args.maxBytes)
      if(!Number.isInteger(pageIndex)||pageIndex<0||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>262144)throw new Error('文件页码或读取大小无效')
      const result=await native({action:'read_file',...bound(page),fileId:text(args.fileId),maxBytes,page:pageIndex})
      if(typeof result.image==='string'){
        lastShot=null
        const {image,...metadata}=result
        return {result:metadata,fileImage:{...metadata,image} as unknown as AgentFileImage}
      }
      return {result}
    }
    if(name==='browser_cancel_download'){
      await requestApproval(name,'取消这项文件下载')
      const result=await native({action:'files',...bound(page),cancelFileId:text(args.fileId)})
      await files();return {result}
    }
    if(name==='browser_back'||name==='browser_forward'){
      const operation=await native({action:name==='browser_back'?'back':'forward',...bound(page)})
      invalidate();return finishAction(operation,fingerprint)
    }
    if(name==='browser_switch_tab'||name==='browser_close_tab'){
      const current=await bridge.state()
      const tab=typeof args.tabId==='number'?current.tabs.find(item=>item.id===args.tabId):current.tabs.find(item=>item.index===args.index)
      if(!tab)throw new Error('标签页已不存在，请重新查看标签页')
      if(name==='browser_close_tab')await requestApproval(name,'关闭标签页：'+tab.title)
      const operation=await native({action:name==='browser_close_tab'?'close_tab':'switch_tab',...bound(page),targetTabId:tab.id})
      invalidate();return finishAction(operation,fingerprint)
    }
    if(name==='browser_screenshot'){
      const shot=await native({action:'screenshot',...bound(page)}) as unknown as AgentScreenshot
      if(!shot.image||!(shot.width>0&&shot.height>0&&shot.viewWidth>0&&shot.viewHeight>0)||!shot.shotId)throw new Error('浏览器截图无效或缺少画面标识')
      lastShot=shot
      return {result:{width:shot.width,height:shot.height,url:page.url,shotId:shot.shotId},screenshot:shot}
    }
    if(name==='browser_touch'){
      const shot=lastShot
      if(!shot)throw new Error('请先获取当前页面截图')
      if(!Array.isArray(args.contacts)||args.contacts.length<1||args.contacts.length>5)throw new Error('多点触控需要1至5个触点')
      const ids=new Set<number>()
      let endTime:number|undefined
      const contacts=args.contacts.map(contact=>{
        if(!contact||!Number.isInteger(contact.id)||contact.id<0||contact.id>4||ids.has(contact.id)||!Array.isArray(contact.points)||contact.points.length<2||contact.points.length>128)throw new Error('触点编号或轨迹无效')
        ids.add(contact.id)
        let previous=-1
        const points=contact.points.map((point:{x:unknown;y:unknown;timeMs:unknown},index:number)=>{
          if(!point||typeof point.x!=='number'||typeof point.y!=='number'||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0||point.x>=shot.width||point.y>=shot.height
            ||typeof point.timeMs!=='number'||!Number.isInteger(point.timeMs)||point.timeMs<=previous||point.timeMs>5000||(index===0&&point.timeMs!==0))throw new Error('触控坐标或时间超出范围')
          previous=point.timeMs
          return {x:point.x*shot.viewWidth/shot.width,y:point.y*shot.viewHeight/shot.height,timeMs:point.timeMs}
        })
        if(previous<16||(endTime!=null&&previous!==endTime))throw new Error('所有触点须在相同时间结束，时长至少16毫秒')
        endTime=previous
        return {id:contact.id,points}
      })
      await requestApproval(name,'在当前网页执行多点触控')
      lastShot=null
      return finishAction(await native({action:'gesture',...bound(page),shotId:shot.shotId,gesture:{kind:'touch',contacts}}),fingerprint)
    }
    if(name==='browser_tap'||name==='browser_gesture'){
      const shot=lastShot
      if(!shot)throw new Error('请先获取当前页面截图')
      const points=name==='browser_tap'?[{x:args.x,y:args.y}]:args.points
      if(!Array.isArray(points)||points.length<1||points.length>128)throw new Error('手势需要1至128个有效坐标点')
      const converted=points.map(point=>{
        if(!point||typeof point.x!=='number'||typeof point.y!=='number'||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0||point.x>=shot.width||point.y>=shot.height)throw new Error('手势坐标超出截图范围')
        return {x:point.x*shot.viewWidth/shot.width,y:point.y*shot.viewHeight/shot.height}
      })
      await requestApproval(name,name==='browser_tap'?'点击当前网页画面中的指定位置':'在当前网页执行'+String(args.kind)+'手势')
      const kind=name==='browser_tap'?'tap':text(args.kind)
      if((kind==='tap'||kind==='long_press')&&converted.length!==1||kind==='pinch'&&converted.length!==2||(['swipe','drag'].includes(kind)&&converted.length<2))throw new Error('手势坐标点数量不匹配')
      const duration=args.durationMs==null?(kind==='long_press'?700:500):Number(args.durationMs)
      if(!Number.isInteger(duration)||duration<50||duration>5000)throw new Error('手势时长必须在50到5000毫秒之间')
      const scale=args.scale==null?1.5:Number(args.scale)
      if(!Number.isFinite(scale)||scale<.2||scale>5)throw new Error('缩放倍数必须在0.2到5之间')
      const holdMs=args.holdMs==null?120:Number(args.holdMs)
      if(!Number.isInteger(holdMs)||holdMs<0||holdMs>1000)throw new Error('拖动前长按时间必须在0到1000毫秒之间')
      lastShot=null
      const operation=await native({action:'gesture',...bound(page),shotId:shot.shotId,gesture:{kind,points:converted,durationMs:duration,scale,holdMs}})
      return finishAction(operation,fingerprint)
    }
    if(name==='browser_key'){
      if(['Enter','Backspace','Delete'].includes(text(args.key)))await requestApproval(name,'向当前网页发送 '+String(args.key)+' 按键')
      const operation=await native({action:'key',...bound(page),key:text(args.key)})
      return finishAction(operation,fingerprint)
    }
    const target=name==='browser_scroll'&&args.id==null?undefined:element(args,page)
    if(target?.protected)return handoff('login','此输入需要你在网页中手动完成')
    if(target?.disabled||target?.readOnly&&name==='browser_type')throw new Error('目标已禁用或只读')
    if(name==='browser_upload_files'){
      if(target?.type!=='file')throw new Error('目标不是文件上传输入框，请重新观察')
      if(target.frameId&&target.frameId!==page.frameId)
        return handoff('file_picker','请在网页的框架上传控件中选择文件。来源：'+(target.frameUrl||page.url))
      const selected=args.fileIds==null?undefined:args.fileIds
      if(selected!==undefined&&(!Array.isArray(selected)||selected.length<1||selected.length>12||selected.some(item=>typeof item!=='string'||!item)))throw new Error('文件编号无效，一次最多选择12个文件')
      await requestApproval(name,'向 '+new URL(target.frameUrl||page.url).host+' 上传文件',target)
      if(!selected){filePicking=true;emitPhase('handoff')}
      try{
        const picked=await native({action:'choose_files',...bound(page,target),fileIds:selected as string[]|undefined,multiple:target.multiple===true,acceptTypes:target.accept?.split(',').map(value=>value.trim()).filter(Boolean)})
        if(Array.isArray(picked.files))publishFiles(picked.files as unknown as AgentArtifact[])
        if(picked.cancelled===true||picked.armed!==true)throw new Error('文件选择已取消，未上传文件')
      }finally{filePicking=false;if(!signal.aborted&&phase==='handoff')ready()}
      const operation=await native({action:'click',...bound(page,target)})
      return finishAction(operation,fingerprint)
    }
    const action=name.slice('browser_'.length) as 'click'|'type'|'choose'|'submit'|'scroll'
    if(!['click','type','choose','submit','scroll'].includes(action))throw new Error('不支持的浏览器操作')
    if(action==='click'||action==='submit'){
      const reason=agentApprovalReason({action,id:target?.id},page)
      if(reason)await requestApproval(name,reason,target)
    }
    const operation=await native({action,...bound(page,target),text:action==='type'||action==='choose'?text(args.text,true):undefined,
      direction:action==='scroll'?(typeof args.direction==='string'?args.direction:'down'):undefined})
    return finishAction(operation,fingerprint)
  }
  return {
    start:async()=>{assertActive();await listen();assertActive();const current=await bridge.state();if(current.state.tabId)await startNative();assertActive();if(phase==='running')emitPhase('running');return {...current,runId}},
    pause,resume,stop,waitUntilReady,
    contextVersion:()=>contextVersion,
    readContext:async()=>({...await observe(true),files:[...artifacts.values()],contextVersion}),
    prepareFinish:async()=>{
      await waitUntilReady(signal)
      if(unresolvedDocuments.size>0)return {ready:false,reason:'有已发出但结果未确认的操作。先读取现状并请求人工确认；确认之前不能宣布任务完成。',context:{outcome:'unknown'}}
      const pending=[...artifacts.values()].filter(item=>item.status==='downloading'||item.status==='paused')
      if(!pending.length)return {ready:true}
      const latest=await files()
      return {ready:!latest.some(item=>item.status==='downloading'||item.status==='paused'),context:{files:latest}}
    },
    performTool:async(name,args,_signal,expectedContextVersion)=>{
      await waitUntilReady(signal)
      const startingVersion=contextVersion
      const step:AgentStep={id:id(),tool:name,label:AGENT_TOOL_LABELS[name],status:'running',input:agentStepData(args)}
      options.onStep?.(step)
      try{
        const result=await operate(name,args,expectedContextVersion)
        assertActive()
        const capturedVersion=contextVersion
        const data=result.result as Record<string,unknown>|null
        const captured:AgentToolResult={...result,contextVersion:capturedVersion,
          context:startingVersion===capturedVersion?undefined:{...(data&&(data.page||data.observation)?{}:{page:lastPage}),files:[...artifacts.values()]}}
        const outcome=(result.result as {outcome?:AgentStep['outcome']}|null)?.outcome
        const failed=outcome==='unknown'||data?.matched===false||data?.ok===false
        const detail=outcome==='unknown'?['操作已发出，结果待确认',data?.observationError].filter(Boolean).join('\n'):
          failed?[data?.message||data?.error||'工具未完成请求',data?.observationError].filter(Boolean).join('\n'):undefined
        options.onStep?.({...step,status:failed?'failed':'succeeded',outcome,detail,result:agentStepData(result.result)})
        return captured
      }catch(error){
        if(!signal.aborted&&phase!=='stopping'&&phase!=='stopped'&&(error as {dispatched?:unknown})?.dispatched===true){
          const attempted=(error as {pageAtDispatch?:AgentObservation|null}).pageAtDispatch||lastPage
          uncertain.add(fingerprintFor(name,args,attempted));unresolvedDocuments.add(documentKey(attempted));invalidate()
          const detail=agentStepError(error)
          options.onStep?.({...step,status:'failed',outcome:'unknown',detail:'操作已发出，结果待确认：'+detail})
          return {result:{outcome:'unknown',observationError:detail,nextAction:'先观察或人工确认结果，禁止重放相同操作'}}
        }
        const dispatched=(error as {dispatched?:unknown})?.dispatched===true
        options.onStep?.({...step,status:signal.aborted||phase!=='running'?'cancelled':'failed',outcome:dispatched?'unknown':'not_executed',detail:(dispatched?'已停止，操作结果待确认\n':'')+agentStepError(error)})
        throw error
      }
    },
  }
}
