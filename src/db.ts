import { Database } from "bun:sqlite";

let db: Database;

export function initDb(): void {
  db = new Database("./catryna.db");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      blocks TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS doc_versions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      summary TEXT,
      FOREIGN KEY (doc_id) REFERENCES docs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS doc_search (
      doc_id TEXT PRIMARY KEY,
      search_vector TEXT NOT NULL,
      plain_content TEXT NOT NULL,
      FOREIGN KEY (doc_id) REFERENCES docs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS watched_files (
      id TEXT PRIMARY KEY,
      file_path TEXT UNIQUE NOT NULL,
      last_modified INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      related_docs TEXT DEFAULT '[]'
    );
  `);
}

export function getDb(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

// Helper to generate content hash
export function hashContent(content: string): string {
  return Bun.hash(content).toString(16);
}
