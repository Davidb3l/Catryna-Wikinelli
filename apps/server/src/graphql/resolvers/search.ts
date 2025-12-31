import { eq, sql, desc, like } from 'drizzle-orm'
import { getDb, docs, docSearch, watchedFiles } from '../../db'
import type { DocMetadata } from '@catryna/shared'

interface SearchFilters {
  docTypes?: string[]
  module?: string
}

export const searchResolvers = {
  Query: {
    async search(
      _: unknown,
      { query, filters, limit = 20 }: { query: string; filters?: SearchFilters; limit?: number }
    ) {
      const db = getDb()

      // Simple search implementation using LIKE
      // In production with Postgres, would use tsvector/tsquery
      const searchTerm = `%${query.toLowerCase()}%`

      const results = await db
        .select({
          doc: {
            id: docs.id,
            path: docs.path,
            title: docs.title,
            updatedAt: docs.updatedAt,
            metadata: docs.metadata,
          },
          plainContent: docSearch.plainContent,
        })
        .from(docs)
        .innerJoin(docSearch, eq(docs.id, docSearch.docId))
        .where(
          sql`LOWER(${docSearch.plainContent}) LIKE ${searchTerm} OR LOWER(${docs.title}) LIKE ${searchTerm}`
        )
        .orderBy(desc(docs.updatedAt))
        .limit(limit)

      // Calculate simple relevance score and extract highlights
      const searchResults = results.map((result, index) => {
        const content = result.plainContent.toLowerCase()
        const queryLower = query.toLowerCase()
        const titleMatch = result.doc.title.toLowerCase().includes(queryLower)

        // Simple score: title matches are worth more
        const score = titleMatch ? 1.0 - index * 0.05 : 0.8 - index * 0.05

        // Extract highlight snippet
        const contentIdx = content.indexOf(queryLower)
        let snippet = ''
        if (contentIdx !== -1) {
          const start = Math.max(0, contentIdx - 50)
          const end = Math.min(result.plainContent.length, contentIdx + query.length + 50)
          snippet = (start > 0 ? '...' : '') + result.plainContent.slice(start, end) + (end < result.plainContent.length ? '...' : '')
        }

        return {
          doc: {
            id: result.doc.id,
            path: result.doc.path,
            title: result.doc.title,
            updatedAt: result.doc.updatedAt,
            tags: (result.doc.metadata as DocMetadata).tags || [],
          },
          score: Math.max(0.1, score),
          highlights: snippet
            ? [
                {
                  field: 'content',
                  snippet,
                },
              ]
            : [],
        }
      })

      return {
        results: searchResults,
        totalCount: searchResults.length,
        facets: null,
      }
    },

    async undocumentedModules() {
      const db = getDb()

      // Get all watched files
      const files = await db.select().from(watchedFiles).limit(100)

      // Filter those without documentation
      const undocumented = files
        .filter((f) => !f.relatedDocs || (f.relatedDocs as string[]).length === 0)
        .map((f) => ({
          filePath: f.filePath,
          name: f.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || f.filePath,
          exports: [], // Would need AST parsing to populate
          lastModified: f.lastModified,
          hasDocumentation: false,
        }))

      return undocumented
    },

    async docCoverage() {
      const db = getDb()

      // Get counts
      const allFiles = await db.select().from(watchedFiles)
      const allDocs = await db
        .select({
          id: docs.id,
          path: docs.path,
          title: docs.title,
          updatedAt: docs.updatedAt,
          metadata: docs.metadata,
        })
        .from(docs)
        .orderBy(desc(docs.updatedAt))

      const documentedFiles = allFiles.filter(
        (f) => f.relatedDocs && (f.relatedDocs as string[]).length > 0
      )

      const totalModules = allFiles.length
      const documentedModules = documentedFiles.length
      const coveragePercent = totalModules > 0 ? (documentedModules / totalModules) * 100 : 100

      const undocumentedFiles = allFiles
        .filter((f) => !f.relatedDocs || (f.relatedDocs as string[]).length === 0)
        .map((f) => f.filePath)

      // Find stale docs (not updated in 30 days)
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const docSummaries = allDocs.map((doc) => ({
        id: doc.id,
        path: doc.path,
        title: doc.title,
        updatedAt: doc.updatedAt,
        tags: (doc.metadata as DocMetadata).tags || [],
      }))

      const staleDocs = docSummaries.filter(
        (doc) => new Date(doc.updatedAt) < thirtyDaysAgo
      )

      return {
        totalModules,
        documentedModules,
        coveragePercent,
        undocumentedFiles,
        recentlyUpdated: docSummaries.slice(0, 5),
        staleDocuments: staleDocs.slice(0, 10),
      }
    },
  },
}
