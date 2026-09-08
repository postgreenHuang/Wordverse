import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION, IndexedDbStoragePort, parseWorkspaceDocument, type WorkspaceDocument } from './storage'

function documentAt(revision: number, label = '记忆'): WorkspaceDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision,
    updatedAt: `2026-09-06T15:00:0${revision}.000Z`,
    graphs: { root: { id: 'root', name: '主词网', nodes: [{ id: 'word', label, note: '', tags: [], links: [], position: [0, 0, 0], scale: 1 }], edges: [] } },
    globalProperties: [],
  }
}

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('wordverse')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

describe('workspace schema boundary', () => {
  it('accepts a valid versioned workspace', () => {
    const parsed = parseWorkspaceDocument(documentAt(1))!
    expect(parsed.graphs.root.nodes[0].label).toBe('记忆')
    expect(parsed.graphs.root.nodes[0].createdAt).toBe(parsed.updatedAt)
    expect(parsed.graphs.root.nodes[0].updatedAt).toBe(parsed.updatedAt)
  })

  it('rejects unknown schema versions and empty graph collections', () => {
    expect(parseWorkspaceDocument({ ...documentAt(1), schemaVersion: 99 })).toBeNull()
    expect(parseWorkspaceDocument({ ...documentAt(1), graphs: {} })).toBeNull()
  })

  it('filters malformed global property definitions', () => {
    const parsed = parseWorkspaceDocument({ ...documentAt(1), globalProperties: [{ id: 'ok', name: '来源', type: 'text' }, { id: 'bad', name: '错误', type: 'number' }] })
    expect(parsed?.globalProperties).toEqual([{ id: 'ok', name: '来源', type: 'text' }])
  })

  it('removes unsafe nodes, duplicate identities and dangling relations', () => {
    const valid = documentAt(1)
    valid.graphs.root.nodes.push(
      { ...valid.graphs.root.nodes[0], id: 'second', label: '联系', position: [1, 1, 1] },
      { ...valid.graphs.root.nodes[0], id: 'word', label: '重复 ID', position: [2, 2, 2] },
      { ...valid.graphs.root.nodes[0], id: 'infinite', position: [Infinity, 0, 0] },
    )
    valid.graphs.root.edges = [
      { source: 'word', target: 'second' },
      { source: 'second', target: 'word' },
      { source: 'word', target: 'missing' },
      { source: 'word', target: 'word' },
    ]
    const parsed = parseWorkspaceDocument(valid)!
    expect(parsed.graphs.root.nodes.map(node => node.id)).toEqual(['word', 'second'])
    expect(parsed.graphs.root.edges).toEqual([{ source: 'word', target: 'second' }])
  })

  it('normalizes optional node fields and filters malformed content', () => {
    const source = documentAt(1) as unknown as Record<string, any>
    source.graphs.root.nodes[0] = {
      id: 'word', label: '记忆', position: [0, 0, 0], tags: ['学习', 42], links: null,
      properties: [
        { id: 'text', name: '解释', type: 'text', value: '内容' },
        { id: 'list', name: '来源', type: 'text-list', value: ['A', 3, 'B'] },
        { id: 'bad', name: '错误', type: 'image', value: [] },
      ],
    }
    const node = parseWorkspaceDocument(source)!.graphs.root.nodes[0]
    expect(node.note).toBe('')
    expect(node.tags).toEqual(['学习'])
    expect(node.links).toEqual([])
    expect(node.scale).toBe(1)
    expect(node.properties).toEqual([
      { id: 'text', name: '解释', type: 'text', value: '内容' },
      { id: 'list', name: '来源', type: 'text-list', value: ['A', 'B'] },
    ])
  })
})

describe('IndexedDB durability', () => {
  it('rotates the prior revision and restores it as a new revision', async () => {
    const storage = new IndexedDbStoragePort()
    await storage.save(documentAt(1, '第一版'))
    await storage.save(documentAt(2, '第二版'))
    const backups = await storage.listBackups()
    expect(backups).toHaveLength(1)
    expect(backups[0].revision).toBe(1)
    const restored = await storage.restoreBackup(backups[0].id)
    expect(restored.revision).toBe(3)
    expect(restored.graphs.root.nodes[0].label).toBe('第一版')
    expect((await storage.load())?.revision).toBe(3)
  })
})
