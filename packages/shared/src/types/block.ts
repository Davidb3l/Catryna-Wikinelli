export type BlockType =
  | 'text'           // Rich text paragraph
  | 'heading'        // H1-H6
  | 'code'           // Inline code block
  | 'code-embed'     // Embedded from source file
  | 'mermaid'        // Mermaid diagram
  | 'react-flow'     // React Flow diagram
  | 'whiteboard'     // tldraw canvas
  | 'table'          // Data table
  | 'callout'        // Info/warning/error boxes
  | 'divider'        // Horizontal rule

export interface Block {
  id: string
  type: BlockType
  data: BlockData
}

export type BlockData =
  | TextBlockData
  | HeadingBlockData
  | CodeBlockData
  | CodeEmbedBlockData
  | MermaidBlockData
  | ReactFlowBlockData
  | WhiteboardBlockData
  | TableBlockData
  | CalloutBlockData
  | DividerBlockData

export interface TextBlockData {
  type: 'text'
  content: string // Rich text HTML or markdown
}

export interface HeadingBlockData {
  type: 'heading'
  level: 1 | 2 | 3 | 4 | 5 | 6
  content: string
}

export interface CodeBlockData {
  type: 'code'
  language: string
  content: string
  caption?: string
}

export interface CodeEmbedBlockData {
  type: 'code-embed'
  filePath: string
  startLine: number
  endLine: number
  language: string
  caption?: string
}

export interface MermaidBlockData {
  type: 'mermaid'
  content: string // Mermaid code
  caption?: string
}

export interface ReactFlowBlockData {
  type: 'react-flow'
  nodes: ReactFlowNode[]
  edges: ReactFlowEdge[]
  viewport: ReactFlowViewport
  caption?: string
}

export interface ReactFlowNode {
  id: string
  type?: string
  data: { label: string; [key: string]: unknown }
  position: { x: number; y: number }
  style?: Record<string, string | number>
}

export interface ReactFlowEdge {
  id: string
  source: string
  target: string
  type?: string
  label?: string
  animated?: boolean
  style?: Record<string, string | number>
}

export interface ReactFlowViewport {
  x: number
  y: number
  zoom: number
}

export interface WhiteboardBlockData {
  type: 'whiteboard'
  snapshot: TldrawSnapshot
  caption?: string
}

// tldraw snapshot type (simplified - actual structure is more complex)
export interface TldrawSnapshot {
  store: Record<string, unknown>
  schema: Record<string, unknown>
}

export interface TableBlockData {
  type: 'table'
  headers: string[]
  rows: string[][]
  caption?: string
}

export interface CalloutBlockData {
  type: 'callout'
  variant: 'info' | 'warning' | 'error' | 'success' | 'note'
  title?: string
  content: string
}

export interface DividerBlockData {
  type: 'divider'
}
