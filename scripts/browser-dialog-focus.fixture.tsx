import React, { StrictMode, useContext, useEffect, useLayoutEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { createRoot } from 'react-dom/client'
import { BrowserSheet } from '../src/features/browser/BrowserPrimitives'
import { BrowserSettingsPanel } from '../src/features/browser/BrowserSettingsPanel'
import { BrowserTabsPanel } from '../src/features/browser/BrowserTabsPanel'
import { BrowserWorkspace } from '../src/features/browser/BrowserWorkspace'
import { BROWSER_KEYS } from '../src/features/browser/browserPreferences'
import { useBrowserDialogFocus } from '../src/features/browser/useBrowserDialogFocus'
import { InkVideoPlayer } from '../src/components/InkVideoPlayer'
import { FloatingVideoProvider } from '../src/features/floatingVideo/FloatingVideoProvider'
import { VideoSessionManagerContext } from '../src/features/floatingVideo/context'
import type { VideoSessionManager } from '../src/features/floatingVideo/session'
import { ScriptManager } from '../src/features/browser/ScriptManager'
import { installUserScript, saveUserScripts } from '../src/features/browser/scripts'

declare global {
  interface Window {
    __focusFixtureReady: boolean
    __dismissDialog: () => void
    __desktopChanges: number
    __videoManager: VideoSessionManager | null
    __openCastForTest: () => void
  }
}

const scenario = new URLSearchParams(location.search).get('case') || 'sheet'
const source = '// ==UserScript==\n// @name Keyboard specimen\n// @version 1.0\n// @match https://example.com/*\n// ==/UserScript==\nvoid 0'
if (scenario === 'scripts') saveUserScripts([installUserScript(source)])
if (scenario === 'workspace') {
  localStorage.clear()
  const entries = [{ url: 'https://example.org/retained', title: '保留的文章', time: Date.now() }]
  localStorage.setItem(BROWSER_KEYS.history, JSON.stringify(entries))
  localStorage.setItem(BROWSER_KEYS.bookmarks, JSON.stringify(entries))
}
window.__desktopChanges = 0
const sampleVideo = scenario.startsWith('player-') ? await createSampleVideo() : ''

async function createSampleVideo(): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 90
  const context = canvas.getContext('2d')!
  context.fillStyle = '#668844'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const stream = canvas.captureStream(15)
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
  const chunks: BlobPart[] = []
  const result = new Promise<string>(resolve => {
    recorder.ondataavailable = event => chunks.push(event.data)
    recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop())
      resolve(URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })))
    }
  })
  recorder.start()
  window.setTimeout(() => recorder.stop(), 300)
  return result
}

function PlayerFixture({onClose}: {onClose: () => void}) {
  const owned = scenario !== 'player-default'
  const owner = useBrowserDialogFocus<HTMLDivElement>(owned)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const manager = useContext(VideoSessionManagerContext)
  useLayoutEffect(() => { setContainer(owner.current) }, [owner])
  useEffect(() => {
    if (!owned) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, owned])
  useEffect(() => {
    window.__videoManager = manager
    window.__openCastForTest = () => {
      // Exercise the real picker in Chrome without invoking native device discovery.
      const platform = Capacitor.getPlatform
      const available = Capacitor.isPluginAvailable
      Capacitor.getPlatform = () => 'android'
      Capacitor.isPluginAvailable = name => name === 'DlnaCast'
      try { document.querySelector<HTMLButtonElement>('[aria-label="投屏"]')?.click() }
      finally { Capacitor.getPlatform = platform; Capacitor.isPluginAvailable = available }
    }
  }, [manager])
  return <div ref={owner} tabIndex={-1} data-test-player-owner
    className="fixed inset-0 flex flex-col bg-ink text-paper outline-none">
    <button id="player-back" className="min-h-11" onClick={onClose}>退出播放器</button>
    <div className="flex min-h-0 flex-1 items-center">
      <div className="w-full min-w-0">
        {container && <InkVideoPlayer src={sampleVideo} title="键盘测试视频" mediaPageHost={false}
          overlayContainer={owned ? container : undefined} suppressResourceFab={scenario === 'player-browser'} />}
      </div>
    </div>
  </div>
}

export function Fixture() {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    window.__focusFixtureReady = true
    window.__dismissDialog = () => { setConfirm(false); setOpen(false) }
  }, [])

  if (scenario.startsWith('player-')) return <FloatingVideoProvider>
    <button id="opener" onClick={() => setOpen(true)}>打开测试播放器</button>
    <button id="background">背景操作</button>
    {open && <PlayerFixture onClose={() => setOpen(false)} />}
  </FloatingVideoProvider>

  if (scenario.startsWith('theme-')) return <>
    <div className="bg-cinnabar/10" data-outside-browser>
      <svg className="lucide" fill="none"><circle cx="8" cy="8" r="6" /></svg>
    </div>
    <div className="browser-workspace fixed inset-0 bg-ink text-paper">
      {scenario === 'theme-settings' ? <BrowserSettingsPanel
        search="bing" bottomAddress desktop={false} hasPage={false} historyCount={3}
        onBack={() => {}} onSearchChange={() => {}} onAddressPositionChange={() => {}}
        onDesktopChange={() => {}} onClearHistory={() => {}}
      /> : <BrowserTabsPanel
        tabs={[
          { index: 0, id: 1, title: '资料 A', url: 'https://example.org/', active: false, loading: false },
          { index: 1, id: 2, title: '资料 B', url: 'https://example.com/', active: true, loading: false },
        ]}
        pending={false} onBack={() => {}} onSelect={() => {}} onRemove={() => {}} onNew={() => {}}
      />}
    </div>
  </>

  return <>
    <button id="opener" onClick={() => setOpen(true)}>打开测试弹层</button>
    <button id="background">背景操作</button>
    {scenario === 'settings' && <BrowserSettingsPanel
      search="bing" bottomAddress={false} desktop={false} hasPage pending historyCount={0}
      onBack={() => {}} onSearchChange={() => {}} onAddressPositionChange={() => {}}
      onDesktopChange={() => { window.__desktopChanges++ }} onClearHistory={() => {}}
    />}
    {open && scenario === 'workspace' && <BrowserWorkspace onExit={() => setOpen(false)} />}
    {open && scenario === 'scripts' && <ScriptManager onClose={() => setOpen(false)} onChanged={() => {}} />}
    {open && scenario !== 'scripts' && scenario !== 'settings' && scenario !== 'workspace' && <BrowserSheet title="测试弹层" onClose={() => setOpen(false)}>
      <button id="first">第一个操作</button>
      <button id="disabled" disabled>禁用操作</button>
      <button id="hidden" hidden>隐藏操作</button>
      {scenario === 'autofocus' && <input id="autofocus" aria-label="自动聚焦输入框" autoFocus />}
      <button id="last" onClick={() => setConfirm(true)}>打开确认</button>
    </BrowserSheet>}
    {open && confirm && <BrowserSheet title="叠加确认" onClose={() => setConfirm(false)}>
      <button id="cancel" onClick={() => setConfirm(false)}>取消确认</button>
      <button id="confirm" onClick={() => setConfirm(false)}>确认操作</button>
    </BrowserSheet>}
  </>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
