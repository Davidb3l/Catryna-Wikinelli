import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDoc, getDoc } from "../storage";

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
      try {
        // Check if doc already exists
        const existing = await getDoc(path);
        if (existing) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: false, error: `Doc already exists at path: ${path}` }) }],
          };
        }

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

        const metadata = await createDoc(
          path,
          title || "Architecture Diagram",
          blocks,
          ["diagram", type || "custom"],
          []
        );

        return {
          content: [{ type: "text", text: JSON.stringify({
            success: true,
            id: metadata.id,
            path,
            file: `.docs/${path}.mdx`,
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

  // CREATE MERMAID DIAGRAM
  server.tool(
    "create_mermaid_diagram",
    {
      path: z.string().describe("Doc path for the diagram"),
      title: z.string().optional().describe("Diagram title"),
      mermaid: z.string().describe("Mermaid diagram code (flowchart, sequence, etc.)"),
    },
    async ({ path, title, mermaid }) => {
      try {
        // Check if doc already exists
        const existing = await getDoc(path);
        if (existing) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: false, error: `Doc already exists at path: ${path}` }) }],
          };
        }

        const blocks = [
          {
            type: "heading",
            data: { level: 1, content: title || "Mermaid Diagram" },
          },
          {
            type: "mermaid",
            data: { content: mermaid },
          },
        ];

        const metadata = await createDoc(
          path,
          title || "Mermaid Diagram",
          blocks,
          ["diagram", "mermaid"],
          []
        );

        return {
          content: [{ type: "text", text: JSON.stringify({
            success: true,
            id: metadata.id,
            path,
            file: `.docs/${path}.mdx`,
            mermaidLength: mermaid.length,
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
      try {
        // Check if doc already exists
        const existing = await getDoc(path);
        if (existing) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: false, error: `Doc already exists at path: ${path}` }) }],
          };
        }

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

        const metadata = await createDoc(
          path,
          title || "Whiteboard",
          blocks,
          ["whiteboard"],
          []
        );

        return {
          content: [{ type: "text", text: JSON.stringify({
            success: true,
            id: metadata.id,
            path,
            file: `.docs/${path}.mdx`,
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
