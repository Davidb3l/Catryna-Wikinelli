import { eq, desc } from 'drizzle-orm'
import { getDb, docs, docVersions, docSearch } from '../../db'
import type { Block, DocMetadata } from '@catryna/shared'

export const versionsResolvers = {
  Query: {
    async docVersion(_: unknown, { id }: { id: string }) {
      const db = getDb()
      return db.query.docVersions.findFirst({
        where: eq(docVersions.id, id),
      })
    },

    async docVersions(_: unknown, { docPath }: { docPath: string }) {
      const db = getDb()

      const doc = await db.query.docs.findFirst({
        where: eq(docs.path, docPath),
      })

      if (!doc) {
        return []
      }

      return db.query.docVersions.findMany({
        where: eq(docVersions.docId, doc.id),
        orderBy: desc(docVersions.createdAt),
      })
    },
  },

  Mutation: {
    async revertToVersion(
      _: unknown,
      { docPath, versionId }: { docPath: string; versionId: string }
    ) {
      const db = getDb()

      const existingDoc = await db.query.docs.findFirst({
        where: eq(docs.path, docPath),
      })

      if (!existingDoc) {
        throw new Error(`Doc not found: ${docPath}`)
      }

      const version = await db.query.docVersions.findFirst({
        where: eq(docVersions.id, versionId),
      })

      if (!version) {
        throw new Error(`Version not found: ${versionId}`)
      }

      if (version.docId !== existingDoc.id) {
        throw new Error('Version does not belong to this document')
      }

      const now = new Date()
      const blocks = version.content as Block[]
      const currentMetadata = existingDoc.metadata as DocMetadata

      const result = await db.transaction(async (tx) => {
        // Update the document with the old version's content
        const [updated] = await tx
          .update(docs)
          .set({
            blocks,
            metadata: {
              ...currentMetadata,
              updatedAt: now,
            },
            updatedAt: now,
          })
          .where(eq(docs.id, existingDoc.id))
          .returning()

        // Create a new version entry to track the revert
        await tx.insert(docVersions).values({
          docId: existingDoc.id,
          content: blocks,
          contentHash: version.contentHash,
          createdBy: 'user:revert',
          summary: `Reverted to version from ${version.createdAt}`,
          parentVersionId: version.id,
        })

        // Update search index
        const plainText = extractPlainText(blocks)
        await tx
          .update(docSearch)
          .set({
            searchVector: plainText,
            plainContent: plainText,
          })
          .where(eq(docSearch.docId, existingDoc.id))

        return updated
      })

      return result
    },
  },
}

// Helper function duplicated here for module isolation
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
