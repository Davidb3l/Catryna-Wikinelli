import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb, hashContent } from "../db";

// React Flow node schema
const NodeSchema = z.object({
  id: z.string(),
  data: z.object({
    label: z.string(),
  }).passthrough(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  type: z.string().optional(),
});

// React Flow edge schema
const EdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  type: z.string().optional(),
});

export function registerDiagramTools(server: McpServer): void {
  // CREATE DIAGRAM (React Flow)
  server.tool(
    "create_diagram",
    {
      path: z.string().describe("Doc path for the diagram"),
      title: z.string().optional().describe("Diagram title"),
      type: z.enum(["architecture", "flow", "sequence", "entity", "custom"]).optional().describe("Diagram type"),
      nodes: z.array(NodeSchema).describe("React Flow nodes"),
      edges: z.array(EdgeSchema).describe("React Flow edges"),
    },
    async ({ path, title, type, nodes, edges }) => {
      const db = getDb();
      const id = crypto.randomUUID();
      const now = Date.now();

      const diagramData = {
        type: type || "custom",
        nodes,
        edges,
      };

      const blocks = [
        {
          type: "heading",
          data: { level: 1, content: title || "Architecture Diagram" },
        },
        {
          type: "react-flow",
          data: diagramData,
        },
      ];

      const blocksJson = JSON.stringify(blocks);
      const metadata = JSON.stringify({
        tags: ["diagram", type || "custom"],
        relatedFiles: [],
        createdBy: "claude-code",
        diagramType: type || "custom",
      });

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
          [id, path, title || "Architecture Diagram", blocksJson, metadata, now, now]
        );

        // Create initial version
        const versionId = crypto.randomUUID();
        const contentHash = hashContent(blocksJson);
        db.run(
          "INSERT INTO doc_versions (id, doc_id, content, content_hash, created_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
          [versionId, id, blocksJson, contentHash, now, "Initial diagram"]
        );

        // Create search index
        const nodeLabels = nodes.map(n => n.data.label).join(" ");
        db.run(
          "INSERT INTO doc_search (doc_id, search_vector, plain_content) VALUES (?, ?, ?)",
          [id, `${title || ""} diagram ${type || ""} ${nodeLabels}`.toLowerCase(), nodeLabels]
        );

        return {
          content: [{ type: "text", text: JSON.stringify({
            success: true,
            id,
            path,
            nodeCount: nodes.length,
            edgeCount: edges.length,
          }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        };
      }
    }
  );

  // CREATE WHITEBOARD (tldraw)
  server.tool(
    "create_whiteboard",
    {
      path: z.string().describe("Doc path for the whiteboard"),
      title: z.string().optional().describe("Whiteboard title"),
      snapshot: z.record(z.unknown()).describe("tldraw snapshot data"),
    },
    async ({ path, title, snapshot }) => {
      const db = getDb();
      const id = crypto.randomUUID();
      const now = Date.now();

      const blocks = [
        {
          type: "heading",
          data: { level: 1, content: title || "Whiteboard" },
        },
        {
          type: "whiteboard",
          data: { snapshot },
        },
      ];

      const blocksJson = JSON.stringify(blocks);
      const metadata = JSON.stringify({
        tags: ["whiteboard"],
        relatedFiles: [],
        createdBy: "claude-code",
      });

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
          [id, path, title || "Whiteboard", blocksJson, metadata, now, now]
        );

        // Create initial version
        const versionId = crypto.randomUUID();
        const contentHash = hashContent(blocksJson);
        db.run(
          "INSERT INTO doc_versions (id, doc_id, content, content_hash, created_at, summary) VALUES (?, ?, ?, ?, ?, ?)",
          [versionId, id, blocksJson, contentHash, now, "Initial whiteboard"]
        );

        // Create search index
        db.run(
          "INSERT INTO doc_search (doc_id, search_vector, plain_content) VALUES (?, ?, ?)",
          [id, `${title || ""} whiteboard`.toLowerCase(), title || "whiteboard"]
        );

        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, id, path }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        };
      }
    }
  );
}
