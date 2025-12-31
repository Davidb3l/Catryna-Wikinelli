import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import { drizzle as drizzleSqlite } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import postgres from 'postgres'
import * as schema from './schema'

export type DbClient = ReturnType<typeof createDb>

export function createDb() {
  const isLocal = process.env.CATRYNA_MODE === 'local'

  if (isLocal) {
    const sqlite = new Database('./catryna.db')
    // Enable WAL mode for better concurrency
    sqlite.exec('PRAGMA journal_mode = WAL;')
    return drizzleSqlite(sqlite, { schema })
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required in server mode')
  }

  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  })

  return drizzlePg(client, { schema })
}

// Singleton instance
let dbInstance: DbClient | null = null

export function getDb(): DbClient {
  if (!dbInstance) {
    dbInstance = createDb()
  }
  return dbInstance
}

export { schema }
export * from './schema'
