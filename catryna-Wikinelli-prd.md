# Catryna Wikinelli — Product Requirements Document

**Version:** 1.0  
**Date:** December 31, 2025  
**Status:** Draft  

---

## Executive Summary

Catryna Wikinelli is an open-source, local-first documentation platform that automatically generates and maintains living documentation for codebases. AI coding agents (starting with Claude Code) create interactive docs with diagrams, whiteboards, and code embeds that stay synchronized with your code through automatic regeneration.

Think Google Code Wiki, but fully open-source, self-hostable, and private by default.

---

## Problem Statement

Documentation is broken:

1. **Decay** — Docs become stale within days of code changes
2. **Context loss** — New developers and AI agents lack understanding of system architecture and decisions
3. **Fragmentation** — Knowledge lives in Notion, Confluence, README files, and developers' heads
4. **Migration pain** — Moving between frameworks or refactoring without reference docs is error-prone

Existing solutions either require manual maintenance (Notion, Confluence) or send your code to external servers (Google Code Wiki, DeepWiki).

---

## Solution

Catryna Wikinelli provides:

- **Automatic documentation generation** via AI agents with MCP tool integration
- **Living docs** that regenerate when code changes (file watcher + git hooks)
- **Interactive visualizations** — React Flow diagrams, tldraw whiteboards, Mermaid charts
- **Full-text search** across all documentation
- **Version history** with diff viewing
- **Code linking** — inline embeds + external links to source files
- **Local-first** — your code never leaves your machine unless you choose to deploy

---

## Target Users

### Primary (v1)
- Solo developers using Claude Code who want persistent project context
- Developers onboarding onto unfamiliar codebases
- Teams doing migrations or major refactors

### Secondary (v2)
- Development teams wanting shared, self-hosted documentation
- Open-source maintainers providing contributor documentation

---

## Core Features

### Phase 1 (MVP)

#### 1. Documentation Viewer

| Feature | Description |
|---------|-------------|
| Rich text rendering | Markdown/MDX with headings, lists, code blocks, tables |
| Interactive diagrams | React Flow for architecture, dependency graphs, data flows |
| Whiteboard canvas | tldraw with optional Excalidraw-style sketchy aesthetic (per-user toggle) |
| Mermaid support | Sequence diagrams, flowcharts, ER diagrams, state machines |
| Code embeds | Inline syntax-highlighted snippets with line numbers |
| External code links | Click to open in GitHub/GitLab/local editor |
| Collapsible sections | Expandable detail blocks for complex explanations |

#### 2. MCP Tool Integration

Claude Code (and future agents) interact via Model Context Protocol tools:

```typescript
// Tool definitions
interface MCPTools {
  // Document operations
  create_doc(path: string, content: DocContent): Promise<DocResult>
  update_doc(path: string, changes: DocChanges): Promise<DocResult>
  delete_doc(path: string): Promise<void>
  
  // Query operations
  get_doc(path: string): Promise<DocContent>
  list_docs(filter?: DocFilter): Promise<DocSummary[]>
  search_docs(query: string): Promise<SearchResult[]>
  
  // Diagram operations
  create_diagram(path: string, type: DiagramType, data: DiagramData): Promise<void>
  update_diagram(path: string, data: DiagramData): Promise<void>
  
  // Whiteboard operations
  create_whiteboard(path: string, snapshot: TldrawSnapshot): Promise<void>
  update_whiteboard(path: string, snapshot: TldrawSnapshot): Promise<void>
  
  // Introspection
  get_undocumented_modules(): Promise<ModuleInfo[]>
  get_doc_coverage(): Promise<CoverageReport>
}
```

**Benefits over file watching alone:**
- Agent can query existing docs before writing (avoids duplicates)
- Schema validation before accepting writes
- Bidirectional — agent asks "what needs documentation?"
- Confirmation of successful operations

#### 3. Automatic Regeneration

**Local Mode (file watcher):**
```
Code file changes → Debounced watcher → 
  Identify affected modules → Queue regeneration →
  Trigger Claude Code via MCP → Update docs
```

**Deployed Mode (git hooks):**
```
Git push → post-receive hook →
  Diff analysis → Identify changed modules →
  Trigger documentation agent → Update docs →
  Commit doc changes (optional)
```

**Configuration:**
```yaml
# catryna.config.yaml
watch:
  include:
    - "src/**/*.{ts,tsx,js,jsx}"
    - "lib/**/*.py"
  exclude:
    - "**/*.test.ts"
    - "**/*.spec.ts"
    - "**/node_modules/**"
  debounce_ms: 2000

regeneration:
  trigger: auto  # auto | manual | hook-only
  scope: affected  # affected | full
  agent: claude-code
```

#### 4. Full-Text Search

- Postgres `tsvector`/`tsquery` for search indexing
- Search across all doc content, code snippets, diagram labels
- Fuzzy matching and typo tolerance
- Filter by doc type, date range, module

**GraphQL Query:**
```graphql
query SearchDocs($query: String!, $filters: SearchFilters) {
  search(query: $query, filters: $filters) {
    results {
      doc {
        path
        title
        excerpt(around: $query, chars: 150)
      }
      score
      highlights {
        field
        snippet
      }
    }
    totalCount
    facets {
      docType
      module
    }
  }
}
```

#### 5. Version History

- Git-backed versioning (docs stored in repo)
- Or Postgres-backed for non-git deployments
- Default view: latest state
- History menu: browse previous versions
- Diff view: side-by-side or inline comparison

**Data Model:**
```typescript
// apps/server/src/db/schema.ts
import { pgTable, sqliteTable, uuid, text, jsonb, timestamp, index, integer } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// Use pgTable for server mode, sqliteTable for local mode
// This example shows Postgres schema

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

export const docVersions = pgTable('doc_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  docId: uuid('doc_id').notNull().references(() => docs.id, { onDelete: 'cascade' }),
  content: jsonb('content').notNull().$type<Block[]>(),
  contentHash: text('content_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by'),  // 'claude-code' | 'user:xxx'
  commitSha: text('commit_sha'),
  parentVersionId: uuid('parent_version_id'),
}, (table) => ({
  docIdIdx: index('versions_doc_id_idx').on(table.docId),
  createdAtIdx: index('versions_created_at_idx').on(table.createdAt),
}))

export const docSearch = pgTable('doc_search', {
  docId: uuid('doc_id').primaryKey().references(() => docs.id, { onDelete: 'cascade' }),
  searchVector: text('search_vector').notNull(),  // tsvector as text
  plainContent: text('plain_content').notNull(),   // for highlighting
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

// User preferences (server mode with auth)
export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id').primaryKey(),
  theme: text('theme').default('system').$type<'light' | 'dark' | 'system'>(),
  whiteboardStyle: text('whiteboard_style').default('clean').$type<'clean' | 'sketchy'>(),
  fontSize: integer('font_size').default(14),
  showLineNumbers: integer('show_line_numbers').default(1),  // boolean as int for SQLite compat
  autoExpandCodeEmbeds: integer('auto_expand_code_embeds').default(0),
  defaultDiffView: text('default_diff_view').default('side-by-side').$type<'side-by-side' | 'inline'>(),
})
```

#### 6. Code Linking (Inline + External)

**Inline Embed:**
```tsx
<CodeEmbed 
  file="src/auth/authenticate.ts"
  lines={[42, 58]}
  language="typescript"
  collapsible={true}
  showLineNumbers={true}
/>
```

**Rendering:**
- Fetch code from local filesystem
- Syntax highlight with Shiki or Prism
- Show file path + line range header
- "View in GitHub" / "Open in Editor" links
- Collapsible by default if > 15 lines

**External Link Resolution:**
```typescript
interface CodeLinkResolver {
  // Resolve local path to external URL
  toExternalUrl(filePath: string, lines?: [number, number]): string
  
  // Resolve to local editor (VS Code, Cursor, etc.)
  toEditorUrl(filePath: string, lines?: [number, number]): string
}

// Config
codeLinks:
  external:
    provider: github  # github | gitlab | bitbucket
    repo: "owner/repo"
    branch: main
  editor:
    scheme: vscode  # vscode | cursor | idea
```

#### 7. User Preferences

Per-user settings stored in localStorage (local mode) or Postgres (deployed):

```typescript
interface UserPreferences {
  // Appearance
  theme: 'light' | 'dark' | 'system'
  whiteboardStyle: 'clean' | 'sketchy'  // tldraw default vs Excalidraw aesthetic
  
  // Editor
  fontSize: number
  showLineNumbers: boolean
  
  // Behavior
  autoExpandCodeEmbeds: boolean
  defaultDiffView: 'side-by-side' | 'inline'
}
```

**Sketchy Mode Implementation:**
- Toggle applies Rough.js rendering to tldraw shapes
- Virgil font for whiteboard text
- Stored per-user, not per-document

---

### Phase 2 (Post-MVP)

#### 1. Team Mode & Authentication

- OAuth with GitHub and Google
- User roles: viewer, editor, admin
- Per-doc permissions (future)

```typescript
interface AuthConfig {
  providers: {
    github?: { clientId: string; clientSecret: string }
    google?: { clientId: string; clientSecret: string }
  }
  defaultRole: 'viewer' | 'editor'
}
```

#### 2. Multi-Repo Support

- Aggregate docs from multiple repositories
- Cross-repo linking ("see also: auth-service docs")
- Unified search across all repos
- Repo switcher in navigation

**Data Model Extension:**
```sql
CREATE TABLE repositories (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,  -- local path or git URL
  default_branch TEXT DEFAULT 'main',
  last_synced_at TIMESTAMPTZ
);

ALTER TABLE doc_versions ADD COLUMN repo_id UUID REFERENCES repositories(id);
```

#### 3. Self-Hosted Deployment

- Docker Compose for easy deployment
- Kubernetes Helm chart for scale
- CI/CD integration (GitHub Actions, GitLab CI)
- Webhook endpoints for git push events

```yaml
# docker-compose.yml
services:
  catryna:
    image: catryna-wikinelli:latest
    environment:
      - CATRYNA_MODE=server
      - DATABASE_URL=postgres://...
      - DRAGONFLY_URL=redis://...
    ports:
      - "3000:3000"
  
  postgres:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data
  
  dragonfly:
    image: docker.dragonflydb.io/dragonflydb/dragonfly
```

#### 4. AI Chat (RAG)

- Gemini-style chat that understands your codebase
- RAG over all documentation
- Answer questions with citations to specific docs/code
- Powered by local embeddings or API

#### 5. NotebookLM-style Audio

- Generate audio summaries of documentation
- Podcast-style explanations for onboarding
- Powered by TTS APIs

---

## Technical Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Developer Machine / Server                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │  Claude Code    │───▶│   MCP Server    │◀──▶│   Bun Backend   │         │
│  │  (AI Agent)     │    │   (Tool Host)   │    │   (GraphQL)     │         │
│  └─────────────────┘    └─────────────────┘    └────────┬────────┘         │
│                                                          │                  │
│  ┌─────────────────┐                           ┌────────▼────────┐         │
│  │  Code Files     │◀─────────────────────────▶│   File Watcher  │         │
│  │  (src/, lib/)   │                           │   (Bun/Chokidar)│         │
│  └─────────────────┘                           └────────┬────────┘         │
│                                                          │                  │
│  ┌─────────────────┐    ┌─────────────────┐    ┌────────▼────────┐         │
│  │  Doc Files      │◀──▶│   Postgres      │◀──▶│   DragonflyDB   │         │
│  │  (.docs/)       │    │   (Storage)     │    │   (Cache)       │         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │  Vite + React Frontend                                          │       │
│  │  ├── TanStack Router (file-based routing)                       │       │
│  │  ├── TanStack Query (GraphQL + caching)                         │       │
│  │  ├── TanStack Table (data tables)                               │       │
│  │  ├── React Flow (diagrams)                                      │       │
│  │  ├── tldraw (whiteboards)                                       │       │
│  │  ├── TipTap (rich text editing)                                 │       │
│  │  └── Mermaid (sequence/flow diagrams)                           │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Runtime | Bun | Fast JS runtime, native file watching, built-in SQLite |
| ORM | Drizzle | Type-safe SQL, Bun-native, works with Postgres + SQLite |
| Frontend | Vite + React | Fast HMR, modern build tooling |
| Routing | TanStack Router | Type-safe, file-based routing |
| Data Fetching | TanStack Query | Caching, invalidation, optimistic updates |
| Tables | TanStack Table | Schema docs, API reference tables |
| API | GraphQL (Yoga) | Flexible queries, subscriptions for live updates |
| Database | Postgres / SQLite | Postgres for server mode, SQLite for local mode |
| Cache | DragonflyDB | Render cache, pub/sub for live reload (server mode) |
| Diagrams | React Flow | Node-based architecture diagrams |
| Whiteboard | tldraw + Rough.js | Canvas with optional sketchy style |
| Rich Text | TipTap | ProseMirror-based editing |
| Charts | Mermaid | Code-defined diagrams |
| Code Highlight | Shiki | Accurate syntax highlighting |

### Data Models

#### Document Schema

```typescript
interface Doc {
  id: string
  path: string                    // e.g., "architecture/auth-flow"
  title: string
  content: Block[]
  metadata: {
    createdAt: Date
    updatedAt: Date
    createdBy: string             // "claude-code" | "user:xxx"
    tags: string[]
    relatedFiles: string[]        // source files this doc covers
  }
}

interface Block {
  id: string
  type: BlockType
  data: BlockData
}

type BlockType = 
  | 'text'           // Rich text paragraph
  | 'heading'        // H1-H6
  | 'code'           // Inline code block
  | 'code-embed'     // Embedded from source file
  | 'mermaid'        // Mermaid diagram
  | 'react-flow'     // React Flow diagram
  | 'whiteboard'     // tldraw canvas
  | 'table'          // Data table
  | 'callout'        // Info/warning/error boxes
  | 'divider'        // Horizontal rule

// Block data varies by type
interface CodeEmbedData {
  filePath: string
  startLine: number
  endLine: number
  language: string
  caption?: string
}

interface ReactFlowData {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
}

interface WhiteboardData {
  snapshot: TldrawSnapshot        // Full tldraw state
}
```

#### GraphQL Schema

```graphql
type Doc {
  id: ID!
  path: String!
  title: String!
  blocks: [Block!]!
  metadata: DocMetadata!
  versions: [DocVersion!]!
  currentVersion: DocVersion!
}

type Block {
  id: ID!
  type: BlockType!
  data: JSON!
}

enum BlockType {
  TEXT
  HEADING
  CODE
  CODE_EMBED
  MERMAID
  REACT_FLOW
  WHITEBOARD
  TABLE
  CALLOUT
  DIVIDER
}

type DocMetadata {
  createdAt: DateTime!
  updatedAt: DateTime!
  createdBy: String!
  tags: [String!]!
  relatedFiles: [String!]!
}

type DocVersion {
  id: ID!
  createdAt: DateTime!
  createdBy: String!
  commitSha: String
}

type SearchResult {
  doc: Doc!
  score: Float!
  highlights: [Highlight!]!
}

type Highlight {
  field: String!
  snippet: String!
}

type Query {
  doc(path: String!): Doc
  docs(filter: DocFilter): [Doc!]!
  search(query: String!, filters: SearchFilters): SearchResults!
  undocumentedModules: [ModuleInfo!]!
  docCoverage: CoverageReport!
}

type Mutation {
  createDoc(input: CreateDocInput!): Doc!
  updateDoc(path: String!, input: UpdateDocInput!): Doc!
  deleteDoc(path: String!): Boolean!
}

type Subscription {
  docChanged(path: String): Doc!
  regenerationStatus: RegenerationEvent!
}
```

### File Structure

```
catryna-wikinelli/
├── apps/
│   ├── web/                      # Vite + React frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── blocks/       # Block renderers
│   │   │   │   │   ├── TextBlock.tsx
│   │   │   │   │   ├── CodeEmbed.tsx
│   │   │   │   │   ├── MermaidBlock.tsx
│   │   │   │   │   ├── ReactFlowBlock.tsx
│   │   │   │   │   └── WhiteboardBlock.tsx
│   │   │   │   ├── editor/       # TipTap editor
│   │   │   │   ├── diagrams/     # React Flow components
│   │   │   │   ├── whiteboard/   # tldraw + Rough.js
│   │   │   │   └── ui/           # Shared UI components
│   │   │   ├── routes/           # TanStack Router
│   │   │   ├── lib/
│   │   │   │   ├── graphql/      # Generated types + hooks
│   │   │   │   └── storage/      # User preferences (localStorage)
│   │   │   └── styles/
│   │   │       └── sketchy/      # Excalidraw-style CSS + fonts
│   │   ├── index.html
│   │   └── vite.config.ts
│   │
│   └── server/                   # Bun backend
│       ├── src/
│       │   ├── graphql/
│       │   │   ├── schema.ts
│       │   │   ├── resolvers/
│       │   │   │   ├── docs.ts
│       │   │   │   ├── search.ts
│       │   │   │   └── versions.ts
│       │   │   └── subscriptions/
│       │   │       └── docChanged.ts
│       │   ├── mcp/              # MCP tool definitions
│       │   │   ├── server.ts
│       │   │   ├── tools.ts
│       │   │   └── handlers/
│       │   │       ├── createDoc.ts
│       │   │       ├── updateDoc.ts
│       │   │       ├── searchDocs.ts
│       │   │       └── diagrams.ts
│       │   ├── watcher/          # File watching
│       │   │   ├── codeWatcher.ts
│       │   │   └── docWatcher.ts
│       │   ├── regeneration/     # Doc regeneration logic
│       │   │   ├── queue.ts
│       │   │   ├── triggers.ts
│       │   │   └── agent.ts
│       │   ├── search/           # Full-text search
│       │   │   └── postgres.ts
│       │   └── db/
│       │       ├── index.ts      # Drizzle client setup
│       │       ├── schema.ts     # Drizzle schema definitions
│       │       ├── migrate.ts    # Migration runner
│       │       └── seed.ts       # Optional seed data
│       ├── drizzle/
│       │   └── migrations/       # Generated migrations
│       ├── drizzle.config.ts     # Drizzle Kit config
│       └── index.ts
│
├── packages/
│   ├── shared/                   # Shared types + utils
│   │   ├── types/
│   │   │   ├── doc.ts
│   │   │   ├── block.ts
│   │   │   └── diagram.ts
│   │   └── utils/
│   │       ├── hash.ts
│   │       └── paths.ts
│   └── mcp-client/               # MCP client for agents
│       ├── src/
│       │   ├── tools.ts
│       │   └── client.ts
│       └── package.json
│
├── docs/                         # Project documentation (dogfooding!)
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── catryna.config.yaml           # User configuration
├── package.json
├── bun.lockb
├── turbo.json                    # Turborepo config (monorepo)
└── README.md
```

### Drizzle Configuration

```typescript
// apps/server/drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: process.env.CATRYNA_MODE === 'local' ? 'sqlite' : 'postgresql',
  dbCredentials: process.env.CATRYNA_MODE === 'local'
    ? { url: './catryna.db' }
    : { url: process.env.DATABASE_URL! },
})
```

```typescript
// apps/server/src/db/index.ts
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import { drizzle as drizzleSqlite } from 'drizzle-orm/bun-sqlite'
import { Database } from 'bun:sqlite'
import postgres from 'postgres'
import * as schema from './schema'

export function createDb() {
  if (process.env.CATRYNA_MODE === 'local') {
    const sqlite = new Database('./catryna.db')
    return drizzleSqlite(sqlite, { schema })
  }
  
  const client = postgres(process.env.DATABASE_URL!)
  return drizzlePg(client, { schema })
}

export const db = createDb()
export type Db = typeof db
```

### Drizzle Query Examples

```typescript
// apps/server/src/graphql/resolvers/docs.ts
import { eq, desc, like, sql } from 'drizzle-orm'
import { db } from '../../db'
import { docs, docVersions, docSearch } from '../../db/schema'

// Get single doc with versions
export async function getDoc(path: string) {
  return db.query.docs.findFirst({
    where: eq(docs.path, path),
    with: {
      versions: {
        orderBy: desc(docVersions.createdAt),
        limit: 10,
      },
    },
  })
}

// List all docs
export async function listDocs(filter?: { tag?: string }) {
  return db
    .select()
    .from(docs)
    .where(filter?.tag 
      ? sql`${docs.metadata}->>'tags' ? ${filter.tag}`
      : undefined
    )
    .orderBy(desc(docs.updatedAt))
}

// Create doc with initial version
export async function createDoc(input: CreateDocInput) {
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(docs)
      .values({
        path: input.path,
        title: input.title,
        blocks: input.content,
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: input.createdBy,
          tags: input.tags ?? [],
          relatedFiles: input.relatedFiles ?? [],
        },
      })
      .returning()
    
    await tx.insert(docVersions).values({
      docId: doc.id,
      content: input.content,
      contentHash: hashContent(input.content),
      createdBy: input.createdBy,
    })
    
    // Update search index
    await tx.insert(docSearch).values({
      docId: doc.id,
      searchVector: sql`to_tsvector('english', ${extractPlainText(input.content)})`,
      plainContent: extractPlainText(input.content),
    })
    
    return doc
  })
}

// Full-text search
export async function searchDocs(query: string, limit = 10) {
  return db
    .select({
      doc: docs,
      rank: sql<number>`ts_rank(to_tsvector('english', ${docSearch.plainContent}), plainto_tsquery('english', ${query}))`,
      headline: sql<string>`ts_headline('english', ${docSearch.plainContent}, plainto_tsquery('english', ${query}))`,
    })
    .from(docs)
    .innerJoin(docSearch, eq(docs.id, docSearch.docId))
    .where(sql`to_tsvector('english', ${docSearch.plainContent}) @@ plainto_tsquery('english', ${query})`)
    .orderBy(sql`ts_rank(to_tsvector('english', ${docSearch.plainContent}), plainto_tsquery('english', ${query})) DESC`)
    .limit(limit)
}

// Get version history
export async function getVersionHistory(docPath: string) {
  const doc = await db.query.docs.findFirst({
    where: eq(docs.path, docPath),
  })
  
  if (!doc) return []
  
  return db
    .select()
    .from(docVersions)
    .where(eq(docVersions.docId, doc.id))
    .orderBy(desc(docVersions.createdAt))
}
```

---

## Configuration

### catryna.config.yaml

```yaml
# Project info
project:
  name: "My Project"
  repo: "github.com/owner/repo"

# Run mode
mode: local  # local | server

# Database (server mode)
database:
  postgres:
    url: ${DATABASE_URL}
  dragonfly:
    url: ${DRAGONFLY_URL}

# Database (local mode uses SQLite automatically)
# SQLite file: ./catryna.db

# File watching
watch:
  enabled: true
  include:
    - "src/**/*.{ts,tsx,js,jsx,py}"
    - "lib/**/*"
  exclude:
    - "**/*.test.*"
    - "**/*.spec.*"
    - "**/node_modules/**"
    - "**/__pycache__/**"
  debounce_ms: 2000

# Regeneration
regeneration:
  trigger: auto           # auto | manual | hook-only
  scope: affected         # affected | full
  agent: claude-code
  prompt_template: |
    Analyze the following code changes and update the relevant documentation.
    Focus on: architecture decisions, API changes, and data flow.

# Code linking
code_links:
  external:
    provider: github
    branch: main
  editor:
    scheme: vscode        # vscode | cursor | idea

# Git hooks (server mode)
hooks:
  post_receive:
    enabled: true
    regenerate: true
    commit_docs: false    # Auto-commit doc changes

# Auth (server mode, v2)
auth:
  enabled: false
  providers:
    github:
      client_id: ${GITHUB_CLIENT_ID}
      client_secret: ${GITHUB_CLIENT_SECRET}
    google:
      client_id: ${GOOGLE_CLIENT_ID}
      client_secret: ${GOOGLE_CLIENT_SECRET}
  default_role: viewer
```

---

## User Interface

### Navigation Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  🐱 Catryna Wikinelli          [Search...]           ⚙️  👤     │
├───────────────────┬─────────────────────────────────────────────┤
│                   │                                             │
│  📁 Docs          │  # Authentication Flow                      │
│  ├── Overview     │                                             │
│  ├── Architecture │  This document describes the auth system... │
│  │   ├── Auth ◀── │                                             │
│  │   ├── Database │  ┌─────────────────────────────────────┐    │
│  │   └── API      │  │  [React Flow Diagram]               │    │
│  ├── Modules      │  │                                     │    │
│  │   ├── Users    │  │   ┌──────┐     ┌──────┐            │    │
│  │   ├── Orders   │  │   │Client│────▶│ API  │            │    │
│  │   └── Payments │  │   └──────┘     └──┬───┘            │    │
│  └── API Reference│  │                   │                 │    │
│                   │  │              ┌────▼────┐            │    │
│  ─────────────    │  │              │   DB    │            │    │
│  📊 Diagrams      │  │              └─────────┘            │    │
│  🎨 Whiteboards   │  └─────────────────────────────────────┘    │
│                   │                                             │
│  ─────────────    │  ## Implementation                          │
│  ⏱️ History       │                                             │
│  📈 Coverage      │  ┌─ src/auth/authenticate.ts (42-58) ─────┐ │
│                   │  │ export async function authenticate(   │ │
│                   │  │   email: string,                       │ │
│                   │  │   password: string                     │ │
│                   │  │ ) { ... }                              │ │
│                   │  │                     [View in GitHub ↗] │ │
│                   │  └────────────────────────────────────────┘ │
│                   │                                             │
└───────────────────┴─────────────────────────────────────────────┘
```

### Key Screens

1. **Doc Viewer** — Read documentation with interactive blocks
2. **Doc Editor** — TipTap-based editing with block insertion
3. **Diagram Editor** — React Flow canvas with node/edge tools
4. **Whiteboard** — tldraw canvas with style toggle
5. **Search Results** — Full-text search with highlighting
6. **Version History** — Timeline view with diff comparison
7. **Coverage Report** — Which modules have docs, which don't
8. **Settings** — User preferences, project config

---

## MCP Integration Details

### Tool Registration

```typescript
// packages/mcp-client/src/tools.ts

export const catrynaTools = {
  name: "catryna-wikinelli",
  version: "1.0.0",
  tools: [
    {
      name: "create_doc",
      description: "Create a new documentation page",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Doc path, e.g. 'modules/auth'" },
          title: { type: "string" },
          content: { 
            type: "array",
            items: { $ref: "#/definitions/Block" }
          },
          relatedFiles: {
            type: "array",
            items: { type: "string" },
            description: "Source files this doc covers"
          }
        },
        required: ["path", "title", "content"]
      }
    },
    {
      name: "search_docs",
      description: "Search existing documentation",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", default: 10 }
        },
        required: ["query"]
      }
    },
    {
      name: "get_undocumented_modules",
      description: "List source modules without documentation",
      parameters: { type: "object", properties: {} }
    },
    {
      name: "create_diagram",
      description: "Create a React Flow diagram",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          title: { type: "string" },
          nodes: { type: "array" },
          edges: { type: "array" }
        },
        required: ["path", "nodes", "edges"]
      }
    },
    {
      name: "create_whiteboard",
      description: "Create a tldraw whiteboard",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          title: { type: "string" },
          snapshot: { type: "object", description: "tldraw snapshot" }
        },
        required: ["path", "snapshot"]
      }
    }
  ]
}
```

### Agent Prompt Template

```markdown
You are documenting a codebase using Catryna Wikinelli.

## Available Tools

- `search_docs(query)` — Find existing documentation
- `get_undocumented_modules()` — See what needs docs
- `create_doc(path, title, content, relatedFiles)` — Create new doc
- `update_doc(path, changes)` — Update existing doc
- `create_diagram(path, title, nodes, edges)` — Create architecture diagram
- `create_whiteboard(path, title, snapshot)` — Create whiteboard

## Documentation Guidelines

1. **Architecture docs**: Explain WHY decisions were made, not just WHAT
2. **Module docs**: Cover public API, data flow, dependencies
3. **Diagrams**: Use for anything with 3+ components interacting
4. **Code embeds**: Reference specific implementations, keep snippets < 20 lines

## Before Creating New Docs

1. Search existing docs to avoid duplicates
2. Check related files to understand scope
3. Link to related documentation

## Block Types

- `text` — Prose explanation
- `heading` — Section headers (h1-h6)
- `code-embed` — Reference source file: { filePath, startLine, endLine }
- `mermaid` — Diagrams: sequenceDiagram, flowchart, erDiagram
- `react-flow` — Node graphs: { nodes: [...], edges: [...] }
- `callout` — Important notes: { type: 'info' | 'warning' | 'error', content }
```

---

## Milestones

### MVP (v1.0) — 8 weeks

| Week | Deliverables |
|------|--------------|
| 1-2 | Project setup, Bun server, Drizzle schema + migrations, GraphQL Yoga |
| 3-4 | Frontend scaffold, TanStack Router, doc viewer with text/code blocks |
| 5 | React Flow integration, Mermaid rendering |
| 6 | tldraw integration with sketchy style toggle, TipTap editor |
| 7 | MCP tool server, Claude Code integration, file watcher |
| 8 | Full-text search, version history, polish & testing |

### v1.5 — 4 weeks

| Week | Deliverables |
|------|--------------|
| 1 | Git hook integration, CI/CD triggers |
| 2 | Coverage reporting, undocumented module detection |
| 3 | Diff viewer for version comparison |
| 4 | Performance optimization, caching with DragonflyDB |

### v2.0 — 6 weeks

| Week | Deliverables |
|------|--------------|
| 1-2 | OAuth integration (GitHub, Google), user management |
| 3-4 | Multi-repo support, cross-repo linking |
| 5 | Docker/Kubernetes deployment configs |
| 6 | AI chat (RAG), audio summaries |

---

## Success Metrics

### MVP Launch

- Documentation generated for 80%+ of source modules
- < 2 second page load time
- Search returns relevant results in < 500ms
- Zero data leaves local machine without explicit sync

### v2 Launch

- < 5 minute onboarding for new team member
- 90%+ doc coverage maintained automatically
- < 1 minute from code push to doc update

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| MCP spec changes | High | Abstract MCP layer, pin versions |
| tldraw breaking changes | Medium | Pin version, abstract whiteboard interface |
| Claude Code rate limits | Medium | Queue regeneration, batch changes |
| Postgres performance at scale | Low | Add read replicas, optimize indexes |
| User adoption | Medium | Great DX, clear docs, dogfooding |

---

## Open Questions

1. **Offline support** — Should docs be viewable without server running?
2. **Export formats** — PDF, static HTML, Markdown bundle?
3. **Plugin system** — Allow custom block types, custom MCP tools?
4. **Monetization** — Keep fully free, or offer hosted version later?

---

## Appendix

### Inspiration & References

- [Google Code Wiki](https://codewiki.google) — Auto-generated docs, chat integration
- [Davia](https://github.com/davialabs/davia) — AI agent documentation
- [tldraw](https://tldraw.com) — Embeddable whiteboard
- [Excalidraw](https://excalidraw.com) — Sketchy diagram aesthetic
- [Notion](https://notion.so) — Block-based editing UX
- [GitBook](https://gitbook.com) — Developer documentation
- [Drizzle ORM](https://orm.drizzle.team) — Type-safe SQL for TypeScript
- [TanStack](https://tanstack.com) — Router, Query, Table

### Glossary

- **MCP** — Model Context Protocol, Anthropic's standard for AI tool integration
- **Block** — Atomic content unit (paragraph, diagram, code embed)
- **Regeneration** — Process of updating docs when code changes
- **Coverage** — Percentage of source modules with documentation
- **Drizzle** — Type-safe ORM that generates SQL, works with Postgres and SQLite
- **tldraw** — Open-source canvas/whiteboard library for React
