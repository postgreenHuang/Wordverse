import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Billboard, Grid, Html, Line, OrbitControls, Text, TransformControls } from '@react-three/drei'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ArrowDown, ArrowLeft, ArrowUp, Axis3d, ChevronDown, CircleHelp, CirclePlus, Command, FileBox, Focus, Folder, Home, LassoSelect, Link2, LocateFixed, Maximize2, Menu, Moon, MoreHorizontal, MousePointer2, PanelLeftClose, Pencil, Play, Plus, Redo2, Scaling, Search, Settings2, Sparkles, SquareDashedMousePointer, Sun, Trash2, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import { Color, Raycaster, Vector2, Vector3 } from 'three'
import { initialGraph } from './data'
import { connectRelations, cutRelations, deleteGraphTree, deleteWord, restoreRelation, restoreWord } from './graphOps'
import { balancedPosition, nearbyIntentPosition, relaxLayout } from './layout'
import { pointInPolygon, segmentHitsBox, segmentHitsPolygon } from './selectionGeometry'
import { parseSearchTerms } from './searchTerms'
import { insertTabAtSelection } from './textEditing'
import { CURRENT_SCHEMA_VERSION, parseWorkspaceDocument, portableWorkspaceJson, prepareImportedWorkspaceJson, resolveImageAsset, StorageConflictError, storeImageAsset, workspaceAutoSaveDelay, workspaceStorage, workspaceStorageLabel } from './storage'
import type { WorkspaceBackup } from './storage'
import type { Edge, Graph, PropertyDefinition, PropertyType, PropertyValue, WordNode } from './types'

type FontStyle = 'modern' | 'serif' | 'compact'
type SelectionMode = 'single' | 'box' | 'lasso'
type SceneView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'perspective'
type ShortcutAction = 'focus' | 'rename' | 'link' | 'linkContinuous' | 'duplicate' | 'encapsulate' | 'edgeSource' | 'edgeTarget' | 'fullscreen' | 'save' | 'search' | 'undo' | 'redo' | 'remove' | 'selectSingle' | 'gizmoMove' | 'gizmoScale' | 'selectBox' | 'selectLasso' | 'forward' | 'backward' | 'left' | 'right' | 'up' | 'down'
type ShortcutMap = Record<ShortcutAction, string>
function projectDeviceKey(name: string): string {
  const projectId = localStorage.getItem('wordverse.activeProjectId') || 'legacy-default'
  return `wordverse.project.${projectId}.${name}`
}

const DEFAULT_SHORTCUTS: ShortcutMap = { focus: 'KeyF', rename: 'F2', link: 'KeyL', linkContinuous: 'Shift+KeyL', duplicate: 'Alt+KeyD', encapsulate: 'Shift+KeyC', edgeSource: 'Shift+Comma', edgeTarget: 'Shift+Period', fullscreen: 'Space', save: 'Ctrl+KeyS', search: 'Ctrl+KeyK', undo: 'Ctrl+KeyZ', redo: 'Ctrl+Shift+KeyZ', remove: 'Delete', selectSingle: 'KeyR', gizmoMove: 'KeyT', gizmoScale: 'KeyY', selectBox: 'KeyB', selectLasso: 'KeyC', forward: 'Mouse0+KeyW', backward: 'Mouse0+KeyS', left: 'Mouse0+KeyA', right: 'Mouse0+KeyD', up: 'Mouse0+KeyE', down: 'Mouse0+KeyQ' }
const SHORTCUT_LABELS: { action: ShortcutAction; label: string }[] = [
  { action: 'selectSingle', label: '取消 Gizmo' }, { action: 'gizmoMove', label: '移动 Gizmo' }, { action: 'gizmoScale', label: '缩放 Gizmo' }, { action: 'selectBox', label: '框选模式' }, { action: 'selectLasso', label: '圈选模式' }, { action: 'encapsulate', label: '封装为子词网' }, { action: 'edgeSource', label: '查看连线起点' }, { action: 'edgeTarget', label: '查看连线终点' }, { action: 'focus', label: '聚焦所选 / 全图' }, { action: 'rename', label: '重命名' }, { action: 'link', label: '建立连接' }, { action: 'linkContinuous', label: '连续连接' }, { action: 'duplicate', label: '复制并连接' }, { action: 'fullscreen', label: '场景全屏' }, { action: 'forward', label: '相机前进' }, { action: 'backward', label: '相机后退' }, { action: 'left', label: '相机左移' }, { action: 'right', label: '相机右移' }, { action: 'up', label: '相机上移' }, { action: 'down', label: '相机下移' }, { action: 'remove', label: '删除所选' }, { action: 'undo', label: '撤销' }, { action: 'redo', label: '重做' }, { action: 'save', label: '保存' }, { action: 'search', label: '检索' }
]
type CameraSnapshot = { position: [number, number, number]; target: [number, number, number]; up: [number, number, number] }

function loadCameraSnapshots(): Map<string, CameraSnapshot> {
  try {
    const parsed = JSON.parse(localStorage.getItem(projectDeviceKey('cameraSnapshots')) || '{}') as Record<string, CameraSnapshot>
    return new Map(Object.entries(parsed).filter(([, value]) =>
      value && [...value.position, ...value.target, ...value.up].every(Number.isFinite)
    ))
  } catch { return new Map() }
}

const cameraSnapshots = loadCameraSnapshots()

function saveCameraSnapshot(graphId: string, camera: { position: Vector3; up: Vector3 }, target: Vector3) {
  const snapshot: CameraSnapshot = { position: camera.position.toArray() as [number, number, number], target: target.toArray() as [number, number, number], up: camera.up.toArray() as [number, number, number] }
  cameraSnapshots.set(graphId, snapshot)
  localStorage.setItem(projectDeviceKey('cameraSnapshots'), JSON.stringify(Object.fromEntries(cameraSnapshots)))
}

function shortcutForEvent(event: KeyboardEvent | React.KeyboardEvent): string {
  const modifiers = [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean)
  return [...modifiers, event.code].join('+')
}

function matchesShortcut(event: KeyboardEvent, binding: string): boolean {
  return shortcutForEvent(event) === binding
}

function displayShortcut(binding: string): string {
  return binding.replace('Mouse0', '左键').replace('Mouse2', '右键').replace('Key', '').replace('Digit', '').replaceAll('+', ' + ')
}

function isTextEditing(): boolean {
  const active = document.activeElement
  return !!active && (active.matches('input, textarea, select, [contenteditable="true"]') || active.closest('[contenteditable="true"]') !== null)
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

function CameraKeys({ graph, selectedId, focusRequest, viewRequest, viewLocked, bringRequest, playbackEnabled, shortcuts, onBring, onPlaybackFocus, onFlyChange, enabled = true }: { graph: Graph; selectedId: string; focusRequest: number; viewRequest: { view: SceneView; nonce: number; locked?: boolean } | null; viewLocked: boolean; bringRequest: { id: string; nonce: number } | null; playbackEnabled: boolean; shortcuts: ShortcutMap; onBring: (id: string, position: [number, number, number]) => void; onPlaybackFocus: (id: string) => void; onFlyChange: (active: boolean) => void; enabled?: boolean }) {
  const { camera, gl } = useThree()
  const controls = useRef<any>(null)
  const pressed = useRef(new Set<string>())
  const flying = useRef(false)
  const playbackHub = useRef('')
  const playbackNeighbors = useRef<string[]>([])
  const playbackRecent = useRef<string[]>([])
  const lastCameraSave = useRef(0)
  const persistView = (force = false) => {
    if (!controls.current || (!force && performance.now() - lastCameraSave.current < 180)) return
    lastCameraSave.current = performance.now()
    saveCameraSnapshot(graph.id, camera, controls.current.target)
  }
  useEffect(() => {
    const saved = cameraSnapshots.get(graph.id)
    if (saved && controls.current) {
      camera.position.fromArray(saved.position)
      camera.up.fromArray(saved.up)
      controls.current.target.fromArray(saved.target)
      camera.lookAt(controls.current.target)
      controls.current.update()
    }
    return () => persistView(true)
  }, [graph.id])
  const focus = () => {
    const selected = graph.nodes.find(node => node.id === selectedId)
    const target = selected
      ? new Vector3(...selected.position)
      : graph.nodes.reduce((sum, node) => sum.add(new Vector3(...node.position)), new Vector3()).multiplyScalar(1 / Math.max(1, graph.nodes.length))
    const radius = selected ? 1 : Math.max(1.8, ...graph.nodes.map(node => target.distanceTo(new Vector3(...node.position))))
    const direction = camera.position.clone().sub(controls.current?.target || new Vector3()).normalize()
    if (!Number.isFinite(direction.x) || direction.lengthSq() < .1) direction.set(0, 0, 1)
    camera.position.copy(target.clone().add(direction.multiplyScalar(selected ? 7 : Math.max(9, radius * 2.15))))
    if (controls.current) { controls.current.target.copy(target); controls.current.update() }
  }
  useEffect(() => { if (focusRequest > 0) focus() }, [focusRequest])
  useEffect(() => {
    if (!viewRequest || !controls.current) return
    const target = controls.current.target.clone() as Vector3
    const distance = Math.max(4.5, camera.position.distanceTo(target))
    const directions: Record<SceneView, Vector3> = {
      front: new Vector3(0, 0, 1), back: new Vector3(0, 0, -1),
      left: new Vector3(-1, 0, 0), right: new Vector3(1, 0, 0),
      top: new Vector3(0, 1, 0), bottom: new Vector3(0, -1, 0),
      perspective: new Vector3(1, .82, 1)
    }
    camera.up.copy(viewRequest.view === 'top' ? new Vector3(0, 0, 1) : viewRequest.view === 'bottom' ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0))
    camera.position.copy(target.clone().add(directions[viewRequest.view].normalize().multiplyScalar(distance)))
    camera.lookAt(target)
    controls.current.update()
  }, [viewRequest?.nonce])
  useEffect(() => {
    if (!bringRequest || !controls.current) return
    const center = controls.current.target.clone() as Vector3
    const existing = graph.nodes.filter(node => node.id !== bringRequest.id).map(node => new Vector3(...node.position))
    let best = center.clone(); let bestScore = -Infinity
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI * (3 - Math.sqrt(5)); const y = 1 - (i / 31) * 2; const ring = Math.sqrt(Math.max(0, 1 - y * y))
      const candidate = center.clone().add(new Vector3(Math.cos(angle) * ring, y, Math.sin(angle) * ring).multiplyScalar(1.45))
      const score = existing.length ? Math.min(...existing.map(point => point.distanceTo(candidate))) : 10
      if (score > bestScore) { bestScore = score; best = candidate }
    }
    onBring(bringRequest.id, [best.x, best.y, best.z])
  }, [bringRequest?.nonce])
  useEffect(() => {
    if (!playbackEnabled || !graph.nodes.length) { playbackHub.current = ''; playbackNeighbors.current = []; onPlaybackFocus(''); return }
    let timeout = 0
    const degree = (id: string) => graph.edges.filter(edge => edge.source === id || edge.target === id).length
    const chooseHub = () => {
      const candidates = graph.nodes.filter(node => !node.isContextRoot || graph.nodes.length === 1)
      const fresh = candidates.filter(node => !playbackRecent.current.includes(node.id) && node.id !== playbackHub.current)
      const pool = fresh.length ? fresh : candidates.filter(node => node.id !== playbackHub.current)
      const available = pool.length ? pool : candidates
      const weights = available.map(node => Math.pow(degree(node.id) + 1, 1.25) * (.72 + Math.random() * .56))
      let cursor = Math.random() * weights.reduce((sum, weight) => sum + weight, 0)
      return available.find((_, index) => (cursor -= weights[index]) <= 0) || available[0]
    }
    const visit = () => {
      let neighborId = playbackNeighbors.current.shift()
      while (neighborId && (playbackRecent.current.includes(neighborId) || neighborId === playbackHub.current)) neighborId = playbackNeighbors.current.shift()
      let node = graph.nodes.find(candidate => candidate.id === neighborId)
      let isHub = false
      if (!node) {
        node = chooseHub(); isHub = true; playbackHub.current = node.id
        const recent = new Set(playbackRecent.current)
        playbackNeighbors.current = graph.edges
          .flatMap(edge => edge.source === node!.id ? [edge.target] : edge.target === node!.id ? [edge.source] : [])
          .filter((id, index, ids) => id !== node!.id && !recent.has(id) && ids.indexOf(id) === index)
          .sort(() => Math.random() - .5)
      }
      playbackRecent.current = [node.id, ...playbackRecent.current.filter(id => id !== node!.id)].slice(0, Math.max(4, graph.nodes.length - 2))
      onPlaybackFocus(node.id)
      timeout = window.setTimeout(visit, isHub ? 6400 : 5600)
    }
    timeout = window.setTimeout(visit, 180)
    return () => window.clearTimeout(timeout)
  }, [playbackEnabled, graph, onPlaybackFocus])
  useEffect(() => {
    const pointerDown = (event: PointerEvent) => { if (enabled && event.button === 0) { flying.current = true; onFlyChange(true) } }
    const pointerUp = (event: PointerEvent) => { if (event.button === 0) { flying.current = false; pressed.current.clear(); onFlyChange(false) } }
    gl.domElement.addEventListener('pointerdown', pointerDown, true); addEventListener('pointerup', pointerUp, true); addEventListener('pointercancel', pointerUp, true)
    return () => { gl.domElement.removeEventListener('pointerdown', pointerDown, true); removeEventListener('pointerup', pointerUp, true); removeEventListener('pointercancel', pointerUp, true); onFlyChange(false) }
  }, [enabled, gl, onFlyChange])
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (isTextEditing()) return
      if (matchesShortcut(event, shortcuts.focus)) focus()
      const movement = flying.current ? (['forward', 'backward', 'left', 'right', 'up', 'down'] as const).find(action => matchesShortcut(event, shortcuts[action].replace('Mouse0+', ''))) : undefined
      if (movement) { pressed.current.add(movement); event.preventDefault() }
    }
    const up = (event: KeyboardEvent) => (['forward', 'backward', 'left', 'right', 'up', 'down'] as const).forEach(action => { if (matchesShortcut(event, shortcuts[action].replace('Mouse0+', ''))) pressed.current.delete(action) })
    addEventListener('keydown', down); addEventListener('keyup', up)
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up) }
  }, [camera, graph, selectedId, shortcuts])
  useEffect(() => {
    let gesture: { pointerId: number; x: number; y: number; pivot: Vector3; applied: boolean } | null = null
    const prepare = (event: PointerEvent) => {
      if (!enabled || event.button !== 0 || event.altKey || !controls.current) return
      const rect = gl.domElement.getBoundingClientRect()
      const pointer = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      const raycaster = new Raycaster()
      raycaster.setFromCamera(pointer, camera)
      const nearby = graph.nodes.map(node => ({ node, distance: raycaster.ray.distanceToPoint(new Vector3(...node.position)) })).sort((a, b) => a.distance - b.distance)[0]
      const depth = Math.max(4.5, camera.position.distanceTo(controls.current.target))
      const pivot = nearby && nearby.distance < .82 ? new Vector3(...nearby.node.position) : raycaster.ray.at(depth, new Vector3())
      gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pivot, applied: false }
    }
    const move = (event: PointerEvent) => {
      if (!gesture || gesture.pointerId !== event.pointerId || gesture.applied || Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 3) return
      controls.current?.target.copy(gesture.pivot)
      gesture.applied = true
    }
    const finish = (event: PointerEvent) => { if (gesture?.pointerId === event.pointerId) gesture = null }
    gl.domElement.addEventListener('pointerdown', prepare, true)
    addEventListener('pointermove', move, true); addEventListener('pointerup', finish, true); addEventListener('pointercancel', finish, true)
    return () => { gl.domElement.removeEventListener('pointerdown', prepare, true); removeEventListener('pointermove', move, true); removeEventListener('pointerup', finish, true); removeEventListener('pointercancel', finish, true) }
  }, [camera, enabled, gl, graph.nodes])
  useFrame((_, delta) => {
    if (!enabled || !pressed.current.size) return
    const forward = new Vector3(); camera.getWorldDirection(forward).normalize()
    const right = new Vector3().crossVectors(forward, camera.up).normalize()
    const move = new Vector3()
    if (pressed.current.has('forward')) move.add(forward)
    if (pressed.current.has('backward')) move.sub(forward)
    if (pressed.current.has('right')) move.add(right)
    if (pressed.current.has('left')) move.sub(right)
    if (pressed.current.has('up')) move.add(camera.up)
    if (pressed.current.has('down')) move.sub(camera.up)
    if (move.lengthSq()) { move.normalize().multiplyScalar(delta * 3.4); camera.position.add(move); controls.current?.target.add(move); persistView() }
  })
  return <OrbitControls ref={controls} enabled={enabled} makeDefault enableRotate={!viewLocked} enableDamping={false} minDistance={4.5} maxDistance={55} zoomToCursor onChange={() => persistView()} />
}

function SceneHealth({ onContextLost }: { onContextLost: () => void }) {
  const { gl } = useThree()
  useEffect(() => {
    const canvas = gl.domElement
    const lost = (event: Event) => { event.preventDefault(); onContextLost() }
    canvas.addEventListener('webglcontextlost', lost)
    return () => canvas.removeEventListener('webglcontextlost', lost)
  }, [gl, onContextLost])
  return null
}

function findGraphPath(graphs: Record<string, Graph>, targetId: string, currentId = 'root', visited = new Set<string>()): string[] | null {
  if (currentId === targetId) return [currentId]
  if (visited.has(currentId)) return null
  visited.add(currentId)
  const current = graphs[currentId]
  if (!current) return null
  for (const node of current.nodes) {
    const childId = `child:${node.id}`
    if (!graphs[childId]) continue
    const childPath = findGraphPath(graphs, targetId, childId, visited)
    if (childPath) return [currentId, ...childPath]
  }
  return null
}

function loadStoredGraphs(): Record<string, Graph> {
  const migrate = (graphs: Record<string, Graph>) => {
    const now = new Date().toISOString()
    return Object.fromEntries(Object.entries(graphs).map(([id, graph]) => [id, { ...graph, nodes: graph.nodes.map(node => ({ ...node, scale: typeof node.scale === 'number' ? node.scale : Array.isArray(node.scale) && typeof node.scale[0] === 'number' ? node.scale[0] : 1, createdAt: node.createdAt || now, updatedAt: node.updatedAt || node.createdAt || now })) }]))
  }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem('wordverse.graph') || 'null')
    if (!parsed || typeof parsed !== 'object') return migrate({ root: initialGraph })
    const candidate = parsed as Record<string, unknown>
    if (candidate.root && typeof candidate.root === 'object') {
      const valid = Object.fromEntries(Object.entries(candidate).filter(([, value]) => {
        const graph = value as Partial<Graph> | null
        return !!graph && typeof graph.id === 'string' && typeof graph.name === 'string' && Array.isArray(graph.nodes) && Array.isArray(graph.edges)
      })) as Record<string, Graph>
      return migrate(valid.root ? valid : { ...valid, root: initialGraph })
    }
    const legacy = parsed as Partial<Graph>
    if (typeof legacy.id === 'string' && Array.isArray(legacy.nodes) && Array.isArray(legacy.edges)) return migrate({ root: { ...initialGraph, ...legacy, id: 'root' } })
  } catch { /* fall back to the starter graph */ }
  return migrate({ root: initialGraph })
}

function formatExactTime(value?: string): string {
  if (!value) return '暂无记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间记录异常'
  const part = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`
}

function loadStoredTabs(graphs: Record<string, Graph>): { tabs: { id: string; path: string[] }[]; activeId: string } {
  try {
    const parsed = JSON.parse(localStorage.getItem(projectDeviceKey('tabs')) || 'null') as { tabs?: { id?: unknown; path?: unknown }[]; activeId?: unknown } | null
    const tabs = (parsed?.tabs || []).filter(tab => typeof tab.id === 'string' && Array.isArray(tab.path)).map(tab => ({ id: tab.id as string, path: (tab.path as unknown[]).filter((id): id is string => typeof id === 'string' && !!graphs[id]) })).filter(tab => tab.path.length > 0)
    if (tabs.length) return { tabs, activeId: tabs.some(tab => tab.id === parsed?.activeId) ? parsed!.activeId as string : tabs[0].id }
  } catch { /* use the default scene tab */ }
  return { tabs: [{ id: 'tab:root', path: ['root'] }], activeId: 'tab:root' }
}

function loadStoredSelection(graphId: string, graphs: Record<string, Graph>): { primary: string; ids: Set<string> } {
  const graph = graphs[graphId]
  if (!graph) return { primary: '', ids: new Set() }
  try {
    const stored = JSON.parse(localStorage.getItem(projectDeviceKey('selections')) || '{}') as Record<string, { primary?: unknown; ids?: unknown }>
    const entry = stored[graphId]
    const ids = new Set((Array.isArray(entry?.ids) ? entry.ids : []).filter((id): id is string => typeof id === 'string' && graph.nodes.some(node => node.id === id)))
    const primary = typeof entry?.primary === 'string' && graph.nodes.some(node => node.id === entry.primary) ? entry.primary : [...ids][0] || graph.nodes[0]?.id || ''
    if (primary) ids.add(primary)
    return { primary, ids }
  } catch {
    const primary = graph.nodes[0]?.id || ''
    return { primary, ids: new Set(primary ? [primary] : []) }
  }
}

function storedNumber(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(key)); return Number.isFinite(value) && value > 0 ? value : fallback
}

function loadGlobalProperties(): PropertyDefinition[] {
  try {
    const value = JSON.parse(localStorage.getItem('wordverse.globalProperties') || '[]')
    if (!Array.isArray(value)) return []
    return value.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && ['text', 'text-list', 'image'].includes(item.type))
  } catch { return [] }
}

function DepthField({ dark }: { dark: boolean }) {
  const positions = useMemo(() => {
    const values = new Float32Array(180 * 3)
    let seed = 9241
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
    for (let i = 0; i < 180; i++) {
      values[i * 3] = (random() - .5) * 34
      values[i * 3 + 1] = (random() - .5) * 24
      values[i * 3 + 2] = -2 - random() * 26
    }
    return values
  }, [])
  return <points frustumCulled={false}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
    <pointsMaterial color={dark ? '#a7adb5' : '#747981'} size={.045} sizeAttenuation transparent opacity={dark ? .13 : .16} depthWrite={false} />
  </points>
}

function NodeMarkers({ nodes, dark }: { nodes: WordNode[]; dark: boolean }) {
  const positions = useMemo(() => new Float32Array(nodes.flatMap(node => node.position)), [nodes])
  const markerColor = dark ? 'vec3(.78,.81,.85)' : 'vec3(.28,.30,.33)'
  return <points frustumCulled={false} renderOrder={3}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
    <shaderMaterial transparent depthWrite={false} depthTest={false} vertexShader={'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = 3.6; }'} fragmentShader={`void main(){ vec2 p=gl_PointCoord-vec2(.5); float d=length(p); if(d>.5) discard; float a=smoothstep(.5,.30,d); gl_FragColor=vec4(${markerColor},a*.68); }`} />
  </points>
}

function TextListEditor({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const updateItem = (index: number, value: string) => onChange(values.map((item, itemIndex) => itemIndex === index ? value : item))
  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= values.length) return
    const next = [...values]; [next[index], next[target]] = [next[target], next[index]]; onChange(next)
  }
  return <div className="text-list-editor">
    {values.map((item, index) => <div className="text-list-row" key={index}><span>{index + 1}</span><input autoFocus={index === values.length - 1 && !item} value={item} placeholder="输入条目…" onChange={event => updateItem(index, event.target.value)}/><button title="上移" disabled={index === 0} onClick={() => moveItem(index, -1)}><ArrowUp size={11}/></button><button title="下移" disabled={index === values.length - 1} onClick={() => moveItem(index, 1)}><ArrowDown size={11}/></button><button title="删除条目" onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}><X size={11}/></button></div>)}
    <button className="text-list-add" onClick={() => onChange([...values, ''])}><Plus size={12}/> 添加条目</button>
  </div>
}

function StoredImage({ value, alt, className, onClick }: { value: string; alt: string; className?: string; onClick?: () => void }) {
  const [source, setSource] = useState(value.startsWith('asset:') ? '' : value)
  useEffect(() => {
    let active = true
    resolveImageAsset(value).then(result => { if (active) setSource(result) }).catch(() => { if (active) setSource('') })
    return () => { active = false }
  }, [value])
  return source ? <img src={source} alt={alt} className={className} onClick={onClick}/> : <span className="image-missing">图片文件不可用</span>
}

function webLink(value: string): string | null {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch { return null }
}

const textLinkPattern = /https?:\/\/[^\s<>"'）】}，。！？；：]+/giu

function ExternalLink({ href, children }: { href: string; children: string }) {
  return <a href={href} target="_blank" rel="noreferrer" title="用默认浏览器打开" onClick={event => {
    if (!('__TAURI_INTERNALS__' in window)) return
    event.preventDefault()
    void openUrl(href)
  }}>{children}</a>
}

function TextWithLinks({ value }: { value: string }) {
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const match of value.matchAll(textLinkPattern)) {
    const index = match.index ?? 0
    if (index > cursor) parts.push(value.slice(cursor, index))
    const candidate = match[0].replace(/[.,!?;:)\]}]+$/u, '')
    const href = webLink(candidate)
    parts.push(href ? <ExternalLink key={`${index}:${href}`} href={href}>{candidate}</ExternalLink> : candidate)
    cursor = index + candidate.length
  }
  if (cursor < value.length) parts.push(value.slice(cursor))
  return <>{parts}</>
}

function Word({ node, degree, mergeCount, selected, hovered, linking, editing, motionEnabled, playbackFocused, reduceMotion, motionSpeed, motionAmplitude, dark, fontScale, fontStyle, onSelect, onEnter, onLeave, onOpen, onContext, onRename }: { node: WordNode; degree: number; mergeCount: number; selected: boolean; hovered: boolean; linking: boolean; editing: boolean; motionEnabled: boolean; playbackFocused: boolean; reduceMotion: boolean; motionSpeed: number; motionAmplitude: number; dark: boolean; fontScale: number; fontStyle: FontStyle; onSelect: (additive: boolean) => void; onEnter: () => void; onLeave: () => void; onOpen: () => void; onContext: (x: number, y: number) => void; onRename: (label: string | null) => void }) {
  const size = .5 + Math.min(degree, 5) * .055
  const textRef = useRef<any>(null)
  const groupRef = useRef<any>(null)
  const [renameDraft, setRenameDraft] = useState(node.label)
  const emergenceStarted = useRef(0)
  useEffect(() => { if (editing) setRenameDraft(node.label) }, [editing, node.label])
  useEffect(() => { if (playbackFocused) emergenceStarted.current = performance.now() }, [playbackFocused])
  useEffect(() => {
    if (motionEnabled || playbackFocused || !groupRef.current) return
    groupRef.current.position.y = 0
    groupRef.current.scale.setScalar(1)
  }, [motionEnabled, playbackFocused])
  const motionPhase = useMemo(() => node.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) * .17, [node.id])
  const restingTextColor = useMemo(() => new Color(node.isContextRoot
    ? (dark ? '#858b93' : '#92959a')
    : selected ? (dark ? '#eadfae' : '#66521d') : (dark ? '#f1f2f3' : '#050608')), [dark, node.isContextRoot, selected])
  const breathingTextColor = useMemo(() => new Color(dark ? '#858a91' : '#85898f'), [dark])
  useFrame(({ camera, size: viewportSize, clock }, delta) => {
    if (groupRef.current) {
      const targetY = motionEnabled && !reduceMotion && !editing ? Math.sin(clock.elapsedTime * motionSpeed + motionPhase) * motionAmplitude : 0
      groupRef.current.position.y += (targetY - groupRef.current.position.y) * Math.min(1, delta * 5)
      const emergenceTime = (performance.now() - emergenceStarted.current) / 1000
      const arrival = Math.min(1, emergenceTime / 3.6)
      const envelope = playbackFocused && !reduceMotion ? arrival * arrival * (3 - 2 * arrival) : 0
      const targetScale = 1 + envelope * .14
      const scale = groupRef.current.scale.x + (targetScale - groupRef.current.scale.x) * Math.min(1, delta * 5)
      groupRef.current.scale.setScalar(scale)
    }
    if (!textRef.current?.material) return
    const distance = camera.position.distanceTo(new Vector3(...node.position))
    const fov = 'fov' in camera ? camera.fov : 47
    const fontWorldSize = (node.label.length > 4 ? .24 : .31) * fontScale
    const pixelHeight = fontWorldSize * viewportSize.height / (2 * distance * Math.tan((fov * Math.PI / 180) / 2))
    textRef.current.material.opacity = Math.max(0, Math.min(1, (pixelHeight - 4.5) / 4.5))
    textRef.current.material.transparent = true
    const emergenceTime = (performance.now() - emergenceStarted.current) / 1000
    const colorBreath = playbackFocused && emergenceTime < 4.2 ? Math.sin((emergenceTime / 4.2) * Math.PI) * .72 : 0
    textRef.current.material.color.copy(restingTextColor).lerp(breathingTextColor, colorBreath)
  })
  return <Billboard position={node.position} scale={node.scale} follow renderOrder={10}>
    <group ref={groupRef} onClick={(e) => { e.stopPropagation(); onSelect(e.ctrlKey || e.metaKey || e.shiftKey) }} onDoubleClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation(); if (!node.isContextRoot) onOpen() }} onPointerEnter={onEnter} onPointerLeave={onLeave}
      onPointerDown={(e) => {
        if (e.button === 2) { e.stopPropagation(); onContext(e.nativeEvent.clientX, e.nativeEvent.clientY) }
      }}>
      <mesh>
        <circleGeometry args={[size, 64]} />
        <meshBasicMaterial color={selected ? (dark ? '#d8bd62' : '#d5b84f') : (dark ? '#ffffff' : '#111318')} transparent opacity={linking ? .085 : selected ? (hovered ? .105 : .072) : hovered ? .045 : .009} depthWrite={false} depthTest={false} />
      </mesh>
      {node.hasChildGraph && <mesh position={[0, -.43, .03]}><circleGeometry args={[.035, 24]} /><meshBasicMaterial color={selected ? (dark ? '#dfca7a' : '#907323') : (dark ? '#aeb2b8' : '#60646a')} transparent opacity={hovered || selected ? .72 : .42} depthWrite={false} /></mesh>}
      {mergeCount > 1 && <Text position={[.42, .24, .07]} fontSize={.11} color={dark ? '#aeb2b8' : '#686c72'} anchorX="center" anchorY="middle" material-fog={false}>×{mergeCount}</Text>}
      {!editing && <Text key={fontStyle} ref={textRef} font={fontStyle === 'serif' ? '/fonts/NotoSerifSC-Medium.ttf' : '/fonts/NotoSansSC-Medium.ttf'} position={[0, 0, .06]} fontSize={(node.label.length > 4 ? .24 : .31) * fontScale * (fontStyle === 'serif' ? 1.04 : fontStyle === 'compact' ? .97 : 1)} color={node.isContextRoot ? (dark ? '#858b93' : '#92959a') : selected ? (dark ? '#eadfae' : '#66521d') : (dark ? '#f1f2f3' : '#050608')} anchorX="center" anchorY="middle" fontWeight={fontStyle === 'serif' ? 500 : fontStyle === 'compact' ? 680 : selected || hovered ? 700 : 500} letterSpacing={fontStyle === 'serif' ? .035 : fontStyle === 'compact' ? -.035 : 0} material-fog={false} material-depthTest={false} material-depthWrite={false}>{node.label}</Text>}
      {editing && <Html center position={[0, 0, .12]} zIndexRange={[20, 10]}><input className="scene-rename" autoFocus value={renameDraft} onChange={event => setRenameDraft(event.target.value)} onFocus={event => event.currentTarget.select()} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => { event.stopPropagation(); onRename(renameDraft) }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter') onRename(renameDraft); if (event.key === 'Escape') onRename(null) }} onBlur={() => onRename(renameDraft)} /></Html>}
    </group>
  </Billboard>
}

function SelectionGesture({ mode, nodes, edges, onSelect }: { mode: Exclude<SelectionMode, 'single'>; nodes: WordNode[]; edges: Edge[]; onSelect: (ids: string[], edges: string[], additive: boolean) => void }) {
  const { camera, gl } = useThree()
  const [points, setPoints] = useState<{ x: number; y: number }[]>([])
  const livePoints = useRef<{ x: number; y: number }[]>([])
  const paintFrame = useRef<number | null>(null)
  const additive = useRef(false)
  const activePointer = useRef<number | null>(null)
  useEffect(() => () => { if (paintFrame.current !== null) cancelAnimationFrame(paintFrame.current) }, [])
  const paintSelection = () => {
    if (paintFrame.current !== null) return
    paintFrame.current = requestAnimationFrame(() => {
      paintFrame.current = null
      setPoints([...livePoints.current])
    })
  }
  const localPoint = (element: HTMLElement, clientX: number, clientY: number) => {
    const rect = element.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }
  const finish = (element: HTMLElement, gesture: { x: number; y: number }[]) => {
    if (paintFrame.current !== null) { cancelAnimationFrame(paintFrame.current); paintFrame.current = null }
    if (gesture.length < 2) { livePoints.current = []; setPoints([]); return }
    const rect = element.getBoundingClientRect()
    const canvasRect = gl.domElement.getBoundingClientRect()
    const start = gesture[0], end = gesture[gesture.length - 1]
    const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x), minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y)
    const ids = nodes.flatMap(node => {
      const projected = new Vector3(...node.position).project(camera)
      if (projected.z < -1 || projected.z > 1) return []
      const point = {
        x: canvasRect.left - rect.left + (projected.x + 1) * canvasRect.width / 2,
        y: canvasRect.top - rect.top + (1 - projected.y) * canvasRect.height / 2
      }
      const cameraRight = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(.82 * node.scale)
      const radiusPoint = new Vector3(...node.position).add(cameraRight).project(camera)
      const radius = Math.max(5, Math.abs(radiusPoint.x - projected.x) * canvasRect.width / 2)
      const chosen = mode === 'box'
        ? point.x + radius >= minX && point.x - radius <= maxX && point.y + radius >= minY && point.y - radius <= maxY
        : gesture.length > 2 && (pointInPolygon(point, gesture) || Array.from({ length: 12 }, (_, index) => {
          const angle = index / 12 * Math.PI * 2
          return { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius }
        }).some(sample => pointInPolygon(sample, gesture)))
      return chosen ? [node.id] : []
    })
    const nodeById = new Map(nodes.map(node => [node.id, node]))
    const projectNode = (id: string) => {
      const node = nodeById.get(id)
      if (!node) return null
      const projected = new Vector3(...node.position).project(camera)
      if (projected.z < -1 || projected.z > 1) return null
      return {
        x: canvasRect.left - rect.left + (projected.x + 1) * canvasRect.width / 2,
        y: canvasRect.top - rect.top + (1 - projected.y) * canvasRect.height / 2
      }
    }
    const selectedEdgeKeys = edges.flatMap(edge => {
      const a = projectNode(edge.source), b = projectNode(edge.target)
      if (!a || !b) return []
      const chosen = mode === 'box'
        ? segmentHitsBox(a, b, minX, maxX, minY, maxY)
        : segmentHitsPolygon(a, b, gesture)
      return chosen ? [`${edge.source}:${edge.target}`] : []
    })
    onSelect(ids, selectedEdgeKeys, additive.current)
    livePoints.current = []
    setPoints([])
  }
  return <Html fullscreen zIndexRange={[8, 7]}>
    <div className={`selection-surface ${mode}`} onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        activePointer.current = event.pointerId; additive.current = event.ctrlKey || event.metaKey || event.shiftKey
        const start = localPoint(event.currentTarget, event.clientX, event.clientY)
        livePoints.current = [start]
        setPoints([start])
      }}
      onPointerMove={event => {
        if (activePointer.current !== event.pointerId) return
        event.stopPropagation()
        const next = localPoint(event.currentTarget, event.clientX, event.clientY)
        const previous = livePoints.current[livePoints.current.length - 1]
        if (previous && mode === 'lasso' && Math.hypot(next.x - previous.x, next.y - previous.y) < 4) return
        livePoints.current = mode === 'box' ? [livePoints.current[0], next] : [...livePoints.current, next]
        paintSelection()
      }}
      onPointerUp={event => {
        if (activePointer.current !== event.pointerId) return
        event.stopPropagation()
        const end = localPoint(event.currentTarget, event.clientX, event.clientY)
        const gesture = mode === 'box' ? [livePoints.current[0], end] : [...livePoints.current, end]
        activePointer.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        finish(event.currentTarget, gesture)
      }}
      onLostPointerCapture={event => {
        if (activePointer.current === null) return
        activePointer.current = null
        finish(event.currentTarget, livePoints.current)
      }}
      onPointerCancel={event => {
        event.stopPropagation()
        if (activePointer.current !== null && livePoints.current.length > 1) finish(event.currentTarget, livePoints.current)
        else { livePoints.current = []; setPoints([]) }
        activePointer.current = null
      }}>
      {points.length > 1 && <svg className="selection-marquee">
        {mode === 'box' ? <rect x={Math.min(points[0].x, points[1].x)} y={Math.min(points[0].y, points[1].y)} width={Math.abs(points[1].x - points[0].x)} height={Math.abs(points[1].y - points[0].y)}/> : <polyline points={points.map(point => `${point.x},${point.y}`).join(' ')}/>} 
      </svg>}
    </div>
  </Html>
}

function TransformGizmo({ nodes, mode, dark, onStart, onTransform, onEnd }: { nodes: WordNode[]; mode: 'translate' | 'scale'; dark: boolean; onStart: () => void; onTransform: (values: Map<string, { position: [number, number, number]; scale: number }>) => void; onEnd: () => void }) {
  const group = useRef<any>(null)
  const controls = useRef<any>(null)
  const dragging = useRef(false)
  const startCenter = useRef(new Vector3())
  const startPositions = useRef(new Map<string, Vector3>())
  const startScales = useRef(new Map<string, number>())
  const center = useMemo(() => nodes.reduce((sum, node) => sum.add(new Vector3(...node.position)), new Vector3()).multiplyScalar(1 / Math.max(1, nodes.length)), [nodes])
  const styleControls = () => {
    const control = controls.current
    const visual = control?.gizmo
    if (!visual) return
    // TransformControls draws infinite helper axes while dragging. They overpower
    // the graph, so keep the useful handles but suppress that helper layer.
    Object.values(visual.helper || {}).forEach((helper: any) => helper?.children?.forEach((handle: any) => {
      const materials = Array.isArray(handle.material) ? handle.material : [handle.material]
      materials.filter(Boolean).forEach((material: any) => { material.visible = false })
    }))
    // tempOpacity is the value restored internally on every render. Adjusting it
    // makes the idle gizmo quiet while preserving the built-in hover highlight.
    Object.values(visual.gizmo || {}).forEach((gizmo: any) => gizmo?.children?.forEach((handle: any) => {
      const materials = Array.isArray(handle.material) ? handle.material : [handle.material]
      materials.filter(Boolean).forEach((material: any) => {
        if (material.userData.wordverseOpacity == null) material.userData.wordverseOpacity = material.opacity
        material.tempOpacity = material.userData.wordverseOpacity * (dragging.current || control.axis ? 1 : .3)
        material.opacity = material.tempOpacity
      })
    }))
  }
  useEffect(() => {
    if (!dragging.current && group.current) {
      group.current.position.copy(center)
      group.current.quaternion.identity()
      group.current.scale.set(1, 1, 1)
    }
    styleControls()
  }, [center, mode])
  if (!nodes.length) return null
  return <><group ref={group} position={[center.x, center.y, center.z]}><mesh visible={false}><sphereGeometry args={[.01, 4, 4]}/><meshBasicMaterial color={dark ? '#fff' : '#000'}/></mesh></group><TransformControls ref={controls} object={group} mode={mode} space="world" size={.78} showX showY showZ onChange={styleControls}
    onMouseDown={() => {
      dragging.current = true; startCenter.current.copy(group.current.position)
      startPositions.current = new Map(nodes.map(node => [node.id, new Vector3(...node.position)]))
      startScales.current = new Map(nodes.map(node => [node.id, node.scale]))
      styleControls()
      onStart()
    }}
    onObjectChange={() => {
      if (!dragging.current || !group.current) return
      const delta = group.current.position.clone().sub(startCenter.current)
      const factor = [group.current.scale.x, group.current.scale.y, group.current.scale.z].reduce((best, value) => Math.abs(value - 1) > Math.abs(best - 1) ? value : best, 1)
      onTransform(new Map([...startPositions.current].map(([id, position]) => {
        const baseScale = startScales.current.get(id) || 1
        const nextPosition = mode === 'scale' ? position.clone().sub(startCenter.current).multiplyScalar(factor).add(startCenter.current) : position.clone().add(delta)
        return [id, { position: [nextPosition.x, nextPosition.y, nextPosition.z], scale: mode === 'scale' ? Math.max(.05, baseScale * factor) : baseScale }]
      })))
    }}
    onMouseUp={() => { dragging.current = false; group.current?.scale.set(1, 1, 1); styleControls(); onEnd() }}/></>
}

function GraphScene({ graph, selectedId, selectedIds, selectionMode, gizmoMode, shortcuts, selectedEdge, selectedEdges, editingId, linkMode, linkSourceIds, duplicateSourceId, isMoving, gridVisible, mergeDuplicates, motionEnabled, playbackEnabled, motionSpeed, motionAmplitude, dark, fontScale, fontStyle, lineScale, gridDensity, gridClarity, gridRange, focusRequest, viewRequest, bringRequest, onBring, onSelect, onSelectMany, onSelectEdge, onOpen, onContext, onRename, onCursorPoint, onDuplicateAt, onMoveStart, onTransformMany, onMoveEnd, onFlyChange, query }: { graph: Graph; selectedId: string; selectedIds: Set<string>; selectionMode: SelectionMode; gizmoMode: 'translate' | 'scale' | null; shortcuts: ShortcutMap; selectedEdge: string; selectedEdges: Set<string>; editingId: string; linkMode: 'off' | 'single' | 'continuous'; linkSourceIds: string[]; duplicateSourceId: string; isMoving: boolean; gridVisible: boolean; mergeDuplicates: boolean; motionEnabled: boolean; playbackEnabled: boolean; motionSpeed: number; motionAmplitude: number; dark: boolean; fontScale: number; fontStyle: FontStyle; lineScale: number; gridDensity: number; gridClarity: number; gridRange: number; focusRequest: number; viewRequest: { view: SceneView; nonce: number; locked?: boolean } | null; bringRequest: { id: string; nonce: number } | null; onBring: (id: string, position: [number, number, number]) => void; onSelect: (id: string, additive: boolean) => void; onSelectMany: (ids: string[], edges: string[], additive: boolean) => void; onSelectEdge: (source: string, target: string) => void; onOpen: (node: WordNode) => void; onContext: (node: WordNode, x: number, y: number) => void; onRename: (id: string, label: string | null) => void; onCursorPoint: (position: [number, number, number]) => void; onDuplicateAt: (position: [number, number, number]) => void; onMoveStart: () => void; onTransformMany: (values: Map<string, { position: [number, number, number]; scale: number }>) => void; onMoveEnd: () => void; onFlyChange: (active: boolean) => void; query: string }) {
  const reduceMotion = useReducedMotion()
  const [hoveredNode, setHoveredNode] = useState('')
  const [hoveredEdge, setHoveredEdge] = useState('')
  const [playbackFocusId, setPlaybackFocusId] = useState('')
  const playbackPositions = useRef(new Map<string, Vector3>())
  const lastPlaybackPaint = useRef(0)
  const [, forcePlaybackFrame] = useState(0)
  const { camera, gl, setFrameloop } = useThree()
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => { setFrameloop(playbackEnabled ? 'always' : 'demand') }, [playbackEnabled, setFrameloop])
  const [cursorPoint, setCursorPoint] = useState<[number, number, number] | null>(null)
  const visible = useMemo(() => {
    const words = parseSearchTerms(query)
    if (!words.length) return new Set(graph.nodes.map(n => n.id))
    const matched = new Set(graph.nodes.filter(node => {
      const propertyText = (node.properties || []).flatMap(property => Array.isArray(property.value) ? property.value : property.type === 'image' ? [] : [property.value]).join(' ').toLowerCase()
      const searchable = `${node.label} ${node.note} ${node.tags.join(' ')} ${propertyText}`.toLowerCase()
      return words.some(word => searchable.includes(word))
    }).map(n => n.id))
    graph.edges.forEach(e => { if (matched.has(e.source) || matched.has(e.target)) { matched.add(e.source); matched.add(e.target) } })
    return matched
  }, [graph, query])
  const display = useMemo(() => {
    const filteredNodes = graph.nodes.filter(node => visible.has(node.id))
    const counts = new Map<string, number>()
    if (!mergeDuplicates) return { graph: { ...graph, nodes: filteredNodes, edges: graph.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target)) }, counts }
    const groups = new Map<string, WordNode[]>()
    filteredNodes.forEach(node => { const key = node.label.trim().toLocaleLowerCase(); groups.set(key, [...(groups.get(key) || []), node]) })
    const canonical = new Map<string, string>()
    const nodes = [...groups.values()].map(group => {
      const representative = group[0]
      group.forEach(node => canonical.set(node.id, representative.id))
      counts.set(representative.id, group.length)
      if (group.length === 1) return representative
      const center = group.reduce((sum, node) => sum.add(new Vector3(...node.position)), new Vector3()).multiplyScalar(1 / group.length)
      return { ...representative, position: [center.x, center.y, center.z] as [number, number, number], hasChildGraph: group.some(node => node.hasChildGraph) }
    })
    const seen = new Set<string>()
    const edges = graph.edges.flatMap(edge => {
      const source = canonical.get(edge.source), target = canonical.get(edge.target)
      if (!source || !target || source === target) return []
      const key = [source, target].sort().join(':')
      if (seen.has(key)) return []
      seen.add(key); return [{ source, target }]
    })
    return { graph: { ...graph, nodes, edges }, counts }
  }, [graph, visible, mergeDuplicates])
  const sceneGraph = display.graph
  const sceneStats = useMemo(() => {
    const degrees = new Map(sceneGraph.nodes.map(node => [node.id, 0]))
    sceneGraph.edges.forEach(edge => {
      degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1)
      degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1)
    })
    let totalWeight = 0
    const densityCenter = sceneGraph.nodes.reduce((sum, node) => {
      const weight = (degrees.get(node.id) || 0) + 1
      totalWeight += weight
      return sum.add(new Vector3(...node.position).multiplyScalar(weight))
    }, new Vector3()).multiplyScalar(1 / Math.max(1, totalWeight))
    return { degrees, densityCenter }
  }, [sceneGraph])
  const playbackWeights = useMemo(() => {
    const weights = new Map<string, number>()
    if (!playbackEnabled || !playbackFocusId) return weights
    weights.set(playbackFocusId, 1)
    const first = new Set<string>()
    sceneGraph.edges.forEach(edge => { if (edge.source === playbackFocusId) first.add(edge.target); if (edge.target === playbackFocusId) first.add(edge.source) })
    first.forEach(id => weights.set(id, .2))
    sceneGraph.edges.forEach(edge => {
      if (first.has(edge.source) && !weights.has(edge.target)) weights.set(edge.target, .04)
      if (first.has(edge.target) && !weights.has(edge.source)) weights.set(edge.source, .04)
    })
    return weights
  }, [playbackEnabled, playbackFocusId, sceneGraph])
  useFrame(({ clock }, delta) => {
    if (!playbackEnabled || isMoving || reduceMotion) return
    const focal = sceneGraph.nodes.find(node => node.id === playbackFocusId)
    const forward = new Vector3(); camera.getWorldDirection(forward)
    const denseDirection = sceneStats.densityCenter.clone().sub(camera.position).normalize()
    const arrival = camera.position.clone().add(denseDirection.multiplyScalar(5.8))
    const focalOrigin = focal ? new Vector3(...focal.position) : new Vector3()
    const pull = focal ? arrival.sub(focalOrigin) : new Vector3()
    const right = new Vector3().crossVectors(forward, camera.up).normalize()
    const step = Math.min(delta, .033)
    let moving = false
    sceneGraph.nodes.forEach(node => {
      const origin = new Vector3(...node.position)
      const position = playbackPositions.current.get(node.id) || origin.clone()
      const weight = playbackWeights.get(node.id) || 0
      const phase = node.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) * .071
      const flutter = right.clone().multiplyScalar(Math.sin(clock.elapsedTime * 1.18 + phase) * .16 * weight).add(camera.up.clone().multiplyScalar(Math.cos(clock.elapsedTime * .86 + phase) * .09 * weight))
      const relative = origin.clone().sub(focalOrigin)
      const rotated = relative.clone().applyAxisAngle(forward, Math.sin(clock.elapsedTime * .48) * .18 * weight)
      const target = origin.clone().add(pull.clone().multiplyScalar(weight)).add(rotated.sub(relative)).add(flutter)
      position.lerp(target, 1 - Math.exp(-step * 1.05))
      if (position.distanceToSquared(target) > .00002) moving = true
      playbackPositions.current.set(node.id, position)
    })
    if (moving && performance.now() - lastPlaybackPaint.current > 32) { lastPlaybackPaint.current = performance.now(); forcePlaybackFrame(frame => frame + 1) }
  })
  useEffect(() => {
    if (playbackEnabled) return
    playbackPositions.current.clear()
    setPlaybackFocusId('')
  }, [playbackEnabled])
  const animatedNodes = sceneGraph.nodes.map(node => {
    const position = playbackEnabled && !isMoving ? playbackPositions.current.get(node.id) : undefined
    return position ? { ...node, position: [position.x, position.y, position.z] as [number, number, number] } : node
  })
  const animatedNodeById = new Map(animatedNodes.map(node => [node.id, node]))
  const linkStartNodes = linkSourceIds.map(id => animatedNodeById.get(id)).filter((node): node is WordNode => !!node)
  const linkTargetNode = hoveredNode && !linkSourceIds.includes(hoveredNode) ? animatedNodeById.get(hoveredNode) : undefined
  const duplicateSource = animatedNodeById.get(duplicateSourceId)
  const animatedGraph = { ...sceneGraph, nodes: animatedNodes }
  const movableSelection = animatedNodes.filter(node => selectedIds.has(node.id) && !node.isContextRoot)
  const pointNearCamera = (ray: { at: (distance: number, target: Vector3) => Vector3 }): [number, number, number] => {
    const selectedNode = animatedNodeById.get(selectedId)
    const selectedDepth = selectedNode ? camera.position.distanceTo(new Vector3(...selectedNode.position)) : 5.2
    const point = ray.at(Math.max(3.8, Math.min(14, selectedDepth)), new Vector3())
    return [point.x, point.y, point.z]
  }
  useEffect(() => {
    const canvas = gl.domElement
    const pointFromClient = (clientX: number, clientY: number) => {
      const bounds = canvas.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return null
      const pointer = new Vector2(
        ((clientX - bounds.left) / bounds.width) * 2 - 1,
        -((clientY - bounds.top) / bounds.height) * 2 + 1
      )
      const raycaster = new Raycaster()
      raycaster.setFromCamera(pointer, camera)
      return pointNearCamera(raycaster.ray)
    }
    const publishPointer = (clientX: number, clientY: number) => {
      lastPointer.current = { x: clientX, y: clientY }
      const point = pointFromClient(clientX, clientY)
      if (point) { setCursorPoint(point); onCursorPoint(point) }
      return point
    }
    const handleMove = (event: PointerEvent) => { publishPointer(event.clientX, event.clientY) }
    const handlePlacement = (event: MouseEvent) => {
      if (!duplicateSourceId || event.button !== 0) return
      const point = publishPointer(event.clientX, event.clientY)
      if (!point) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      onDuplicateAt(point)
    }
    canvas.addEventListener('pointermove', handleMove, true)
    canvas.addEventListener('dblclick', handlePlacement, true)
    if (lastPointer.current) publishPointer(lastPointer.current.x, lastPointer.current.y)
    return () => {
      canvas.removeEventListener('pointermove', handleMove, true)
      canvas.removeEventListener('dblclick', handlePlacement, true)
    }
  }, [camera, gl, duplicateSourceId, selectedId, onCursorPoint, onDuplicateAt])
  return <>
    <fog attach="fog" args={[dark ? '#12161c' : '#f3f4f5', 12, 34]} />
    <ambientLight intensity={1.4} />
    <DepthField dark={dark} />
    {gridVisible && <Grid renderOrder={-20} position={[0, -4.5, 0]} args={[gridRange, gridRange]} cellSize={.65 / gridDensity} cellThickness={.36 * gridClarity} cellColor={dark ? '#3b424b' : '#9da1a7'} sectionSize={3.25 / gridDensity} sectionThickness={.58 * gridClarity} sectionColor={dark ? '#59616b' : '#7f848b'} fadeDistance={gridRange} fadeStrength={1.7} infiniteGrid />}
    <NodeMarkers nodes={animatedNodes} dark={dark} />
    {animatedGraph.edges.map((edge) => {
      const a = animatedNodeById.get(edge.source)!, b = animatedNodeById.get(edge.target)!
      const key = `${edge.source}:${edge.target}`
      const active = hoveredEdge === key || selectedEdge === key || selectedEdges.has(key)
      const emerging = playbackEnabled && (edge.source === playbackFocusId || edge.target === playbackFocusId)
      return <Line key={key} points={[a.position, b.position]} color={active ? (dark ? '#f1f2f3' : '#08090b') : (dark ? '#848a93' : '#6e737b')} lineWidth={(active ? 2.2 : 1) * lineScale} transparent opacity={active ? .8 : emerging ? .46 : .34} onPointerEnter={(e) => { e.stopPropagation(); setHoveredEdge(key) }} onPointerLeave={() => setHoveredEdge('')} onClick={(e) => { e.stopPropagation(); if (!mergeDuplicates) onSelectEdge(edge.source, edge.target) }} onDoubleClick={(e) => { e.stopPropagation(); e.nativeEvent.stopPropagation() }} />
    })}
    {linkStartNodes.map(source => (linkTargetNode || cursorPoint) && <Line key={`link-preview:${source.id}`} points={[source.position, linkTargetNode?.position || cursorPoint!]} color={dark ? '#f1f2f3' : '#111318'} lineWidth={1.6} dashed dashSize={.16} gapSize={.1} transparent opacity={.72} />)}
    {duplicateSource && cursorPoint && <><Line points={[duplicateSource.position, cursorPoint]} color={dark ? '#c7cbd1' : '#555a62'} lineWidth={1.2} dashed dashSize={.13} gapSize={.11} transparent opacity={.52}/><Billboard position={cursorPoint} follow><mesh><circleGeometry args={[.72, 48]}/><meshBasicMaterial color={dark ? '#ffffff' : '#111318'} transparent opacity={.045} depthWrite={false}/></mesh><Text position={[0, 0, .05]} font={fontStyle === 'serif' ? '/fonts/NotoSerifSC-Medium.ttf' : '/fonts/NotoSansSC-Medium.ttf'} fontSize={.27 * fontScale} color={dark ? '#d9dce0' : '#31343a'} anchorX="center" anchorY="middle" material-fog={false}>{duplicateSource.label}</Text></Billboard></>}
    {animatedNodes.map(node => <Word key={node.id} node={node} selected={selectedIds.has(node.id)} hovered={node.id === hoveredNode} linking={linkSourceIds.includes(node.id) || (!!linkSourceIds.length && node.id === hoveredNode)} editing={node.id === editingId} mergeCount={display.counts.get(node.id) || 1} motionEnabled={playbackEnabled && motionEnabled} playbackFocused={playbackEnabled && node.id === playbackFocusId} reduceMotion={reduceMotion} motionSpeed={motionSpeed} motionAmplitude={motionAmplitude} dark={dark} fontScale={fontScale} fontStyle={fontStyle} degree={sceneStats.degrees.get(node.id) || 0} onSelect={(additive) => onSelect(node.id, additive)} onOpen={() => { if (linkMode === 'off') onOpen(node) }} onContext={(x, y) => onContext(node, x, y)} onRename={(label) => onRename(node.id, label)} onEnter={() => setHoveredNode(node.id)} onLeave={() => setHoveredNode('')} />)}
    {selectionMode !== 'single' && linkMode === 'off' && !duplicateSourceId && <SelectionGesture mode={selectionMode} nodes={animatedNodes} edges={animatedGraph.edges} onSelect={onSelectMany}/>}
    {selectionMode === 'single' && gizmoMode && linkMode === 'off' && !duplicateSourceId && !playbackEnabled && !editingId && movableSelection.length > 0 && <TransformGizmo nodes={movableSelection} mode={gizmoMode} dark={dark} onStart={onMoveStart} onTransform={onTransformMany} onEnd={onMoveEnd}/>} 
    <CameraKeys graph={sceneGraph} selectedId={selectedId} focusRequest={focusRequest} viewRequest={viewRequest} viewLocked={!!viewRequest?.locked} bringRequest={bringRequest} playbackEnabled={playbackEnabled} shortcuts={shortcuts} onBring={onBring} onPlaybackFocus={setPlaybackFocusId} onFlyChange={onFlyChange} enabled={selectionMode === 'single' && linkMode === 'off' && !isMoving && !playbackEnabled} />
  </>
}

export default function App({ projectName, onRequestProjectManager }: { projectName?: string; onRequestProjectManager?: () => void } = {}) {
  const reduceMotion = useReducedMotion()
  const [graphs, setGraphs] = useState<Record<string, Graph>>(loadStoredGraphs)
  const restoredTabs = useMemo(() => loadStoredTabs(graphs), [])
  const [tabs, setTabs] = useState<{ id: string; path: string[] }[]>(restoredTabs.tabs)
  const [activeTabId, setActiveTabId] = useState(restoredTabs.activeId)
  const activeTab = tabs.find(tab => tab.id === activeTabId) || tabs[0]
  const path = activeTab.path
  const setPath = (next: string[] | ((current: string[]) => string[])) => setTabs(current => current.map(tab => tab.id === activeTabId ? { ...tab, path: typeof next === 'function' ? next(tab.path) : next } : tab))
  const graph = graphs[path[path.length - 1]] || initialGraph
  const restoredSelection = useMemo(() => loadStoredSelection(graph.id, graphs), [])
  const [selectedId, setSelectedId] = useState(restoredSelection.primary)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(restoredSelection.ids)
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('single')
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'scale' | null>('translate')
  const [flyNavigation, setFlyNavigation] = useState(false)
  const [query, setQuery] = useState('')
  const [mergeDuplicates, setMergeDuplicates] = useState(false)
  const [hierarchyQuery, setHierarchyQuery] = useState('')
  const [browserQuery, setBrowserQuery] = useState('')
  const [browserSelection, setBrowserSelection] = useState('root')
  const [graphContextMenu, setGraphContextMenu] = useState<{ graphId: string; x: number; y: number } | null>(null)
  const [renameGraphRequest, setRenameGraphRequest] = useState<{ graphId: string; name: string } | null>(null)
  const [deleteGraphRequest, setDeleteGraphRequest] = useState<string | null>(null)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(projectDeviceKey('expandedNodes')) || '[]')) }
    catch { return new Set() }
  })
  const [hierarchyRootExpanded, setHierarchyRootExpanded] = useState(() => localStorage.getItem(projectDeviceKey('hierarchyRootExpanded')) !== 'false')
  const [browserRootExpanded, setBrowserRootExpanded] = useState(() => localStorage.getItem(projectDeviceKey('browserRootExpanded')) !== 'false')
  const [dark, setDark] = useState(() => localStorage.getItem('wordverse.theme') === 'dark')
  const [editingId, setEditingId] = useState('')
  const [draftGraphName, setDraftGraphName] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const [viewRequest, setViewRequest] = useState<{ view: SceneView; nonce: number; locked?: boolean } | null>(null)
  const [lockedView, setLockedView] = useState<SceneView | null>(null)
  const [bringRequest, setBringRequest] = useState<{ id: string; nonce: number } | null>(null)
  const sceneCursorPoint = useRef<[number, number, number] | null>(null)
  const [linkMode, setLinkMode] = useState<'off' | 'single' | 'continuous'>('off')
  const [linkSourceIds, setLinkSourceIds] = useState<string[]>([])
  const [duplicateSourceId, setDuplicateSourceId] = useState('')
  const [selectedEdge, setSelectedEdge] = useState('')
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set())
  const [sceneFullscreen, setSceneFullscreen] = useState(() => localStorage.getItem('wordverse.sceneFullscreen') === 'true')
  const [sceneFailure, setSceneFailure] = useState(false)
  const [sceneGeneration, setSceneGeneration] = useState(0)
  const [contextMenu, setContextMenu] = useState<{ node: WordNode; x: number; y: number } | null>(null)
  const [isMoving, setIsMoving] = useState(false)
  const [gridVisible, setGridVisible] = useState(() => localStorage.getItem('wordverse.grid') === 'true')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsPage, setSettingsPage] = useState<'view' | 'shortcuts'>('view')
  const [recordingShortcut, setRecordingShortcut] = useState<ShortcutAction | null>(null)
  const [shortcutConflict, setShortcutConflict] = useState('')
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(() => {
    try {
      const merged = { ...DEFAULT_SHORTCUTS, ...JSON.parse(localStorage.getItem('wordverse.shortcuts') || '{}') } as ShortcutMap
      if (merged.selectSingle === 'KeyQ' && merged.gizmoMove === 'KeyW' && merged.gizmoScale === 'KeyR') { merged.selectSingle = 'KeyR'; merged.gizmoMove = 'KeyT'; merged.gizmoScale = 'KeyY' }
      ;(['forward', 'backward', 'left', 'right', 'up', 'down'] as const).forEach(action => {
        const key = merged[action]?.replace(/^Mouse[02]\+/, '') || DEFAULT_SHORTCUTS[action].replace('Mouse0+', '')
        merged[action] = `Mouse0+${key}`
      })
      return merged
    }
    catch { return DEFAULT_SHORTCUTS }
  })
  const [helpOpen, setHelpOpen] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(() => localStorage.getItem('wordverse.consoleOpen') !== 'false')
  const [traceEntries, setTraceEntries] = useState<{ time: string; level: 'info' | 'warn' | 'error'; scope: string; message: string }[]>([])
  const [trashOpen, setTrashOpen] = useState(false)
  const [fontScale, setFontScale] = useState(() => storedNumber('wordverse.fontScale', 1))
  const [fontStyle, setFontStyle] = useState<FontStyle>(() => {
    const saved = localStorage.getItem('wordverse.fontStyle')
    return saved === 'serif' || saved === 'compact' ? saved : 'modern'
  })
  const [lineScale, setLineScale] = useState(() => storedNumber('wordverse.lineScale', 1))
  const [gridDensity, setGridDensity] = useState(() => storedNumber('wordverse.gridDensity', 1))
  const [gridClarity, setGridClarity] = useState(() => storedNumber('wordverse.gridClarity', 1))
  const [gridRange, setGridRange] = useState(() => storedNumber('wordverse.gridRange', 52))
  const [motionEnabled, setMotionEnabled] = useState(() => localStorage.getItem('wordverse.motion') !== 'false')
  const [playbackEnabled, setPlaybackEnabled] = useState(false)
  const [motionSpeed, setMotionSpeed] = useState(() => storedNumber('wordverse.motionSpeed', .55))
  const [motionAmplitude, setMotionAmplitude] = useState(() => storedNumber('wordverse.motionAmplitude', .09))
  const [globalProperties, setGlobalProperties] = useState<PropertyDefinition[]>(loadGlobalProperties)
  const [propertyTarget, setPropertyTarget] = useState<'node' | 'global' | null>(null)
  const [propertyName, setPropertyName] = useState('')
  const [propertyType, setPropertyType] = useState<PropertyType>('text')
  const [editingPropertyId, setEditingPropertyId] = useState('')
  const [imageUploadError, setImageUploadError] = useState('')
  const [transformExpanded, setTransformExpanded] = useState(false)
  const [imagePreview, setImagePreview] = useState<{ value: string; alt: string } | null>(null)
  const [expandedText, setExpandedText] = useState<{ id: string; name: string } | null>(null)
  const [deletePropertyRequest, setDeletePropertyRequest] = useState<{ id: string; name: string; global: boolean } | null>(null)
  const [autoLayout, setAutoLayout] = useState(() => localStorage.getItem('wordverse.autoLayout') !== 'false')
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => storedNumber('wordverse.leftPanelWidth', 220))
  const [rightPanelWidth, setRightPanelWidth] = useState(() => storedNumber('wordverse.rightPanelWidth', 294))
  const [resizingPanel, setResizingPanel] = useState<'left' | 'right' | null>(null)
  const [storageReady, setStorageReady] = useState(false)
  const [saveState, setSaveState] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading')
  const [storageConflict, setStorageConflict] = useState(false)
  const [backups, setBackups] = useState<WorkspaceBackup[]>([])
  const [backupBusy, setBackupBusy] = useState(false)
  const [closeProblem, setCloseProblem] = useState<'timeout' | 'save-error' | 'close-error' | null>(null)
  const undoStack = useRef<Record<string, Graph>[]>([])
  const redoStack = useRef<Record<string, Graph>[]>([])
  const saveTimer = useRef<number | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const lastSaveSucceeded = useRef(true)
  const saveGeneration = useRef(0)
  const revision = useRef(0)
  const closeAttempt = useRef(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const trace = useCallback((scope: string, message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false, fractionalSecondDigits: 3 })
    setTraceEntries(current => [...current.slice(-199), { time, level, scope, message }])
  }, [])
  const selected = graph.nodes.find(n => n.id === selectedId) || graph.nodes[0]
  useEffect(() => {
    setSelectedEdge('')
    setSelectedEdges(new Set())
    setLinkMode('off')
    setLinkSourceIds([])
  }, [graph.id])
  useEffect(() => {
    setSelectedIds(current => {
      if (!selectedId) return current.size ? new Set() : current
      const valid = new Set(graph.nodes.filter(node => current.has(node.id)).map(node => node.id))
      valid.add(selectedId)
      return valid.size === current.size && [...valid].every(id => current.has(id)) ? current : valid
    })
  }, [selectedId, graph.id, graph.nodes])
  useEffect(() => { if (reduceMotion) setPlaybackEnabled(false) }, [reduceMotion])
  useEffect(() => {
    const describe = (value: unknown) => value instanceof Error ? `${value.name}: ${value.message}` : typeof value === 'string' ? value : (() => { try { return JSON.stringify(value) } catch { return String(value) } })()
    const onError = (event: ErrorEvent) => trace('window', `${event.message} · ${event.filename}:${event.lineno}`, 'error')
    const onRejection = (event: PromiseRejectionEvent) => trace('promise', describe(event.reason), 'error')
    const originalError = console.error, originalWarn = console.warn
    console.error = (...values) => { trace('console', values.map(describe).join(' '), 'error'); originalError(...values) }
    console.warn = (...values) => { trace('console', values.map(describe).join(' '), 'warn'); originalWarn(...values) }
    addEventListener('error', onError); addEventListener('unhandledrejection', onRejection)
    trace('app', 'Trace console ready')
    return () => { console.error = originalError; console.warn = originalWarn; removeEventListener('error', onError); removeEventListener('unhandledrejection', onRejection) }
  }, [trace])
  useEffect(() => {
    let cancelled = false
    workspaceStorage.load().then(document => {
      if (cancelled) return
      if (document) {
        setGraphs(document.graphs)
        setGlobalProperties(document.globalProperties)
        revision.current = document.revision
        const restoredWorkspaceTabs = loadStoredTabs(document.graphs)
        setTabs(restoredWorkspaceTabs.tabs)
        setActiveTabId(restoredWorkspaceTabs.activeId)
        const restoredTab = restoredWorkspaceTabs.tabs.find(tab => tab.id === restoredWorkspaceTabs.activeId) || restoredWorkspaceTabs.tabs[0]
        const restoredGraphId = restoredTab.path[restoredTab.path.length - 1]
        const selection = loadStoredSelection(restoredGraphId, document.graphs)
        setSelectedId(selection.primary)
        setSelectedIds(selection.ids)
      }
      setStorageReady(true)
      setSaveState('saved')
    }).catch(() => {
      if (cancelled) return
      setStorageReady(true)
      setSaveState('error')
    })
    return () => { cancelled = true }
  }, [])
  const queueWorkspaceSave = useCallback((generation: number) => {
    const documentRevision = ++revision.current
    const document = { schemaVersion: CURRENT_SCHEMA_VERSION, revision: documentRevision, updatedAt: new Date().toISOString(), graphs, globalProperties }
    setSaveState('saving')
    saveQueue.current = saveQueue.current.catch(() => undefined).then(() => workspaceStorage.save(document)).then(() => {
      lastSaveSucceeded.current = true
      localStorage.removeItem('wordverse.graph')
      localStorage.removeItem('wordverse.globalProperties')
      if (saveGeneration.current === generation) setSaveState('saved')
    }).catch(error => {
      lastSaveSucceeded.current = false
      if (error instanceof StorageConflictError) setStorageConflict(true)
      if (saveGeneration.current === generation) setSaveState('error')
    })
  }, [graphs, globalProperties])
  const saveImmediately = useCallback(() => {
    if (!storageReady) return
    if (saveTimer.current !== null) { window.clearTimeout(saveTimer.current); saveTimer.current = null }
    queueWorkspaceSave(++saveGeneration.current)
  }, [queueWorkspaceSave, storageReady])
  const forceCloseApp = async () => {
    if (!('__TAURI_INTERNALS__' in window)) { setCloseProblem(null); return }
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().destroy()
    } catch { setCloseProblem('close-error') }
  }
  useEffect(() => {
    const flushWhenHidden = () => { if (document.visibilityState === 'hidden') saveImmediately() }
    document.addEventListener('visibilitychange', flushWhenHidden)
    let disposed = false
    let unlisten: (() => void) | undefined
    if ('__TAURI_INTERNALS__' in window) {
      import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        if (disposed) return
        const appWindow = getCurrentWindow()
        unlisten = await appWindow.onCloseRequested(async event => {
          event.preventDefault()
          if (closeAttempt.current) return
          closeAttempt.current = true
          saveImmediately()
          const outcome = await Promise.race([
            saveQueue.current.then(() => 'settled' as const),
            new Promise<'timeout'>(resolve => window.setTimeout(() => resolve('timeout'), 4000))
          ])
          if (outcome === 'settled' && lastSaveSucceeded.current) {
            try { await appWindow.destroy(); return }
            catch { closeAttempt.current = false; setCloseProblem('close-error'); return }
          }
          closeAttempt.current = false
          setCloseProblem(outcome === 'timeout' ? 'timeout' : 'save-error')
        })
      }).catch(() => undefined)
    }
    return () => { disposed = true; unlisten?.(); document.removeEventListener('visibilitychange', flushWhenHidden) }
  }, [saveImmediately])
  useEffect(() => {
    if (!storageReady) return
    const generation = ++saveGeneration.current
    setSaveState('saving')
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => queueWorkspaceSave(generation), workspaceAutoSaveDelay)
    return () => { if (saveTimer.current !== null) window.clearTimeout(saveTimer.current) }
  }, [queueWorkspaceSave, storageReady])
  useEffect(() => localStorage.setItem('wordverse.grid', String(gridVisible)), [gridVisible])
  useEffect(() => localStorage.setItem('wordverse.theme', dark ? 'dark' : 'light'), [dark])
  useEffect(() => localStorage.setItem('wordverse.fontScale', String(fontScale)), [fontScale])
  useEffect(() => localStorage.setItem('wordverse.fontStyle', fontStyle), [fontStyle])
  useEffect(() => localStorage.setItem('wordverse.lineScale', String(lineScale)), [lineScale])
  useEffect(() => localStorage.setItem('wordverse.gridDensity', String(gridDensity)), [gridDensity])
  useEffect(() => localStorage.setItem('wordverse.gridClarity', String(gridClarity)), [gridClarity])
  useEffect(() => localStorage.setItem('wordverse.gridRange', String(gridRange)), [gridRange])
  useEffect(() => localStorage.setItem('wordverse.motion', String(motionEnabled)), [motionEnabled])
  useEffect(() => localStorage.setItem(projectDeviceKey('hierarchyRootExpanded'), String(hierarchyRootExpanded)), [hierarchyRootExpanded])
  useEffect(() => localStorage.setItem(projectDeviceKey('browserRootExpanded'), String(browserRootExpanded)), [browserRootExpanded])
  useEffect(() => localStorage.setItem(projectDeviceKey('expandedNodes'), JSON.stringify([...expandedNodes])), [expandedNodes])
  useEffect(() => localStorage.setItem('wordverse.sceneFullscreen', String(sceneFullscreen)), [sceneFullscreen])
  useEffect(() => localStorage.setItem('wordverse.consoleOpen', String(consoleOpen)), [consoleOpen])
  useEffect(() => localStorage.setItem('wordverse.motionSpeed', String(motionSpeed)), [motionSpeed])
  useEffect(() => localStorage.setItem('wordverse.motionAmplitude', String(motionAmplitude)), [motionAmplitude])
  useEffect(() => localStorage.setItem('wordverse.autoLayout', String(autoLayout)), [autoLayout])
  useEffect(() => localStorage.setItem('wordverse.shortcuts', JSON.stringify(shortcuts)), [shortcuts])
  useEffect(() => { if (!settingsOpen) { setRecordingShortcut(null); setShortcutConflict('') } }, [settingsOpen])
  useEffect(() => localStorage.setItem('wordverse.leftPanelWidth', String(leftPanelWidth)), [leftPanelWidth])
  useEffect(() => localStorage.setItem('wordverse.rightPanelWidth', String(rightPanelWidth)), [rightPanelWidth])
  useEffect(() => {
    if (!settingsOpen) return
    workspaceStorage.listBackups().then(setBackups).catch(() => setBackups([]))
  }, [settingsOpen, saveState])
  useEffect(() => {
    if (!resizingPanel) return
    const move = (event: PointerEvent) => resizingPanel === 'left' ? setLeftPanelWidth(Math.max(180, Math.min(380, event.clientX))) : setRightPanelWidth(Math.max(240, Math.min(460, innerWidth - event.clientX)))
    const stop = () => setResizingPanel(null)
    addEventListener('pointermove', move); addEventListener('pointerup', stop)
    return () => { removeEventListener('pointermove', move); removeEventListener('pointerup', stop) }
  }, [resizingPanel])
  useEffect(() => localStorage.setItem(projectDeviceKey('tabs'), JSON.stringify({ tabs, activeId: activeTabId })), [tabs, activeTabId])
  useEffect(() => {
    if (!storageReady) return
    const validIds = [...selectedIds].filter(id => graph.nodes.some(node => node.id === id))
    const validPrimary = graph.nodes.some(node => node.id === selectedId) ? selectedId : validIds[0] || ''
    try {
      const stored = JSON.parse(localStorage.getItem(projectDeviceKey('selections')) || '{}') as Record<string, { primary: string; ids: string[] }>
      stored[graph.id] = { primary: validPrimary, ids: validIds }
      localStorage.setItem(projectDeviceKey('selections'), JSON.stringify(stored))
    } catch { localStorage.setItem(projectDeviceKey('selections'), JSON.stringify({ [graph.id]: { primary: validPrimary, ids: validIds } })) }
  }, [storageReady, graph.id, graph.nodes, selectedId, selectedIds])
  const navigateBack = () => {
    if (path.length <= 1) return
    const leavingGraphId = path[path.length - 1]
    const parentNodeId = leavingGraphId.startsWith('child:') ? leavingGraphId.slice('child:'.length) : ''
    setPath(current => current.slice(0, -1)); setSelectedId(parentNodeId)
    setFocusRequest(value => value + 1)
  }
  const commitGraphs = (change: (current: Record<string, Graph>) => Record<string, Graph>) => setGraphs(current => {
    const next = change(current)
    if (next === current) return current
    undoStack.current.push(current); if (undoStack.current.length > 80) undoStack.current.shift()
    redoStack.current = []
    return next
  })
  const undo = () => setGraphs(current => {
    const previous = undoStack.current.pop(); if (!previous) return current
    redoStack.current.push(current); return previous
  })
  const redo = () => setGraphs(current => {
    const next = redoStack.current.pop(); if (!next) return current
    undoStack.current.push(current); return next
  })
  const encapsulateSelection = () => {
    const selectedNodes = graph.nodes.filter(node => selectedIds.has(node.id) && !node.isContextRoot)
    if (selectedNodes.length < 2) return
    const selectedSet = new Set(selectedNodes.map(node => node.id))
    const containerId = crypto.randomUUID()
    const childId = `child:${containerId}`
    const timestamp = new Date().toISOString()
    const center = selectedNodes.reduce((sum, node) => sum.add(new Vector3(...node.position)), new Vector3()).multiplyScalar(1 / selectedNodes.length)
    const container: WordNode = { id: containerId, label: '子词网', note: '', tags: [], links: [], position: [center.x, center.y, center.z], scale: 1, hasChildGraph: true, positionLocked: true, createdAt: timestamp, updatedAt: timestamp }
    const contextRoot: WordNode = { id: crypto.randomUUID(), label: '子词网', note: '当前子词网的上下文词。', tags: [], links: [], position: [0, 0, 2.6], scale: 1, isContextRoot: true, positionLocked: true, createdAt: timestamp, updatedAt: timestamp }
    const innerNodes = selectedNodes.map(node => ({ ...node, position: [node.position[0] - center.x, node.position[1] - center.y, node.position[2] - center.z] as [number, number, number] }))
    const innerEdges = graph.edges.filter(edge => selectedSet.has(edge.source) && selectedSet.has(edge.target))
    const edgeKeys = new Set<string>()
    const outerEdges = graph.edges.flatMap(edge => {
      const sourceInside = selectedSet.has(edge.source), targetInside = selectedSet.has(edge.target)
      if (sourceInside && targetInside) return []
      const next = { source: sourceInside ? containerId : edge.source, target: targetInside ? containerId : edge.target }
      if (next.source === next.target) return []
      const key = [next.source, next.target].sort().join(':')
      if (edgeKeys.has(key)) return []
      edgeKeys.add(key)
      return [next]
    })
    commitGraphs(current => ({
      ...current,
      [graph.id]: { ...(current[graph.id] || graph), nodes: [...graph.nodes.filter(node => !selectedSet.has(node.id)), container], edges: outerEdges },
      [childId]: { id: childId, name: container.label, nodes: [contextRoot, ...innerNodes], edges: innerEdges }
    }))
    setSelectedIds(new Set([containerId])); setSelectedId(containerId); setSelectedEdge('')
    setSelectionMode('single'); setGizmoMode('translate'); setEditingId(containerId)
  }
  useEffect(() => {
    const back = (event: KeyboardEvent) => {
      const typing = isTextEditing()
      if (recordingShortcut) return
      if (matchesShortcut(event, shortcuts.save)) { event.preventDefault(); saveImmediately(); return }
      if (event.key === 'Escape') { if (imagePreview) setImagePreview(null); else if (expandedText) setExpandedText(null); else if (closeProblem) setCloseProblem(null); else if (helpOpen) setHelpOpen(false); else if (deleteGraphRequest) setDeleteGraphRequest(null); else if (renameGraphRequest) setRenameGraphRequest(null); else if (graphContextMenu) setGraphContextMenu(null); else if (deletePropertyRequest) setDeletePropertyRequest(null); else if (editingPropertyId) setEditingPropertyId(''); else if (propertyTarget) setPropertyTarget(null); else if (editingId) setEditingId(''); else if (linkMode !== 'off' || duplicateSourceId || contextMenu) cancelActiveMode(); else if (selectionMode !== 'single' || gizmoMode) { setSelectionMode('single'); setGizmoMode(null) } else if (draftGraphName !== null) setDraftGraphName(null); else if (!typing) navigateBack() }
      if (!typing && event.key === '?') { event.preventDefault(); setSettingsPage('shortcuts'); setSettingsOpen(true); setHelpOpen(false); setTrashOpen(false) }
      if (!typing && matchesShortcut(event, shortcuts.rename) && selectedId) { event.preventDefault(); setEditingId(selectedId); setContextMenu(null) }
      if (!typing && matchesShortcut(event, shortcuts.duplicate) && selectedId) { event.preventDefault(); cancelActiveMode(); setDuplicateSourceId(selectedId); setPlaybackEnabled(false); setSelectedEdge('') }
      if (!typing && matchesShortcut(event, shortcuts.encapsulate) && selectedIds.size > 1) { event.preventDefault(); cancelActiveMode(); encapsulateSelection() }
      if (!typing && selectedEdge && (matchesShortcut(event, shortcuts.edgeSource) || matchesShortcut(event, shortcuts.edgeTarget))) {
        event.preventDefault()
        const [source, target] = selectedEdge.split(':')
        const endpoint = matchesShortcut(event, shortcuts.edgeSource) ? source : target
        if (graph.nodes.some(node => node.id === endpoint)) {
          setSelectedIds(new Set([endpoint])); setSelectedId(endpoint)
          setSelectionMode('single'); setGizmoMode(null)
          setFocusRequest(value => value + 1)
        }
      }
      if (!typing && !editingId && matchesShortcut(event, shortcuts.fullscreen)) { event.preventDefault(); setSceneFullscreen(value => !value); setSettingsOpen(false); setContextMenu(null) }
      if (!typing && (matchesShortcut(event, shortcuts.link) || matchesShortcut(event, shortcuts.linkContinuous))) { event.preventDefault(); setDuplicateSourceId(''); const mode = matchesShortcut(event, shortcuts.linkContinuous) ? 'continuous' : 'single'; const sources = selectedId && selectedIds.has(selectedId) && selectedIds.size > 1 ? [...selectedIds] : selectedId ? [selectedId] : []; setMergeDuplicates(false); setLinkMode(mode); setLinkSourceIds(sources); setSelectedEdge(''); setSelectedEdges(new Set()); setContextMenu(null) }
      if (!typing && !flyNavigation && matchesShortcut(event, shortcuts.selectSingle)) { event.preventDefault(); cancelActiveMode(); setSelectionMode('single'); setGizmoMode(null) }
      if (!typing && !flyNavigation && matchesShortcut(event, shortcuts.gizmoMove)) { event.preventDefault(); cancelActiveMode(); setSelectionMode('single'); setGizmoMode('translate') }
      if (!typing && !flyNavigation && matchesShortcut(event, shortcuts.gizmoScale)) { event.preventDefault(); cancelActiveMode(); setSelectionMode('single'); setGizmoMode('scale') }
      if (!typing && !flyNavigation && matchesShortcut(event, shortcuts.selectBox)) { event.preventDefault(); cancelActiveMode(); setSelectionMode('box'); setGizmoMode(null) }
      if (!typing && !flyNavigation && matchesShortcut(event, shortcuts.selectLasso)) { event.preventDefault(); cancelActiveMode(); setSelectionMode('lasso'); setGizmoMode(null) }
      if (!typing && matchesShortcut(event, shortcuts.remove)) {
        if (selectedEdges.size || selectedEdge) { event.preventDefault(); const keys = selectedEdges.size ? [...selectedEdges] : [selectedEdge]; setGraph(current => cutRelations(current, keys.map(key => { const [source, target] = key.split(':'); return { source, target } }), new Date().toISOString())); setSelectedEdge(''); setSelectedEdges(new Set()) }
        else if (selectedId) { event.preventDefault(); removeNode() }
      }
      if (!typing && matchesShortcut(event, shortcuts.redo)) { event.preventDefault(); redo() }
      else if (!typing && matchesShortcut(event, shortcuts.undo)) { event.preventDefault(); undo() }
      if (matchesShortcut(event, shortcuts.search)) { event.preventDefault(); searchInputRef.current?.focus(); searchInputRef.current?.select() }
    }
    addEventListener('keydown', back); return () => removeEventListener('keydown', back)
  }, [editingId, editingPropertyId, imagePreview, expandedText, propertyTarget, deletePropertyRequest, deleteGraphRequest, renameGraphRequest, graphContextMenu, draftGraphName, helpOpen, closeProblem, linkMode, duplicateSourceId, selectedId, selectedIds, selectedEdge, selectedEdges, contextMenu, graph, saveImmediately, shortcuts, recordingShortcut, selectionMode, gizmoMode, flyNavigation])
  const setGraph = (change: (graph: Graph) => Graph) => commitGraphs(all => ({ ...all, [graph.id]: change(all[graph.id] || graph) }))
  const update = (patch: Partial<WordNode>) => setGraph(g => ({ ...g, nodes: g.nodes.map(n => n.id === selected.id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n) }))
  const updatePositionAxis = (axis: number, rawValue: string) => {
    const value = Number(rawValue)
    if (!selected || !Number.isFinite(value)) return
    const vector = [...selected.position] as [number, number, number]
    vector[axis] = value
    update({ position: vector, positionLocked: true })
  }
  const updateScale = (rawValue: string) => { const value = Number(rawValue); if (Number.isFinite(value)) update({ scale: Math.max(.05, Math.min(20, value)) }) }
  const updateProperty = (definition: PropertyDefinition, value: PropertyValue) => update({ properties: [...(selected.properties || []).filter(item => item.id !== definition.id), { ...definition, value }] })
  const addPropertyDefinition = () => {
    const name = propertyName.trim()
    if (!name || !propertyTarget) return
    const definition: PropertyDefinition = { id: crypto.randomUUID(), name, type: propertyType }
    if (propertyTarget === 'global') setGlobalProperties(current => [...current, definition])
    else {
      update({ properties: [...(selected.properties || []), { ...definition, value: propertyType === 'text-list' ? [] : '' }] })
      setEditingPropertyId(definition.id)
    }
    setPropertyName(''); setPropertyType('text'); setPropertyTarget(null)
  }
  const removeProperty = (id: string, global: boolean) => {
    if (global) {
      setGlobalProperties(current => current.filter(item => item.id !== id))
      commitGraphs(current => Object.fromEntries(Object.entries(current).map(([graphId, item]) => [graphId, { ...item, nodes: item.nodes.map(node => ({ ...node, properties: (node.properties || []).filter(property => property.id !== id) })) }])))
    }
    else update({ properties: (selected.properties || []).filter(item => item.id !== id) })
  }
  const confirmPropertyDelete = () => {
    if (!deletePropertyRequest) return
    if (deletePropertyRequest.id === '__note__') update({ note: '' })
    else removeProperty(deletePropertyRequest.id, deletePropertyRequest.global)
    setEditingPropertyId(''); setDeletePropertyRequest(null)
  }
  const enterGraph = (node: WordNode) => {
    const id = `child:${node.id}`
    commitGraphs(all => {
      if (!all[id]) return { ...all, [id]: { id, name: node.label, nodes: [{ id: crypto.randomUUID(), label: node.label, note: '当前子词网的上下文词。', tags: [], links: [], position: [0, 0, 0], scale: 1, isContextRoot: true }], edges: [] } }
      return { ...all, [id]: { ...all[id], nodes: all[id].nodes.map((child, index) => index === 0 ? { ...child, isContextRoot: true, hasChildGraph: false } : child) } }
    })
    setGraph(g => ({ ...g, nodes: g.nodes.map(n => n.id === node.id ? { ...n, hasChildGraph: true } : n) }))
    setPath(p => [...p, id]); setTimeout(() => setSelectedId(''), 0)
  }
  const connectMany = (sources: string[], target: string) => setGraph(g => connectRelations(g, sources, target))
  const beginNodeMove = () => {
    undoStack.current.push(graphs); if (undoStack.current.length > 80) undoStack.current.shift()
    redoStack.current = []
  }
  const transformNodes = (values: Map<string, { position: [number, number, number]; scale: number }>) => setGraphs(all => ({ ...all, [graph.id]: { ...(all[graph.id] || graph), nodes: (all[graph.id] || graph).nodes.map(node => values.has(node.id) ? { ...node, ...values.get(node.id)! } : node) } }))
  const finishNodeMove = () => {
    const moved = new Set(selectedIds)
    setGraphs(all => ({ ...all, [graph.id]: { ...(all[graph.id] || graph), nodes: (all[graph.id] || graph).nodes.map(node => moved.has(node.id) ? { ...node, positionLocked: true, updatedAt: new Date().toISOString() } : node) } }))
    setIsMoving(false)
    trace('transform', `Moved ${selectedIds.size} node(s)`)
  }
  const bringNodeIntoView = (id: string, position: [number, number, number]) => setGraph(g => ({ ...g, nodes: g.nodes.map(node => node.id === id ? { ...node, position, positionLocked: true, updatedAt: new Date().toISOString() } : node) }))
  const activateNode = (id: string, additive = false) => {
    setSelectedEdge(''); setSelectedEdges(new Set())
    if (linkMode === 'off') {
      if (additive && selectedIds.has(id)) {
        const next = new Set(selectedIds); next.delete(id)
        setSelectedIds(next); setSelectedId([...next].at(-1) || '')
      } else {
        const next = additive ? new Set(selectedIds).add(id) : new Set([id])
        setSelectedIds(next); setSelectedId(id)
      }
      return
    }
    if (!linkSourceIds.length) { setLinkSourceIds([id]); setSelectedId(id); return }
    const sources = linkSourceIds.filter(source => source !== id)
    if (!sources.length) return
    connectMany(sources, id); setSelectedIds(new Set([id])); setSelectedId(id)
    if (linkMode === 'single') { setLinkMode('off'); setLinkSourceIds([]) }
  }
  const selectMany = (ids: string[], edgeKeys: string[], additive: boolean) => {
    const primary = ids[ids.length - 1] || (additive ? selectedId : '')
    setSelectedIds(current => {
      const next = additive ? new Set(current) : new Set<string>()
      ids.forEach(id => next.add(id))
      return next
    })
    setSelectedEdges(current => {
      const next = additive ? new Set(current) : new Set<string>()
      edgeKeys.forEach(key => next.add(key))
      return next
    })
    setSelectedId(primary); setSelectedEdge(edgeKeys.at(-1) || (additive ? selectedEdge : ''))
    setSelectionMode('single'); setGizmoMode(ids.length ? 'translate' : null)
    trace('selection', `${additive ? 'Added' : 'Selected'} ${ids.length} node(s), ${edgeKeys.length} relation(s)`)
  }
  const startLink = (nodeId = selectedId, mode: 'single' | 'continuous' = 'single') => {
    const sources = nodeId && selectedIds.has(nodeId) && selectedIds.size > 1 ? [...selectedIds] : nodeId ? [nodeId] : []
    setMergeDuplicates(false); setLinkMode(mode); setLinkSourceIds(sources); setSelectedEdge(''); setSelectedEdges(new Set()); setContextMenu(null)
  }
  const cancelActiveMode = () => { setLinkMode('off'); setLinkSourceIds([]); setDuplicateSourceId(''); setContextMenu(null) }
  const openGraphTab = (graphId: string) => {
    const existing = tabs.find(tab => tab.path[tab.path.length - 1] === graphId)
    if (existing) { setActiveTabId(existing.id); setSelectedId(''); return }
    const graphPath = findGraphPath(graphs, graphId) || [graphId]
    const id = `tab:${crypto.randomUUID()}`
    setTabs(current => [...current, { id, path: graphPath }]); setActiveTabId(id); setSelectedId('')
  }
  const createMainGraph = (name: string) => {
    const graphId = `graph:${crypto.randomUUID()}`
    commitGraphs(current => ({ ...current, [graphId]: { id: graphId, name: name.trim(), nodes: [], edges: [] } }))
    const tabId = `tab:${crypto.randomUUID()}`
    setTabs(current => [...current, { id: tabId, path: [graphId] }]); setActiveTabId(tabId); setSelectedId(''); setDraftGraphName(null)
  }
  const renameMainGraph = () => {
    if (!renameGraphRequest?.name.trim()) return
    commitGraphs(current => ({ ...current, [renameGraphRequest.graphId]: { ...current[renameGraphRequest.graphId], name: renameGraphRequest.name.trim() } }))
    setRenameGraphRequest(null)
  }
  const deleteMainGraph = () => {
    const mainGraphCount = Object.keys(graphs).filter(id => id === 'root' || id.startsWith('graph:')).length
    if (!deleteGraphRequest || deleteGraphRequest === 'root' || mainGraphCount <= 1) return
    commitGraphs(current => deleteGraphTree(current, deleteGraphRequest))
    const remainingTabs = tabs.filter(tab => tab.path[0] !== deleteGraphRequest)
    const nextTabs = remainingTabs.length ? remainingTabs : [{ id: 'tab:root', path: ['root'] }]
    setTabs(nextTabs)
    if (!nextTabs.some(tab => tab.id === activeTabId)) setActiveTabId(nextTabs[0].id)
    setBrowserSelection('root'); setSelectedId(''); setDeleteGraphRequest(null)
  }
  const closeTab = (id: string) => {
    if (tabs.length === 1) return
    const index = tabs.findIndex(tab => tab.id === id)
    const remaining = tabs.filter(tab => tab.id !== id)
    setTabs(remaining)
    if (activeTabId === id) { setActiveTabId(remaining[Math.max(0, index - 1)].id); setSelectedId('') }
  }
  const toggleHierarchyNode = (nodeId: string) => setExpandedNodes(current => {
    const next = new Set(current); if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId); return next
  })
  const visitHierarchyNode = (node: WordNode, ownerGraphId: string, shouldFocus: boolean) => {
    const ownerPath = findGraphPath(graphs, ownerGraphId, path[0]) || [path[0]]
    setPath(ownerPath); setSelectedId(node.id); cancelActiveMode()
    if (shouldFocus) setFocusRequest(value => value + 1)
  }
  const hierarchyNeedle = hierarchyQuery.trim().toLowerCase()
  const graphContainsHierarchyMatch = (candidate: Graph): boolean => candidate.nodes.some(node => {
    const selfMatches = node.label.toLowerCase().includes(hierarchyNeedle) || node.tags.some(tag => tag.toLowerCase().includes(hierarchyNeedle))
    const child = graphs[`child:${node.id}`]
    return selfMatches || (!!child && graphContainsHierarchyMatch(child))
  })
  const renderHierarchyNodes = (ownerGraph: Graph, depth = 0, nested = false): React.ReactNode => ownerGraph.nodes
    .filter(node => !nested || !node.isContextRoot)
    .filter(node => !hierarchyNeedle || node.label.toLowerCase().includes(hierarchyNeedle) || node.tags.some(tag => tag.toLowerCase().includes(hierarchyNeedle)) || (!!graphs[`child:${node.id}`] && graphContainsHierarchyMatch(graphs[`child:${node.id}`])))
    .map(node => {
      const childGraph = graphs[`child:${node.id}`]
      const expanded = expandedNodes.has(node.id)
      return <div key={`${ownerGraph.id}:${node.id}`} className="hierarchy-branch"><div className={node.id === selectedId && ownerGraph.id === graph.id ? 'tree-item selected' : 'tree-item'} style={{ paddingLeft: `${20 + depth * 14}px` }} onContextMenu={event => { event.preventDefault(); visitHierarchyNode(node, ownerGraph.id, false); setContextMenu({ node, x: event.clientX, y: event.clientY }) }}><button className="tree-expand" aria-label={expanded ? '折叠子词网' : '展开子词网'} disabled={!childGraph} onClick={() => childGraph && toggleHierarchyNode(node.id)}>{childGraph ? <ChevronDown size={12} className={expanded || !!hierarchyNeedle ? '' : 'collapsed'}/> : <span className="node-dot"/>}</button><button className="tree-select" onDoubleClick={() => visitHierarchyNode(node, ownerGraph.id, true)} onClick={() => visitHierarchyNode(node, ownerGraph.id, false)}><span>{node.label}</span></button></div>{childGraph && (expanded || !!hierarchyNeedle) && <div className="tree-children">{renderHierarchyNodes(childGraph, depth + 1, true)}</div>}</div>
    })
  const addNode = (label = '新词', requestedPosition?: [number, number, number]) => {
    const id = crypto.randomUUID()
    setGraph(g => {
      const timestamp = new Date().toISOString()
      const position = requestedPosition ? nearbyIntentPosition(g.nodes, requestedPosition) : balancedPosition(g.nodes)
      const node: WordNode = { id, label: label.trim(), note: '', tags: [], links: [], position, scale: selected?.scale || 1, positionLocked: !!requestedPosition, createdAt: timestamp, updatedAt: timestamp }
      const nodes = [...g.nodes, node]
      const arranged = autoLayout ? relaxLayout(nodes) : nodes
      return { ...g, nodes: arranged.map(item => item.id === id ? { ...item, positionLocked: false } : item) }
    }); setSelectedIds(new Set([id])); setSelectedId(id); setEditingId(id); trace('node', `Created ${id}`)
  }
  const duplicateNodeAt = (requestedPosition: [number, number, number]) => {
    const source = graph.nodes.find(node => node.id === duplicateSourceId)
    if (!source) { setDuplicateSourceId(''); return }
    const id = crypto.randomUUID()
    const timestamp = new Date().toISOString()
    setGraph(current => {
      const duplicate: WordNode = {
        id,
        label: '新词',
        note: '',
        tags: [],
        links: [],
        position: [...requestedPosition],
        scale: source.scale || 1,
        positionLocked: true,
        hasChildGraph: false,
        isContextRoot: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        properties: []
      }
      return { ...current, nodes: [...current.nodes, duplicate], edges: [...current.edges, { source: source.id, target: id }] }
    })
    setSelectedIds(new Set([id])); setSelectedId(id); setSelectedEdge(''); setDuplicateSourceId(''); setEditingId(id); trace('node', `Duplicated ${source.id} as ${id}`)
  }
  useEffect(() => {
    if (!duplicateSourceId) return
    const confirmPlacement = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || isTextEditing() || !sceneCursorPoint.current) return
      event.preventDefault()
      duplicateNodeAt(sceneCursorPoint.current)
    }
    addEventListener('keydown', confirmPlacement)
    return () => removeEventListener('keydown', confirmPlacement)
  }, [duplicateSourceId, graph])
  const renameNode = (id: string, label: string | null) => {
    if (label !== null && label.trim()) {
      const nextLabel = label.trim()
      const childId = `child:${id}`
      commitGraphs(current => ({
        ...current,
        [graph.id]: { ...(current[graph.id] || graph), nodes: (current[graph.id] || graph).nodes.map(node => node.id === id ? { ...node, label: nextLabel, updatedAt: new Date().toISOString() } : node) },
        ...(current[childId] ? { [childId]: { ...current[childId], name: nextLabel, nodes: current[childId].nodes.map(node => node.isContextRoot ? { ...node, label: nextLabel, updatedAt: new Date().toISOString() } : node) } } : {})
      }))
    }
    setEditingId('')
  }
  const removeNode = () => {
    const requested = graph.nodes.filter(node => selectedIds.has(node.id) && !node.isContextRoot).map(node => node.id)
    const removable = requested.slice(0, Math.max(0, graph.nodes.length - 1))
    if (!removable.length) return
    const removed = new Set(removable)
    const timestamp = new Date().toISOString()
    setGraph(g => removable.reduce((current, id) => deleteWord(current, id, timestamp), g))
    const next = graph.nodes.find(node => !removed.has(node.id))?.id || ''
    setSelectedIds(next ? new Set([next]) : new Set()); setSelectedId(next)
  }
  const trashItems = Object.values(graphs).flatMap(candidate => (candidate.trash || []).map(item => ({ ...item, graphId: candidate.id, graphName: candidate.name }))).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  const deletedRelations = Object.values(graphs).flatMap(candidate => (candidate.deletedEdges || []).map(item => ({ ...item, graphId: candidate.id, graphName: candidate.name, sourceName: candidate.nodes.find(node => node.id === item.edge.source)?.label || '未知词', targetName: candidate.nodes.find(node => node.id === item.edge.target)?.label || '未知词' }))).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  const restoreDeletedNode = (graphId: string, nodeId: string) => commitGraphs(current => {
    const owner = current[graphId]
    if (!owner) return current
    const restored = restoreWord(owner, nodeId)
    return restored === owner ? current : { ...current, [graphId]: restored }
  })
  const restoreDeletedRelation = (graphId: string, source: string, target: string, deletedAt: string) => commitGraphs(current => {
    const owner = current[graphId]
    if (!owner) return current
    const restored = restoreRelation(owner, source, target, deletedAt)
    return restored === owner ? current : { ...current, [graphId]: restored }
  })
  const visibleProperties = selected ? [
    ...globalProperties.map(definition => ({ definition, value: selected.properties?.find(item => item.id === definition.id)?.value ?? (definition.type === 'text-list' ? [] : ''), global: true })),
    ...(selected.properties || []).filter(item => !globalProperties.some(definition => definition.id === item.id)).map(item => ({ definition: item as PropertyDefinition, value: item.value, global: false }))
  ] : []
  const expandedTextDefinition = expandedText?.id === '__note__' ? null : visibleProperties.find(item => item.definition.id === expandedText?.id)?.definition
  const expandedTextValue = expandedText?.id === '__note__' ? selected?.note || '' : typeof selected?.properties?.find(item => item.id === expandedText?.id)?.value === 'string' ? selected.properties.find(item => item.id === expandedText?.id)!.value as string : ''
  const updateExpandedText = (value: string) => {
    if (!expandedText) return
    if (expandedText.id === '__note__') update({ note: value })
    else if (expandedTextDefinition) updateProperty(expandedTextDefinition, value)
  }
  const choosePropertyImage = async (definition: PropertyDefinition, file?: File) => {
    if (!file) return
    setImageUploadError('')
    try { updateProperty(definition, await storeImageAsset(file)) }
    catch (error) {
      setImageUploadError(error instanceof Error ? error.message : '图片保存失败，请重试')
      setSaveState('error')
    }
  }
  const pastePropertyImage = (definition: PropertyDefinition, event: ClipboardEvent<HTMLElement>) => {
    const file = [...event.clipboardData.items].find(item => item.kind === 'file')?.getAsFile()
    event.preventDefault()
    if (!file) { setImageUploadError('剪贴板中没有找到图片。请复制图片本身，而不是文件路径或文字。'); return }
    void choosePropertyImage(definition, file)
  }
  const removePropertyImage = (definition: PropertyDefinition) => {
    if (!confirm(`移除“${definition.name}”中的图片？属性会保留。`)) return
    setImageUploadError('')
    updateProperty(definition, '')
  }
  const restoreBackup = async (backup: WorkspaceBackup) => {
    if (!confirm(`恢复 ${formatExactTime(backup.updatedAt)} 的备份？\n当前词库会先自动备份。`)) return
    setBackupBusy(true)
    try {
      const document = await workspaceStorage.restoreBackup(backup.id)
      const mainGraph = Object.values(document.graphs).find(candidate => !candidate.id.startsWith('child:')) || Object.values(document.graphs)[0]
      revision.current = document.revision
      undoStack.current = []; redoStack.current = []
      setGraphs(document.graphs); setGlobalProperties(document.globalProperties)
      setTabs([{ id: `tab:${mainGraph.id}`, path: [mainGraph.id] }]); setActiveTabId(`tab:${mainGraph.id}`)
      setSelectedId(mainGraph.nodes[0]?.id || ''); setSaveState('saved')
      setBackups(await workspaceStorage.listBackups())
    } catch { setSaveState('error') }
    finally { setBackupBusy(false) }
  }
  const exportWorkspace = async () => {
    const workspaceDocument = { schemaVersion: CURRENT_SCHEMA_VERSION, revision: revision.current, updatedAt: new Date().toISOString(), graphs, globalProperties }
    let serialized: string
    try { serialized = await portableWorkspaceJson(workspaceDocument) }
    catch { setSaveState('error'); return }
    const blob = new Blob([serialized], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `Wordverse-${new Date().toISOString().slice(0, 10)}.json`; anchor.click()
    URL.revokeObjectURL(url)
  }
  const importWorkspace = async (file?: File) => {
    if (!file) return
    try {
      const serialized = await file.text()
      if (!parseWorkspaceDocument(JSON.parse(serialized))) throw new Error('invalid workspace')
      if (!confirm(`导入词库“${file.name}”？\n当前词库会先进入自动备份。`)) return
      const imported = parseWorkspaceDocument(JSON.parse(await prepareImportedWorkspaceJson(serialized)))
      if (!imported) throw new Error('invalid workspace')
      saveImmediately(); await saveQueue.current
      const mainGraph = Object.values(imported.graphs).find(candidate => !candidate.id.startsWith('child:')) || Object.values(imported.graphs)[0]
      undoStack.current = []; redoStack.current = []
      setGraphs(imported.graphs); setGlobalProperties(imported.globalProperties)
      setTabs([{ id: `tab:${mainGraph.id}`, path: [mainGraph.id] }]); setActiveTabId(`tab:${mainGraph.id}`)
      setSelectedId(mainGraph.nodes[0]?.id || '')
    } catch { setSaveState('error') }
  }
  const loadExternalWorkspace = async (preserveCurrent: boolean) => {
    if (!preserveCurrent && !confirm('重新载入磁盘版本？当前尚未保存的修改将被放弃。')) return
    setBackupBusy(true)
    try {
      if (preserveCurrent) await workspaceStorage.saveConflictCopy({ schemaVersion: CURRENT_SCHEMA_VERSION, revision: revision.current, updatedAt: new Date().toISOString(), graphs, globalProperties })
      const external = await workspaceStorage.load()
      if (!external) throw new Error('external workspace missing')
      const mainGraph = Object.values(external.graphs).find(candidate => !candidate.id.startsWith('child:')) || Object.values(external.graphs)[0]
      revision.current = external.revision
      undoStack.current = []; redoStack.current = []
      setGraphs(external.graphs); setGlobalProperties(external.globalProperties)
      setTabs([{ id: `tab:${mainGraph.id}`, path: [mainGraph.id] }]); setActiveTabId(`tab:${mainGraph.id}`)
      setSelectedId(mainGraph.nodes[0]?.id || ''); setStorageConflict(false); setSaveState('saved'); lastSaveSucceeded.current = true
    } catch { setSaveState('error') }
    finally { setBackupBusy(false) }
  }
  const chooseSceneView = (view: SceneView, lockRequested: boolean) => {
    const nextLock = lockRequested ? (lockedView === view ? null : view) : null
    setLockedView(nextLock)
    setViewRequest({ view, nonce: Date.now(), locked: !!nextLock })
  }
  const requestProjectManager = async () => {
    if (!onRequestProjectManager) return
    saveImmediately()
    await saveQueue.current.catch(() => undefined)
    if (!lastSaveSucceeded.current) { setCloseProblem('save-error'); return }
    onRequestProjectManager()
  }
  return <div className={`${dark ? 'app dark' : 'app'} font-${fontStyle}${sceneFullscreen ? ' scene-fullscreen' : ''}${resizingPanel ? ' resizing-panels' : ''}`} style={{ '--left-panel': `${leftPanelWidth}px`, '--right-panel': `${rightPanelWidth}px` } as React.CSSProperties}>
    {storageConflict && <div className="storage-conflict"><div><strong>检测到词库同步冲突</strong><span>磁盘文件已被其他设备或程序修改。你的当前内容尚未覆盖它。</span></div><button disabled={backupBusy} onClick={() => loadExternalWorkspace(false)}>载入磁盘版本</button><button className="primary" disabled={backupBusy} onClick={() => loadExternalWorkspace(true)}>保留我的副本并载入</button></div>}
    <header className="titlebar">
      <div className="brand-project"><button className="logo" aria-label="回到主页" onClick={() => { setPath([path[0]]); setSelectedId(''); cancelActiveMode() }}><Sparkles size={17}/><span>Wordverse</span></button>{projectName && <button className="project-switch" title="切换项目" onClick={() => void requestProjectManager()}><Folder size={13}/><span>{projectName}</span><ChevronDown size={11}/></button>}</div>
      <nav className="tabs">{tabs.map(tab => {
        const active = tab.id === activeTabId
        const label = tab.path.map(id => graphs[id]?.name || (id === 'root' ? '主词网' : id)).join(' > ')
        return <div key={tab.id} className={active ? 'tab active depth-tab' : 'tab depth-tab'} title={label} onClick={() => { setActiveTabId(tab.id); setSelectedId(''); cancelActiveMode() }}><span className="tab-dot"/><span className="tab-path">{active ? tab.path.map((id, index) => <span key={id}>{index > 0 && <b>›</b>}<button onClick={(event) => { event.stopPropagation(); setPath(current => current.slice(0, index + 1)) }}>{graphs[id]?.name || (id === 'root' ? '主词网' : id)}</button></span>) : label}</span><button className="tab-close" aria-label="关闭场景" disabled={tabs.length === 1} onClick={(event) => { event.stopPropagation(); closeTab(tab.id) }}><X size={13}/></button></div>
      })}</nav>
      <div className="window-tools">
        <button className="icon-btn" onClick={undo} aria-label="撤销"><Undo2 size={15}/></button>
        <button className="icon-btn" onClick={redo} aria-label="重做"><Redo2 size={15}/></button>
        <button className="icon-btn" onClick={() => setDark(v => !v)} aria-label="切换主题">{dark ? <Sun size={16}/> : <Moon size={16}/>}</button>
        <button className={settingsOpen && settingsPage === 'shortcuts' ? 'icon-btn active' : 'icon-btn'} onClick={() => { setSettingsPage('shortcuts'); setSettingsOpen(true); setHelpOpen(false); setTrashOpen(false) }} aria-label="快捷键设置" title="快捷键设置（?）"><CircleHelp size={16}/></button>
        <button className={settingsOpen ? 'icon-btn active' : 'icon-btn'} onClick={() => { setSettingsOpen(value => !value); setTrashOpen(false); setHelpOpen(false) }} aria-label="全局设置"><Settings2 size={16}/></button>
        <button className={trashOpen ? 'icon-btn active' : 'icon-btn'} onClick={() => { setTrashOpen(value => !value); setSettingsOpen(false); setHelpOpen(false) }} aria-label="更多"><MoreHorizontal size={17}/></button>
        {trashOpen && <div className="trash-menu"><header><span><Trash2 size={13}/>废纸篓</span><small>{trashItems.length + deletedRelations.length} 项</small></header>{trashItems.map(item => <div key={`${item.graphId}:${item.node.id}`}><span><strong>{item.node.label}</strong><small>词 · {item.graphName} · {formatExactTime(item.deletedAt)}</small></span><button onClick={() => restoreDeletedNode(item.graphId, item.node.id)}>恢复</button></div>)}{deletedRelations.map(item => <div key={`${item.graphId}:${item.edge.source}:${item.edge.target}:${item.deletedAt}`}><span><strong>{item.sourceName} — {item.targetName}</strong><small>连接 · {item.graphName} · {formatExactTime(item.deletedAt)}</small></span><button onClick={() => restoreDeletedRelation(item.graphId, item.edge.source, item.edge.target, item.deletedAt)}>恢复</button></div>)}{!trashItems.length && !deletedRelations.length && <p>删除的词和连接会保存在这里。</p>}</div>}
        {settingsOpen && <div className="view-settings">
          <nav className="settings-tabs"><button className={settingsPage === 'view' ? 'active' : ''} onClick={() => setSettingsPage('view')}>全局设置</button><button className={settingsPage === 'shortcuts' ? 'active' : ''} onClick={() => setSettingsPage('shortcuts')}>快捷键</button></nav>
          <div className={settingsPage === 'view' ? 'settings-page active' : 'settings-page'}>
          <div><strong>全局视图</strong><small>自动保存在本机</small></div>
          <div className="theme-choice"><button className={!dark ? 'selected' : ''} onClick={() => setDark(false)}>浅色</button><button className={dark ? 'selected' : ''} onClick={() => setDark(true)}>深色</button></div>
          <div className="setting-heading"><span>字体样式</span><small>界面与词眼同步</small></div>
          <div className="font-choice">
            <button className={fontStyle === 'modern' ? 'selected' : ''} onClick={() => setFontStyle('modern')}><strong>现代</strong><small>清晰中性</small></button>
            <button className={fontStyle === 'serif' ? 'selected' : ''} onClick={() => setFontStyle('serif')}><strong>书卷</strong><small>宋体舒展</small></button>
            <button className={fontStyle === 'compact' ? 'selected' : ''} onClick={() => setFontStyle('compact')}><strong>紧凑</strong><small>高密强调</small></button>
          </div>
          <div className="setting-heading"><span>全局属性</span><small>自动出现在所有词眼</small></div>
          <div className="global-property-list">{globalProperties.map(item => <div key={item.id}><span>{item.name}<small>{item.type === 'text' ? '文本' : item.type === 'text-list' ? '文本序列' : '图片'}</small></span><button title="删除注解" onClick={() => setDeletePropertyRequest({ id: item.id, name: item.name, global: true })}><X size={12}/></button></div>)}</div>
          <button className="settings-add" onClick={() => setPropertyTarget('global')}><Plus size={13}/> 添加全局属性</button>
          <label><span>自动整理位置<small>新增词时均匀微调未锁定词</small></span><input type="checkbox" checked={autoLayout} onChange={event => setAutoLayout(event.target.checked)}/><i/></label>
          <label><span>空间网格<small>显示透视参照</small></span><input type="checkbox" checked={gridVisible} onChange={event => setGridVisible(event.target.checked)}/><i/></label>
          <label className="range-setting"><span>词字号<output>{Math.round(fontScale * 100)}%</output></span><input type="range" min="0.75" max="1.5" step="0.05" value={fontScale} onChange={event => setFontScale(Number(event.target.value))}/></label>
          <label className="range-setting"><span>连线粗细<output>{Math.round(lineScale * 100)}%</output></span><input type="range" min="0.6" max="2" step="0.1" value={lineScale} onChange={event => setLineScale(Number(event.target.value))}/></label>
          <label><span>播放呼吸<small>控制漫游时的 sine 运动</small></span><input type="checkbox" checked={motionEnabled} onChange={event => setMotionEnabled(event.target.checked)}/><i/></label>
          {motionEnabled && <><label className="range-setting"><span>动画速度<output>{Math.round(motionSpeed * 100)}%</output></span><input type="range" min="0.2" max="1.2" step="0.05" value={motionSpeed} onChange={event => setMotionSpeed(Number(event.target.value))}/></label><label className="range-setting"><span>动画幅度<output>{Math.round(motionAmplitude * 1000) / 10}</output></span><input type="range" min="0.02" max="0.22" step="0.01" value={motionAmplitude} onChange={event => setMotionAmplitude(Number(event.target.value))}/></label></>}
          {gridVisible && <><label className="range-setting"><span>网格密度<output>{Math.round(gridDensity * 100)}%</output></span><input type="range" min="0.65" max="1.8" step="0.05" value={gridDensity} onChange={event => setGridDensity(Number(event.target.value))}/></label><label className="range-setting"><span>网格清晰度<output>{Math.round(gridClarity * 100)}%</output></span><input type="range" min="0.6" max="1.8" step="0.05" value={gridClarity} onChange={event => setGridClarity(Number(event.target.value))}/></label><label className="range-setting"><span>网格距离<output>{Math.round(gridRange)}</output></span><input type="range" min="24" max="80" step="2" value={gridRange} onChange={event => setGridRange(Number(event.target.value))}/></label></>}
          <div className="setting-heading"><span>存储与恢复</span><small>{workspaceStorageLabel}</small></div>
          <div className="storage-actions"><button onClick={exportWorkspace}>导出词库</button><label>导入词库<input type="file" accept="application/json,.json" onChange={event => { importWorkspace(event.target.files?.[0]); event.currentTarget.value = '' }}/></label></div>
          <div className="backup-list">{backups.length ? backups.map(backup => <button key={backup.id} disabled={backupBusy} onClick={() => restoreBackup(backup)}><span>{formatExactTime(backup.updatedAt)}</span><small>修订 {backup.revision} · 恢复</small></button>) : <p>完成多次保存后，这里会显示最近三份备份。</p>}</div>
          </div>
          <div className={settingsPage === 'shortcuts' ? 'settings-page active shortcut-settings' : 'settings-page'}>
            <div className="setting-heading"><span>快捷键</span><small>点击键位后按下新组合</small></div>
            {SHORTCUT_LABELS.map(item => <div className="shortcut-setting" key={item.action}><span>{item.label}</span><button className={recordingShortcut === item.action ? 'recording' : ''} onClick={() => { setRecordingShortcut(item.action); setShortcutConflict('') }} onKeyDown={event => {
              if (recordingShortcut !== item.action) return
              event.preventDefault(); event.stopPropagation()
              if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
              if (event.code === 'Escape') { setRecordingShortcut(null); return }
              const keyboardBinding = shortcutForEvent(event)
              const next = (['forward', 'backward', 'left', 'right'] as ShortcutAction[]).includes(item.action) ? `Mouse2+${keyboardBinding}` : keyboardBinding
              const occupied = SHORTCUT_LABELS.find(candidate => candidate.action !== item.action && shortcuts[candidate.action] === next)
              if (occupied) { setShortcutConflict(`“${displayShortcut(next)}”已用于${occupied.label}`); return }
              setShortcuts(current => ({ ...current, [item.action]: next })); setRecordingShortcut(null); setShortcutConflict('')
            }}>{recordingShortcut === item.action ? '请按键…' : displayShortcut(shortcuts[item.action])}</button></div>)}
            {shortcutConflict && <p className="shortcut-conflict">{shortcutConflict}</p>}
            <button className="shortcut-reset" onClick={() => { setShortcuts(DEFAULT_SHORTCUTS); setRecordingShortcut(null); setShortcutConflict('') }}>恢复默认快捷键</button>
            <p className="shortcut-note">Esc 仍固定用于取消/返回；双击空白新建、双击词进入、Gizmo 拖动属于鼠标操作。</p>
          </div>
        </div>}
      </div>
    </header>
    <aside className="hierarchy">
      <div className="panel-resizer panel-resizer-right" onPointerDown={event => { event.preventDefault(); setResizingPanel('left') }}/>
      <div className="hierarchy-pane">
      <div className="panel-title"><span>层级</span><PanelLeftClose size={15}/></div>
      <label className="search mini"><Search size={14}/><input value={hierarchyQuery} onChange={event => setHierarchyQuery(event.target.value)} placeholder="查找词…" /></label>
      <button className="tree-root root-toggle" aria-expanded={hierarchyRootExpanded} onClick={() => setHierarchyRootExpanded(value => !value)}><ChevronDown size={14} className={hierarchyRootExpanded ? '' : 'collapsed'}/><span className="galaxy-icon">✣</span><strong>{graphs[path[0]]?.name || '主词网'}</strong><span className="count">{graph.nodes.length}</span></button>
      {hierarchyRootExpanded && <><div className="tree-list">{renderHierarchyNodes(graph)}</div><button className="new-word" onClick={() => addNode()}><CirclePlus size={15}/> 新建词</button></>}
      </div>
      <div className="graph-browser"><div className="browser-title"><span>词网浏览器</span><span className="browser-actions"><em>{Object.keys(graphs).filter(id => id === 'root' || id.startsWith('graph:')).length}</em><button title="新建主词网" aria-label="新建主词网" onClick={() => setDraftGraphName('')}><Plus size={14}/></button></span></div><label className="search mini"><Search size={13}/><input value={browserQuery} onChange={event => setBrowserQuery(event.target.value)} placeholder="查找主词网…"/></label><button className="browser-root root-toggle" aria-expanded={browserRootExpanded} onClick={() => setBrowserRootExpanded(value => !value)}><ChevronDown size={13} className={browserRootExpanded ? '' : 'collapsed'}/><Folder size={14}/><strong>Wordverse</strong></button>{browserRootExpanded && <div className="browser-files">{Object.values(graphs).filter(item => (item.id === 'root' || item.id.startsWith('graph:')) && (!browserQuery.trim() || item.name.toLowerCase().includes(browserQuery.trim().toLowerCase()))).map(item => <button key={item.id} className={browserSelection === item.id ? 'browser-file selected' : 'browser-file'} onClick={() => setBrowserSelection(item.id)} onDoubleClick={() => openGraphTab(item.id)} onContextMenu={event => { event.preventDefault(); setContextMenu(null); setBrowserSelection(item.id); setGraphContextMenu({ graphId: item.id, x: event.clientX, y: event.clientY }) }}><FileBox size={14}/><span>{item.name}</span></button>)}</div>}<div className="browser-help">这里只保存主词网 · 双击打开 · 右键管理</div></div>
    </aside>
    <main className={`space${consoleOpen ? ' console-visible' : ''}`}>
      <button className="scene-back" aria-label="返回上一级" title="返回上一级（Esc）" disabled={path.length <= 1} onClick={() => { cancelActiveMode(); navigateBack() }}><ArrowLeft size={17}/></button>
      <div className="space-top"><label className="search global"><Search size={16}/><input ref={searchInputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="检索当前词网（逗号分隔）"/><kbd>⌘ K</kbd></label><button className={mergeDuplicates ? 'soft merge-active' : 'soft'} aria-pressed={mergeDuplicates} onClick={() => { cancelActiveMode(); setMergeDuplicates(value => !value) }}><Link2 size={15}/> 同词合并 <span className="toggle"/></button></div>
      <div className="canvas" onDoubleClick={() => { if (!sceneFailure && selectionMode === 'single' && linkMode === 'off' && !duplicateSourceId && !isMoving && !editingId && !playbackEnabled) addNode('新词', sceneCursorPoint.current || undefined) }} onContextMenu={event => { event.preventDefault(); setGraphContextMenu(null); if ((linkMode !== 'off' || duplicateSourceId) && !contextMenu) cancelActiveMode() }}>{sceneFailure ? <div className="scene-recovery" role="alert"><Sparkles size={22}/><strong>三维场景暂时不可用</strong><p>显卡上下文已中断，词库数据没有受到影响。</p><button onClick={() => { setSceneGeneration(value => value + 1); setSceneFailure(false) }}>重新启动场景</button></div> : <Canvas key={sceneGeneration} fallback={<div className="scene-recovery"><strong>无法启动三维场景</strong><p>请确认系统 WebView2 和图形加速可用。</p></div>} gl={{ alpha: true }} camera={{ position: [0, 0, 11], fov: 47 }} dpr={graph.nodes.length > 400 ? [0.8, 1.2] : [1, 1.6]}><SceneHealth onContextLost={() => { setPlaybackEnabled(false); setSceneFailure(true) }}/><GraphScene graph={graph} selectedId={selectedId} selectedIds={selectedIds} selectionMode={selectionMode} gizmoMode={gizmoMode} shortcuts={shortcuts} selectedEdge={selectedEdge} selectedEdges={selectedEdges} editingId={editingId} linkMode={linkMode} linkSourceIds={linkSourceIds} duplicateSourceId={duplicateSourceId} isMoving={isMoving} gridVisible={gridVisible} mergeDuplicates={mergeDuplicates} motionEnabled={motionEnabled} playbackEnabled={playbackEnabled} motionSpeed={motionSpeed} motionAmplitude={motionAmplitude} dark={dark} fontScale={fontScale} fontStyle={fontStyle} lineScale={lineScale} gridDensity={gridDensity} gridClarity={gridClarity} gridRange={gridRange} focusRequest={focusRequest} viewRequest={viewRequest} bringRequest={bringRequest} onBring={bringNodeIntoView} onSelect={activateNode} onSelectMany={selectMany} onSelectEdge={(source, target) => { const key = `${source}:${target}`; setSelectedEdge(key); setSelectedEdges(new Set([key])); setSelectedIds(new Set()); setSelectedId(''); cancelActiveMode() }} onOpen={enterGraph} onContext={(node, x, y) => { setGraphContextMenu(null); setSelectedIds(new Set([node.id])); setSelectedId(node.id); setContextMenu({ node, x, y }) }} onRename={renameNode} onCursorPoint={(position) => { sceneCursorPoint.current = position }} onDuplicateAt={duplicateNodeAt} onMoveStart={() => { setPlaybackEnabled(false); cancelActiveMode(); setIsMoving(true); beginNodeMove() }} onTransformMany={transformNodes} onMoveEnd={finishNodeMove} onFlyChange={setFlyNavigation} query={query}/></Canvas>}</div>
      <div className="scene-view-gizmo" aria-label="场景视图">
        <button className={`view-cube${lockedView === 'perspective' ? ' locked' : ''}`} title="等距透视（Ctrl 点击锁定）" onClick={event => chooseSceneView('perspective', event.ctrlKey || event.metaKey)}><Axis3d size={17}/></button>
        <div className="view-faces">
          {([['top', '顶'], ['front', '前'], ['right', '右'], ['left', '左'], ['back', '后'], ['bottom', '底']] as [SceneView, string][]).map(([view, label]) => <button key={view} className={lockedView === view ? 'locked' : ''} title={`${label}视图（Ctrl 点击锁定）`} onClick={event => chooseSceneView(view, event.ctrlKey || event.metaKey)}>{label}</button>)}
        </div>
      </div>
      {consoleOpen ? <section className="scene-console" aria-label="调试控制台"><header><strong>Console</strong><span>{traceEntries.filter(entry => entry.level === 'error').length} errors · {traceEntries.length} traces</span><button onClick={() => setTraceEntries([])}>清空</button><button onClick={() => setConsoleOpen(false)}>收起</button></header><div>{traceEntries.length ? traceEntries.map((entry, index) => <p className={entry.level} key={`${entry.time}:${index}`}><time>{entry.time}</time><b>{entry.scope}</b><span>{entry.message}</span></p>) : <p className="empty">暂无 Trace</p>}</div></section> : <button className="console-reopen" onClick={() => setConsoleOpen(true)}>Console</button>}
      <div className="scene-selection-tools" aria-label="选择模式">
        <button className={selectionMode === 'single' && !gizmoMode ? 'active' : ''} title="取消 Gizmo（R）" onClick={() => { setSelectionMode('single'); setGizmoMode(null) }}><MousePointer2 size={15}/></button>
        <button className={gizmoMode === 'translate' ? 'active' : ''} title="移动 Gizmo（T）" onClick={() => { setSelectionMode('single'); setGizmoMode('translate') }}><Axis3d size={15}/></button>
        <button className={gizmoMode === 'scale' ? 'active' : ''} title="等比缩放 Gizmo（Y）" onClick={() => { setSelectionMode('single'); setGizmoMode('scale') }}><Scaling size={15}/></button>
        <button className={selectionMode === 'box' ? 'active' : ''} title="框选（B）" onClick={() => { cancelActiveMode(); setSelectionMode('box'); setGizmoMode(null) }}><SquareDashedMousePointer size={15}/></button>
        <button className={selectionMode === 'lasso' ? 'active' : ''} title="圈选（C）" onClick={() => { cancelActiveMode(); setSelectionMode('lasso'); setGizmoMode(null) }}><LassoSelect size={15}/></button>
      </div>
      <div className="scene-hint">{duplicateSourceId ? <><strong>复制放置中</strong><span>双击当前位置或 Enter 确认 · Esc 取消</span></> : linkMode !== 'off' ? <><strong>{linkSourceIds.length > 1 ? `批量连接中 · ${linkSourceIds.length} 个起点` : linkMode === 'continuous' ? '连续连接中' : '连接中'}</strong><span>{linkSourceIds.length ? '点击目标词 · Esc 取消' : '点击起点词 · Esc 取消'}</span></> : selectionMode !== 'single' ? <><strong>{selectionMode === 'box' ? '框选模式' : '圈选模式'}</strong><span>拖动可选择词与连线 · Ctrl/Shift 追加</span></> : (selectedEdges.size || selectedEdge) ? <><strong>已选择 {selectedEdges.size || 1} 条连线</strong><span>&lt; / &gt; 查看端点 · Delete 批量斩断</span></> : <><span>R 取消 · T 移动 · Y 缩放</span>{selectedIds.size > 1 && <span>Shift+C 封装子词网</span>}<span>L 连接 · Shift+L 连续</span><span>Alt+D 复制连接</span><span>双击词进入 · Esc 返回</span><span>左键+WASD/QE 游走</span><span>Space {sceneFullscreen ? '退出全屏' : '场景全屏'}</span></>}</div>
      <div className="scene-tools"><button onClick={() => addNode()}><Plus size={18}/></button><button className={linkMode !== 'off' ? 'tool-active' : ''} title="建立连接（L）" onClick={() => linkMode === 'off' ? startLink() : cancelActiveMode()}><Link2 size={17}/></button><button title="聚焦（F）" onClick={() => setFocusRequest(value => value + 1)}><Focus size={18}/></button><button disabled={reduceMotion} className={playbackEnabled ? 'tool-active playback-active' : ''} title={reduceMotion ? '系统已启用“减少动态效果”' : playbackEnabled ? '停止词网漫游' : '播放词网漫游'} onClick={() => { cancelActiveMode(); setPlaybackEnabled(value => !value) }}><Play size={17}/></button><button title="回到当前词网 Home 视野" onClick={() => { setPlaybackEnabled(false); setSelectedIds(new Set()); setSelectedId(''); setFocusRequest(value => value + 1) }}><Home size={17}/></button></div>
      {draftGraphName !== null && <form className="quick-create" onSubmit={event => { event.preventDefault(); if (draftGraphName.trim()) createMainGraph(draftGraphName) }}><span>主词网</span><input autoFocus value={draftGraphName} onChange={event => setDraftGraphName(event.target.value)} placeholder="输入词网名称…"/><kbd>Enter</kbd><button type="button" onClick={() => setDraftGraphName(null)}><X size={14}/></button></form>}
      {contextMenu && <div className="node-menu" style={{ left: contextMenu.x, top: contextMenu.y }}><button onClick={() => { setEditingId(contextMenu.node.id); setContextMenu(null) }}>重命名 <kbd>F2</kbd></button><button onClick={() => startLink(contextMenu.node.id)}><Link2 size={14}/>建立连接</button><button onClick={() => { setBringRequest({ id: contextMenu.node.id, nonce: Date.now() }); setContextMenu(null) }} disabled={contextMenu.node.isContextRoot}><LocateFixed size={14}/>移到当前视野</button><button onClick={() => { enterGraph(contextMenu.node); setContextMenu(null) }} disabled={contextMenu.node.isContextRoot}>进入子词网</button></div>}
      {graphContextMenu && <div className="node-menu graph-file-menu" style={{ left: graphContextMenu.x, top: graphContextMenu.y }}><button onClick={() => { const item = graphs[graphContextMenu.graphId]; setRenameGraphRequest({ graphId: item.id, name: item.name }); setGraphContextMenu(null) }}>重命名</button><button className="danger" disabled={graphContextMenu.graphId === 'root' || Object.keys(graphs).filter(id => id === 'root' || id.startsWith('graph:')).length <= 1} onClick={() => { setDeleteGraphRequest(graphContextMenu.graphId); setGraphContextMenu(null) }}>删除主词网</button></div>}
    </main>
    <aside className="inspector">
      <div className="panel-resizer panel-resizer-left" onPointerDown={event => { event.preventDefault(); setResizingPanel('right') }}/>
      <div className="panel-title"><span>检查器</span><Menu size={16}/></div>
      {selected ? <><section className="identity"><div className={selected.isContextRoot ? 'avatar context' : 'avatar'}>{selected.label.slice(0, 1)}</div><div><input className="word-name" value={selected.label} onChange={e => update({ label: e.target.value })}/><p>{selected.isContextRoot ? '当前子词网的上下文词' : selected.hasChildGraph ? '包含子词网' : '词眼'}</p></div></section>
      <section className={`transform-section${transformExpanded ? ' expanded' : ''}`}><button className="transform-heading" aria-expanded={transformExpanded} onClick={() => setTransformExpanded(value => !value)}><span><ChevronDown size={12}/><h3>Transform</h3></span><Axis3d size={13}/></button>{transformExpanded && <><div className="transform-row"><span>Position</span><div className="transform-vector">{(['X', 'Y', 'Z'] as const).map((axis, index) => <label key={axis} className={`axis-${axis.toLowerCase()}`}><b>{axis}</b><input type="number" step="0.1" value={Math.round(selected.position[index] * 1000) / 1000} onChange={event => updatePositionAxis(index, event.target.value)}/></label>)}</div></div><div className="transform-row"><span>Scale</span><label className="uniform-scale"><input type="number" step="0.05" min="0.05" max="20" value={Math.round(selected.scale * 1000) / 1000} onChange={event => updateScale(event.target.value)}/></label></div></>}</section>
      <section className="content-section"><div className="content-heading compact"><button title="添加属性" aria-label="添加属性" onClick={() => { setPropertyType('text'); setPropertyTarget('node') }}><Plus size={14}/></button></div>
        {!selected.note && visibleProperties.length === 0 && <div className="content-empty">点击 + 添加文本、文本序列或图片</div>}
        {selected.note && <article className="content-block"><header><span>文本</span><span className="content-actions"><button title="放大编辑和预览" onClick={() => setExpandedText({ id: '__note__', name: '文本' })}><Maximize2 size={12}/></button><button title="编辑文本" onClick={() => setEditingPropertyId('__note__')}><Pencil size={12}/></button></span></header>{editingPropertyId === '__note__' ? <div className="content-editor"><textarea autoFocus value={selected.note} onChange={event => update({ note: event.target.value })}/><div><button onClick={() => setDeletePropertyRequest({ id: '__note__', name: '文本', global: false })}>移除</button><button onClick={() => setEditingPropertyId('')}>完成</button></div></div> : <p><TextWithLinks value={selected.note}/></p>}</article>}
        {visibleProperties.map(({ definition, value, global }) => <article className="content-block" key={definition.id}><header><span>{definition.name}</span><span className="content-actions">{definition.type === 'text' && <button title="放大编辑和预览" onClick={() => setExpandedText({ id: definition.id, name: definition.name })}><Maximize2 size={12}/></button>}<button title={`编辑${definition.name}`} onClick={() => setEditingPropertyId(definition.id)}><Pencil size={12}/></button></span></header>{editingPropertyId === definition.id ? <div className="content-editor">{definition.type === 'text' ? <textarea autoFocus value={typeof value === 'string' ? value : ''} placeholder="输入文本…" onChange={event => updateProperty(definition, event.target.value)}/> : definition.type === 'text-list' ? <TextListEditor values={Array.isArray(value) ? value : []} onChange={items => updateProperty(definition, items)}/> : <div className="image-editor" tabIndex={0} onPaste={event => pastePropertyImage(definition, event)} title="点击此区域后可按 Ctrl + V 粘贴剪贴板图片">{typeof value === 'string' && value ? <StoredImage value={value} alt={definition.name}/> : <span className="image-paste-target">点击此处，然后按 Ctrl + V 粘贴图片</span>}<div className="image-editor-actions"><label><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { void choosePropertyImage(definition, event.target.files?.[0]); event.currentTarget.value = '' }}/><span>{typeof value === 'string' && value ? '替换图片' : '选择文件'}</span></label><small>或聚焦此区域后 Ctrl + V</small>{typeof value === 'string' && value && <button type="button" onClick={() => removePropertyImage(definition)}>移除图片</button>}</div>{imageUploadError && <p className="image-upload-error">{imageUploadError}</p>}</div>}<div>{!global && <button onClick={() => setDeletePropertyRequest({ id: definition.id, name: definition.name, global: false })}>移除</button>}<button onClick={() => setEditingPropertyId('')}>完成</button></div></div> : definition.type === 'text' && typeof value === 'string' && value ? <p><TextWithLinks value={value}/></p> : definition.type === 'text-list' ? <div className="content-list">{(Array.isArray(value) ? value : []).filter(Boolean).map((item, index) => { const href = webLink(item); return <p key={`${item}:${index}`}>{href ? <ExternalLink href={href}>{item}</ExternalLink> : item}</p> })}</div> : definition.type === 'image' && typeof value === 'string' && value ? <button className="content-image-trigger" title="查看大图" onClick={() => setImagePreview({ value, alt: definition.name })}><StoredImage className="content-image" value={value} alt={definition.name}/></button> : <p className="content-placeholder">暂无内容</p>}</article>)}
      </section>
      <div className="inspector-footer"><span>更新于 {formatExactTime(selected.updatedAt)}</span><span>Delete 删除</span></div></> : <div className="empty-inspector">选择一个词查看属性</div>}
    </aside>
    {imagePreview && <div className="property-dialog-backdrop media-backdrop" onPointerDown={() => setImagePreview(null)}><section className="image-preview-dialog" role="dialog" aria-modal="true" aria-label={`${imagePreview.alt}大图预览`} onPointerDown={event => event.stopPropagation()}><header><strong>{imagePreview.alt}</strong><button aria-label="关闭大图" onClick={() => setImagePreview(null)}><X size={16}/></button></header><div><StoredImage value={imagePreview.value} alt={imagePreview.alt}/></div></section></div>}
    {expandedText && <div className="property-dialog-backdrop text-editor-backdrop" onPointerDown={() => setExpandedText(null)}><section className="expanded-text-dialog" role="dialog" aria-modal="true" aria-label={`${expandedText.name}编辑器`} onPointerDown={event => event.stopPropagation()}><header><div><strong>{expandedText.name}</strong><small>专注编辑</small></div><button aria-label="关闭编辑器" onClick={() => setExpandedText(null)}><X size={16}/></button></header><div className="expanded-text-workspace"><label><span>文本</span><textarea autoFocus value={expandedTextValue} onChange={event => updateExpandedText(event.target.value)} onKeyDown={event => { if (event.key !== 'Tab') return; event.preventDefault(); const textarea = event.currentTarget; const result = insertTabAtSelection(textarea.value, textarea.selectionStart, textarea.selectionEnd); updateExpandedText(result.value); requestAnimationFrame(() => textarea.setSelectionRange(result.cursor, result.cursor)) }} placeholder="输入文本…"/></label></div><footer><small>{expandedTextValue.length} 字符</small><button onClick={() => setExpandedText(null)}>完成</button></footer></section></div>}
    {propertyTarget && <div className="property-dialog-backdrop" onPointerDown={() => setPropertyTarget(null)}><form className="property-dialog" onPointerDown={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); addPropertyDefinition() }}><div><strong>{propertyTarget === 'global' ? '添加全局属性' : '添加属性'}</strong><button type="button" onClick={() => setPropertyTarget(null)}><X size={14}/></button></div><label><span>{propertyTarget === 'global' ? '属性名称' : '属性名称'}</span><input autoFocus value={propertyName} onChange={event => setPropertyName(event.target.value)} placeholder={propertyTarget === 'global' ? '例如：来源' : '例如：定义'}/></label><label><span>内容类型</span><select value={propertyType} onChange={event => setPropertyType(event.target.value as PropertyType)}><option value="text">文本</option><option value="text-list">文本序列</option><option value="image">图片</option></select></label><p>{propertyType === 'text' ? '适合一段可以直接阅读的文本。' : propertyType === 'text-list' ? '适合步骤、链接或多条并列内容。' : '可从剪贴板粘贴或选择文件；图片保存到 .Wordverse/assets。'}</p><button className="property-confirm" disabled={!propertyName.trim()}>创建</button></form></div>}
    {deletePropertyRequest && <div className="property-dialog-backdrop" onPointerDown={() => setDeletePropertyRequest(null)}><div className="confirm-dialog" onPointerDown={event => event.stopPropagation()}><strong>删除“{deletePropertyRequest.name}”？</strong><p>{deletePropertyRequest.global ? '这是注解，将从所有词眼中移除，并删除已经填写的对应内容。' : '该内容将从当前词中移除。'}</p><div><button onClick={() => setDeletePropertyRequest(null)}>取消</button><button className="danger" onClick={confirmPropertyDelete}>确认删除</button></div></div></div>}
    {renameGraphRequest && <div className="property-dialog-backdrop" onPointerDown={() => setRenameGraphRequest(null)}><form className="property-dialog" onPointerDown={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); renameMainGraph() }}><div><strong>重命名主词网</strong><button type="button" onClick={() => setRenameGraphRequest(null)}><X size={14}/></button></div><label><span>名称</span><input autoFocus value={renameGraphRequest.name} onFocus={event => event.currentTarget.select()} onChange={event => setRenameGraphRequest(current => current ? { ...current, name: event.target.value } : null)}/></label><button className="property-confirm" disabled={!renameGraphRequest.name.trim()}>完成</button></form></div>}
    {deleteGraphRequest && <div className="property-dialog-backdrop" onPointerDown={() => setDeleteGraphRequest(null)}><div className="confirm-dialog" onPointerDown={event => event.stopPropagation()}><strong>删除主词网“{graphs[deleteGraphRequest]?.name}”？</strong><p>该主词网及内部所有子词网都会被删除。其他主词网不会受到影响，此操作仍可通过撤销恢复。</p><div><button onClick={() => setDeleteGraphRequest(null)}>取消</button><button className="danger" onClick={deleteMainGraph}>确认删除</button></div></div></div>}
    {closeProblem && <div className="property-dialog-backdrop"><div className="confirm-dialog" role="alertdialog" aria-modal="true"><strong>{closeProblem === 'timeout' ? '保存超时，软件尚未关闭' : closeProblem === 'close-error' ? '系统拒绝了窗口关闭请求' : '保存失败，软件尚未关闭'}</strong><p>为避免丢失未保存内容，Wordverse 暂停了退出。可取消后重试保存，或确认不保存直接退出。</p><div><button onClick={() => setCloseProblem(null)}>返回词库</button><button className="danger" onClick={() => { void forceCloseApp() }}>不保存，仍然退出</button></div></div></div>}
    {helpOpen && <div className="property-dialog-backdrop" onPointerDown={() => setHelpOpen(false)}><section className="shortcut-dialog" aria-modal="true" role="dialog" aria-label="快捷键帮助" onPointerDown={event => event.stopPropagation()}><header><div><strong>快捷键</strong><small>Scene 操作速览</small></div><button aria-label="关闭" onClick={() => setHelpOpen(false)}><X size={15}/></button></header><div className="shortcut-grid"><span>新建词</span><kbd>双击空白</kbd><span>重命名</span><kbd>F2</kbd><span>建立连接</span><kbd>L</kbd><span>连续连接</span><kbd>Shift + L</kbd><span>移动词</span><kbd>Alt + 拖动</kbd><span>聚焦所选 / 全图</span><kbd>F</kbd><span>进入子词网</span><kbd>双击词</kbd><span>返回 / 取消</span><kbd>Esc</kbd><span>空间游走</span><kbd>W A S D</kbd><span>场景全屏</span><kbd>Space</kbd><span>删除所选</span><kbd>Delete</kbd><span>撤销 / 重做</span><kbd>Ctrl + Z / Ctrl + Shift + Z</kbd><span>保存</span><kbd>Ctrl + S</kbd><span>检索</span><kbd>Ctrl + K</kbd></div><p>右键词还可连接、重命名或移到当前视野。输入文字时场景快捷键会自动暂停。</p></section></div>}
    <footer className="status"><span className={`save-state ${saveState}`}><i/>{saveState === 'loading' ? '正在载入词库' : saveState === 'saving' ? '正在保存' : saveState === 'error' ? '保存失败或发生同步冲突' : `已保存到${workspaceStorageLabel}`}</span><span>{path.map(id => graphs[id]?.name || id).join(' / ')}{selected ? ` / ${selected.label}` : ''}</span><span><Command size={13}/> F 聚焦 · {graph.nodes.length} 词 · {graph.edges.length} 连接</span></footer>
  </div>
}
