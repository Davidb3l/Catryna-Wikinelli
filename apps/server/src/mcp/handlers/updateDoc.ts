import { eq } from 'drizzle-orm'
import { getDb, docs, docVersions, docSearch } from '../../db'
import { hashContent } from '@catryna/shared'
import type { Block, BlockType, DocMetadata } from '@catryna/shared'

interface UpdateDocArgs {
  path: string
  title?: string
  content?: Array<{
    type: string
    data: unknown
  }>
  tags?: string[]
  relatedFiles?: string[]
}

export async function updateDocHandler(args: unknown): Promise<{
  success: boolean
  doc?: { id: string; path: string; title: string }
  error?: string
}> {
  const input = args as UpdateDocArgs

  if (!input.path) {
    return { success: false, error: 'Missing required field: path' }
  }

  try {
    const db = getDb()
    const now = new Date()

    // Find existing doc
    const existing = await db.query.docs.findFirst({
      where: eq(docs.path, input.path),
    })

    if (!existing) {
      return { success: false, error: `Doc not found at path: ${input.path}` }
    }

    const currentMetadata = existing.metadata as DocMetadata

    // Prepare updates
    const newBlocks = input.content
      ? input.content.map((block, i) => ({
          id: `block-${Date.now()}-${i}`,
          type: block.type as BlockType,
          data: block.data as Block['data'],
        }))
      : (existing.blocks as Block[])

    const metadata: DocMetadata = {
      ...currentMetadata,
      updatedAt: now,
      tags: input.tags ?? currentMetadata.tags,
      relatedFiles: input.relatedFiles ?? currentMetadata.relatedFiles,
    }

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(docs)
        .set({
          title: input.title ?? existing.title,
          blocks: newBlocks,
          metadata,
          updatedAt: now,
        })
        .where(eq(docs.id, existing.id))
        .returning()

      // Only create version if content changed
      if (input.content) {
        const contentHash = hashContent(newBlocks)
        await tx.insert(docVersions).values({
          docId: existing.id,
          content: newBlocks,
          contentHash,
          createdBy: 'claude-code',
          summary: `Updated by Claude Code`,
        })

        // Update search index
        const plainText = extractPlainText(newBlocks)
        await tx
          .update(docSearch)
          .set({
            searchVector: plainText,
            plainContent: plainText,
          })
          .where(eq(docSearch.docId, existing.id))
      }

      return updated
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
