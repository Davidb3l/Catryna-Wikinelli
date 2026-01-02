/**
 * File-based storage for documentation.
 *
 * Docs are stored as .mdx files in .docs/ folder.
 * This allows Claude Code to READ docs directly without MCP.
 * MCP tools are only needed for CREATE/UPDATE/DELETE operations.
 */

import { readFile, writeFile, mkdir, unlink, readdir, stat } from "node:fs/promises";
import { join, dirname, basename } from "node:path";

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
 * Load the index file
 */
export async function loadIndex(): Promise<DocIndex> {
  try {
    const content = await readFile(INDEX_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    // Index doesn't exist, create empty
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
    default:
      // Generic block - store as JSON comment for round-trip
      return `{/* Block: ${block.type}\n${JSON.stringify(block.data, null, 2)}\n*/}`;
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

  // Update index
  const index = await loadIndex();
  index.docs.push(metadata);
  await saveIndex(index);

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
  const index = await loadIndex();
  const metaIndex = index.docs.findIndex(d => d.path === path);

  if (metaIndex === -1) {
    return null;
  }

  const meta = { ...index.docs[metaIndex] };
  meta.updatedAt = Date.now();

  if (updates.title) meta.title = updates.title;
  if (updates.tags) meta.tags = updates.tags;
  if (updates.relatedFiles) meta.relatedFiles = updates.relatedFiles;

  // Get existing blocks if not updating
  let blocks: Block[];
  if (updates.blocks) {
    blocks = updates.blocks;
  } else {
    const doc = await getDoc(path);
    blocks = doc?.blocks || [];
  }

  // Write updated file
  const filePath = docPathToFilePath(path);
  const mdxContent = blocksToMdx(meta, blocks);
  await writeFile(filePath, mdxContent);

  // Update index
  index.docs[metaIndex] = meta;
  await saveIndex(index);

  return meta;
}

/**
 * Delete a document
 */
export async function deleteDoc(path: string): Promise<boolean> {
  const index = await loadIndex();
  const metaIndex = index.docs.findIndex(d => d.path === path);

  if (metaIndex === -1) {
    return false;
  }

  // Delete file
  try {
    const filePath = docPathToFilePath(path);
    await unlink(filePath);
  } catch {
    // File might not exist
  }

  // Update index
  index.docs.splice(metaIndex, 1);
  await saveIndex(index);

  return true;
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
