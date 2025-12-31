import type { ReactFlowNode, ReactFlowEdge, ReactFlowViewport, TldrawSnapshot } from './block'

export type DiagramType = 'architecture' | 'flow' | 'sequence' | 'entity' | 'custom'

export interface DiagramData {
  type: DiagramType
  nodes: ReactFlowNode[]
  edges: ReactFlowEdge[]
  viewport?: ReactFlowViewport
}

export interface WhiteboardData {
  snapshot: TldrawSnapshot
}

export interface CreateDiagramInput {
  path: string
  title: string
  type: DiagramType
  data: DiagramData
}

export interface UpdateDiagramInput {
  data: DiagramData
}

export interface CreateWhiteboardInput {
  path: string
  title: string
  snapshot: TldrawSnapshot
}

export interface UpdateWhiteboardInput {
  snapshot: TldrawSnapshot
}
