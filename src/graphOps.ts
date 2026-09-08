import type { Edge, Graph } from './types'

const sameUndirectedEdge = (left: Edge, right: Edge) =>
  (left.source === right.source && left.target === right.target) ||
  (left.source === right.target && left.target === right.source)

export function cutRelation(graph: Graph, source: string, target: string, deletedAt: string): Graph {
  const edge = graph.edges.find(candidate => sameUndirectedEdge(candidate, { source, target }))
  if (!edge) return graph
  return {
    ...graph,
    edges: graph.edges.filter(candidate => candidate !== edge),
    deletedEdges: [...(graph.deletedEdges || []), { edge, deletedAt }],
  }
}

export function deleteWord(graph: Graph, nodeId: string, deletedAt: string): Graph {
  const node = graph.nodes.find(candidate => candidate.id === nodeId)
  if (!node || node.isContextRoot || graph.nodes.length <= 1) return graph
  const edges = graph.edges.filter(edge => edge.source === nodeId || edge.target === nodeId)
  return {
    ...graph,
    nodes: graph.nodes.filter(candidate => candidate.id !== nodeId),
    edges: graph.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId),
    trash: [...(graph.trash || []), { node, edges, deletedAt }],
  }
}

export function restoreWord(graph: Graph, nodeId: string): Graph {
  const deleted = graph.trash?.find(item => item.node.id === nodeId)
  if (!deleted || graph.nodes.some(node => node.id === nodeId)) return graph
  const available = new Set([...graph.nodes.map(node => node.id), nodeId])
  const edges = [...graph.edges]
  deleted.edges.forEach(edge => {
    if (available.has(edge.source) && available.has(edge.target) && !edges.some(candidate => sameUndirectedEdge(candidate, edge))) edges.push(edge)
  })
  return { ...graph, nodes: [...graph.nodes, deleted.node], edges, trash: graph.trash?.filter(item => item !== deleted) }
}

export function restoreRelation(graph: Graph, source: string, target: string, deletedAt: string): Graph {
  const deletedEdges = graph.deletedEdges?.filter(item => item.deletedAt !== deletedAt)
  if (!graph.nodes.some(node => node.id === source) || !graph.nodes.some(node => node.id === target)) return graph
  if (graph.edges.some(edge => sameUndirectedEdge(edge, { source, target }))) return { ...graph, deletedEdges }
  return { ...graph, edges: [...graph.edges, { source, target }], deletedEdges }
}

export function graphTreeIds(graphs: Record<string, Graph>, rootId: string): Set<string> {
  const result = new Set<string>()
  const visit = (graphId: string) => {
    if (result.has(graphId) || !graphs[graphId]) return
    result.add(graphId)
    graphs[graphId].nodes.forEach(node => visit(`child:${node.id}`))
  }
  visit(rootId)
  return result
}

export function deleteGraphTree(graphs: Record<string, Graph>, rootId: string): Record<string, Graph> {
  const removed = graphTreeIds(graphs, rootId)
  if (!removed.size) return graphs
  return Object.fromEntries(Object.entries(graphs).filter(([id]) => !removed.has(id)))
}
