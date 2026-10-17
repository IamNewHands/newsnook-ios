import { useEffect, useRef, useState } from 'react'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Check, FileUp, Globe2, LoaderCircle, Plus, ShieldAlert, ShieldCheck, Trash2, X } from 'lucide-react'
import { useHardwareBackLayer } from '../../hooks/useHardwareBackLayer'
import { useBrowserDialogFocus } from './useBrowserDialogFocus'
import { loadUserScripts, MAX_USER_SCRIPT_BYTES, prepareUserScriptInstall, saveUserScripts, type UserScript } from './scripts'

interface Props { onClose: () => void; onChanged: () => void | Promise<void> }
const risky = ['unsafeWindow', 'GM_xmlhttpRequest', 'GM.xmlHttpRequest', 'GM_download', 'GM.download', 'GM_cookie', 'GM.webRequest']
const primaryButton = 'rounded-xl border border-cinnabar/60 bg-cinnabar/15 px-4 py-3 text-sm font-semibold text-cinnabar-soft transition-colors hover:bg-cinnabar/25 disabled:opacity-40'
const secondaryButton = 'rounded-xl border border-haze px-4 py-3 text-sm text-paper-muted hover:bg-haze disabled:opacity-40'

export function ScriptManager({ onClose, onChanged }: Props) {
  const [scripts, setScripts] = useState(loadUserScripts)
  const [source, setSource] = useState('')
  const [editing, setEditing] = useState<UserScript | null>(null)
  const [candidate, setCandidate] = useState<UserScript | null>(null)
  const [deleting, setDeleting] = useState<UserScript | null>(null)
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const importGeneration = useRef(0)
  const syncGeneration = useRef(0)
  const downloadAbort = useRef<AbortController | null>(null)
  const managerDialog = useBrowserDialogFocus<HTMLElement>()
  const permissionDialog = useBrowserDialogFocus<HTMLDivElement>(!!candidate)
  const deletionDialog = useBrowserDialogFocus<HTMLDivElement>(!!deleting)

  useEffect(() => () => {
    importGeneration.current += 1
    syncGeneration.current += 1
    downloadAbort.current?.abort()
  }, [])

  const cancelImport = () => {
    importGeneration.current += 1
    downloadAbort.current?.abort()
    downloadAbort.current = null
    setImporting(false)
  }
  const closeTopLayer = () => {
    if (candidate) { setCandidate(null); setMessage(''); return }
    if (deleting) { setDeleting(null); setMessage(''); return }
    cancelImport()
    onClose()
  }
  useHardwareBackLayer(true, () => { closeTopLayer(); return true })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeTopLayer()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const update = (next: UserScript[], success: string): boolean => {
    setMessage('')
    try { saveUserScripts(next) }
    catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '脚本保存失败，请重试')
      return false
    }
    setScripts(next)
    setStatus(success)
    const generation = ++syncGeneration.current
    const syncFailed = () => {
      if (generation === syncGeneration.current) setMessage('脚本已保存，但浏览器暂未应用更改。请重新进入浏览器后重试。')
    }
    try { void Promise.resolve(onChanged()).catch(syncFailed) }
    catch { syncFailed() }
    return true
  }
  const install = () => {
    try {
      setCandidate(prepareUserScriptInstall(source, scripts, editing ?? undefined))
      setMessage(''); setStatus('')
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '脚本无效') }
  }
  const approve = () => {
    if (!candidate) return
    const replacing = scripts.some(script => script.id === candidate.id)
    const next = replacing ? scripts.map(script => script.id === candidate.id ? candidate : script) : [...scripts, candidate]
    if (update(next, replacing ? '脚本已更新，重新加载网页后生效' : '脚本已安装，重新加载网页后生效')) {
      setCandidate(null); setEditing(null); setSource(''); setUrl('')
    }
  }
  const remove = () => {
    if (!deleting) return
    if (!update(scripts.filter(script => script.id !== deleting.id), '脚本已删除，重新加载网页后生效')) return
    if (editing?.id === deleting.id) { cancelImport(); setEditing(null); setSource('') }
    setDeleting(null)
  }
  const edit = (script: UserScript) => {
    cancelImport()
    setEditing(script); setSource(script.source); setCandidate(null); setMessage(''); setStatus('')
  }
  const importFile = async (selected: File) => {
    cancelImport()
    const generation = importGeneration.current
    setImporting(true); setMessage(''); setStatus(''); setCandidate(null)
    try {
      if (selected.size > MAX_USER_SCRIPT_BYTES) throw new Error('文件不能超过 400 KB')
      const text = await selected.text()
      if (generation !== importGeneration.current) return
      setSource(text)
      setStatus('文件已读取，请检查内容后审核安装')
    } catch (cause) {
      if (generation === importGeneration.current) setMessage(cause instanceof Error ? cause.message : '文件读取失败，请重新选择')
    } finally {
      if (generation === importGeneration.current) setImporting(false)
    }
  }
  const importUrl = async () => {
    if (importing) return
    cancelImport()
    const generation = importGeneration.current
    const controller = new AbortController()
    downloadAbort.current = controller
    setImporting(true); setMessage(''); setStatus(''); setCandidate(null)
    let timeout: ReturnType<typeof window.setTimeout> | undefined
    try {
      let target: URL
      try { target = new URL(url.trim()) }
      catch { throw new Error('请输入完整的 HTTPS 脚本地址') }
      if (target.protocol !== 'https:' || target.username || target.password) throw new Error('只允许 HTTPS 脚本地址')
      const download = async () => {
        if (Capacitor.getPlatform() === 'android') {
          const response = await CapacitorHttp.get({ url: target.href, responseType: 'text', connectTimeout: 15000, readTimeout: 25000 })
          if (response.status < 200 || response.status >= 300) throw new Error(`下载失败：HTTP ${response.status}`)
          if (typeof response.data !== 'string') throw new Error('下载内容不是 JavaScript 文本')
          return response.data
        }
        const response = await fetch(target.href, { signal: controller.signal })
        if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)
        return response.text()
      }
      const text = await Promise.race([
        download(),
        new Promise<never>((_, reject) => {
          timeout = window.setTimeout(() => { controller.abort(); reject(new Error('脚本下载超时，请检查网络后重试')) }, 25000)
        }),
      ])
      if (generation !== importGeneration.current) return
      const script = prepareUserScriptInstall(text, loadUserScripts())
      setSource(text); setCandidate(script); setEditing(null)
    } catch (cause) {
      if (generation === importGeneration.current) setMessage(cause instanceof Error ? cause.message : '无法导入脚本，请检查网络后重试')
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout)
      if (generation === importGeneration.current) { setImporting(false); downloadAbort.current = null }
    }
  }
  const replacing = candidate ? scripts.some(script => script.id === candidate.id) : false
  const dangerous = candidate?.grants.filter(grant => risky.includes(grant)) ?? []
  const runAtLabel = candidate?.runAt === 'document-start' ? '网页开始加载时' : candidate?.runAt === 'document-idle' ? '网页空闲时' : '网页加载完成时'

  return <div className="fixed inset-0 z-[99] flex items-end justify-center bg-ink-deep/80 sm:items-center" onClick={closeTopLayer} role="presentation">
    <section ref={managerDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="用户脚本管理" onClick={event => event.stopPropagation()}
      className="browser-script-manager relative flex w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-haze bg-ink-raised px-4 pt-5 shadow-xl outline-none sm:rounded-2xl sm:px-6">
      <header className="flex items-center justify-between gap-3 border-b border-haze pb-4">
        <div><h2 className="font-display text-[23px] text-paper">用户脚本</h2><p className="mt-1 text-xs text-paper-muted">保存在本机，按网站规则运行 · {scripts.length}/128</p></div>
        <button aria-label="关闭脚本管理" type="button" onClick={closeTopLayer} className="flex size-11 shrink-0 items-center justify-center rounded-full text-paper-muted hover:bg-haze"><X size={20}/></button>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-4" inert={!!candidate || !!deleting}>
        {scripts.length === 0 && <div className="rounded-2xl border border-dashed border-haze px-4 py-6 text-center"><ShieldCheck size={26} className="mx-auto text-paper-faint"/><p className="mt-3 text-sm text-paper">尚未安装用户脚本</p><p className="mt-1 text-xs text-paper-muted">从网址、文件或源代码安装</p></div>}
        {scripts.map(script => <div key={script.id} className="flex items-center gap-3 rounded-xl border border-haze bg-ink p-3">
          <button type="button" role="switch" aria-checked={script.enabled} aria-label={`${script.enabled ? '停用' : '启用'} ${script.name}`}
            onClick={() => update(scripts.map(item => item.id === script.id ? { ...item, enabled: !item.enabled } : item), script.enabled ? '脚本已停用，重新加载网页后生效' : '脚本已启用，重新加载网页后生效')}
            className={`flex h-11 w-12 shrink-0 items-center rounded-xl ${script.enabled ? 'text-cinnabar' : 'text-paper-faint'}`}>
            <span className={`block h-6 w-11 rounded-full border p-0.5 ${script.enabled ? 'border-cinnabar/60 bg-cinnabar/20' : 'border-haze bg-haze'}`}><span className={`block size-[18px] rounded-full bg-current transition-transform ${script.enabled ? 'translate-x-5' : ''}`}/></span>
          </button>
          <button type="button" className="min-w-0 flex-1 py-1 text-left" onClick={() => edit(script)}>
            <span className="block truncate text-[13px] font-semibold text-paper">{script.name}</span>
            <span className="mt-1 block truncate font-mono text-[10px] text-paper-faint">v{script.version} · {script.matches[0] || script.includes[0]}</span>
          </button>
          <button type="button" aria-label={`删除 ${script.name}`} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-paper-muted hover:bg-haze" onClick={() => { setDeleting(script); setMessage('') }}><Trash2 size={17}/></button>
        </div>)}
        {status && <p role="status" className="rounded-xl bg-haze/40 p-3 text-xs leading-relaxed text-paper-muted">{status}</p>}
        {!candidate && !deleting && message && <p role="alert" className="rounded-xl border border-cinnabar/30 bg-cinnabar/10 p-3 text-xs leading-relaxed text-cinnabar-soft">{message}</p>}
        <div className="pt-4"><h3 className="text-sm font-semibold text-paper">{editing ? '编辑脚本' : '安装用户脚本'}</h3>
          {!editing && <div className="mt-3 flex gap-2">
            <input type="url" autoCapitalize="none" aria-label="脚本网址" placeholder="https://.../script.user.js" value={url} onChange={event => setUrl(event.target.value)} disabled={importing}
              className="min-w-0 flex-1 rounded-xl border border-haze bg-ink px-3 py-3 font-mono text-xs text-paper outline-none focus:border-cinnabar/60 disabled:opacity-50"/>
            <button type="button" disabled={importing || !url.trim()} onClick={() => void importUrl()} className="flex shrink-0 items-center gap-1 rounded-xl border border-haze px-3 text-xs text-paper disabled:opacity-40">
              {importing ? <LoaderCircle size={15} className="animate-spin"/> : <Globe2 size={15}/>} {importing ? '读取中' : '网址导入'}
            </button>
          </div>}
          {importing && <div role="status" className="mt-3 flex items-center justify-between text-xs text-paper-muted"><span>正在读取脚本…</span><button type="button" onClick={cancelImport} className="px-3 py-2 text-paper">取消读取</button></div>}
          <label htmlFor="userscript-source" className="mt-4 mb-1.5 block text-xs text-paper-muted">.user.js 源代码</label>
          <textarea id="userscript-source" rows={7} value={source} disabled={importing} onChange={event => { setSource(event.target.value); setCandidate(null); setMessage(''); setStatus('') }} spellCheck={false}
            className="w-full rounded-xl border border-haze bg-ink p-3 font-mono text-[11px] leading-relaxed text-paper outline-none focus:border-cinnabar/60 disabled:opacity-50" placeholder="// ==UserScript=="/>
          <input ref={file} type="file" accept=".js,.txt,.user.js,text/javascript,text/plain" hidden onChange={event => {
            const selected = event.target.files?.[0]
            event.target.value = ''
            if (selected) void importFile(selected)
          }}/>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={importing} onClick={() => file.current?.click()} className="flex min-h-11 items-center gap-2 rounded-xl border border-haze px-4 py-2 text-[12px] text-paper disabled:opacity-40"><FileUp size={16}/>选择文件</button>
            <button type="button" onClick={install} disabled={importing || !source.trim()} className={`flex min-h-11 items-center gap-2 ${primaryButton}`}>{editing ? <Check size={16}/> : <Plus size={16}/>} {editing ? '审核修改' : '检查并安装'}</button>
            {editing && <button type="button" onClick={() => { cancelImport(); setEditing(null); setSource(''); setCandidate(null); setMessage('') }} className="min-h-11 px-2 text-[12px] text-paper-muted">取消编辑</button>}
          </div>
        </div>
      </div>
      {candidate && <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink-deep/80 sm:items-center" onClick={() => { setCandidate(null); setMessage('') }}>
        <div ref={permissionDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="脚本权限确认" onClick={event => event.stopPropagation()} className="max-h-full w-full overflow-y-auto rounded-2xl border border-haze bg-ink-raised p-5 shadow-2xl outline-none">
          <div className="flex items-center gap-3"><ShieldAlert size={21} className="shrink-0 text-cinnabar"/><div><h3 className="font-semibold text-paper">{replacing ? '确认更新脚本' : '确认脚本权限'}</h3><p className="mt-1 break-words text-xs text-paper-muted">{candidate.name} · {candidate.version}</p></div></div>
          {replacing && <p className="mt-3 text-xs leading-relaxed text-paper-muted">将替换已安装的同一脚本，并保留当前启用状态。</p>}
          <div className="mt-5 space-y-3 text-[12px] text-paper-muted">
            <div><p className="font-semibold text-paper">运行网站</p><p className="mt-1 break-all font-mono">{[...candidate.matches, ...candidate.includes].join('，')}</p></div>
            {[...candidate.excludes, ...candidate.excludeMatches].length > 0 && <div><p className="font-semibold text-paper">排除网站</p><p className="mt-1 break-all font-mono">{[...candidate.excludes, ...candidate.excludeMatches].join('，')}</p></div>}
            <div><p className="font-semibold text-paper">运行时间</p><p className="mt-1">{runAtLabel}</p></div>
            <div><p className="font-semibold text-paper">GM 权限</p><p className="mt-1 break-all font-mono">{candidate.grants.join('，') || '无'}</p></div>
            {candidate.connects.length > 0 && <div><p className="font-semibold text-paper">网络授权</p><p className="mt-1 break-all font-mono">{candidate.connects.join('，')}</p></div>}
            {candidate.requires.length > 0 && <div><p className="font-semibold text-paper">外部依赖</p><p className="mt-1 break-all font-mono">{candidate.requires.join('，')}</p></div>}
            {dangerous.length > 0 && <p className="rounded-lg border border-cinnabar/40 bg-cinnabar/10 p-3 leading-relaxed text-paper">该脚本包含页面对象访问、网络请求或下载等高级权限。仅安装你信任的来源。</p>}
          </div>
          {message && <p role="alert" className="mt-4 rounded-xl border border-cinnabar/30 bg-cinnabar/10 p-3 text-xs leading-relaxed text-cinnabar-soft">{message}</p>}
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => { setCandidate(null); setMessage('') }} className={secondaryButton}>返回编辑</button><button type="button" onClick={approve} className={primaryButton}><ShieldCheck size={16} className="mr-2 inline"/>{replacing ? '确认更新' : '确认安装'}</button></div>
        </div>
      </div>}
      {deleting && <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink-deep/80 sm:items-center" onClick={() => { setDeleting(null); setMessage('') }}>
        <div ref={deletionDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="删除用户脚本" onClick={event => event.stopPropagation()} className="w-full rounded-2xl border border-haze bg-ink-raised p-5 shadow-2xl outline-none">
          <h3 className="font-semibold text-paper">删除用户脚本</h3><p className="mt-3 break-words text-sm leading-relaxed text-paper-muted">删除「{deleting.name}」？如需再次使用，需要重新安装。</p>
          {message && <p role="alert" className="mt-4 text-xs leading-relaxed text-cinnabar-soft">{message}</p>}
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => { setDeleting(null); setMessage('') }} className={secondaryButton}>取消</button><button type="button" onClick={remove} className={primaryButton}>删除脚本</button></div>
        </div>
      </div>}
    </section>
  </div>
}
