import { eq, sql, desc } from 'drizzle-orm'
import { getDb, docs, docSearch } from '../../db'
import type { DocMetadata } from '@catryna/shared'

interface SearchDocsArgs {
  query: string
  limit?: number
}

export async function searchDocsHandler(args: unknown): Promise<{
  success: boolean
  results?: Array<{
    path: string
    title: string
    score: number
    excerpt: string
  }>
  error?: string
}> {
  const input = args as SearchDocsArgs

  if (!input.query) {
    return { success: false, error: 'Missing required field: query' }
  }

  try {
    const db = getDb()
    const limit = input.limit || 10
    const searchTerm = `%${input.query.toLowerCase()}%`

    const results = await db
      .select({
        id: docs.id,
        path: docs.path,
        title: docs.title,
        updatedAt: docs.updatedAt,
        metadata: docs.metadata,
        plainContent: docSearch.plainContent,
      })
      .from(docs)
      .innerJoin(docSearch, eq(docs.id, docSearch.docId))
      .where(
        sql`LOWER(${docSearch.plainContent}) LIKE ${searchTerm} OR LOWER(${docs.title}) LIKE ${searchTerm}`
      )
      .orderBy(desc(docs.updatedAt))
      .limit(limit)

    const searchResults = results.map((result, index) => {
      const content = result.plainContent.toLowerCase()
      const queryLower = input.query.toLowerCase()
      const titleMatch = result.title.toLowerCase().includes(queryLower)

      // Simple relevance score
      const score = titleMatch ? 1.0 - index * 0.05 : 0.8 - index * 0.05

      // Extract excerpt
      const contentIdx = content.indexOf(queryLower)
      let excerpt = ''
      if (contentIdx !== -1) {
        const start = Math.max(0, contentIdx - 40)
        const end = Math.min(result.plainContent.length, contentIdx + input.query.length + 40)
        excerpt =
          (start > 0 ? '...' : '') +
          result.plainContent.slice(start, end) +
          (end < result.plainContent.length ? '...' : '')
      } else {
        excerpt = result.plainContent.slice(0, 100) + '...'
      }

      return {
        path: result.path,
        title: result.title,
        score: Math.max(0.1, score),
        excerpt,
      }
    })

    return { success: true, results: searchResults }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
