#!/usr/bin/env node
/**
 * Catryna Wikinelli MCP Server
 *
 * File-based documentation platform for AI coding agents.
 *
 * KEY INSIGHT: Docs are stored as .mdx files in .docs/ folder.
 * - Claude can READ docs directly (no MCP needed)
 * - Claude uses MCP tools to CREATE/UPDATE/DELETE docs
 * - Humans view docs in the Vite viewer
 *
 * This dual-access model means BOTH Claude and humans benefit.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerDocTools } from "./tools/docs";
import { registerSearchTools } from "./tools/search";
import { registerDiagramTools } from "./tools/diagrams";
import { registerCoverageTools } from "./tools/coverage";
import { registerDriftTools } from "./tools/drift";

// Create MCP server
const server = new McpServer({
  name: "catryna-wikinelli",
  version: "1.0.0",
});

// Register all tools
registerDocTools(server);
registerSearchTools(server);
registerDiagramTools(server);
registerCoverageTools(server);
registerDriftTools(server);

// Connect to stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

// Log to stderr (stdout is reserved for MCP protocol)
console.error("[Catryna] MCP server started on stdio");
console.error("[Catryna] Docs are stored in .docs/ folder");
console.error("[Catryna] Claude can read docs directly: .docs/{path}.mdx");
