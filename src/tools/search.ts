import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchDocs } from "../storage";

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

        const formattedResults = results.map(r => ({
          id: r.id,
          path: r.path,
          title: r.title,
          tags: r.tags,
          file: `.docs/${r.path}.mdx`,
          snippet: r.snippet,
          updatedAt: r.updatedAt,
        }));

        return {
          content: [{ type: "text", text: JSON.stringify({
            success: true,
            results: formattedResults,
            count: formattedResults.length,
            query,
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
