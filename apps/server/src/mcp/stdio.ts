#!/usr/bin/env node
/**
 * Catryna Wikinelli MCP Server
 *
 * This is the stdio entry point for Claude Code integration.
 * Run this server to enable Claude Code to manage documentation.
 *
 * Usage in Claude Code MCP settings:
 * {
 *   "mcpServers": {
 *     "catryna": {
 *       "command": "bun",
 *       "args": ["run", "path/to/apps/server/src/mcp/stdio.ts"]
 *     }
 *   }
 * }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { mcpTools } from './server'
import { createDocHandler } from './handlers/createDoc'
import { updateDocHandler } from './handlers/updateDoc'
import { searchDocsHandler } from './handlers/searchDocs'
import { diagramHandlers } from './handlers/diagrams'
import { coverageHandlers } from './handlers/coverage'
import { getDocHandler, listDocsHandler, deleteDocHandler } from './handlers/docOperations'

// Tool handlers map
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

// Create MCP server
const server = new Server(
  {
    name: 'catryna-wikinelli',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// Handle tools/list request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: mcpTools.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: 'object' as const,
        properties: tool.parameters.properties,
        required: tool.parameters.required || [],
      },
    })),
  }
})

// Handle tools/call request
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  const handler = toolHandlers[name]
  if (!handler) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ error: `Unknown tool: ${name}` }),
        },
      ],
      isError: true,
    }
  }

  try {
    const result = await handler(args)
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        },
      ],
      isError: true,
    }
  }
})

// Start the server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[Catryna MCP] Server started on stdio')
}

main().catch((error) => {
  console.error('[Catryna MCP] Fatal error:', error)
  process.exit(1)
})
