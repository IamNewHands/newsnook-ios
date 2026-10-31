import {Capacitor, CapacitorHttp} from '@capacitor/core'
import {MAX_USER_SCRIPT_BYTES} from './scripts'

/** Shared by manual installation and Browser Agent. Downloads remain read-only until permission review. */
export async function downloadUserScriptSource(value:string, signal?:AbortSignal):Promise<string>{
  let url:URL
  try{url=new URL(value.trim())}catch{throw new Error('请输入完整的 HTTPS 脚本地址')}
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('仅支持 HTTPS 脚本地址')
  if(signal?.aborted)throw new DOMException('任务已停止','AbortError')
  const controller=new AbortController()
  let timer:ReturnType<typeof setTimeout>|undefined
  const abort=()=>controller.abort()
  signal?.addEventListener('abort',abort,{once:true})
  try {
    const response=await Promise.race([
      (async()=>{
        if(Capacitor.getPlatform()==='android'){
          const result=await CapacitorHttp.get({url:url.href,responseType:'text',connectTimeout:15000,readTimeout:25000})
          if(result.status<200||result.status>=300)throw new Error('下载失败：HTTP '+result.status)
          if(typeof result.data!=='string')throw new Error('下载内容不是 JavaScript 文本')
          return result.data
        }
        const result=await fetch(url.href,{signal:controller.signal,redirect:'error'})
        if(!result.ok)throw new Error('下载失败：HTTP '+result.status)
        const length=Number(result.headers.get('content-length'))
        if(length>MAX_USER_SCRIPT_BYTES)throw new Error('脚本文件不能超过 400 KB')
        return result.text()
      })(),
      new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>{controller.abort();reject(new Error('脚本下载超时，请检查网络后重试'))},25000)
        controller.signal.addEventListener('abort',()=>reject(new DOMException('任务已停止','AbortError')),{once:true})
      }),
    ])
    if(signal?.aborted)throw new DOMException('任务已停止','AbortError')
    if(new TextEncoder().encode(response).byteLength>MAX_USER_SCRIPT_BYTES)
      throw new Error('脚本文件不能超过 400 KB')
    return response
  }finally{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort()}
}
