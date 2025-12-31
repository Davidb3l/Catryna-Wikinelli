import type { Block } from './block'

export interface Doc {
  id: string
  path: string // e.g., "architecture/auth-flow"
  title: string
  blocks: Block[]
  metadata: DocMetadata
}

export interface DocMetadata {
  createdAt: Date | string
  updatedAt: Date | string
  createdBy: string // "claude-code" | "user:xxx"
  tags: string[]
  relatedFiles: string[] // source files this doc covers
}

export interface DocVersion {
  id: string
  docId: string
  content: Block[]
  contentHash: string
  createdAt: Date | string
  createdBy: string | null
  commitSha: string | null
  parentVersionId: string | null
  summary: string | null
}

export interface DocSummary {
  id: string
  path: string
  title: string
  updatedAt: Date | string
  tags: string[]
}

export interface DocFilter {
  tag?: string
  search?: string
  path?: string
  createdBy?: string
  since?: Date | string
}

export interface SearchResult {
  doc: DocSummary
  score: number
  highlights: Highlight[]
}

export interface Highlight {
  field: string
  snippet: string
}

export interface SearchFilters {
  docType?: string[]
  module?: string
  dateRange?: {
    start: Date | string
    end: Date | string
  }
}

export interface CoverageReport {
  totalModules: number
  documentedModules: number
  coveragePercent: number
  undocumentedFiles: string[]
  recentlyUpdated: DocSummary[]
  staleDocuments: DocSummary[]
}

export interface ModuleInfo {
  filePath: string
  name: string
  exports: string[]
  lastModified: Date | string
  hasDocumentation: boolean
}
