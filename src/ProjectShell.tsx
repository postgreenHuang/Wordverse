import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, Plus, Sparkles, X } from 'lucide-react'
import App from './App'

export type ProjectInfo = { projectId: string; name: string; path: string; legacy: boolean }
const RECENTS_KEY = 'wordverse.projects.recent'
const LAST_KEY = 'wordverse.projects.lastPath'

function storedRecents(): ProjectInfo[] {
  try { const value = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); return Array.isArray(value) ? value.filter(item => item && typeof item.projectId === 'string' && typeof item.path === 'string') : [] }
  catch { return [] }
}

function remember(project: ProjectInfo) {
  const recent = [project, ...storedRecents().filter(item => item.projectId !== project.projectId)].slice(0, 12)
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recent))
  localStorage.setItem(LAST_KEY, project.path)
  localStorage.setItem('wordverse.activeProjectId', project.projectId)
}

export default function ProjectShell() {
  const desktop = '__TAURI_INTERNALS__' in window
  const dark = localStorage.getItem('wordverse.theme') === 'dark'
  const [active, setActive] = useState<ProjectInfo | null>(null)
  const [recents, setRecents] = useState(storedRecents)
  const [loading, setLoading] = useState(desktop)
  const [error, setError] = useState('')
  const [createName, setCreateName] = useState('')

  const activate = async (path: string, reload = false) => {
    setLoading(true); setError('')
    try {
      const project = await invoke<ProjectInfo>('activate_project', { path })
      remember(project); setRecents(storedRecents()); setActive(project)
      if (reload) location.reload()
    } catch (reason) { setError(String(reason)); setLoading(false) }
  }

  useEffect(() => {
    if (!desktop) { setLoading(false); return }
    const last = localStorage.getItem(LAST_KEY)
    if (last) { void activate(last); return }
    invoke<ProjectInfo | null>('default_project').then(project => {
      if (project) { remember(project); setRecents(storedRecents()); setActive(project) }
      setLoading(false)
    }).catch(reason => { setError(String(reason)); setLoading(false) })
  }, [])

  if (!desktop) return <App />
  if (active) return <App projectName={active.name} onRequestProjectManager={() => { setActive(null); setLoading(false) }} />

  const chooseExisting = async () => {
    const selected = await open({ directory: true, multiple: false, title: '打开 Wordverse 项目' })
    if (typeof selected === 'string') await activate(selected, true)
  }
  const create = async () => {
    if (!createName.trim()) { setError('请先输入项目名称'); return }
    const selected = await open({ directory: true, multiple: false, title: '选择一个空文件夹作为项目位置' })
    if (typeof selected !== 'string') return
    setLoading(true); setError('')
    try {
      const project = await invoke<ProjectInfo>('create_project', { path: selected, name: createName.trim() })
      remember(project); location.reload()
    } catch (reason) { setError(String(reason)); setLoading(false) }
  }
  const forget = (projectId: string) => { const next = recents.filter(item => item.projectId !== projectId); setRecents(next); localStorage.setItem(RECENTS_KEY, JSON.stringify(next)) }

  return <main className={`project-launcher${dark ? ' dark' : ''}`}><section className="project-launcher-card"><header><Sparkles size={22}/><div><strong>Wordverse</strong><span>选择一个词网项目继续</span></div></header><div className="project-create"><input value={createName} onChange={event => setCreateName(event.target.value)} placeholder="新项目名称，例如：工作"/><button disabled={loading} onClick={() => void create()}><Plus size={15}/>在空文件夹新建</button></div><button className="project-open" disabled={loading} onClick={() => void chooseExisting()}><FolderOpen size={16}/>打开已有项目</button>{recents.length > 0 && <div className="recent-projects"><h2>最近项目</h2>{recents.map(project => <div key={project.projectId}><button disabled={loading} onClick={() => void activate(project.path, true)}><strong>{project.name}</strong><span>{project.path}</span></button><button aria-label={`移除${project.name}`} onClick={() => forget(project.projectId)}><X size={13}/></button></div>)}</div>}{loading && <p className="project-message">正在验证项目…</p>}{error && <p className="project-message error">{error}</p>}</section></main>
}
