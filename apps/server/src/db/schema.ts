import { pgTable, uuid, text, jsonb, timestamp, index, integer, boolean } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import type { Block, DocMetadata } from '@catryna/shared'

// Documents table - stores the current state of each doc
export const docs = pgTable('docs', {
  id: uuid('id').primaryKey().defaultRandom(),
  path: text('path').notNull().unique(),
  title: text('title').notNull(),
  blocks: jsonb('blocks').notNull().$type<Block[]>(),
  metadata: jsonb('metadata').notNull().$type<DocMetadata>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  pathIdx: index('docs_path_idx').on(table.path),
  updatedIdx: index('docs_updated_idx').on(table.updatedAt),
}))

// Document versions - stores historical versions
export const docVersions = pgTable('doc_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  docId: uuid('doc_id').notNull().references(() => docs.id, { onDelete: 'cascade' }),
  content: jsonb('content').notNull().$type<Block[]>(),
  contentHash: text('content_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by'), // 'claude-code' | 'user:xxx'
  commitSha: text('commit_sha'),
  parentVersionId: uuid('parent_version_id'),
  summary: text('summary'),
}, (table) => ({
  docIdIdx: index('versions_doc_id_idx').on(table.docId),
  createdAtIdx: index('versions_created_at_idx').on(table.createdAt),
}))

// Full-text search index
export const docSearch = pgTable('doc_search', {
  docId: uuid('doc_id').primaryKey().references(() => docs.id, { onDelete: 'cascade' }),
  searchVector: text('search_vector').notNull(), // tsvector stored as text
  plainContent: text('plain_content').notNull(), // for highlighting
})

// User preferences (server mode)
export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id').primaryKey(),
  theme: text('theme').default('system').$type<'light' | 'dark' | 'system'>(),
  whiteboardStyle: text('whiteboard_style').default('clean').$type<'clean' | 'sketchy'>(),
  fontSize: integer('font_size').default(14),
  showLineNumbers: boolean('show_line_numbers').default(true),
  autoExpandCodeEmbeds: boolean('auto_expand_code_embeds').default(false),
  defaultDiffView: text('default_diff_view').default('side-by-side').$type<'side-by-side' | 'inline'>(),
})

// Code files being watched for regeneration
export const watchedFiles = pgTable('watched_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  filePath: text('file_path').notNull().unique(),
  lastModified: timestamp('last_modified').notNull(),
  contentHash: text('content_hash').notNull(),
  relatedDocs: jsonb('related_docs').$type<string[]>().default([]),
}, (table) => ({
  filePathIdx: index('watched_files_path_idx').on(table.filePath),
}))

// Regeneration queue
export const regenerationQueue = pgTable('regeneration_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  filePath: text('file_path').notNull(),
  status: text('status').notNull().$type<'pending' | 'processing' | 'completed' | 'failed'>().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
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

// Export all tables for drizzle-kit
export const schema = {
  docs,
  docVersions,
  docSearch,
  userPreferences,
  watchedFiles,
  regenerationQueue,
}
