import { useEffect, useState } from 'react'
import { BrowserWorkspace } from './BrowserWorkspace'
import { takeBrowserRecoverySession, type BrowserRecoverySession } from './useBrowserSession'
import { BROWSER_OPEN_EVENT, type BrowserOpenDetail } from './browserOpen'

// Shared only within this JavaScript lifetime. A recreated Activity gets a new read.
let startupRecovery: Promise<BrowserRecoverySession | null> | null = null
function readStartupRecovery() {
  if (!startupRecovery) startupRecovery = takeBrowserRecoverySession().catch(() => null)
  return startupRecovery
}

interface WorkspaceState {
  recoverySession?: BrowserRecoverySession
  initialUrl?: string
}

/** Native WebView site viewport and a themed NewsNook browser chrome. */
export function BrowserLauncher() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  useEffect(() => {
    let live = true
    const enter = (event: Event) => {
      // A user's new entry supersedes any delayed startup recovery result.
      startupRecovery = Promise.resolve(null)
      const detail = 'detail' in event ? (event as CustomEvent<BrowserOpenDetail>).detail : undefined
      const initialUrl = detail?.url && /^https?:\/\//i.test(detail.url) ? detail.url : undefined
      setWorkspace(current => {
        if (!current) return { initialUrl }
        return initialUrl ? { ...current, initialUrl } : current
      })
    }
    window.addEventListener(BROWSER_OPEN_EVENT, enter)
    const request = readStartupRecovery()
    void request.then(snapshot => {
      if (!live || startupRecovery !== request) return
      // Consume only from a live effect, so StrictMode's trial mount cannot lose it.
      startupRecovery = Promise.resolve(null)
      if (snapshot) setWorkspace({ recoverySession: snapshot })
    })
    return () => {
      live = false
      window.removeEventListener(BROWSER_OPEN_EVENT, enter)
    }
  }, [])
  return workspace ? (
    <BrowserWorkspace
      initialUrl={workspace.initialUrl}
      recoverySession={workspace.recoverySession}
      onExit={() => {
        startupRecovery = Promise.resolve(null)
        setWorkspace(null)
      }}
    />
  ) : null
}

