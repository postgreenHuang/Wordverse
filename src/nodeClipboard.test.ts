import { describe, expect, it } from 'vitest'
import { copyNodeSelection, pasteNodeSelection } from './nodeClipboard'
import type { Graph, WordNode } from './types'

const word = (id: string, extra: Partial<WordNode> = {}): WordNode => ({
  id, label: id, note: '', tags: [], links: [], position: [0, 0, 0], scale: 1, ...extra,
})
const makeGraph = (id: string, nodes: WordNode[], edges: Graph['edges'] = []): Graph => ({ id, name: id, nodes, edges })

describe('node clipboard subtrees', () => {
  it('copies and pastes nested child graphs with new IDs and intact edges', () => {
    const root = makeGraph('root', [word('owner', { hasChildGraph: true, position: [4, 0, 0] }), word('other')])
    const child = makeGraph('child:owner', [word('context', { isContextRoot: true }), word('inner', { hasChildGraph: true }), word('peer')], [{ source: 'inner', target: 'peer' }])
    const grandchild = makeGraph('child:inner', [word('deep-context', { isContextRoot: true }), word('deep')])
    const graphs = { root, 'child:owner': child, 'child:inner': grandchild }
    const clipboard = copyNodeSelection(root, graphs, ['owner'])!
    expect(Object.keys(clipboard.childGraphs)).toEqual(['child:owner', 'child:inner'])
    const pasted = pasteNodeSelection(clipboard, 'root', [10, 2, 3], '2026-09-17T00:00:00.000Z', (() => {
      let next = 0
      return () => `new-${++next}`
    })())
    const owner = pasted.nodes[0]
    expect(owner.id).not.toBe('owner')
    expect(owner.hasChildGraph).toBe(true)
    expect(owner.position).toEqual([10, 2, 3])
    const copiedChild = pasted.childGraphs[`child:${owner.id}`]
    expect(copiedChild).toBeDefined()
    expect(copiedChild.nodes[0].isContextRoot).toBe(true)
    const inner = copiedChild.nodes.find(node => node.label === 'inner')!
    const peer = copiedChild.nodes.find(node => node.label === 'peer')!
    expect(copiedChild.edges).toEqual([{ source: inner.id, target: peer.id }])
    expect(inner.hasChildGraph).toBe(true)
    expect(pasted.childGraphs[`child:${inner.id}`].nodes.map(node => node.label)).toEqual(['deep-context', 'deep'])
    expect(graphs['child:owner'].nodes[1].id).toBe('inner')
  })

  it('keeps trashed descendants in a copied subtree', () => {
    const root = makeGraph('root', [word('owner', { hasChildGraph: true })])
    const child: Graph = { ...makeGraph('child:owner', [word('context', { isContextRoot: true })]), trash: [{ node: word('deleted', { hasChildGraph: true }), edges: [], deletedAt: 'time' }] }
    const graphs = { root, 'child:owner': child, 'child:deleted': makeGraph('child:deleted', [word('deep')]) }
    const clipboard = copyNodeSelection(root, graphs, ['owner'])!
    const pasted = pasteNodeSelection(clipboard, 'root', [0, 0, 0], 'time', (() => {
      let next = 0
      return () => `copy-${++next}`
    })())
    const copiedChild = pasted.childGraphs[`child:${pasted.nodes[0].id}`]
    const deleted = copiedChild.trash![0].node
    expect(deleted.hasChildGraph).toBe(true)
    expect(pasted.childGraphs[`child:${deleted.id}`].nodes[0].label).toBe('deep')
  })
})