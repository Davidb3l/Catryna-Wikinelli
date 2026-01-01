import { drizzle as drizzleSqlite } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import * as sqliteSchema from './schema-sqlite'

export type DbClient = ReturnType<typeof createDb>

function isLocalMode() {
  return process.env.CATRYNA_MODE === 'local' || !process.env.DATABASE_URL
}

export function createDb() {
  if (isLocalMode()) {
    const sqlite = new Database('./catryna.db')
    // Enable WAL mode for better concurrency
    sqlite.exec('PRAGMA journal_mode = WAL;')
    // Create tables if they don't exist
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        blocks TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS doc_versions (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        created_by TEXT,
        commit_sha TEXT,
        parent_version_id TEXT,
        summary TEXT
      );
      CREATE TABLE IF NOT EXISTS doc_search (
        doc_id TEXT PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
        search_vector TEXT NOT NULL,
        plain_content TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS watched_files (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL UNIQUE,
        last_modified INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        related_docs TEXT DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS regeneration_queue (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        processed_at INTEGER,
        error TEXT
      );
    `)
    return drizzleSqlite(sqlite, { schema: sqliteSchema })
  }

  // Lazy load postgres dependencies only when needed
  const { drizzle: drizzlePg } = require('drizzle-orm/postgres-js')
  const postgres = require('postgres')
  const pgSchema = require('./schema')

  const connectionString = process.env.DATABASE_URL!
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  })

  return drizzlePg(client, { schema: pgSchema })
}

// Singleton instance
let dbInstance: DbClient | null = null

export function getDb(): DbClient {
  if (!dbInstance) {
    dbInstance = createDb()
  }
  return dbInstance
}

// Export SQLite schema by default (used in local/MCP mode)
// For server mode with Postgres, import from './schema' directly
export const { docs, docVersions, docSearch, watchedFiles, regenerationQueue } = sqliteSchema
export { sqliteSchema }
