import type { DeletedEdge, DeletedNode, Edge, Graph, PropertyDefinition, WordNode, WordProperty } from './types'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'

export const CURRENT_SCHEMA_VERSION = 1

export type WorkspaceDocument = {
  schemaVersion: number
  revision: number
  updatedAt: string
  graphs: Record<string, Graph>
  globalProperties: PropertyDefinition[]
}

export type WorkspaceBackup = { id: string; revision: number; updatedAt: string }

export interface StoragePort {
  load(): Promise<WorkspaceDocument | null>
  save(document: WorkspaceDocument): Promise<void>
  listBackups(): Promise<WorkspaceBackup[]>
  restoreBackup(id: string): Promise<WorkspaceDocument>
  saveConflictCopy(document: WorkspaceDocument): Promise<string>
}

export class StorageConflictError extends Error { constructor() { super('storage_conflict'); this.name = 'StorageConflictError' } }

const DB_NAME = 'wordverse'
const DB_VERSION = 2
const STORE_NAME = 'workspace'
const BACKUP_STORE_NAME = 'workspace-backups'
const DOCUMENT_KEY = 'main'
const BACKUP_SLOTS = 3

function normalizeProperty(value: unknown): WordProperty | null {
  if (!value || typeof value !== 'object') return null
  const property = value as Partial<WordProperty>
  if (typeof property.id !== 'string' || typeof property.name !== 'string' || !['text', 'text-list', 'image'].includes(property.type || '')) return null
  if (property.type === 'text-list') {
    if (!Array.isArray(property.value)) return null
    return { id: property.id, name: property.name, type: property.type, value: property.value.filter(item => typeof item === 'string') }
  }
  return typeof property.value === 'string' ? { id: property.id, name: property.name, type: property.type!, value: property.value } : null
}

function normalizeNode(value: unknown, fallbackTimestamp: string): WordNode | null {
  if (!value || typeof value !== 'object') return null
  const node = value as Partial<WordNode>
  if (typeof node.id !== 'string' || !node.id || typeof node.label !== 'string' || !Array.isArray(node.position) || node.position.length !== 3 || !node.position.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate))) return null
  return {
    id: node.id,
    label: node.label,
    note: typeof node.note === 'string' ? node.note : '',
    tags: Array.isArray(node.tags) ? node.tags.filter(item => typeof item === 'string') : [],
    links: Array.isArray(node.links) ? node.links.filter(item => typeof item === 'string') : [],
    position: node.position as [number, number, number],
    scale: typeof node.scale === 'number' && Number.isFinite(node.scale) && node.scale > 0 ? node.scale : Array.isArray(node.scale) && typeof node.scale[0] === 'number' && Number.isFinite(node.scale[0]) && node.scale[0] > 0 ? node.scale[0] : 1,
    ...(typeof node.hasChildGraph === 'boolean' ? { hasChildGraph: node.hasChildGraph } : {}),
    ...(typeof node.isContextRoot === 'boolean' ? { isContextRoot: node.isContextRoot } : {}),
    ...(typeof node.positionLocked === 'boolean' ? { positionLocked: node.positionLocked } : {}),
    ...(Array.isArray(node.properties) ? { properties: node.properties.flatMap(property => { const normalized = normalizeProperty(property); return normalized ? [normalized] : [] }) } : {}),
    createdAt: typeof node.createdAt === 'string' ? node.createdAt : fallbackTimestamp,
    updatedAt: typeof node.updatedAt === 'string' ? node.updatedAt : typeof node.createdAt === 'string' ? node.createdAt : fallbackTimestamp,
  }
}

function normalizeEdge(value: unknown, nodeIds: Set<string>): Edge | null {
  if (!value || typeof value !== 'object') return null
  const edge = value as Partial<Edge>
  return typeof edge.source === 'string' && typeof edge.target === 'string' && edge.source !== edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target) ? { source: edge.source, target: edge.target } : null
}

function normalizeGraph(value: unknown, fallbackTimestamp: string): Graph | null {
  if (!value || typeof value !== 'object') return null
  const graph = value as Partial<Graph>
  if (typeof graph.id !== 'string' || typeof graph.name !== 'string' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null
  const seenNodes = new Set<string>()
  const nodes = graph.nodes.flatMap(value => { const node = normalizeNode(value, fallbackTimestamp); if (!node || seenNodes.has(node.id)) return []; seenNodes.add(node.id); return [node] })
  const edgeKeys = new Set<string>()
  const edges = graph.edges.flatMap(value => {
    const edge = normalizeEdge(value, seenNodes)
    if (!edge) return []
    const key = [edge.source, edge.target].sort().join(':')
    if (edgeKeys.has(key)) return []
    edgeKeys.add(key); return [edge]
  })
  const trash: DeletedNode[] = Array.isArray(graph.trash) ? graph.trash.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const item = value as Partial<DeletedNode>
    const node = normalizeNode(item.node, fallbackTimestamp)
    if (!node || typeof item.deletedAt !== 'string' || !Array.isArray(item.edges)) return []
    const available = new Set([...seenNodes, node.id])
    return [{ node, edges: item.edges.flatMap(edge => { const normalized = normalizeEdge(edge, available); return normalized ? [normalized] : [] }), deletedAt: item.deletedAt }]
  }) : []
  const deletedEdges: DeletedEdge[] = Array.isArray(graph.deletedEdges) ? graph.deletedEdges.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const item = value as Partial<DeletedEdge>
    const edge = normalizeEdge(item.edge, seenNodes)
    return edge && typeof item.deletedAt === 'string' ? [{ edge, deletedAt: item.deletedAt }] : []
  }) : []
  return { id: graph.id, name: graph.name, nodes, edges, trash, deletedEdges }
}

function validateDocument(value: unknown): WorkspaceDocument | null {
  if (!value || typeof value !== 'object') return null
  const document = value as Partial<WorkspaceDocument>
  if (document.schemaVersion !== CURRENT_SCHEMA_VERSION || !document.graphs || typeof document.graphs !== 'object') return null
  const updatedAt = typeof document.updatedAt === 'string' ? document.updatedAt : new Date().toISOString()
  const graphs = Object.fromEntries(Object.entries(document.graphs).flatMap(([id, graph]) => { const normalized = normalizeGraph(graph, updatedAt); return normalized ? [[id, normalized]] : [] }))
  if (!Object.keys(graphs).length) return null
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: typeof document.revision === 'number' ? document.revision : 0,
    updatedAt,
    graphs,
    globalProperties: Array.isArray(document.globalProperties) ? document.globalProperties.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && ['text', 'text-list', 'image'].includes(item.type)) : []
  }
}

export function parseWorkspaceDocument(value: unknown): WorkspaceDocument | null { return validateDocument(value) }

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))
  })
}

export class IndexedDbStoragePort implements StoragePort {
  private database: Promise<IDBDatabase> | null = null

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
        if (!database.objectStoreNames.contains(BACKUP_STORE_NAME)) database.createObjectStore(BACKUP_STORE_NAME)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('Unable to open IndexedDB'))
    })
    return this.database
  }

  async load(): Promise<WorkspaceDocument | null> {
    const database = await this.open()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const stored = await requestResult(transaction.objectStore(STORE_NAME).get(DOCUMENT_KEY))
    const document = validateDocument(stored)
    if (document) return document
    return this.readLegacyDocument()
  }

  async save(document: WorkspaceDocument): Promise<void> {
    const valid = validateDocument(document)
    if (!valid) throw new Error('Refusing to save an invalid workspace document')
    const database = await this.open()
    const transaction = database.transaction([STORE_NAME, BACKUP_STORE_NAME], 'readwrite')
    const current = validateDocument(await requestResult(transaction.objectStore(STORE_NAME).get(DOCUMENT_KEY)))
    if (current) transaction.objectStore(BACKUP_STORE_NAME).put(current, `slot:${current.revision % BACKUP_SLOTS}`)
    transaction.objectStore(STORE_NAME).put(valid, DOCUMENT_KEY)
    await transactionDone(transaction)
  }

  async listBackups(): Promise<WorkspaceBackup[]> {
    const database = await this.open()
    const transaction = database.transaction(BACKUP_STORE_NAME, 'readonly')
    const [keys, values] = await Promise.all([requestResult(transaction.objectStore(BACKUP_STORE_NAME).getAllKeys()), requestResult(transaction.objectStore(BACKUP_STORE_NAME).getAll())])
    return values.flatMap((value, index) => { const document = validateDocument(value); return document ? [{ id: String(keys[index]), revision: document.revision, updatedAt: document.updatedAt }] : [] }).sort((a, b) => b.revision - a.revision)
  }

  async restoreBackup(id: string): Promise<WorkspaceDocument> {
    const database = await this.open()
    const transaction = database.transaction([STORE_NAME, BACKUP_STORE_NAME], 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const backups = transaction.objectStore(BACKUP_STORE_NAME)
    const [currentValue, backupValue] = await Promise.all([requestResult(store.get(DOCUMENT_KEY)), requestResult(backups.get(id))])
    const current = validateDocument(currentValue)
    const backup = validateDocument(backupValue)
    if (!backup) throw new Error('Backup is missing or invalid')
    const restored = { ...backup, revision: (current?.revision || 0) + 1, updatedAt: new Date().toISOString() }
    if (current) backups.put(current, `slot:${current.revision % BACKUP_SLOTS}`)
    store.put(restored, DOCUMENT_KEY)
    await transactionDone(transaction)
    return restored
  }

  async saveConflictCopy(document: WorkspaceDocument): Promise<string> {
    const database = await this.open()
    const transaction = database.transaction(BACKUP_STORE_NAME, 'readwrite')
    const id = `conflict:${Date.now()}`
    transaction.objectStore(BACKUP_STORE_NAME).put(document, id)
    await transactionDone(transaction)
    return id
  }

  private readLegacyDocument(): WorkspaceDocument | null {
    try {
      const rawGraphs = JSON.parse(localStorage.getItem('wordverse.graph') || 'null') as unknown
      if (!rawGraphs || typeof rawGraphs !== 'object') return null
      const migratedAt = new Date().toISOString()
      const candidate = rawGraphs as Record<string, unknown>
      const graphEntries = candidate.root ? Object.entries(candidate) : [['root', rawGraphs] as [string, unknown]]
      const graphs = Object.fromEntries(graphEntries.flatMap(([id, graph]) => { const normalized = normalizeGraph(graph, migratedAt); return normalized ? [[id, normalized]] : [] })) as Record<string, Graph>
      if (!Object.keys(graphs).length) return null
      const rawProperties = JSON.parse(localStorage.getItem('wordverse.globalProperties') || '[]') as unknown
      const document = validateDocument({ schemaVersion: CURRENT_SCHEMA_VERSION, revision: 0, updatedAt: migratedAt, graphs, globalProperties: Array.isArray(rawProperties) ? rawProperties : [] })
      return document
    } catch { return null }
  }
}

class TauriFileStoragePort implements StoragePort {
  async load(): Promise<WorkspaceDocument | null> {
    const raw = await invoke<string | null>('load_workspace')
    if (!raw) return null
    try { return validateDocument(JSON.parse(raw)) } catch { return null }
  }

  async save(document: WorkspaceDocument): Promise<void> {
    const valid = validateDocument(document)
    if (!valid) throw new Error('Refusing to save an invalid workspace document')
    try { await invoke('save_workspace', { document: JSON.stringify(valid, null, 2), expectedRevision: Math.max(0, valid.revision - 1) }) }
    catch (error) { if (String(error).includes('storage_conflict')) throw new StorageConflictError(); throw error }
  }

  async listBackups(): Promise<WorkspaceBackup[]> { return invoke<WorkspaceBackup[]>('list_workspace_backups') }

  async restoreBackup(id: string): Promise<WorkspaceDocument> {
    const slot = Number(id)
    if (!Number.isInteger(slot) || slot < 1 || slot > 3) throw new Error('Invalid backup slot')
    const raw = await invoke<string>('restore_workspace_backup', { slot, updatedAt: new Date().toISOString() })
    const document = validateDocument(JSON.parse(raw))
    if (!document) throw new Error('Restored backup is invalid')
    return document
  }

  async saveConflictCopy(document: WorkspaceDocument): Promise<string> {
    return invoke<string>('save_conflict_copy', { document: JSON.stringify(document, null, 2) })
  }
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export const workspaceStorage: StoragePort = isTauri ? new TauriFileStoragePort() : new IndexedDbStoragePort()
export const workspaceStorageLabel = isTauri ? '.Wordverse 词库文件' : '本地数据库'
export const workspaceAutoSaveDelay = isTauri ? 900 : 350

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('image_read_failed'))
    reader.onerror = () => reject(reader.error || new Error('image_read_failed'))
    reader.readAsDataURL(file)
  })
}

export async function storeImageAsset(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('unsupported_image_format')
  if (file.size > 12 * 1024 * 1024) throw new Error('image_size_invalid')
  if (!isTauri) return fileAsDataUrl(file)
  return invoke<string>('save_image_asset', { bytes: Array.from(new Uint8Array(await file.arrayBuffer())) })
}

const resolvedAssets = new Map<string, string>()
export async function resolveImageAsset(value: string): Promise<string> {
  if (!value.startsWith('asset:') || !isTauri) return value
  const cacheKey = `${localStorage.getItem('wordverse.activeProjectId') || 'legacy-default'}:${value}`
  const cached = resolvedAssets.get(cacheKey)
  if (cached) return cached
  const path = await invoke<string>('resolve_image_asset', { reference: value })
  const source = convertFileSrc(path)
  resolvedAssets.set(cacheKey, source)
  return source
}

export async function portableWorkspaceJson(document: WorkspaceDocument): Promise<string> {
  const serialized = JSON.stringify(document, null, 2)
  return isTauri ? invoke<string>('export_workspace_document', { document: serialized }) : serialized
}

export async function prepareImportedWorkspaceJson(serialized: string): Promise<string> {
  return isTauri ? invoke<string>('import_workspace_document', { document: serialized }) : serialized
}
