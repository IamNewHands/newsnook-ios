import { useEffect, useState } from 'react'
import { BrowserWorkspace } from './BrowserWorkspace'

/** Native WebView site viewport and a themed NewsNook browser chrome. */
export function BrowserLauncher() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const enter = () => setOpen(true)
    window.addEventListener('newsnook:open-browser', enter)
    return () => window.removeEventListener('newsnook:open-browser', enter)
  }, [])
  return open ? <BrowserWorkspace onExit={() => setOpen(false)} /> : null
}
