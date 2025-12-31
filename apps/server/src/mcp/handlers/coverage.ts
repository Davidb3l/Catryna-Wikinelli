import { desc } from 'drizzle-orm'
import { getDb, docs, watchedFiles } from '../../db'
import type { DocMetadata } from '@catryna/shared'

export const coverageHandlers = {
  async getUndocumented(): Promise<{
    success: boolean
    modules?: Array<{
      filePath: string
      name: string
      lastModified: string
    }>
    error?: string
  }> {
    try {
      const db = getDb()

      const files = await db.select().from(watchedFiles).limit(100)

      const undocumented = files
        .filter((f) => !f.relatedDocs || (f.relatedDocs as string[]).length === 0)
        .map((f) => ({
          filePath: f.filePath,
          name: f.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || f.filePath,
          lastModified: f.lastModified.toISOString(),
        }))

      return { success: true, modules: undocumented }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  },

  async getCoverage(): Promise<{
    success: boolean
    report?: {
      totalModules: number
      documentedModules: number
      coveragePercent: number
      undocumentedFiles: string[]
      recentlyUpdated: Array<{ path: string; title: string; updatedAt: string }>
      staleDocuments: Array<{ path: string; title: string; updatedAt: string }>
    }
    error?: string
  }> {
    try {
      const db = getDb()

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
        path: doc.path,
        title: doc.title,
        updatedAt: doc.updatedAt.toISOString(),
      }))

      const staleDocs = allDocs
        .filter((doc) => new Date(doc.updatedAt) < thirtyDaysAgo)
        .map((doc) => ({
          path: doc.path,
          title: doc.title,
          updatedAt: doc.updatedAt.toISOString(),
        }))

      return {
        success: true,
        report: {
          totalModules,
          documentedModules,
          coveragePercent: Math.round(coveragePercent * 100) / 100,
          undocumentedFiles,
          recentlyUpdated: docSummaries.slice(0, 5),
          staleDocuments: staleDocs.slice(0, 10),
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  },
}
