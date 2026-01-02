import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db";

export function registerSearchTools(server: McpServer): void {
  server.tool(
    "search_docs",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().default(10).describe("Maximum number of results"),
    },
    async ({ query, limit }) => {
      const db = getDb();

      if (!query || query.trim().length < 2) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: "Query must be at least 2 characters" }) }],
        };
      }

      const searchTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);

      if (searchTerms.length === 0) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, results: [], count: 0 }) }],
        };
      }

      // Build search query with LIKE for each term
      const conditions = searchTerms.map(() => "search_vector LIKE ?").join(" AND ");
      const params = searchTerms.map(t => `%${t}%`);

      const results = db.query(`
        SELECT
          d.id,
          d.path,
          d.title,
          d.metadata,
          ds.plain_content,
          d.updated_at
        FROM docs d
        JOIN doc_search ds ON d.id = ds.doc_id
        WHERE ${conditions}
        ORDER BY d.updated_at DESC
        LIMIT ?
      `).all(...params, limit) as Array<{
        id: string;
        path: string;
        title: string;
        metadata: string;
        plain_content: string;
        updated_at: number;
      }>;

      const formattedResults = results.map(r => {
        // Extract snippet around first match
        const content = r.plain_content;
        const firstTerm = searchTerms[0];
        const matchIndex = content.toLowerCase().indexOf(firstTerm);
        const snippetStart = Math.max(0, matchIndex - 50);
        const snippetEnd = Math.min(content.length, matchIndex + 100);
        const snippet = (snippetStart > 0 ? "..." : "") +
                       content.slice(snippetStart, snippetEnd) +
                       (snippetEnd < content.length ? "..." : "");

        return {
          id: r.id,
          path: r.path,
          title: r.title,
          tags: JSON.parse(r.metadata).tags || [],
          snippet: snippet.trim(),
          updatedAt: r.updated_at,
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify({
          success: true,
          results: formattedResults,
          count: formattedResults.length,
          query,
        }) }],
      };
    }
  );
}
