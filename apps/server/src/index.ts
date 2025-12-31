import { createYoga } from 'graphql-yoga'
import { schema } from './graphql/schema'
import { createFileWatcher } from './watcher/codeWatcher'
import { startMcpServer } from './mcp/server'

const PORT = parseInt(process.env.PORT || '4567', 10)
const isLocal = process.env.CATRYNA_MODE === 'local'

// Create GraphQL Yoga server
const yoga = createYoga({
  schema,
  graphqlEndpoint: '/graphql',
  landingPage: true,
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  },
})

// Create Bun HTTP server
const server = Bun.serve({
  port: PORT,
  fetch: yoga.fetch,
})

console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║                                                           ║
  ║   🐱 Catryna Wikinelli Server                             ║
  ║                                                           ║
  ║   Mode:     ${isLocal ? 'Local (SQLite)' : 'Server (Postgres)'}                         ║
  ║   GraphQL:  http://localhost:${PORT}/graphql                  ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
`)

// Start file watcher in local mode
if (isLocal) {
  try {
    const watcher = await createFileWatcher({
      include: ['src/**/*.{ts,tsx,js,jsx}', 'lib/**/*.py'],
      exclude: ['**/*.test.*', '**/*.spec.*', '**/node_modules/**'],
      debounceMs: 2000,
    })

    watcher.on('change', (filePath) => {
      console.log(`[Watcher] File changed: ${filePath}`)
      // Queue for regeneration
    })

    console.log('[Watcher] File watcher started')
  } catch (error) {
    console.error('[Watcher] Failed to start:', error)
  }
}

// Start MCP server for Claude Code integration
try {
  await startMcpServer()
  console.log('[MCP] Server started on stdio')
} catch (error) {
  console.error('[MCP] Failed to start:', error)
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...')
  server.stop()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\nShutting down...')
  server.stop()
  process.exit(0)
})

export { server }
