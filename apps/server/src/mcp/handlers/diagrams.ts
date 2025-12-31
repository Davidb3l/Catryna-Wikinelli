import { getDb, docs, docVersions, docSearch } from '../../db'
import { hashContent } from '@catryna/shared'
import type { Block, DocMetadata, ReactFlowNode, ReactFlowEdge, TldrawSnapshot } from '@catryna/shared'

interface CreateDiagramArgs {
  path: string
  title?: string
  type?: 'architecture' | 'flow' | 'sequence' | 'entity' | 'custom'
  nodes: ReactFlowNode[]
  edges: ReactFlowEdge[]
}

interface CreateWhiteboardArgs {
  path: string
  title?: string
  snapshot: TldrawSnapshot
}

export const diagramHandlers = {
  async createDiagram(args: unknown): Promise<{
    success: boolean
    doc?: { id: string; path: string }
    error?: string
  }> {
    const input = args as CreateDiagramArgs

    if (!input.path || !input.nodes || !input.edges) {
      return { success: false, error: 'Missing required fields: path, nodes, edges' }
    }

    try {
      const db = getDb()
      const now = new Date()

      const diagramBlock: Block = {
        id: `block-diagram-${Date.now()}`,
        type: 'react-flow',
        data: {
          type: 'react-flow',
          nodes: input.nodes,
          edges: input.edges,
          viewport: { x: 0, y: 0, zoom: 1 },
          caption: input.title,
        },
      }

      const blocks: Block[] = [
        {
          id: `block-heading-${Date.now()}`,
          type: 'heading',
          data: {
            type: 'heading',
            level: 1,
            content: input.title || 'Diagram',
          },
        },
        diagramBlock,
      ]

      const metadata: DocMetadata = {
        createdAt: now,
        updatedAt: now,
        createdBy: 'claude-code',
        tags: ['diagram', input.type || 'custom'],
        relatedFiles: [],
      }

      const contentHash = hashContent(blocks)

      const result = await db.transaction(async (tx) => {
        const [doc] = await tx
          .insert(docs)
          .values({
            path: input.path,
            title: input.title || 'Diagram',
            blocks,
            metadata,
          })
          .returning()

        await tx.insert(docVersions).values({
          docId: doc.id,
          content: blocks,
          contentHash,
          createdBy: 'claude-code',
          summary: `Diagram created by Claude Code`,
        })

        await tx.insert(docSearch).values({
          docId: doc.id,
          searchVector: input.title || 'diagram',
          plainContent: input.title || 'diagram',
        })

        return doc
      })

      return { success: true, doc: { id: result.id, path: result.path } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  },

  async createWhiteboard(args: unknown): Promise<{
    success: boolean
    doc?: { id: string; path: string }
    error?: string
  }> {
    const input = args as CreateWhiteboardArgs

    if (!input.path || !input.snapshot) {
      return { success: false, error: 'Missing required fields: path, snapshot' }
    }

    try {
      const db = getDb()
      const now = new Date()

      const whiteboardBlock: Block = {
        id: `block-whiteboard-${Date.now()}`,
        type: 'whiteboard',
        data: {
          type: 'whiteboard',
          snapshot: input.snapshot,
          caption: input.title,
        },
      }

      const blocks: Block[] = [
        {
          id: `block-heading-${Date.now()}`,
          type: 'heading',
          data: {
            type: 'heading',
            level: 1,
            content: input.title || 'Whiteboard',
          },
        },
        whiteboardBlock,
      ]

      const metadata: DocMetadata = {
        createdAt: now,
        updatedAt: now,
        createdBy: 'claude-code',
        tags: ['whiteboard'],
        relatedFiles: [],
      }

      const contentHash = hashContent(blocks)

      const result = await db.transaction(async (tx) => {
        const [doc] = await tx
          .insert(docs)
          .values({
            path: input.path,
            title: input.title || 'Whiteboard',
            blocks,
            metadata,
          })
          .returning()

        await tx.insert(docVersions).values({
          docId: doc.id,
          content: blocks,
          contentHash,
          createdBy: 'claude-code',
          summary: `Whiteboard created by Claude Code`,
        })

        await tx.insert(docSearch).values({
          docId: doc.id,
          searchVector: input.title || 'whiteboard',
          plainContent: input.title || 'whiteboard',
        })

        return doc
      })

      return { success: true, doc: { id: result.id, path: result.path } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  },
}
