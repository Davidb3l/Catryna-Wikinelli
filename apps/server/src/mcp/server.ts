import { createDocHandler } from './handlers/createDoc'
import { updateDocHandler } from './handlers/updateDoc'
import { searchDocsHandler } from './handlers/searchDocs'
import { diagramHandlers } from './handlers/diagrams'
import { coverageHandlers } from './handlers/coverage'
import { getDocHandler, listDocsHandler, deleteDocHandler } from './handlers/docOperations'

// MCP Tool definitions following Model Context Protocol
export const mcpTools = {
  name: 'catryna-wikinelli',
  version: '1.0.0',
  tools: [
    {
      name: 'create_doc',
      description: 'Create a new documentation page in Catryna Wikinelli',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Doc path, e.g. "modules/auth" or "architecture/database"'
          },
          title: {
            type: 'string',
            description: 'Human-readable title for the documentation page'
          },
          content: {
            type: 'array',
            description: 'Array of content blocks (text, code, diagrams, etc.)',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['text', 'heading', 'code', 'code-embed', 'mermaid', 'callout', 'table', 'divider']
                },
                data: { type: 'object' }
              },
              required: ['type', 'data']
            }
          },
          relatedFiles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Source files this documentation covers'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization and search'
          }
        },
        required: ['path', 'title', 'content']
      }
    },
    {
      name: 'update_doc',
      description: 'Update an existing documentation page',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of the doc to update' },
          title: { type: 'string', description: 'New title (optional)' },
          content: {
            type: 'array',
            description: 'New content blocks (optional)',
            items: { type: 'object' }
          },
          tags: { type: 'array', items: { type: 'string' } },
          relatedFiles: { type: 'array', items: { type: 'string' } }
        },
        required: ['path']
      }
    },
    {
      name: 'get_doc',
      description: 'Retrieve a documentation page by path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of the doc to retrieve' }
        },
        required: ['path']
      }
    },
    {
      name: 'list_docs',
      description: 'List all documentation pages with optional filtering',
      parameters: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: 'Filter by tag' },
          path: { type: 'string', description: 'Filter by path prefix' }
        }
      }
    },
    {
      name: 'search_docs',
      description: 'Search documentation content',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default 10)' }
        },
        required: ['query']
      }
    },
    {
      name: 'delete_doc',
      description: 'Delete a documentation page',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of the doc to delete' }
        },
        required: ['path']
      }
    },
    {
      name: 'create_diagram',
      description: 'Create a React Flow diagram',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Doc path for the diagram' },
          title: { type: 'string' },
          type: {
            type: 'string',
            enum: ['architecture', 'flow', 'sequence', 'entity', 'custom']
          },
          nodes: { type: 'array', description: 'React Flow nodes' },
          edges: { type: 'array', description: 'React Flow edges' }
        },
        required: ['path', 'nodes', 'edges']
      }
    },
    {
      name: 'create_whiteboard',
      description: 'Create a tldraw whiteboard',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Doc path for the whiteboard' },
          title: { type: 'string' },
          snapshot: { type: 'object', description: 'tldraw snapshot' }
        },
        required: ['path', 'snapshot']
      }
    },
    {
      name: 'get_undocumented_modules',
      description: 'List source modules that lack documentation',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'get_doc_coverage',
      description: 'Get documentation coverage report',
      parameters: { type: 'object', properties: {} }
    }
  ]
}

// Tool handlers
const toolHandlers: Record<string, (args: unknown) => Promise<unknown>> = {
  create_doc: createDocHandler,
  update_doc: updateDocHandler,
  get_doc: getDocHandler,
  list_docs: listDocsHandler,
  search_docs: searchDocsHandler,
  delete_doc: deleteDocHandler,
  create_diagram: diagramHandlers.createDiagram,
  create_whiteboard: diagramHandlers.createWhiteboard,
  get_undocumented_modules: coverageHandlers.getUndocumented,
  get_doc_coverage: coverageHandlers.getCoverage,
}

// Handle incoming MCP requests
export async function handleMcpRequest(request: {
  method: string
  params?: { name?: string; arguments?: unknown }
}) {
  if (request.method === 'tools/list') {
    return { tools: mcpTools.tools }
  }

  if (request.method === 'tools/call') {
    const toolName = request.params?.name
    const args = request.params?.arguments

    if (!toolName || !toolHandlers[toolName]) {
      throw new Error(`Unknown tool: ${toolName}`)
    }

    const result = await toolHandlers[toolName](args)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }

  throw new Error(`Unknown method: ${request.method}`)
}

// Start MCP server on stdio (for Claude Code integration)
export async function startMcpServer() {
  // In a real implementation, this would set up stdio communication
  // with Claude Code using the MCP protocol

  // For now, we expose the handlers for direct use
  console.log('[MCP] Tools registered:', mcpTools.tools.map(t => t.name).join(', '))

  return {
    tools: mcpTools,
    handle: handleMcpRequest,
  }
}
