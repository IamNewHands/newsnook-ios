import './lib/logger'
import { StrictMode, Suspense, lazy, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
const rootView = lazy(() => import('./BootstrapRoot').then(module => ({default: module.BootstrapRoot})))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>{createElement(rootView)}</Suspense>
  </StrictMode>,
)
