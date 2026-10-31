import {useMemo, type MouseEvent} from 'react'
import {markdownToSafeHtml} from '../../../lib/markdown'

/** AI results are untrusted. Shared markdown sanitizer strips scripts and unsafe links. */
export function AgentMarkdown({markdown,onNavigate}:{markdown:string;onNavigate:(url:string)=>Promise<boolean>}){
  const html=useMemo(()=>markdownToSafeHtml(markdown),[markdown])
  const onClick=(event:MouseEvent<HTMLElement>)=>{
    const target=event.target
    if(!(target instanceof Element))return
    const link=target.closest('a')
    if(!link)return
    event.preventDefault()
    const href=link.getAttribute('href')
    if(!href)return
    try{
      const url=new URL(href)
      if(url.protocol==='https:'||url.protocol==='http:')void onNavigate(url.href)
    }catch{ /* sanitized content never navigates relative or malformed links */ }
  }
  return <article data-selectable="true" className="agent-markdown" onClick={onClick} dangerouslySetInnerHTML={{__html:html}}/>
}
