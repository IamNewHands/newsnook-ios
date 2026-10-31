const sensitive=/api.?key|authorization|cookie|password|passwd|secret|token|credential/i
const LIMIT=8000

/** Bounded, memory-only diagnostics; exclude credentials and binary payloads. */
export function agentStepData(value:unknown):string {
  const seen=new WeakSet<object>()
  const clean=(item:unknown,depth:number):unknown=>{
    if(typeof item==='string'){
      if(/^data:.*;base64,/i.test(item))return '[图片内容已省略]'
      if(/^https?:\/\//i.test(item)){
        try{
          const url=new URL(item)
          if(url.username)url.username='***'
          if(url.password)url.password='***'
          for(const key of [...url.searchParams.keys()])if(sensitive.test(key))url.searchParams.set(key,'[已隐藏]')
          item=url.href
        }catch{ /* Preserve non-URL text. */ }
      }
      const text=item as string
      return text.length>1600?text.slice(0,1600)+'…（内容已截断）':text
    }
    if(item===null||typeof item!=='object')return item
    if(seen.has(item))return '[重复引用]'
    if(depth>=5)return '[嵌套内容已省略]'
    seen.add(item)
    if(Array.isArray(item))return [...item.slice(0,20).map(entry=>clean(entry,depth+1)),...(item.length>20?['…（其余条目已省略）']:[])]
    return Object.fromEntries(Object.entries(item).slice(0,40).map(([key,entry])=>[
      key,sensitive.test(key)?'[已隐藏]':/^(image|base64|contentHtml)$/i.test(key)?'[内容已省略]':clean(entry,depth+1),
    ]))
  }
  try{
    const text=JSON.stringify(clean(value,0),null,2)??'无返回内容'
    return text.length>LIMIT?text.slice(0,LIMIT-12)+'…（内容已截断）':text
  }catch{return '详情无法转换为文字'}
}

export function agentStepError(error:unknown,depth=0):string {
  const value=error as {message?:unknown;code?:unknown;cause?:unknown}|null
  const message=typeof value?.message==='string'?value.message:String(error)
  const code=typeof value?.code==='string'||typeof value?.code==='number'?'\n错误代码：'+value.code:''
  const cause=depth<2&&value?.cause&&value.cause!==error?'\n原因：'+agentStepError(value.cause,depth+1):''
  return (message+code+cause).slice(0,8000)
}
