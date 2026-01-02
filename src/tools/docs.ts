import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb, hashContent } from "../db";

// Block schema for documents
const BlockSchema = z.object({
  type: z.string(),
  data: z.record(z.unknown()),
});

export function registerDocTools(server: McpServer): void {
  // CREATE DOC
  server.tool(
    "create_doc",
    {
      path: z.string().describe("Doc path, e.g. 'modules/auth' or 'architecture/database'"),
      title: z.string().describe("Human-readable title for the documentation page"),
      content: z.array(BlockSchema).describe("Array of content blocks"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      relatedFiles: z.array(z.string()).optional().describe("Source files this doc covers"),
    },
    async ({ path, title, content, tags, relatedFiles }) => {
      const db = getDb();
      const id = crypto.randomUUID();
      const now = Date.now();

      const metadata = JSON.stringify({
        tags: tags || [],
        relatedFiles: relatedFiles || [],
        createdBy: "claude-code",
      });

      const blocksJson = JSON.stringify(content);

      try {
        // Check if doc already exists
        const existing = db.query("SELECT id FROM docs WHERE path = ?").get(path);
        if (existing) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: false, error: `Doc already exists at path: ${path}` }) }],
          };
        }

        // Insert doc
        db.run(
          "INSERT INTO docs (id, path, title, blocks, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [id, path, title, blocksJson, metadata, now, now]
        );

        // Create initial version
        const versionId = crypto.randomUUID();
        const contentHash = hashContent(blocksJson);
        db.run(
          "INSERT INTO doc_versions (id, doc_id, content, content_hash, created_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
          [versionId, id, blocksJson, contentHash, now, "Initial version"]
        );

        // Create search index
        const plainContent = content.map(b => JSON.stringify(b.data)).join(" ");
        db.run(
          "INSERT INTO doc_search (doc_id, search_vector, plain_content) VALUES (?, ?, ?)",
          [id, `${title} ${plainContent}`.toLowerCase(), plainContent]
        );

        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, id, path, title }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        };
      }
    }
  );

  // GET DOC
  server.tool(
    "get_doc",
    {
      path: z.string().describe("Path of the document to retrieve"),
    },
    async ({ path }) => {
      const db = getDb();

      const doc = db.query(`
        SELECT id, path, title, blocks, metadata, created_at, updated_at
        FROM docs WHERE path = ?
      `).get(path) as { id: string; path: string; title: string; blocks: string; metadata: string; created_at: number; updated_at: number } | null;

      if (!doc) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: `Doc not found: ${path}` }) }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({
          success: true,
          doc: {
            id: doc.id,
            path: doc.path,
            title: doc.title,
            blocks: JSON.parse(doc.blocks),
            metadata: JSON.parse(doc.metadata),
            createdAt: doc.created_at,
            updatedAt: doc.updated_at,
          },
        }) }],
      };
    }
  );

  // LIST DOCS
  server.tool(
    "list_docs",
    {
      tag: z.string().optional().describe("Filter by tag"),
      pathPrefix: z.string().optional().describe("Filter by path prefix"),
    },
    async ({ tag, pathPrefix }) => {
      const db = getDb();

      let query = "SELECT id, path, title, metadata, updated_at FROM docs WHERE 1=1";
      const params: string[] = [];

      if (pathPrefix) {
        query += " AND path LIKE ?";
        params.push(`${pathPrefix}%`);
      }

      query += " ORDER BY updated_at DESC";

      const docs = db.query(query).all(...params) as Array<{ id: string; path: string; title: string; metadata: string; updated_at: number }>;

      let results = docs.map(d => ({
        id: d.id,
        path: d.path,
        title: d.title,
        tags: JSON.parse(d.metadata).tags || [],
        updatedAt: d.updated_at,
      }));

      // Filter by tag if specified
      if (tag) {
        results = results.filter(d => d.tags.includes(tag));
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, docs: results, count: results.length }) }],
      };
    }
  );

  // UPDATE DOC
  server.tool(
    "update_doc",
    {
      path: z.string().describe("Path of the document to update"),
      title: z.string().optional().describe("New title"),
      content: z.array(BlockSchema).optional().describe("New content blocks"),
      tags: z.array(z.string()).optional().describe("New tags"),
      relatedFiles: z.array(z.string()).optional().describe("New related files"),
    },
    async ({ path, title, content, tags, relatedFiles }) => {
      const db = getDb();
      const now = Date.now();

      const existing = db.query("SELECT id, blocks, metadata FROM docs WHERE path = ?").get(path) as { id: string; blocks: string; metadata: string } | null;

      if (!existing) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: `Doc not found: ${path}` }) }],
        };
      }

      const currentMetadata = JSON.parse(existing.metadata);
      const newMetadata = {
        ...currentMetadata,
        ...(tags !== undefined && { tags }),
        ...(relatedFiles !== undefined && { relatedFiles }),
      };

      const newBlocks = content ? JSON.stringify(content) : existing.blocks;

      try {
        // Update doc
        const updates: string[] = [];
        const params: (string | number)[] = [];

        if (title) {
          updates.push("title = ?");
          params.push(title);
        }
        if (content) {
          updates.push("blocks = ?");
          params.push(newBlocks);
        }
        updates.push("metadata = ?");
        params.push(JSON.stringify(newMetadata));
        updates.push("updated_at = ?");
        params.push(now);

        params.push(path);

        db.run(`UPDATE docs SET ${updates.join(", ")} WHERE path = ?`, params);

        // Create new version if content changed
        if (content) {
          const versionId = crypto.randomUUID();
          const contentHash = hashContent(newBlocks);
          db.run(
            "INSERT INTO doc_versions (id, doc_id, content, content_hash, created_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
            [versionId, existing.id, newBlocks, contentHash, now, "Updated content"]
          );

          // Update search index
          const plainContent = content.map(b => JSON.stringify(b.data)).join(" ");
          const searchTitle = title || "";
          db.run(
            "INSERT OR REPLACE INTO doc_search (doc_id, search_vector, plain_content) VALUES (?, ?, ?)",
            [existing.id, `${searchTitle} ${plainContent}`.toLowerCase(), plainContent]
          );
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, path }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        };
      }
    }
  );

  // DELETE DOC
  server.tool(
    "delete_doc",
    {
      path: z.string().describe("Path of the document to delete"),
    },
    async ({ path }) => {
      const db = getDb();

      const existing = db.query("SELECT id FROM docs WHERE path = ?").get(path);

      if (!existing) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: `Doc not found: ${path}` }) }],
        };
      }

      try {
        db.run("DELETE FROM docs WHERE path = ?", [path]);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, path }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        };
      }
    }
  );
}
