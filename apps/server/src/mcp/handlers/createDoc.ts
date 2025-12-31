import { getDb, docs, docVersions, docSearch } from '../../db'
import { hashContent } from '@catryna/shared'
import type { Block, BlockType, DocMetadata } from '@catryna/shared'

interface CreateDocArgs {
  path: string
  title: string
  content: Array<{
    type: string
    data: unknown
  }>
  relatedFiles?: string[]
  tags?: string[]
}

export async function createDocHandler(args: unknown): Promise<{
  success: boolean
  doc?: { id: string; path: string; title: string }
  error?: string
}> {
  const input = args as CreateDocArgs

  if (!input.path || !input.title || !input.content) {
    return { success: false, error: 'Missing required fields: path, title, content' }
  }

  try {
    const db = getDb()
    const now = new Date()

    // Transform content blocks
    const blocks: Block[] = input.content.map((block, i) => ({
      id: `block-${Date.now()}-${i}`,
      type: block.type as BlockType,
      data: block.data as Block['data'],
    }))

    const metadata: DocMetadata = {
      createdAt: now,
      updatedAt: now,
      createdBy: 'claude-code',
      tags: input.tags || [],
      relatedFiles: input.relatedFiles || [],
    }

    const contentHash = hashContent(blocks)

    // Check if doc already exists
    const existing = await db.query.docs.findFirst({
      where: (table, { eq }) => eq(table.path, input.path),
    })

    if (existing) {
      return { success: false, error: `Doc already exists at path: ${input.path}` }
    }

    // Create doc with version
    const result = await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(docs)
        .values({
          path: input.path,
          title: input.title,
          blocks,
          metadata,
        })
        .returning()

      await tx.insert(docVersions).values({
        docId: doc.id,
        content: blocks,
        contentHash,
        createdBy: 'claude-code',
        summary: `Initial creation by Claude Code`,
      })

      // Update search index
      const plainText = extractPlainText(blocks)
      await tx.insert(docSearch).values({
        docId: doc.id,
        searchVector: plainText,
        plainContent: plainText,
      })

      return doc
    })

    return {
      success: true,
      doc: {
        id: result.id,
        path: result.path,
        title: result.title,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

function extractPlainText(blocks: Block[]): string {
  return blocks
    .map((block) => {
      const data = block.data as Record<string, unknown>
      if (typeof data.content === 'string') return data.content
      if (Array.isArray(data.rows)) {
        return data.rows.flat().join(' ')
      }
      return ''
    })
    .filter(Boolean)
    .join(' ')
}
