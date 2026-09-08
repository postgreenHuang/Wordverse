import { describe, expect, it } from 'vitest'
import { cutRelation, deleteGraphTree, deleteWord, graphTreeIds, restoreRelation, restoreWord } from './graphOps'
import type { Graph, WordNode } from './types'

const word = (id: string, extra: Partial<WordNode> = {}): WordNode => ({ id, label: id, note: '', tags: [], links: [], position: [0, 0, 0], scale: 1, ...extra })
const graph = (): Graph => ({ id: 'root', name: '主词网', nodes: [word('a'), word('b'), word('c')], edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }] })

describe('recoverable graph mutations', () => {
  it('deletes a word with its incident relations and restores only valid endpoints', () => {
    const deleted = deleteWord(graph(), 'b', '2026-09-07T00:00:00.000Z')
    expect(deleted.nodes.map(node => node.id)).toEqual(['a', 'c'])
    expect(deleted.edges).toEqual([])
    expect(deleted.trash?.[0].edges).toHaveLength(2)

    const withoutC = { ...deleted, nodes: deleted.nodes.filter(node => node.id !== 'c') }
    const restored = restoreWord(withoutC, 'b')
    expect(restored.nodes.map(node => node.id)).toEqual(['a', 'b'])
    expect(restored.edges).toEqual([{ source: 'a', target: 'b' }])
    expect(restored.trash).toEqual([])
  })

  it('protects context roots and the final word', () => {
    const contextGraph = { ...graph(), nodes: [word('context', { isContextRoot: true }), word('peer')] }
    expect(deleteWord(contextGraph, 'context', 'time')).toBe(contextGraph)
    const singleton = { ...graph(), nodes: [word('only')], edges: [] }
    expect(deleteWord(singleton, 'only', 'time')).toBe(singleton)
  })

  it('cuts and restores an exact relation without creating duplicates', () => {
    const cut = cutRelation(graph(), 'b', 'a', 'cut-time')
    expect(cut.edges).toEqual([{ source: 'b', target: 'c' }])
    const restored = restoreRelation(cut, 'a', 'b', 'cut-time')
    expect(restored.edges).toContainEqual({ source: 'a', target: 'b' })
    expect(restored.deletedEdges).toEqual([])

    const duplicate = restoreRelation({ ...cut, edges: [{ source: 'b', target: 'a' }] }, 'a', 'b', 'cut-time')
    expect(duplicate.edges).toHaveLength(1)
    expect(duplicate.deletedEdges).toEqual([])
  })

  it('keeps a deleted relation recoverable while an endpoint is missing', () => {
    const cut = cutRelation(graph(), 'a', 'b', 'cut-time')
    const missing = { ...cut, nodes: cut.nodes.filter(node => node.id !== 'b') }
    expect(restoreRelation(missing, 'a', 'b', 'cut-time')).toBe(missing)
  })
})

describe('main graph file mutations', () => {
  it('collects and deletes only the selected graph and its nested child graphs', () => {
    const root = graph()
    root.nodes[0].hasChildGraph = true
    const child: Graph = { id: 'child:a', name: 'a', nodes: [word('nested', { hasChildGraph: true })], edges: [] }
    const grandchild: Graph = { id: 'child:nested', name: 'nested', nodes: [], edges: [] }
    const other: Graph = { id: 'graph:other', name: '其他', nodes: [word('other')], edges: [] }
    const graphs = { root, 'child:a': child, 'child:nested': grandchild, 'graph:other': other }
    expect([...graphTreeIds(graphs, 'root')]).toEqual(['root', 'child:a', 'child:nested'])
    expect(Object.keys(deleteGraphTree(graphs, 'root'))).toEqual(['graph:other'])
  })
})
