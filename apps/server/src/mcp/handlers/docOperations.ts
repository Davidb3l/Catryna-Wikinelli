import { getDb, docs } from '../../db'
import { eq, like, and } from 'drizzle-orm'

interface GetDocArgs {
  path: string
}

interface ListDocsArgs {
  tag?: string
  path?: string
}

interface DeleteDocArgs {
  path: string
}

export async function getDocHandler(args: unknown): Promise<{
  success: boolean
  doc?: {
    id: string
    path: string
    title: string
    blocks: unknown[]
    metadata: unknown
    createdAt: Date
    updatedAt: Date
  }
  error?: string
}> {
  const input = args as GetDocArgs

  if (!input.path) {
    return { success: false, error: 'Missing required field: path' }
  }

  try {
    const db = getDb()

    const doc = await db.query.docs.findFirst({
      where: (table, { eq }) => eq(table.path, input.path),
    })

    if (!doc) {
      return { success: false, error: `Doc not found at path: ${input.path}` }
    }

    return {
      success: true,
      doc: {
        id: doc.id,
        path: doc.path,
        title: doc.title,
        blocks: doc.blocks,
        metadata: doc.metadata,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function listDocsHandler(args: unknown): Promise<{
  success: boolean
  docs?: Array<{
    id: string
    path: string
    title: string
    tags: string[]
    updatedAt: Date
  }>
  error?: string
}> {
  const input = (args as ListDocsArgs) || {}

  try {
    const db = getDb()

    // Build query conditions
    const conditions = []

    if (input.path) {
      conditions.push(like(docs.path, `${input.path}%`))
    }

    const results = await db.query.docs.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: (table, { desc }) => [desc(table.updatedAt)],
    })

    // Filter by tag if specified (done in memory since tags are in JSONB)
    let filteredDocs = results
    if (input.tag) {
      filteredDocs = results.filter((doc) => {
        const metadata = doc.metadata as { tags?: string[] }
        return metadata.tags?.includes(input.tag!)
      })
    }

    return {
      success: true,
      docs: filteredDocs.map((doc) => ({
        id: doc.id,
        path: doc.path,
        title: doc.title,
        tags: (doc.metadata as { tags?: string[] }).tags || [],
        updatedAt: doc.updatedAt,
      })),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function deleteDocHandler(args: unknown): Promise<{
  success: boolean
  error?: string
}> {
  const input = args as DeleteDocArgs

  if (!input.path) {
    return { success: false, error: 'Missing required field: path' }
  }

  try {
    const db = getDb()

    // Check if doc exists
    const existing = await db.query.docs.findFirst({
      where: (table, { eq }) => eq(table.path, input.path),
    })

    if (!existing) {
      return { success: false, error: `Doc not found at path: ${input.path}` }
    }

    // Delete cascades to versions and search index due to foreign key constraints
    await db.delete(docs).where(eq(docs.path, input.path))

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
