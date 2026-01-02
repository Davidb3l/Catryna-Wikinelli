#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initDb } from "./db";
import { registerDocTools } from "./tools/docs";
import { registerSearchTools } from "./tools/search";
import { registerDiagramTools } from "./tools/diagrams";
import { registerCoverageTools } from "./tools/coverage";

// Initialize database
initDb();

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

// Connect to stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("[Catryna] MCP server started on stdio");
