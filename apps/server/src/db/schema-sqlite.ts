import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import type { Block, DocMetadata } from '@catryna/shared'

// Documents table - stores the current state of each doc
export const docs = sqliteTable('docs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  path: text('path').notNull().unique(),
  title: text('title').notNull(),
  blocks: text('blocks', { mode: 'json' }).notNull().$type<Block[]>(),
  metadata: text('metadata', { mode: 'json' }).notNull().$type<DocMetadata>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// Document versions - stores historical versions
export const docVersions = sqliteTable('doc_versions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  docId: text('doc_id').notNull().references(() => docs.id, { onDelete: 'cascade' }),
  content: text('content', { mode: 'json' }).notNull().$type<Block[]>(),
  contentHash: text('content_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  createdBy: text('created_by'),
  commitSha: text('commit_sha'),
  parentVersionId: text('parent_version_id'),
  summary: text('summary'),
})

// Full-text search index
export const docSearch = sqliteTable('doc_search', {
  docId: text('doc_id').primaryKey().references(() => docs.id, { onDelete: 'cascade' }),
  searchVector: text('search_vector').notNull(),
  plainContent: text('plain_content').notNull(),
})

// Code files being watched for regeneration
export const watchedFiles = sqliteTable('watched_files', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  filePath: text('file_path').notNull().unique(),
  lastModified: integer('last_modified', { mode: 'timestamp' }).notNull(),
  contentHash: text('content_hash').notNull(),
  relatedDocs: text('related_docs', { mode: 'json' }).$type<string[]>().default([]),
})

// Regeneration queue
export const regenerationQueue = sqliteTable('regeneration_queue', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  filePath: text('file_path').notNull(),
  status: text('status').notNull().$type<'pending' | 'processing' | 'completed' | 'failed'>().default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  processedAt: integer('processed_at', { mode: 'timestamp' }),
  error: text('error'),
})

// Relations
export const docsRelations = relations(docs, ({ many }) => ({
  versions: many(docVersions),
}))

export const docVersionsRelations = relations(docVersions, ({ one }) => ({
  doc: one(docs, {
    fields: [docVersions.docId],
    references: [docs.id],
  }),
  parent: one(docVersions, {
    fields: [docVersions.parentVersionId],
    references: [docVersions.id],
  }),
}))

// Export all tables
export const schema = {
  docs,
  docVersions,
  docSearch,
  watchedFiles,
  regenerationQueue,
}
