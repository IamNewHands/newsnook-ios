import './lib/logger'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import { bootMark } from './lib/startupPerf'
import { BootstrapRoot } from './BootstrapRoot'
bootMark('main-module-ready')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BootstrapRoot />
  </StrictMode>,
)
