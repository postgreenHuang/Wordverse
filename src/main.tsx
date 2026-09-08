import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ProjectShell from './ProjectShell'
import AppErrorBoundary from './AppErrorBoundary'
import './styles.css'

createRoot(document.getElementById('root')!).render(<StrictMode><AppErrorBoundary><ProjectShell /></AppErrorBoundary></StrictMode>)
