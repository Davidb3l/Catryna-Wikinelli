/**
 * MCP Client for connecting to Catryna Wikinelli server
 */

import type { Block, Doc, DocSummary, SearchResult, CoverageReport, ModuleInfo } from '@catryna/shared'
import { catrynaTools, type CatrynaToolName } from './tools'

interface McpClientConfig {
  serverUrl: string
}

interface McpResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export class CatrynaClient {
  private serverUrl: string

  constructor(config: McpClientConfig) {
    this.serverUrl = config.serverUrl.replace(/\/$/, '')
  }

  private async callTool<T>(name: CatrynaToolName, args: unknown): Promise<McpResponse<T>> {
    try {
      const response = await fetch(`${this.serverUrl}/mcp/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      return { success: true, data: result.content?.[0]?.text ? JSON.parse(result.content[0].text) : result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // Document operations
  async createDoc(params: {
    path: string
    title: string
    content: Array<{ type: string; data: unknown }>
    relatedFiles?: string[]
    tags?: string[]
  }): Promise<McpResponse<{ id: string; path: string; title: string }>> {
    return this.callTool('create_doc', params)
  }

  async updateDoc(params: {
    path: string
    title?: string
    content?: Array<{ type: string; data: unknown }>
    tags?: string[]
    relatedFiles?: string[]
  }): Promise<McpResponse<{ id: string; path: string; title: string }>> {
    return this.callTool('update_doc', params)
  }

  async getDoc(path: string): Promise<McpResponse<Doc>> {
    return this.callTool('get_doc', { path })
  }

  async listDocs(filter?: { tag?: string; path?: string }): Promise<McpResponse<DocSummary[]>> {
    return this.callTool('list_docs', filter || {})
  }

  async searchDocs(query: string, limit?: number): Promise<McpResponse<{ results: SearchResult[] }>> {
    return this.callTool('search_docs', { query, limit })
  }

  async deleteDoc(path: string): Promise<McpResponse<boolean>> {
    return this.callTool('delete_doc', { path })
  }

  // Diagram operations
  async createDiagram(params: {
    path: string
    title?: string
    type?: 'architecture' | 'flow' | 'sequence' | 'entity' | 'custom'
    nodes: Array<{ id: string; data: { label: string }; position: { x: number; y: number } }>
    edges: Array<{ id: string; source: string; target: string }>
  }): Promise<McpResponse<{ id: string; path: string }>> {
    return this.callTool('create_diagram', params)
  }

  async createWhiteboard(params: {
    path: string
    title?: string
    snapshot: unknown
  }): Promise<McpResponse<{ id: string; path: string }>> {
    return this.callTool('create_whiteboard', params)
  }

  // Coverage operations
  async getUndocumentedModules(): Promise<McpResponse<{ modules: ModuleInfo[] }>> {
    return this.callTool('get_undocumented_modules', {})
  }

  async getDocCoverage(): Promise<McpResponse<{ report: CoverageReport }>> {
    return this.callTool('get_doc_coverage', {})
  }

  // Utility: get tool definitions for MCP registration
  getToolDefinitions() {
    return catrynaTools
  }
}

// Factory function
export function createCatrynaClient(serverUrl = 'http://localhost:4000'): CatrynaClient {
  return new CatrynaClient({ serverUrl })
}
