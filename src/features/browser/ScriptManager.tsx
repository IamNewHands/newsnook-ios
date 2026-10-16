import { useRef, useState } from 'react'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Check, FileUp, Globe2, Plus, ShieldAlert, ShieldCheck, Trash2, X } from 'lucide-react'
import { installUserScript, loadUserScripts, saveUserScripts, type UserScript } from './scripts'

interface Props { onClose: () => void; onChanged: () => void }
const risky = ['unsafeWindow', 'GM_xmlhttpRequest', 'GM.xmlHttpRequest', 'GM_download', 'GM.download', 'GM_cookie', 'GM.webRequest']
export function ScriptManager({ onClose, onChanged }: Props) {
  const [scripts, setScripts] = useState(loadUserScripts)
  const [source, setSource] = useState('')
  const [editing, setEditing] = useState<UserScript | null>(null)
  const [candidate, setCandidate] = useState<UserScript | null>(null)
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const update = (next: UserScript[]) => {
    try { saveUserScripts(next); setScripts(next); onChanged(); setMessage('') }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : '脚本保存失败') }
  }
  const install = () => {
    try { setCandidate(installUserScript(source, editing ?? undefined)); setMessage('') }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : '脚本无效') }
  }
  const approve = () => {
    if (!candidate) return
    const next = editing ? scripts.map(s => s.id === editing.id ? candidate : s) : [...scripts, candidate]
    try {
      saveUserScripts(next); setScripts(next); onChanged(); setMessage(''); setCandidate(null); setEditing(null); setSource('')
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '脚本保存失败') }
  }
  const importUrl = async () => {
    if (importing) return
    setImporting(true); setMessage('')
    try {
      const target = new URL(url.trim())
      if (target.protocol !== 'https:' || target.username || target.password) throw new Error('只允许 HTTPS 脚本地址')
      let text: string
      if (Capacitor.getPlatform() === 'android') {
        const response = await CapacitorHttp.get({ url: target.href, responseType: 'text', readTimeout: 25000 })
        if (response.status < 200 || response.status >= 300) throw new Error(`下载失败：HTTP ${response.status}`)
        if (typeof response.data !== 'string') throw new Error('下载内容不是 JavaScript 文本')
        text = response.data
      } else {
        const response = await fetch(target.href)
        if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)
        text = await response.text()
      }
      if (text.length > 400_000) throw new Error('脚本不能超过 400 KB')
      const script = installUserScript(text)
      setSource(text); setCandidate(script); setEditing(null)
    } catch (cause) {setMessage(cause instanceof Error ? cause.message : '无法导入脚本')}
    finally { setImporting(false) }
  }
  const dangerous = candidate?.grants.filter(grant => risky.includes(grant)) ?? []
  return <div className="fixed inset-0 z-[99] flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose} role="presentation">
    <section role="dialog" aria-modal="true" aria-label="用户脚本管理" onClick={event => event.stopPropagation()}
      className="relative flex max-h-[93vh] w-full max-w-xl flex-col rounded-t-3xl border border-haze bg-ink-raised px-4 pt-5 pb-5 shadow-xl sm:rounded-2xl sm:px-6">
      <header className="flex items-center justify-between gap-3 border-b border-haze pb-4"><div><span className="font-mono text-[10px] tracking-[0.18em] text-cinnabar">USER SCRIPTS</span>
        <h2 className="mt-1 font-display text-[23px] text-paper">用户脚本</h2><p className="mt-1 text-xs text-paper-muted">脚本存储于本机，按网站规则运行</p></div>
        <button aria-label="关闭" type="button" onClick={onClose} className="flex size-9 items-center justify-center rounded-full text-paper-muted hover:bg-haze"><X size={20}/></button>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-4">
        {scripts.length === 0 && <div className="py-8 text-center text-sm text-paper-muted">尚未安装用户脚本</div>}
        {scripts.map(script => <div key={script.id} className="flex items-center gap-3 rounded-xl border border-haze bg-ink p-3">
          <button type="button" role="switch" aria-checked={script.enabled} aria-label={`启用 ${script.name}`}
            onClick={() => update(scripts.map(s => s.id === script.id ? { ...s, enabled: !s.enabled } : s))}
            className={`h-6 w-11 shrink-0 rounded-full p-1 transition-colors ${script.enabled ? 'bg-cinnabar' : 'bg-haze'}`}><span className={`block size-4 rounded-full bg-white transition-transform ${script.enabled ? 'translate-x-5' : ''}`} /></button>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => {setEditing(script);setSource(script.source);setCandidate(null);setMessage('')}}>
            <span className="block truncate text-[13px] font-semibold text-paper">{script.name}</span>
            <span className="mt-1 block truncate font-mono text-[10px] text-paper-faint">v{script.version} · {script.matches[0] || script.includes[0]}</span>
          </button>
          <button type="button" aria-label={`删除 ${script.name}`} onClick={() => { if(window.confirm(`删除脚本「${script.name}」？`)) update(scripts.filter(s => s.id !== script.id)) }}><Trash2 size={17} className="text-paper-muted" /></button>
        </div>)}
        <div className="pt-4"><h3 className="text-sm font-semibold text-paper">{editing ? '编辑脚本' : '安装用户脚本'}</h3>
          {!editing && <div className="mt-3 flex gap-2"><input type="url" autoCapitalize="none" aria-label="脚本网址" placeholder="https://.../script.user.js" value={url} onChange={event => setUrl(event.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-haze bg-ink px-3 py-2 font-mono text-xs text-paper outline-none focus:border-cinnabar/60" />
            <button type="button" disabled={importing || !url.trim()} onClick={() => void importUrl()} className="flex shrink-0 items-center gap-1 rounded-xl border border-haze px-3 text-xs text-paper disabled:opacity-40"><Globe2 size={15}/>{importing ? '下载中' : '从网址导入'}</button></div>}
          <label htmlFor="userscript-source" className="mt-4 mb-1.5 block text-xs text-paper-muted">.user.js 源代码</label>
          <textarea id="userscript-source" rows={7} value={source} onChange={event => {setSource(event.target.value);setCandidate(null)}} spellCheck={false}
            className="w-full rounded-xl border border-haze bg-ink p-3 font-mono text-[11px] leading-relaxed text-paper outline-none focus:border-cinnabar/60" placeholder="// ==UserScript==" />
          {message && <p role="alert" className="mt-2 text-xs text-cinnabar">{message}</p>}
          <input ref={file} type="file" accept=".js,.txt,.user.js,text/javascript,text/plain" hidden onChange={async event => {
            const selected = event.target.files?.[0]; if(!selected)return
            if(selected.size>400_000){setMessage('文件不能超过 400 KB');return}
            setSource(await selected.text());setCandidate(null);setMessage('')
            event.target.value=''
          }}/>
          <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={() => file.current?.click()} className="flex items-center gap-2 rounded-xl border border-haze px-4 py-2 text-[12px] text-paper"><FileUp size={16}/> 选择文件</button>
            <button type="button" onClick={install} disabled={!source.trim()} className="flex items-center gap-2 rounded-xl bg-cinnabar px-4 py-2 text-[12px] font-medium text-white disabled:opacity-40">{editing?<Check size={16}/>:<Plus size={16}/>} {editing?'审核修改':'检查并安装'}</button>
            {editing && <button type="button" onClick={()=>{setEditing(null);setSource('');setCandidate(null)}} className="text-[12px] text-paper-muted">取消编辑</button>}</div>
        </div>
      </div>
      {candidate && <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/70 sm:items-center">
        <div role="dialog" aria-modal="true" aria-label="脚本权限确认" className="max-h-full w-full overflow-y-auto rounded-2xl border border-haze bg-ink-raised p-5 shadow-2xl">
          <div className="flex items-center gap-3"><ShieldAlert size={21} className="text-cinnabar"/><div><h3 className="font-semibold text-paper">确认脚本权限</h3><p className="mt-1 text-xs text-paper-muted">{candidate.name} · {candidate.version}</p></div></div>
          <div className="mt-5 space-y-3 text-[12px] text-paper-muted"><div><p className="font-semibold text-paper">运行网站</p><p className="mt-1 break-all font-mono">{[...candidate.matches,...candidate.includes].join('，')}</p></div>
            <div><p className="font-semibold text-paper">GM 权限</p><p className="mt-1 break-all font-mono">{candidate.grants.join('，')||'无'}</p></div>
            {candidate.connects.length>0&&<div><p className="font-semibold text-paper">网络授权</p><p className="mt-1 break-all font-mono">{candidate.connects.join('，')}</p></div>}
            {candidate.requires.length>0&&<div><p className="font-semibold text-paper">外部依赖</p><p className="mt-1 break-all font-mono">{candidate.requires.join('，')}</p></div>}
            {dangerous.length>0&&<p className="rounded-lg border border-cinnabar/40 bg-cinnabar/10 p-3 leading-relaxed text-paper">该脚本包含页面对象访问、网络请求或下载等高级权限。仅安装你信任的来源。</p>}
          </div>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={()=>setCandidate(null)} className="rounded-xl border border-haze px-4 py-3 text-sm text-paper-muted">取消</button><button type="button" onClick={approve} className="rounded-xl bg-cinnabar px-5 py-3 text-sm font-semibold text-white"><ShieldCheck size={16} className="mr-2 inline"/>确认安装</button></div>
        </div>
      </div>}
    </section>
  </div>
}
