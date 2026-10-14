import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { registerHardwareBackLayer } from '../../lib/hardwareBackStack'
import { BookOpen, Bookmark, ChevronLeft, Copy, Maximize2, Minimize2, Settings2, X } from 'lucide-react'
import { readWikiLibrary, rememberWikiEntry, removeWikiBookmark, wikiEntryIdentity } from './library'
import {
  encyclopediaProviders, getEncyclopediaProvider, loadWikiSettings,
  lookupEncyclopedia, saveWikiSettings,
  type WikiEntry, type WikiSettings,
} from './encyclopedia'
import './wiki.css'

interface SelectionInfo { text: string; x: number; y: number }
type View = 'peek' | 'article' | 'settings'
export function WikiSelectionLayer() {
  const [settings, setSettings] = useState<WikiSettings>(loadWikiSettings)
  const [selected, setSelected] = useState<SelectionInfo | null>(null)
  const [view, setView] = useState<View>('peek')
  const [entry, setEntry] = useState<WikiEntry | null>(null)
  const [activeTerm, setActiveTerm] = useState('')
  const [queryProviderId, setQueryProviderId] = useState(settings.providerId)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fullText, setFullText] = useState<string | null>(null)
  const [fullLoading, setFullLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [trail, setTrail] = useState<WikiEntry[]>([])
  const [peekText, setPeekText] = useState('')
  const [history, setHistory] = useState(() => readWikiLibrary('history'))
  const [bookmarks, setBookmarks] = useState(() => readWikiLibrary('bookmarks'))
  const [settingsReturn, setSettingsReturn] = useState<View>('peek')
  const requestRef = useRef<AbortController | null>(null)
  const fullRef = useRef<AbortController | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const updateSettings = (patch: Partial<WikiSettings>) => {
    setSettings(old => {
      const next = { ...old, ...patch }
      saveWikiSettings(next)
      return next
    })
  }
  const dismiss = useCallback(() => {
    requestRef.current?.abort()
    fullRef.current?.abort()
    setSelected(null)
    setView('peek')
    setEntry(null)
    setActiveTerm('')
    setTrail([])
    setFullText(null)
    setError('')
    setLoading(false)
    setFullLoading(false)
    setExpanded(false)
    setPeekText('')
  }, [])
  const lookup = useCallback(async (term: string, override?: string, nest = false) => {
    requestRef.current?.abort()
    fullRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    if (!nest) setTrail([])
    else if (entry) setTrail(old => [...old, entry])
    setActiveTerm(term)
    setQueryProviderId(override || settingsRef.current.providerId)
    setView('article')
    setEntry(null)
    setError('')
    setLoading(true)
    setFullText(null)
    setFullLoading(false)
    try {
      const result = await lookupEncyclopedia(term, settingsRef.current, controller.signal, override)
      if (!controller.signal.aborted) {
        setEntry(result)
        setHistory(rememberWikiEntry(result, 'history'))
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '查询失败，请稍后重试')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [entry])
  const loadFull = useCallback(async () => {
    if (!entry) return
    if (fullText !== null) { setFullText(null); return }
    fullRef.current?.abort()
    const controller = new AbortController()
    fullRef.current = controller
    setFullLoading(true)
    try {
      const text = await getEncyclopediaProvider(entry.providerId).fullText?.(entry, controller.signal)
      if (!controller.signal.aborted) setFullText(text || entry.summary)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取词条全文')
    } finally {
      if (!controller.signal.aborted) setFullLoading(false)
    }
  }, [entry, fullText])

  const openSettingsView = () => {
    setSettingsReturn(view)
    setView('settings')
  }
  const toggleBookmark = (value: WikiEntry) => {
    const exists = bookmarks.some(item => wikiEntryIdentity(item) === wikiEntryIdentity(value))
    setBookmarks(exists ? removeWikiBookmark(value) : rememberWikiEntry(value, 'bookmarks'))
  }
  useEffect(() => {
    function openSettings() {
      setSelected({ text: '', x: 0, y: 0 })
      setSettingsReturn('peek')
      setExpanded(false)
      setView('settings')
    }
    window.addEventListener('newsnook:open-wiki-settings', openSettings)
    return () => window.removeEventListener('newsnook:open-wiki-settings', openSettings)
  }, [])
  useEffect(() => {
    const onNativeLookup = (event: Event) => {
      const term = (event as CustomEvent<{ text?: string }>).detail?.text?.trim().slice(0, 160)
      if (!settingsRef.current.enabled || !term) return
      setSelected({ text: term, x: window.innerWidth / 2, y: 0 })
      setExpanded(false)
      void lookup(term)
    }
    window.addEventListener('newsnook:wiki-native-lookup', onNativeLookup)
    return () => window.removeEventListener('newsnook:wiki-native-lookup', onNativeLookup)
  }, [lookup])
  useEffect(() => {
    function captureSelection() {
      // Android 使用系统原生选词工具栏「百科」操作，避免双工具栏重叠。
      if (Capacitor.getPlatform() === 'android' || !settingsRef.current.enabled) return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.rangeCount) return
      const term = selection.toString().trim().replace(/\s+/g, ' ')
      if (!term || term.length > 160) return
      const node = selection.anchorNode?.parentElement
      if (!node || node.closest('input, textarea, [contenteditable="true"], button, .wiki-lookup-ui, [role="textbox"]')) return
      // Restrict to actual reading surfaces; never intercept editing or configuration controls.
      if (!node.closest('.reader-prose, .linuxdo-post-prose, .zhihu-prose, .reader-content, .article-body, .post-body, .topic-body, .markdown-body, .cooked')) return
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      const x = Math.min(window.innerWidth - 12, Math.max(12, rect.left + rect.width / 2))
      const y = Math.max(12, rect.top)
      setSelected({ text: term, x, y })
      setEntry(null)
      setPeekText('')
      setView('peek')
    }
    function onPointerUp(event: PointerEvent) {
      if ((event.target as Element)?.closest?.('.wiki-lookup-ui')) return
      window.setTimeout(captureSelection, 40)
    }
    function onTouchEnd(event: TouchEvent) {
      if ((event.target as Element)?.closest?.('.wiki-lookup-ui')) return
      window.setTimeout(captureSelection, 100)
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.shiftKey || event.key === 'Shift') window.setTimeout(captureSelection, 0)
    }
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('touchend', onTouchEnd)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [])
  useEffect(() => {
    if (!selected || view !== 'peek' || !settings.directLookup) return
    void lookup(selected.text)
  }, [selected, view, settings.directLookup, lookup])
  useEffect(() => {
    if (!selected?.text || view !== 'peek' || settings.directLookup) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void lookupEncyclopedia(selected.text, settings, controller.signal)
        .then(result => { if (!controller.signal.aborted) setPeekText(result.summary) })
        .catch(() => { if (!controller.signal.aborted) setPeekText('点击查看百科释义') })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [selected, view, settings])
  const handleBack = useCallback(() => {
    if (view === 'settings' && settingsReturn === 'article' && entry) {
      setView('article')
      return
    }
    if (view === 'article' && trail.length > 0) {
      requestRef.current?.abort()
      fullRef.current?.abort()
      const previous = trail[trail.length - 1]
      setEntry(previous)
      setActiveTerm(previous.query)
      setQueryProviderId(previous.providerId)
      setTrail(old => old.slice(0, -1))
      setError('')
      setLoading(false)
      setFullText(null)
      setFullLoading(false)
      return
    }
    dismiss()
  }, [dismiss, entry, settingsReturn, trail, view])
  useEffect(() => {
    if (!selected) return
    return registerHardwareBackLayer(() => { handleBack(); return true })
  }, [handleBack, selected])
  useEffect(() => {
    if (!selected) return
    function onEscape(event: KeyboardEvent) { if (event.key === 'Escape') handleBack() }
    function onScroll(event: Event) {
      if ((event.target as Element)?.closest?.('.wiki-lookup-ui')) return
      if (view === 'peek') dismiss()
    }
    window.addEventListener('keydown', onEscape)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('keydown', onEscape)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [selected, view, dismiss, handleBack])
  if (!selected) return null
  const activeProvider = getEncyclopediaProvider(queryProviderId)
  return (
    <div className="wiki-lookup-ui" onPointerDown={event => event.stopPropagation()} onTouchStart={event => event.stopPropagation()}>
      {view === 'peek' && (
        <div className="wiki-selection-popover" role="dialog" aria-label="划词操作"
          style={{ left: Math.max(12, Math.min(window.innerWidth - 290, selected.x - 145)), top: Math.max(12, selected.y - 100) }}>
          <button type="button" className="wiki-selection-word" onClick={() => void lookup(selected.text)}>
            <BookOpen size={17} /> <span title={selected.text}>{selected.text}</span> <strong>百科</strong>
          </button>
          <button type="button" aria-label="复制" title="复制" onClick={() => { void navigator.clipboard.writeText(selected.text); dismiss() }}><Copy size={16} /></button>
          <button type="button" title="百科设置" aria-label="设置" onClick={openSettingsView}><Settings2 size={16} /></button>
          <button type="button" aria-label="关闭" onClick={dismiss}><X size={16} /></button>
          <button className="wiki-peek-definition" type="button" title={peekText} onClick={() => void lookup(selected.text)}>{peekText || '正在获取词条摘要…'}</button>
        </div>
      )}
      {view !== 'peek' && (
        <>
          <div className="wiki-sheet-mask" onClick={dismiss} />
          <section className={`wiki-sheet ${expanded ? 'wiki-sheet-expanded' : ''}`} role="dialog" aria-modal="true" aria-label={view === 'settings' ? '百科设置' : '百科词条'}>
            <header className="wiki-sheet-header">
              <div className="wiki-sheet-grabber" onClick={() => setExpanded(x => !x)} />
              <div className="wiki-sheet-header-row">
                {trail.length > 0 && view === 'article' ? <button type="button" aria-label="返回上一词条" onClick={handleBack}><ChevronLeft size={20}/></button> : null}
                <h2>{view === 'settings' ? '划词百科设置' : entry?.title || selected.text}</h2>
                {view === 'article' && <button type="button" aria-label="设置" onClick={openSettingsView}><Settings2 size={18} /></button>}
                <button type="button" aria-label={expanded ? '收起' : '展开'} onClick={() => setExpanded(x => !x)}>{expanded ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}</button>
                <button type="button" aria-label="关闭百科" onClick={dismiss}><X size={20}/></button>
              </div>
            </header>
            {view === 'settings' ? (
              <div className="wiki-sheet-body wiki-settings">
                <label><span>启用划词百科</span><input type="checkbox" checked={settings.enabled} onChange={event => updateSettings({ enabled: event.target.checked })}/></label>
                <label><span>默认百科源</span><select value={settings.providerId} onChange={event => updateSettings({ providerId: event.target.value })}>
                  {encyclopediaProviders().map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                </select></label>
                {Capacitor.getPlatform() !== 'android' && <label><span>选中文字后直接打开词条</span><input type="checkbox" checked={settings.directLookup} onChange={event => updateSettings({ directLookup: event.target.checked })}/></label>}
                <label><span>中文维基未收录时尝试英文维基</span><input type="checkbox" checked={settings.fallbackEnglish} onChange={event => updateSettings({ fallbackEnglish: event.target.checked })}/></label>
                {(bookmarks.length > 0 || history.length > 0) && <div className="wiki-library">
                  {bookmarks.length > 0 && <><h3>收藏词条</h3><div>{bookmarks.map(item => <button type="button" key={wikiEntryIdentity(item)} onClick={() => void lookup(item.query, item.providerId)}>{item.title}</button>)}</div></>}
                  {history.length > 0 && <><h3>最近查询</h3><div>{history.slice(0, 12).map(item => <button type="button" key={wikiEntryIdentity(item)} onClick={() => void lookup(item.query, item.providerId)}>{item.title}</button>)}</div></>}
                </div>}
                <button className="wiki-primary" type="button" onClick={() => { if (settingsReturn === 'article' && (entry || loading)) setView('article'); else dismiss() }}>完成</button>
              </div>
            ) : (
              <>
                <div className="wiki-sheet-body" key={entry?.url || 'loading'}>
                  <p className="wiki-provider-name">{entry ? getEncyclopediaProvider(entry.providerId).name : activeProvider.name}</p>
                  {loading && <p className="wiki-status">正在查询百科…</p>}
                  {error && <div className="wiki-error" role="alert">{error}<button type="button" onClick={() => void lookup(activeTerm || selected.text)}>重试</button></div>}
                  {entry && <>
                    <div className="wiki-entry-heading">
                      <div><h3>{entry.title}</h3>{entry.description && <p>{entry.description}</p>}</div>
                      {entry.thumbnail && <img alt="" loading="lazy" src={entry.thumbnail} />}
                    </div>
                    <p className="wiki-entry-summary">{entry.summary}</p>
                    <button className="wiki-save" type="button" onClick={() => toggleBookmark(entry)}><Bookmark size={16} fill={bookmarks.some(item => wikiEntryIdentity(item) === wikiEntryIdentity(entry)) ? 'currentColor' : 'none'}/>{bookmarks.some(item => wikiEntryIdentity(item) === wikiEntryIdentity(entry)) ? '已收藏' : '收藏词条'}</button>
                    {fullText && <div className="wiki-fulltext">{fullText}</div>}
                    {entry.related.length > 0 && <div className="wiki-related"><h4>相关词条</h4><div>{entry.related.map(term => <button type="button" key={term} onClick={() => void lookup(term, entry.providerId, true)}>{term}</button>)}</div></div>}
                  </>}
                </div>
                <footer className="wiki-sheet-footer">
                  <select aria-label="查询百科源" value={entry?.providerId || queryProviderId} onChange={event => void lookup(activeTerm || selected.text, event.target.value)}>
                    {encyclopediaProviders().map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                  </select>
                  {entry && <>
                    <a href={entry.url} target="_blank" rel="noopener noreferrer">原文</a>
                    <button type="button" onClick={() => void loadFull()} disabled={fullLoading}>{fullLoading ? '加载中' : fullText === null ? '全文' : '摘要'}</button>
                  </>}
                </footer>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
