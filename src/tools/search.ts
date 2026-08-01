import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchDocs } from "../storage";
import { docsFreshness, freshnessHeadline } from "../freshness";

export function registerSearchTools(server: McpServer): void {
  server.tool(
    "search_docs",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().default(10).describe("Maximum number of results"),
    },
    async ({ query, limit }) => {
      if (!query || query.trim().length < 2) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: "Query must be at least 2 characters" }) }],
        };
      }

      try {
        const results = await searchDocs(query, limit);

        // One drift pass for the whole result set (Phase 2 trust surface).
        const fresh = await docsFreshness(process.cwd(), results.map(r => r.path));

        const formattedResults = results.map(r => ({
          id: r.id,
          path: r.path,
          title: r.title,
          tags: r.tags,
          file: `.docs/${r.path}.mdx`,
          snippet: r.snippet,
          updatedAt: r.updatedAt,
          freshness: fresh.get(r.path),
        }));

        const headline = freshnessHeadline(fresh.values());

        return {
          content: [{ type: "text", text: JSON.stringify({
            success: true,
            results: formattedResults,
            count: formattedResults.length,
            query,
            ...(headline ? { warning: headline } : {}),
            hint: "Read any doc directly with: Read .docs/{path}.mdx",
          }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        };
      }
    }
  );
}
