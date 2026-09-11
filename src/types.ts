export type PropertyType = 'text' | 'text-list' | 'image'
export type PropertyValue = string | string[]
export type PropertyDefinition = { id: string; name: string; type: PropertyType }
export type WordProperty = PropertyDefinition & { value: PropertyValue }

export type WordNode = {
  id: string
  label: string
  note: string
  tags: string[]
  links: string[]
  position: [number, number, number]
  scale: number
  hasChildGraph?: boolean
  isContextRoot?: boolean
  positionLocked?: boolean
  properties?: WordProperty[]
  createdAt?: string
  updatedAt?: string
  ghostSource?: { graphId: string; nodeId: string }
}

export type Edge = { source: string; target: string }
export type DeletedNode = { node: WordNode; edges: Edge[]; deletedAt: string }
export type DeletedEdge = { edge: Edge; deletedAt: string }
export type Graph = { id: string; name: string; nodes: WordNode[]; edges: Edge[]; trash?: DeletedNode[]; deletedEdges?: DeletedEdge[] }
