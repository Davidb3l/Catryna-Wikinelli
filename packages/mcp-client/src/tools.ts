/**
 * MCP Tool definitions for Catryna Wikinelli
 * Used by Claude Code and other AI agents to interact with the documentation system
 */

export const catrynaTools = {
  name: 'catryna-wikinelli',
  version: '1.0.0',
  description: 'Living documentation platform for codebases',
  tools: [
    {
      name: 'create_doc',
      description: 'Create a new documentation page',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Doc path, e.g. "modules/auth" or "architecture/database"',
          },
          title: {
            type: 'string',
            description: 'Human-readable title for the documentation page',
          },
          content: {
            type: 'array',
            description: 'Array of content blocks',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: [
                    'text',
                    'heading',
                    'code',
                    'code-embed',
                    'mermaid',
                    'react-flow',
                    'whiteboard',
                    'table',
                    'callout',
                    'divider',
                  ],
                },
                data: { type: 'object' },
              },
              required: ['type', 'data'],
            },
          },
          relatedFiles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Source files this documentation covers',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization and search',
          },
        },
        required: ['path', 'title', 'content'],
      },
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
            items: { type: 'object' },
          },
          tags: { type: 'array', items: { type: 'string' } },
          relatedFiles: { type: 'array', items: { type: 'string' } },
        },
        required: ['path'],
      },
    },
    {
      name: 'get_doc',
      description: 'Retrieve a documentation page by path',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of the doc to retrieve' },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_docs',
      description: 'List all documentation pages with optional filtering',
      parameters: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: 'Filter by tag' },
          path: { type: 'string', description: 'Filter by path prefix' },
        },
      },
    },
    {
      name: 'search_docs',
      description: 'Search documentation content',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'delete_doc',
      description: 'Delete a documentation page',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of the doc to delete' },
        },
        required: ['path'],
      },
    },
    {
      name: 'create_diagram',
      description: 'Create a React Flow architecture diagram',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Doc path for the diagram' },
          title: { type: 'string' },
          type: {
            type: 'string',
            enum: ['architecture', 'flow', 'sequence', 'entity', 'custom'],
          },
          nodes: {
            type: 'array',
            description: 'React Flow nodes with id, data.label, position',
          },
          edges: {
            type: 'array',
            description: 'React Flow edges with id, source, target',
          },
        },
        required: ['path', 'nodes', 'edges'],
      },
    },
    {
      name: 'create_whiteboard',
      description: 'Create a tldraw whiteboard for sketching ideas',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Doc path for the whiteboard' },
          title: { type: 'string' },
          snapshot: { type: 'object', description: 'tldraw snapshot object' },
        },
        required: ['path', 'snapshot'],
      },
    },
    {
      name: 'get_undocumented_modules',
      description: 'List source modules that lack documentation',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_doc_coverage',
      description: 'Get documentation coverage report showing health score',
      parameters: { type: 'object', properties: {} },
    },
  ],
}

export type CatrynaToolName = (typeof catrynaTools.tools)[number]['name']
