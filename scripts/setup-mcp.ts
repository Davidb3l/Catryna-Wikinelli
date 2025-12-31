#!/usr/bin/env bun
/**
 * Catryna Wikinelli MCP Setup Script
 *
 * Run this from any project directory to set up Catryna MCP integration:
 *
 *   bun run E:/0 - Code/Catryna Wikinelli/scripts/setup-mcp.ts
 *
 * Or create an alias in your shell profile:
 *   alias catryna-setup="bun run 'E:/0 - Code/Catryna Wikinelli/scripts/setup-mcp.ts'"
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

// Get the Catryna installation path (where this script lives)
const scriptDir = import.meta.dir
const catrynaRoot = resolve(scriptDir, '..')
const mcpServerPath = join(catrynaRoot, 'apps/server/src/mcp/stdio.ts').replace(/\\/g, '/')

// Target project is current working directory
const projectDir = process.cwd()
const claudeDir = join(projectDir, '.claude')
const settingsPath = join(claudeDir, 'settings.json')

console.log(`\nCatryna MCP Setup`)
console.log(`─────────────────────────────────────`)
console.log(`Project:  ${projectDir}`)
console.log(`Catryna:  ${catrynaRoot}\n`)

// Create .claude directory if needed
if (!existsSync(claudeDir)) {
  mkdirSync(claudeDir, { recursive: true })
  console.log(`Created .claude directory`)
}

// MCP config to add
const mcpConfig = {
  command: 'bun',
  args: ['run', mcpServerPath],
  env: {
    CATRYNA_MODE: 'local'
  }
}

// Read existing settings or create new
let settings: Record<string, unknown> = {}
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    console.log(`Found existing settings.json`)
  } catch {
    console.log(`Existing settings.json was invalid, creating new`)
  }
}

// Merge MCP config
if (!settings.mcpServers) {
  settings.mcpServers = {}
}
(settings.mcpServers as Record<string, unknown>).catryna = mcpConfig

// Write settings
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
console.log(`Updated ${settingsPath}`)

// Add catryna.db to .gitignore if it exists
const gitignorePath = join(projectDir, '.gitignore')
if (existsSync(gitignorePath)) {
  const gitignore = readFileSync(gitignorePath, 'utf-8')
  if (!gitignore.includes('catryna.db')) {
    writeFileSync(gitignorePath, gitignore.trimEnd() + '\n\n# Catryna documentation database\ncatryna.db\n')
    console.log(`Added catryna.db to .gitignore`)
  }
}

console.log(`\nDone! Restart Claude Code in this project to load Catryna MCP.`)
console.log(`\nAvailable tools:`)
console.log(`  - create_doc, update_doc, get_doc, list_docs, delete_doc`)
console.log(`  - search_docs, create_diagram, create_whiteboard`)
console.log(`  - get_undocumented_modules, get_doc_coverage\n`)
