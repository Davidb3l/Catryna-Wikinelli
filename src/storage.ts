/**
 * File-based storage for documentation.
 *
 * Docs are stored as .mdx files in .docs/ folder.
 * This allows Claude Code to READ docs directly without MCP.
 * MCP tools are only needed for CREATE/UPDATE/DELETE operations.
 */

import { readFile, writeFile, mkdir, unlink, readdir, stat } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { emitEvent, docUri } from "./events";

// Get the .docs folder path relative to where the server runs
const DOCS_ROOT = join(process.cwd(), ".docs");
const INDEX_FILE = join(DOCS_ROOT, "_index.json");

export interface DocMetadata {
  id: string;
  path: string;
  title: string;
  tags: string[];
  relatedFiles: string[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

export interface DocIndex {
  version: number;
  docs: DocMetadata[];
  lastUpdated: number | null;
}

export interface Block {
  type: string;
  data: Record<string, unknown>;
}

export interface Doc {
  metadata: DocMetadata;
  blocks: Block[];
}

/**
 * Ensure .docs folder exists
 */
async function ensureDocsFolder(): Promise<void> {
  try {
    await mkdir(DOCS_ROOT, { recursive: true });
  } catch {
    // Already exists
  }
}

/**
 * Read and parse the docs index for a given working directory WITHOUT creating
 * it. Throws on a missing or malformed `_index.json` (ENOENT / SyntaxError).
 *
 * This is the read-only counterpart to `loadIndex()` (which creates an empty
 * index as a side effect on a miss). `catryna doctor` needs a read-only probe —
 * it must never write another repo's `.docs/` just to answer a health check —
 * so it goes through here. Parameterized by `cwd` so it can inspect any repo,
 * not just the one captured at module load.
 */
export async function readIndexAt(cwd: string = process.cwd()): Promise<DocIndex> {
  const indexFile = join(cwd, ".docs", "_index.json");
  const content = await readFile(indexFile, "utf-8");
  return JSON.parse(content) as DocIndex;
}

/**
 * Load the index file, creating an empty one if it doesn't exist yet. Used by
 * the MCP write tools, which legitimately materialize the store on first use.
 */
export async function loadIndex(): Promise<DocIndex> {
  try {
    return await readIndexAt();
  } catch {
    // Index doesn't exist (or is unreadable), create empty
    const emptyIndex: DocIndex = {
      version: 1,
      docs: [],
      lastUpdated: null,
    };
    await saveIndex(emptyIndex);
    return emptyIndex;
  }
}

/**
 * Save the index file
 */
export async function saveIndex(index: DocIndex): Promise<void> {
  await ensureDocsFolder();
  index.lastUpdated = Date.now();
  await writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
}

/**
 * Serialize every read-modify-write of `_index.json`.
 *
 * `createDoc`/`updateDoc`/`deleteDoc` each do `loadIndex()` → mutate → `saveIndex()`.
 * Those steps `await` in between, so two concurrent MCP write calls could
 * interleave — both read the same index, both save their own mutation, and the
 * second overwrite drops the first entry (the `.mdx` file survives on disk, but
 * vanishes from the index). This promise-chain mutex forces each mutation to
 * run only after the previous one has fully settled, so every mutation loads
 * the latest persisted index. The store is single-process (SUITE_CONTRACTS's
 * single-machine model), so an in-process lock is sufficient — no file lock.
 *
 * A rejected mutation must not wedge the chain: the tail always continues via a
 * settled (resolved) link, while the original result — value or rejection — is
 * returned to the caller unchanged.
 */
let indexMutationChain: Promise<unknown> = Promise.resolve();
function withIndexLock<T>(mutate: () => Promise<T>): Promise<T> {
  const result = indexMutationChain.then(mutate, mutate);
  indexMutationChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Convert doc path to file path
 * e.g., "modules/auth" -> ".docs/modules/auth.mdx"
 */
function docPathToFilePath(docPath: string): string {
  return join(DOCS_ROOT, `${docPath}.mdx`);
}

/**
 * Convert blocks to MDX content with frontmatter
 */
function blocksToMdx(metadata: DocMetadata, blocks: Block[]): string {
  // Create YAML frontmatter
  const frontmatter = `---
id: ${metadata.id}
title: "${metadata.title}"
path: "${metadata.path}"
tags: [${metadata.tags.map(t => `"${t}"`).join(", ")}]
relatedFiles: [${metadata.relatedFiles.map(f => `"${f}"`).join(", ")}]
createdAt: ${metadata.createdAt}
updatedAt: ${metadata.updatedAt}
createdBy: "${metadata.createdBy}"
---

`;

  // Convert blocks to MDX content
  const content = blocks.map(block => blockToMdx(block)).join("\n\n");

  return frontmatter + content;
}

/**
 * Convert a single block to MDX
 */
function blockToMdx(block: Block): string {
  switch (block.type) {
    case "heading": {
      const level = block.data.level as number || 1;
      const prefix = "#".repeat(level);
      return `${prefix} ${block.data.content || ""}`;
    }
    case "text":
      return String(block.data.content || "");
    case "code": {
      const lang = block.data.language || "";
      const code = block.data.content || "";
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }
    case "code-embed": {
      return `<CodeEmbed file="${block.data.file}" startLine={${block.data.startLine || 1}} endLine={${block.data.endLine || -1}} />`;
    }
    case "mermaid": {
      return `\`\`\`mermaid\n${block.data.content || ""}\n\`\`\``;
    }
    case "react-flow": {
      return `<ReactFlow data={${JSON.stringify(block.data)}} />`;
    }
    case "whiteboard": {
      return `<Whiteboard data={${JSON.stringify(block.data)}} />`;
    }
    case "callout": {
      const type = block.data.type || "info";
      return `<Callout type="${type}">\n${block.data.content || ""}\n</Callout>`;
    }
    case "table": {
      return `<Table data={${JSON.stringify(block.data)}} />`;
    }
    case "divider":
      return "---";
    case "markdown":
      // Raw markdown content - just output directly
      return String(block.data.content || "");
    default:
      // Unknown block type - warn and output content if available
      console.warn(`[Catryna] Unknown block type: "${block.type}". Use: heading, text, code, mermaid, callout, table, divider, react-flow, whiteboard, or markdown`);
      if (block.data.content) {
        return String(block.data.content);
      }
      return `{/* Unknown block type: ${block.type} */}`;
  }
}

/**
 * Parse MDX file back to metadata and blocks
 */
function parseMdx(content: string): { metadata: Partial<DocMetadata>; blocks: Block[] } {
  // Extract frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);

  let metadata: Partial<DocMetadata> = {};
  let body = content;

  if (frontmatterMatch) {
    body = content.slice(frontmatterMatch[0].length);
    const yaml = frontmatterMatch[1];

    // Simple YAML parsing for our known fields
    const lines = yaml.split("\n");
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        if (key === "id" || key === "title" || key === "path" || key === "createdBy") {
          metadata[key] = value.replace(/^["']|["']$/g, "");
        } else if (key === "tags" || key === "relatedFiles") {
          // Parse array: ["a", "b"]
          const arrayMatch = value.match(/\[(.*)\]/);
          if (arrayMatch) {
            metadata[key] = arrayMatch[1]
              .split(",")
              .map(s => s.trim().replace(/^["']|["']$/g, ""))
              .filter(s => s);
          }
        } else if (key === "createdAt" || key === "updatedAt") {
          metadata[key] = parseInt(value, 10);
        }
      }
    }
  }

  // Parse body into blocks (simplified - mainly for headings and text)
  const blocks: Block[] = [];
  const lines = body.trim().split("\n");
  let currentBlock: Block | null = null;
  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeContent: string[] = [];

  for (const line of lines) {
    // Check for code block
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        codeContent = [];
      } else {
        // End of code block
        if (codeBlockLang === "mermaid") {
          blocks.push({ type: "mermaid", data: { content: codeContent.join("\n") } });
        } else {
          blocks.push({ type: "code", data: { language: codeBlockLang, content: codeContent.join("\n") } });
        }
        inCodeBlock = false;
        codeBlockLang = "";
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent.push(line);
      continue;
    }

    // Check for heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({ type: "heading", data: { level: headingMatch[1].length, content: headingMatch[2] } });
      continue;
    }

    // Check for divider
    if (line === "---") {
      blocks.push({ type: "divider", data: {} });
      continue;
    }

    // Check for MDX components
    if (line.startsWith("<CodeEmbed") || line.startsWith("<ReactFlow") ||
        line.startsWith("<Whiteboard") || line.startsWith("<Callout") ||
        line.startsWith("<Table")) {
      // Store as raw for now
      blocks.push({ type: "raw", data: { content: line } });
      continue;
    }

    // Regular text
    if (line.trim()) {
      blocks.push({ type: "text", data: { content: line } });
    }
  }

  return { metadata, blocks };
}

/**
 * Create a new document
 */
export async function createDoc(
  path: string,
  title: string,
  blocks: Block[],
  tags: string[] = [],
  relatedFiles: string[] = []
): Promise<DocMetadata> {
  await ensureDocsFolder();

  const now = Date.now();
  const metadata: DocMetadata = {
    id: crypto.randomUUID(),
    path,
    title,
    tags,
    relatedFiles,
    createdAt: now,
    updatedAt: now,
    createdBy: "claude-code",
  };

  // Create directory if needed
  const filePath = docPathToFilePath(path);
  await mkdir(dirname(filePath), { recursive: true });

  // Write MDX file
  const mdxContent = blocksToMdx(metadata, blocks);
  await writeFile(filePath, mdxContent);

  // Update index under the serialization lock so a concurrent write can't
  // clobber this entry (the .mdx write above is per-path, so it stays outside).
  await withIndexLock(async () => {
    const index = await loadIndex();
    index.docs.push(metadata);
    await saveIndex(index);
  });

  // The doc is now durable — announce it on the suite spine (§2, best-effort).
  await emitEvent("doc.created", [docUri(path)], { path, title, id: metadata.id });

  return metadata;
}

/**
 * Get a document by path
 */
export async function getDoc(path: string): Promise<Doc | null> {
  const index = await loadIndex();
  const meta = index.docs.find(d => d.path === path);

  if (!meta) {
    return null;
  }

  try {
    const filePath = docPathToFilePath(path);
    const content = await readFile(filePath, "utf-8");
    const { blocks } = parseMdx(content);

    return {
      metadata: meta,
      blocks,
    };
  } catch {
    return null;
  }
}

/**
 * List all documents
 */
export async function listDocs(options?: { tag?: string; pathPrefix?: string }): Promise<DocMetadata[]> {
  const index = await loadIndex();
  let docs = index.docs;

  if (options?.pathPrefix) {
    docs = docs.filter(d => d.path.startsWith(options.pathPrefix!));
  }

  if (options?.tag) {
    docs = docs.filter(d => d.tags.includes(options.tag!));
  }

  return docs.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Update a document
 */
export async function updateDoc(
  path: string,
  updates: {
    title?: string;
    blocks?: Block[];
    tags?: string[];
    relatedFiles?: string[];
  }
): Promise<DocMetadata | null> {
  // Serialize the whole read-modify-write: the file's frontmatter embeds `meta`
  // (which comes from the freshly-loaded index), so the .mdx write belongs
  // inside the lock too. Loading INSIDE the lock guarantees we see the latest
  // persisted index rather than a snapshot a concurrent write already replaced.
  const meta = await withIndexLock<DocMetadata | null>(async () => {
    const index = await loadIndex();
    const metaIndex = index.docs.findIndex(d => d.path === path);

    if (metaIndex === -1) {
      return null;
    }

    const m = { ...index.docs[metaIndex] };
    m.updatedAt = Date.now();

    if (updates.title) m.title = updates.title;
    if (updates.tags) m.tags = updates.tags;
    if (updates.relatedFiles) m.relatedFiles = updates.relatedFiles;

    // Preserve existing blocks when the caller isn't replacing them. Read the
    // file directly (not getDoc) to avoid a redundant index load inside the lock.
    let blocks: Block[];
    if (updates.blocks) {
      blocks = updates.blocks;
    } else {
      try {
        const existing = await readFile(docPathToFilePath(path), "utf-8");
        blocks = parseMdx(existing).blocks;
      } catch {
        blocks = [];
      }
    }

    // Write updated file, then the index entry, then persist the index.
    await writeFile(docPathToFilePath(path), blocksToMdx(m, blocks));
    index.docs[metaIndex] = m;
    await saveIndex(index);

    return m;
  });

  if (!meta) {
    return null;
  }

  // The update is now durable — announce it on the suite spine (§2, best-effort).
  await emitEvent("doc.updated", [docUri(path)], { path, title: meta.title, id: meta.id });

  return meta;
}

/**
 * Delete a document
 */
export async function deleteDoc(path: string): Promise<boolean> {
  // Serialized read-modify-write, so a concurrent create/update can't resurrect
  // this entry or lose its own by racing on the shared index.
  return withIndexLock(async () => {
    const index = await loadIndex();
    const metaIndex = index.docs.findIndex(d => d.path === path);

    if (metaIndex === -1) {
      return false;
    }

    // Delete file
    try {
      await unlink(docPathToFilePath(path));
    } catch {
      // File might not exist
    }

    // Update index
    index.docs.splice(metaIndex, 1);
    await saveIndex(index);

    return true;
  });
}

/**
 * Search documents (simple text search)
 */
export async function searchDocs(query: string, limit = 10): Promise<Array<DocMetadata & { snippet: string }>> {
  const index = await loadIndex();
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);

  if (terms.length === 0) {
    return [];
  }

  const results: Array<DocMetadata & { snippet: string; score: number }> = [];

  for (const meta of index.docs) {
    // Check title and tags
    const titleLower = meta.title.toLowerCase();
    const tagsLower = meta.tags.join(" ").toLowerCase();
    const pathLower = meta.path.toLowerCase();

    let score = 0;
    for (const term of terms) {
      if (titleLower.includes(term)) score += 3;
      if (tagsLower.includes(term)) score += 2;
      if (pathLower.includes(term)) score += 1;
    }

    // Also search file content
    try {
      const filePath = docPathToFilePath(meta.path);
      const content = await readFile(filePath, "utf-8");
      const contentLower = content.toLowerCase();

      for (const term of terms) {
        if (contentLower.includes(term)) {
          score += 1;

          // Extract snippet
          const idx = contentLower.indexOf(term);
          const start = Math.max(0, idx - 40);
          const end = Math.min(content.length, idx + 60);
          const snippet = (start > 0 ? "..." : "") +
                         content.slice(start, end).replace(/\n/g, " ") +
                         (end < content.length ? "..." : "");

          if (score > 0) {
            results.push({ ...meta, snippet, score });
            break;
          }
        }
      }
    } catch {
      // Skip files that can't be read
    }

    if (score > 0 && !results.find(r => r.id === meta.id)) {
      results.push({ ...meta, snippet: meta.title, score });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...rest }) => rest);
}
