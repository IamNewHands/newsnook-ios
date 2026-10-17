import { useEffect, useState } from 'react'
import { BrowserWorkspace } from './BrowserWorkspace'
import { takeBrowserRecoverySession, type BrowserRecoverySession } from './useBrowserSession'

// Shared only within this JavaScript lifetime. A recreated Activity gets a new read.
let startupRecovery: Promise<BrowserRecoverySession | null> | null = null
function readStartupRecovery() {
  if (!startupRecovery) startupRecovery = takeBrowserRecoverySession().catch(() => null)
  return startupRecovery
}

/** Native WebView site viewport and a themed NewsNook browser chrome. */
export function BrowserLauncher() {
  const [workspace, setWorkspace] = useState<{recoverySession?: BrowserRecoverySession} | null>(null)
  useEffect(() => {
    let live = true
    const enter = () => {
      // A user's new entry supersedes any delayed startup recovery result.
      startupRecovery = Promise.resolve(null)
      setWorkspace(current => current ?? {})
    }
    window.addEventListener('newsnook:open-browser', enter)
    const request = readStartupRecovery()
    void request.then(snapshot => {
      if (!live || startupRecovery !== request) return
      // Consume only from a live effect, so StrictMode's trial mount cannot lose it.
      startupRecovery = Promise.resolve(null)
      if (snapshot) setWorkspace({recoverySession: snapshot})
    })
    return () => {
      live = false
      window.removeEventListener('newsnook:open-browser', enter)
    }
  }, [])
  return workspace ? <BrowserWorkspace recoverySession={workspace.recoverySession} onExit={() => {
    startupRecovery = Promise.resolve(null)
    setWorkspace(null)
  }} /> : null
}
