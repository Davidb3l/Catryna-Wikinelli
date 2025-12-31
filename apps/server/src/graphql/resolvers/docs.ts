import { eq, desc, like, sql, and } from 'drizzle-orm'
import { getDb, docs, docVersions, docSearch } from '../../db'
import { hashContent } from '@catryna/shared'
import type { Block, DocMetadata } from '@catryna/shared'

interface CreateDocInput {
  path: string
  title: string
  blocks: { type: string; data: unknown }[]
  tags?: string[]
  relatedFiles?: string[]
}

interface UpdateDocInput {
  title?: string
  blocks?: { type: string; data: unknown }[]
  tags?: string[]
  relatedFiles?: string[]
}

interface DocFilter {
  tag?: string
  search?: string
  path?: string
  createdBy?: string
}

// Helper to extract plain text from blocks for search indexing
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

export const docsResolvers = {
  Query: {
    async doc(_: unknown, { path }: { path: string }) {
      const db = getDb()
      const result = await db.query.docs.findFirst({
        where: eq(docs.path, path),
        with: {
          versions: {
            orderBy: desc(docVersions.createdAt),
            limit: 10,
          },
        },
      })
      return result || null
    },

    async docs(_: unknown, { filter }: { filter?: DocFilter }) {
      const db = getDb()

      const conditions = []
      if (filter?.path) {
        conditions.push(like(docs.path, `${filter.path}%`))
      }
      if (filter?.tag) {
        conditions.push(sql`${docs.metadata}->>'tags' ? ${filter.tag}`)
      }

      const results = await db
        .select({
          id: docs.id,
          path: docs.path,
          title: docs.title,
          updatedAt: docs.updatedAt,
          metadata: docs.metadata,
        })
        .from(docs)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(docs.updatedAt))
        .limit(100)

      return results.map((doc) => ({
        ...doc,
        tags: (doc.metadata as DocMetadata).tags || [],
      }))
    },
  },

  Mutation: {
    async createDoc(_: unknown, { input }: { input: CreateDocInput }) {
      const db = getDb()
      const now = new Date()

      const blocks = input.blocks.map((b, i) => ({
        id: `block-${Date.now()}-${i}`,
        type: b.type as Block['type'],
        data: b.data as Block['data'],
      }))

      const metadata: DocMetadata = {
        createdAt: now,
        updatedAt: now,
        createdBy: 'claude-code',
        tags: input.tags || [],
        relatedFiles: input.relatedFiles || [],
      }

      const contentHash = hashContent(blocks)

      // Use transaction for atomic insert
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
        })

        // Update search index
        const plainText = extractPlainText(blocks)
        await tx.insert(docSearch).values({
          docId: doc.id,
          searchVector: plainText, // In real impl, would use tsvector
          plainContent: plainText,
        })

        return doc
      })

      return result
    },

    async updateDoc(_: unknown, { path, input }: { path: string; input: UpdateDocInput }) {
      const db = getDb()
      const now = new Date()

      const existingDoc = await db.query.docs.findFirst({
        where: eq(docs.path, path),
      })

      if (!existingDoc) {
        throw new Error(`Doc not found: ${path}`)
      }

      const currentMetadata = existingDoc.metadata as DocMetadata
      const newBlocks = input.blocks
        ? input.blocks.map((b, i) => ({
            id: `block-${Date.now()}-${i}`,
            type: b.type as Block['type'],
            data: b.data as Block['data'],
          }))
        : existingDoc.blocks

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
            title: input.title ?? existingDoc.title,
            blocks: newBlocks,
            metadata,
            updatedAt: now,
          })
          .where(eq(docs.id, existingDoc.id))
          .returning()

        // Only create version if blocks changed
        if (input.blocks) {
          const contentHash = hashContent(newBlocks)
          await tx.insert(docVersions).values({
            docId: existingDoc.id,
            content: newBlocks,
            contentHash,
            createdBy: 'claude-code',
          })

          // Update search index
          const plainText = extractPlainText(newBlocks)
          await tx
            .update(docSearch)
            .set({
              searchVector: plainText,
              plainContent: plainText,
            })
            .where(eq(docSearch.docId, existingDoc.id))
        }

        return updated
      })

      return result
    },

    async deleteDoc(_: unknown, { path }: { path: string }) {
      const db = getDb()

      const existingDoc = await db.query.docs.findFirst({
        where: eq(docs.path, path),
      })

      if (!existingDoc) {
        return false
      }

      await db.delete(docs).where(eq(docs.id, existingDoc.id))
      return true
    },
  },

  Doc: {
    versions: async (parent: { id: string }) => {
      const db = getDb()
      return db.query.docVersions.findMany({
        where: eq(docVersions.docId, parent.id),
        orderBy: desc(docVersions.createdAt),
      })
    },

    currentVersion: async (parent: { id: string }) => {
      const db = getDb()
      return db.query.docVersions.findFirst({
        where: eq(docVersions.docId, parent.id),
        orderBy: desc(docVersions.createdAt),
      })
    },
  },
}
