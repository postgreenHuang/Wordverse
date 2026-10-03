import { graphTreeIds } from './graphOps'
import type { Edge, Graph, WordNode } from './types'

export type NodeClipboard = { sourceGraphId: string; nodes: WordNode[]; edges: Edge[]; childGraphs: Record<string, Graph> }

export function copyNodeSelection(graph: Graph, graphs: Record<string, Graph>, ids: Iterable<string>): NodeClipboard | null {
  const selected = new Set(ids)
  const nodes = graph.nodes.filter(node => selected.has(node.id) && !node.isContextRoot)
  if (!nodes.length) return null
  const childIds = new Set(nodes.flatMap(node => [...graphTreeIds(graphs, `child:${node.id}`)]))
  return structuredClone({
    sourceGraphId: graph.id,
    nodes,
    edges: graph.edges.filter(edge => selected.has(edge.source) && selected.has(edge.target)),
    childGraphs: Object.fromEntries([...childIds].map(id => [id, graphs[id]])),
  })
}

export function pasteNodeSelection(
  clipboard: NodeClipboard,
  targetGraphId: string,
  target: [number, number, number],
  timestamp: string,
  newId: () => string = () => crypto.randomUUID(),
): { nodes: WordNode[]; edges: Edge[]; childGraphs: Record<string, Graph> } {
  const idMap = new Map<string, string>()
  const register = (node: WordNode) => { if (!idMap.has(node.id)) idMap.set(node.id, newId()) }
  clipboard.nodes.forEach(register)
  Object.values(clipboard.childGraphs).forEach(graph => {
    graph.nodes.forEach(register)
    graph.trash?.forEach(item => register(item.node))
  })
  const graphIdMap = new Map(Object.keys(clipboard.childGraphs).map(id => [id, `child:${idMap.get(id.slice('child:'.length))}`]))
  const mapEdge = (edge: Edge): Edge => ({ source: idMap.get(edge.source) || edge.source, target: idMap.get(edge.target) || edge.target })
  const mapNode = (node: WordNode): WordNode => ({
    ...node,
    id: idMap.get(node.id)!,
    hasChildGraph: !!clipboard.childGraphs[`child:${node.id}`],
    ghostSource: node.ghostSource ? {
      graphId: graphIdMap.get(node.ghostSource.graphId) || (node.ghostSource.graphId === clipboard.sourceGraphId && idMap.has(node.ghostSource.nodeId) ? targetGraphId : node.ghostSource.graphId),
      nodeId: idMap.get(node.ghostSource.nodeId) || node.ghostSource.nodeId,
    } : undefined,
  })
  const centroid = clipboard.nodes.reduce<[number, number, number]>((sum, node) => [sum[0] + node.position[0], sum[1] + node.position[1], sum[2] + node.position[2]], [0, 0, 0]).map(value => value / clipboard.nodes.length)
  const nodes = clipboard.nodes.map(node => ({
    ...mapNode(node),
    position: [node.position[0] - centroid[0] + target[0], node.position[1] - centroid[1] + target[1], node.position[2] - centroid[2] + target[2]] as [number, number, number],
    positionLocked: true,
    isContextRoot: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
  const childGraphs = Object.fromEntries(Object.entries(clipboard.childGraphs).map(([oldId, graph]) => {
    const id = graphIdMap.get(oldId)!
    return [id, {
      ...graph,
      id,
      nodes: graph.nodes.map(mapNode),
      edges: graph.edges.map(mapEdge),
      trash: graph.trash?.map(item => ({ node: mapNode(item.node), edges: item.edges.map(mapEdge), deletedAt: item.deletedAt })),
      deletedEdges: graph.deletedEdges?.map(item => ({ edge: mapEdge(item.edge), deletedAt: item.deletedAt })),
    }]
  })) as Record<string, Graph>
  return { nodes, edges: clipboard.edges.map(mapEdge), childGraphs }
}