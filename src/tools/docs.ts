import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDoc, getDoc, listDocs, updateDoc, deleteDoc } from "../storage";

// Block schema for documents
const BlockSchema = z.object({
  type: z.string(),
  data: z.record(z.unknown()),
});

// Validated anchor (Phase 1): a file, with an optional symbol and/or inclusive
// line range, that `catryna drift` watches for changes. A bare `relatedFiles`
// path is a file-level anchor; use this for symbol/line precision.
const AnchorSchema = z.object({
  file: z.string().describe("Repo-relative path of the anchored source file"),
  symbol: z.string().optional().describe("Optional symbol name to narrow drift to (e.g. a function/class)"),
  lines: z.tuple([z.number(), z.number()]).optional().describe("Optional inclusive [start, end] line range to narrow drift to"),
});
const ANCHORS_DESC =
  "Structured drift anchors: {file, symbol?, lines?}. Additive over relatedFiles — use for symbol/line-level drift precision. `catryna drift` flags a doc when its anchored code changes since verification.";

export function registerDocTools(server: McpServer): void {
  // CREATE DOC
  server.tool(
    "create_doc",
    {
      path: z.string().describe("Doc path, e.g. 'modules/auth' or 'architecture/database'. Creates .docs/{path}.mdx file"),
      title: z.string().describe("Human-readable title for the documentation page"),
      content: z.array(BlockSchema).describe("Array of content blocks. SUPPORTED TYPES: heading, text, code, mermaid, callout, table, divider, markdown, react-flow, whiteboard. For full markdown docs use: {type:'markdown', data:{content:'# Your markdown...'}}"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      relatedFiles: z.array(z.string()).optional().describe("Source files this doc covers"),
      evidence: z.array(z.string()).optional().describe("Suite URIs cited as evidence backing this doc, e.g. 'sirius:receipt/89'. Accepts any suite scheme (catryna:/amt:/hayven:/sirius:); stored OPAQUELY — not validated or resolved."),
      refs: z.array(z.string()).optional().describe("Suite URIs this doc references, e.g. 'amt:decision/7'. Accepts any suite scheme (catryna:/amt:/hayven:/sirius:); stored OPAQUELY — not validated or resolved."),
      anchors: z.array(AnchorSchema).optional().describe(ANCHORS_DESC),
    },
    async ({ path, title, content, tags, relatedFiles, evidence, refs, anchors }) => {
      try {
        // Check if doc already exists
        const existing = await getDoc(path);
        if (existing) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: false, error: `Doc already exists at path: ${path}` }) }],
          };
        }

        const metadata = await createDoc(path, title, content, tags, relatedFiles, evidence, refs, anchors);

        return {
          content: [{ type: "text", text: JSON.stringify({
            success: true,
            id: metadata.id,
            path: metadata.path,
            title: metadata.title,
            file: `.docs/${path}.mdx`,
            message: "Doc created. Claude can read it directly with the Read tool.",
          }) }],
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
      const doc = await getDoc(path);

      if (!doc) {
        return {
          content: [{ type: "text", text: JSON.stringify({
            success: false,
            error: `Doc not found: ${path}`,
            hint: "You can also read the file directly: .docs/{path}.mdx",
          }) }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({
          success: true,
          doc: {
            id: doc.metadata.id,
            path: doc.metadata.path,
            title: doc.metadata.title,
            blocks: doc.blocks,
            tags: doc.metadata.tags,
            relatedFiles: doc.metadata.relatedFiles,
            anchors: doc.metadata.anchors,
            evidence: doc.metadata.evidence,
            refs: doc.metadata.refs,
            createdAt: doc.metadata.createdAt,
            updatedAt: doc.metadata.updatedAt,
          },
          file: `.docs/${path}.mdx`,
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
      const docs = await listDocs({ tag, pathPrefix });

      const results = docs.map(d => ({
        id: d.id,
        path: d.path,
        title: d.title,
        tags: d.tags,
        file: `.docs/${d.path}.mdx`,
        updatedAt: d.updatedAt,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify({
          success: true,
          docs: results,
          count: results.length,
          hint: "All docs are stored in .docs/ folder. Claude can read them directly.",
        }) }],
      };
    }
  );

  // UPDATE DOC
  server.tool(
    "update_doc",
    {
      path: z.string().describe("Path of the document to update"),
      title: z.string().optional().describe("New title"),
      content: z.array(BlockSchema).optional().describe("New content blocks. SUPPORTED TYPES: heading, text, code, mermaid, callout, table, divider, markdown, react-flow, whiteboard"),
      tags: z.array(z.string()).optional().describe("New tags"),
      relatedFiles: z.array(z.string()).optional().describe("New related files"),
      evidence: z.array(z.string()).optional().describe("Replacement suite URIs cited as evidence, e.g. 'sirius:receipt/89'. Accepts any suite scheme (catryna:/amt:/hayven:/sirius:); stored OPAQUELY — not validated or resolved. Omit to preserve existing."),
      refs: z.array(z.string()).optional().describe("Replacement suite URIs this doc references, e.g. 'amt:decision/7'. Accepts any suite scheme (catryna:/amt:/hayven:/sirius:); stored OPAQUELY — not validated or resolved. Omit to preserve existing."),
      anchors: z.array(AnchorSchema).optional().describe(ANCHORS_DESC + " Omit to preserve existing."),
    },
    async ({ path, title, content, tags, relatedFiles, evidence, refs, anchors }) => {
      try {
        const updated = await updateDoc(path, {
          title,
          blocks: content,
          tags,
          relatedFiles,
          evidence,
          refs,
          anchors,
        });

        if (!updated) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: false, error: `Doc not found: ${path}` }) }],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify({
            success: true,
            path: updated.path,
            file: `.docs/${path}.mdx`,
            updatedAt: updated.updatedAt,
          }) }],
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
      try {
        const deleted = await deleteDoc(path);

        if (!deleted) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: false, error: `Doc not found: ${path}` }) }],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, path, deleted: true }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        };
      }
    }
  );
}
