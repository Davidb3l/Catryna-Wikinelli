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

/**
 * A VALIDATED anchor from a doc to a precise region of code (PRODUCT_ROADMAP
 * Phase 1 — "validated anchors: file + optional symbol/line-range"). Structured
 * successor to the bare `relatedFiles: string[]`:
 *
 *   - `file`            — repo-relative path the anchor points at (required).
 *   - `symbol`          — optional symbol name inside `file` (e.g. a function).
 *                         Narrows drift to that symbol via git-diff, or — when
 *                         the Hayvenhurst daemon is present — via the code graph
 *                         (`impact` of changed symbols), see src/drift.ts.
 *   - `lines`           — optional inclusive [start, end] line range (1-based,
 *                         relative to the doc's `verifiedCommit` baseline).
 *                         Narrows drift to whether changed hunks overlap it.
 *
 * A bare `relatedFiles` path is equivalent to a FILE-LEVEL anchor (`{file}` with
 * no `symbol`/`lines`) — see `effectiveAnchors`, which merges the two so legacy
 * docs (relatedFiles only) keep drifting at file level with zero migration.
 */
export interface DocAnchor {
  file: string;
  symbol?: string;
  lines?: [number, number];
}

export interface DocMetadata {
  id: string;
  path: string;
  title: string;
  tags: string[];
  relatedFiles: string[];
  /**
   * Structured, validated anchors (Phase 1). ADDITIVE over `relatedFiles`: a doc
   * may declare file-level anchors as bare `relatedFiles` paths, symbol/line
   * anchors here, or both — `effectiveAnchors(meta)` merges them for drift.
   * Backward-compat (§ storage): absent in a legacy index/frontmatter →
   * normalized to `[]` on read (like `evidence`/`refs`).
   */
  anchors: DocAnchor[];
  /**
   * Suite URIs cited as *evidence* backing this doc (SUITE_CONTRACTS §1) — e.g.
   * a `sirius:receipt/89` receipt that verified it. Foreign schemes are stored
   * OPAQUELY (§1 rule 2): accepted, persisted, and displayed verbatim, never
   * validated or resolved. Any string is a valid entry.
   */
  evidence: string[];
  /**
   * Suite URIs this doc otherwise *references* — e.g. the `amt:decision/7` that
   * governs it. Same opaque-storage contract as `evidence`.
   */
  refs: string[];
  /**
   * The git commit SHA this doc was last VERIFIED against — the drift baseline
   * (PRODUCT_ROADMAP Phase 1). This is deliberately NOT `updatedAt`: editing a
   * doc's prose does not re-verify it against code; only `catryna verify` sets
   * this, recording the repo HEAD at the moment a human/agent confirmed the doc
   * matches the code. `catryna drift` diffs `relatedFiles` over
   * `verifiedCommit..HEAD`. Empty string ("") means NEVER verified — a doc with
   * no baseline is reported `unverified`, never silently "clean". Backward-compat
   * (§ storage): absent in a legacy index/frontmatter → normalized to "" on read.
   */
  verifiedCommit: string;
  /**
   * ISO-8601 UTC timestamp of the last `catryna verify` for this doc, or "" if
   * never verified. Paired with `verifiedCommit`; surfaced in the `doc.verified`
   * spine event (SUITE_CONTRACTS §2) and the trust surface (Phase 2).
   */
  verifiedAt: string;
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
    const index = await readIndexAt();
    // Backward-compat: index entries written before the suite-URI fields
    // existed lack `evidence`/`refs`. Normalize them to `[]` on read so every
    // DocMetadata leaving this function carries the arrays — no downstream
    // code has to guard against `undefined`. (§1: an old doc loads fine, never
    // throws.)
    for (const d of index.docs) {
      if (!Array.isArray(d.evidence)) d.evidence = [];
      if (!Array.isArray(d.refs)) d.refs = [];
      // Drift baseline fields (Phase 1). A legacy index written before they
      // existed lacks them; normalize to "" (= never verified) so every
      // DocMetadata leaving here carries strings and `drift` can read the
      // baseline without guarding against `undefined`.
      if (typeof d.verifiedCommit !== "string") d.verifiedCommit = "";
      if (typeof d.verifiedAt !== "string") d.verifiedAt = "";
      // Validated anchors (Phase 1). A legacy index written before they existed
      // lacks the field; normalize to [] and re-validate any present entries so
      // a hand-edited/garbage anchor never reaches drift as a malformed object.
      d.anchors = Array.isArray(d.anchors)
        ? d.anchors.map(normalizeAnchor).filter((a): a is DocAnchor => a !== null)
        : [];
    }
    return index;
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
 * Serialize a frontmatter STRING value as a single-line, valid-JSON string.
 * `JSON.stringify` escapes embedded quotes, backslashes, and newlines (`\n`),
 * so a value that would otherwise break the line-based YAML block — or produce
 * invalid JSON the frontend can't parse — round-trips losslessly and stays on
 * one physical line.
 */
function serializeFmScalar(value: string): string {
  return JSON.stringify(value);
}

/**
 * Serialize a frontmatter ARRAY as a single-line, valid-JSON array using the
 * human-friendly `", "` separator. Each element is JSON-encoded so opaque suite
 * URIs (§1 rule 2) and free-text tags containing a comma, a double-quote, a
 * backslash, a `]`, or a newline survive the .mdx round-trip VERBATIM. The
 * result is valid JSON, so both this module's `parseFmArray` and the frontend's
 * `JSON.parse` reader round-trip it identically.
 */
function serializeFmArray(arr: string[]): string {
  return `[${arr.map((v) => JSON.stringify(v)).join(", ")}]`;
}

/**
 * Decode a frontmatter STRING value. Prefers a valid-JSON string (the format
 * `serializeFmScalar` writes); falls back to bare quote-stripping for legacy
 * files written before JSON encoding, or any malformed value.
 */
function parseFmScalar(value: string): string {
  const v = value.trim();
  if (v.startsWith('"')) {
    try {
      const parsed = JSON.parse(v);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Legacy / malformed — fall through to quote-strip.
    }
  }
  return v.replace(/^["']|["']$/g, "");
}

/**
 * Decode a frontmatter ARRAY value. Prefers valid JSON (what `serializeFmArray`
 * writes) so opaque values with commas/quotes/backslashes survive; falls back to
 * the legacy comma-split for arrays written before JSON encoding (e.g.
 * single-quoted values). Always returns an array (never undefined).
 */
function parseFmArray(value: string): string[] {
  const v = value.trim();
  if (v.startsWith("[")) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    } catch {
      // Legacy single-quoted / malformed array — fall through to comma-split.
    }
  }
  const arrayMatch = v.match(/\[(.*)\]/);
  if (arrayMatch) {
    return arrayMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter((s) => s);
  }
  return [];
}

/**
 * Coerce an unknown value into a well-formed `DocAnchor`, or `null` if it can't
 * be one. Central validator for anchors arriving from ANY untrusted edge — a
 * hand-edited `_index.json`, hand-written frontmatter, or an MCP tool payload —
 * so the rest of the system only ever sees `{file, symbol?, lines?}` in canonical
 * shape (`file` a non-empty string; `lines` a sorted 2-tuple of numbers).
 */
export function normalizeAnchor(x: unknown): DocAnchor | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.file !== "string" || o.file.length === 0) return null;
  const anchor: DocAnchor = { file: o.file };
  if (typeof o.symbol === "string" && o.symbol.length > 0) anchor.symbol = o.symbol;
  if (
    Array.isArray(o.lines) &&
    o.lines.length === 2 &&
    typeof o.lines[0] === "number" &&
    typeof o.lines[1] === "number" &&
    Number.isFinite(o.lines[0]) &&
    Number.isFinite(o.lines[1])
  ) {
    const a = o.lines[0] as number;
    const b = o.lines[1] as number;
    anchor.lines = a <= b ? [a, b] : [b, a];
  }
  return anchor;
}

/**
 * Serialize an anchor array as a single-line, valid-JSON array for frontmatter.
 * Objects (unlike the string arrays `serializeFmArray` handles) round-trip as
 * plain JSON so `parseAnchors` / the frontend `JSON.parse` reader both decode it
 * identically. Each entry is re-normalized so only canonical anchors are written.
 */
function serializeAnchors(anchors: DocAnchor[]): string {
  const clean = anchors.map(normalizeAnchor).filter((a): a is DocAnchor => a !== null);
  return JSON.stringify(clean);
}

/**
 * Decode a frontmatter anchors value (the single-line JSON `serializeAnchors`
 * writes). Any malformed entry is dropped, never thrown — an absent/garbage
 * field yields `[]`, matching the evidence/refs "always an array" contract.
 */
export function parseAnchors(value: string): DocAnchor[] {
  const v = value.trim();
  if (!v.startsWith("[")) return [];
  try {
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeAnchor).filter((a): a is DocAnchor => a !== null);
  } catch {
    return [];
  }
}

/**
 * The effective drift anchors for a doc: its structured `anchors` UNION a
 * file-level anchor for every `relatedFiles` path not already covered by an
 * anchor's `file`. This is the single place the two anchoring styles reconcile,
 * so drift logic (src/drift.ts) reads ONE list:
 *
 *   - A legacy doc (relatedFiles only, no anchors) → one file-level anchor per
 *     relatedFile → IDENTICAL to the pre-anchor file-level drift behavior.
 *   - A doc that upgrades a file to a symbol anchor (adds `{file, symbol}`) is
 *     NOT also given a redundant file-level anchor for that same file — the
 *     precise anchor supersedes it (otherwise symbol precision would be drowned
 *     by whole-file drift). `relatedFiles` paths for OTHER files still anchor.
 */
export function effectiveAnchors(
  meta: Pick<DocMetadata, "anchors" | "relatedFiles">,
): DocAnchor[] {
  const anchors: DocAnchor[] = Array.isArray(meta.anchors)
    ? meta.anchors.map(normalizeAnchor).filter((a): a is DocAnchor => a !== null)
    : [];
  const anchoredFiles = new Set(anchors.map((a) => a.file));
  const related = Array.isArray(meta.relatedFiles) ? meta.relatedFiles : [];
  for (const f of related) {
    if (typeof f === "string" && f.length > 0 && !anchoredFiles.has(f)) {
      anchors.push({ file: f });
      anchoredFiles.add(f);
    }
  }
  return anchors;
}

/**
 * Surgically set frontmatter SCALAR fields in a raw .mdx string, PRESERVING the
 * document body verbatim.
 *
 * Unlike updateDoc's path (parseMdx → blocksToMdx), which re-serializes the body
 * through the simplified block parser and can mangle rich MDX (the known lossy
 * round-trip debt), this rewrites ONLY the requested `key: value` lines inside
 * the leading `---` frontmatter block and leaves every body byte untouched.
 * `catryna verify` uses it so recording a drift baseline never risks the doc's
 * prose. Each value is JSON-encoded (serializeFmScalar) so it stays on one
 * physical line and round-trips through parseMdx / the frontend reader.
 *
 * A key already present is replaced in place; a missing key is appended to the
 * frontmatter block. If the file has no frontmatter block at all, the content is
 * returned unchanged (the index stays the queryable source of truth).
 */
export function setFrontmatterScalars(content: string, fields: Record<string, string>): string {
  const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---\n)/);
  if (!fmMatch) return content;
  const [, open, body, close] = fmMatch;
  const lines = body.split("\n");
  for (const [key, value] of Object.entries(fields)) {
    const encoded = `${key}: ${serializeFmScalar(value)}`;
    const idx = lines.findIndex((l) => l === `${key}:` || l.startsWith(`${key}: `));
    if (idx === -1) lines.push(encoded);
    else lines[idx] = encoded;
  }
  return open + lines.join("\n") + close + content.slice(fmMatch[0].length);
}

/**
 * Convert blocks to MDX content with frontmatter
 */
function blocksToMdx(metadata: DocMetadata, blocks: Block[]): string {
  // Create YAML frontmatter. Free-text / opaque fields are JSON-encoded so any
  // value round-trips losslessly and the on-disk frontmatter is always valid
  // JSON (see serializeFmScalar / serializeFmArray).
  const frontmatter = `---
id: ${metadata.id}
title: ${serializeFmScalar(metadata.title)}
path: "${metadata.path}"
tags: ${serializeFmArray(metadata.tags)}
relatedFiles: ${serializeFmArray(metadata.relatedFiles)}
anchors: ${serializeAnchors(metadata.anchors ?? [])}
evidence: ${serializeFmArray(metadata.evidence ?? [])}
refs: ${serializeFmArray(metadata.refs ?? [])}
verifiedCommit: ${serializeFmScalar(metadata.verifiedCommit ?? "")}
verifiedAt: ${serializeFmScalar(metadata.verifiedAt ?? "")}
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
    case "raw":
      // A source line captured verbatim by parseMdx (e.g. a single-line
      // <ReactFlow …/> / <Table …/> component). Re-emit it exactly, unchanged,
      // so the parse → re-serialize round-trip is byte-faithful.
      return String(block.data.content || "");
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
 * Parse MDX file back to metadata and blocks. Exported so the frontmatter
 * round-trip (serialize → parse) is directly testable.
 */
export function parseMdx(content: string): { metadata: Partial<DocMetadata>; blocks: Block[] } {
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
        if (
          key === "id" ||
          key === "title" ||
          key === "path" ||
          key === "createdBy" ||
          key === "verifiedCommit" ||
          key === "verifiedAt"
        ) {
          metadata[key] = parseFmScalar(value);
        } else if (key === "tags" || key === "relatedFiles" || key === "evidence" || key === "refs") {
          // Parse array: ["a", "b"]. `evidence`/`refs` hold suite URIs stored
          // opaquely (§1 rule 2) — decoded as plain strings, never validated.
          // JSON-decoded so commas/quotes/backslashes inside a value survive.
          metadata[key] = parseFmArray(value);
        } else if (key === "anchors") {
          // Validated anchors — a single-line JSON array of {file, symbol?,
          // lines?} objects (Phase 1). Malformed entries are dropped, not fatal.
          metadata.anchors = parseAnchors(value);
        } else if (key === "createdAt" || key === "updatedAt") {
          metadata[key] = parseInt(value, 10);
        }
      }
    }
  }

  // Parse body into blocks.
  //
  // FIDELITY CONTRACT: this parse feeds updateDoc's metadata-only path, which
  // preserves existing content by re-serializing these blocks through
  // blocksToMdx/blockToMdx. So the parse MUST group and reconstruct blocks such
  // that blockToMdx re-emits byte-identical body text — otherwise a title-only
  // update churns the .mdx (blank lines injected, callouts split). Two multi-line
  // constructs need care:
  //   1. A `<Callout …>…</Callout>` spanning several lines is reconstructed as a
  //      SINGLE `callout` block whose inner content is joined with "\n", exactly
  //      mirroring blockToMdx's `<Callout type="…">\n${content}\n</Callout>` emit.
  //   2. Consecutive prose lines are grouped into ONE `text` block (joined with
  //      "\n") rather than one block per line, so a wrapped paragraph round-trips
  //      as a single block instead of exploding with blank lines between lines.
  // See src/roundtrip.test.ts.
  const blocks: Block[] = [];
  const lines = body.trim().split("\n");

  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeContent: string[] = [];

  let inCallout = false;
  let calloutType = "info";
  let calloutContent: string[] = [];

  // Pending prose lines for the current paragraph. Flushed as one `text` block
  // (joined with "\n") at the next blank line, structural line, or EOF.
  let textBuffer: string[] = [];
  const flushText = () => {
    if (textBuffer.length > 0) {
      blocks.push({ type: "text", data: { content: textBuffer.join("\n") } });
      textBuffer = [];
    }
  };
  const flushCode = () => {
    if (codeBlockLang === "mermaid") {
      blocks.push({ type: "mermaid", data: { content: codeContent.join("\n") } });
    } else {
      blocks.push({ type: "code", data: { language: codeBlockLang, content: codeContent.join("\n") } });
    }
  };

  for (const line of lines) {
    // Inside a fenced code block: collect verbatim until the closing fence.
    if (inCodeBlock) {
      if (line.startsWith("```")) {
        flushCode();
        inCodeBlock = false;
        codeBlockLang = "";
        codeContent = [];
      } else {
        codeContent.push(line);
      }
      continue;
    }

    // Inside a multi-line callout: collect raw lines until the closing tag, then
    // reconstruct ONE callout block (content joined with "\n" to match blockToMdx).
    if (inCallout) {
      if (line.includes("</Callout>")) {
        const beforeClose = line.replace("</Callout>", "");
        if (beforeClose.trim()) calloutContent.push(beforeClose);
        blocks.push({ type: "callout", data: { type: calloutType, content: calloutContent.join("\n") } });
        inCallout = false;
        calloutContent = [];
      } else {
        calloutContent.push(line);
      }
      continue;
    }

    // Opening code fence.
    if (line.startsWith("```")) {
      flushText();
      inCodeBlock = true;
      codeBlockLang = line.slice(3).trim();
      codeContent = [];
      continue;
    }

    // Callout — single-line (`<Callout …>text</Callout>`) or the start of a
    // multi-line one. Reconstructed as a `callout` block either way.
    if (line.startsWith("<Callout")) {
      flushText();
      const typeMatch = line.match(/type="(\w+)"/);
      calloutType = typeMatch ? typeMatch[1] : "info";
      if (line.includes("</Callout>")) {
        const content = line.replace(/<Callout[^>]*>/, "").replace("</Callout>", "").trim();
        blocks.push({ type: "callout", data: { type: calloutType, content } });
      } else {
        inCallout = true;
        calloutContent = [];
        const afterTag = line.replace(/<Callout[^>]*>/, "");
        if (afterTag.trim()) calloutContent.push(afterTag);
      }
      continue;
    }

    // Heading.
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushText();
      blocks.push({ type: "heading", data: { level: headingMatch[1].length, content: headingMatch[2] } });
      continue;
    }

    // Divider.
    if (line === "---") {
      flushText();
      blocks.push({ type: "divider", data: {} });
      continue;
    }

    // Single-line MDX components. blockToMdx emits each on one line; preserve the
    // line verbatim as `raw` (blockToMdx's `raw` case re-emits it unchanged).
    if (line.startsWith("<CodeEmbed") || line.startsWith("<ReactFlow") ||
        line.startsWith("<Whiteboard") || line.startsWith("<Table")) {
      flushText();
      blocks.push({ type: "raw", data: { content: line } });
      continue;
    }

    // Stray closing tags on their own line (defensive — a well-formed multi-line
    // callout is already consumed above; this drops orphans without emitting text).
    if (line.trim() === "</Callout>" || line.trim() === "</ReactFlow>" || line.trim() === "</Whiteboard>") {
      continue;
    }

    // Blank line: paragraph boundary — flush the current prose block.
    if (!line.trim()) {
      flushText();
      continue;
    }

    // Regular prose — accumulate into the current paragraph.
    textBuffer.push(line);
  }

  // Flush any construct still open at EOF.
  flushText();
  if (inCallout) {
    blocks.push({ type: "callout", data: { type: calloutType, content: calloutContent.join("\n") } });
  }
  if (inCodeBlock) {
    flushCode();
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
  relatedFiles: string[] = [],
  // Suite URIs, stored opaquely (SUITE_CONTRACTS §1). Trailing + optional so
  // existing positional callers (e.g. src/tools/diagrams.ts) are unaffected.
  evidence: string[] = [],
  refs: string[] = [],
  // Validated anchors (Phase 1). Trailing + optional so existing positional
  // callers are unaffected; each entry is normalized so only canonical anchors
  // are persisted.
  anchors: DocAnchor[] = []
): Promise<DocMetadata> {
  await ensureDocsFolder();

  const now = Date.now();
  const metadata: DocMetadata = {
    id: crypto.randomUUID(),
    path,
    title,
    tags,
    relatedFiles,
    anchors: anchors.map(normalizeAnchor).filter((a): a is DocAnchor => a !== null),
    evidence,
    refs,
    // A fresh doc has no verification baseline: it has never been confirmed
    // against code. `catryna verify` sets these later. "" = never verified.
    verifiedCommit: "",
    verifiedAt: "",
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
  // Enforce the "at most one entry per path" invariant IN the lock: two
  // concurrent createDoc("x") each load a fresh index and would otherwise both
  // push, leaving two entries for "x" (getDoc/updateDoc/deleteDoc then see only
  // the first, dangling the second). Replace an existing same-path entry instead.
  await withIndexLock(async () => {
    const index = await loadIndex();
    const existingIdx = index.docs.findIndex(d => d.path === path);
    if (existingIdx === -1) {
      index.docs.push(metadata);
    } else {
      index.docs[existingIdx] = metadata;
    }
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
    // Validated anchors (Phase 1). "Only if provided" semantics, like
    // tags/relatedFiles: omitting preserves the existing value; entries are
    // normalized so a malformed anchor can't be written.
    anchors?: DocAnchor[];
    // Suite URIs, stored opaquely (§1). "Only if provided" semantics, like
    // tags/relatedFiles: omitting a field preserves the existing value.
    evidence?: string[];
    refs?: string[];
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
    if (updates.anchors) {
      m.anchors = updates.anchors
        .map(normalizeAnchor)
        .filter((a): a is DocAnchor => a !== null);
    }
    if (updates.evidence) m.evidence = updates.evidence;
    if (updates.refs) m.refs = updates.refs;

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
 * Record that a doc was VERIFIED against a git commit — the drift baseline
 * (PRODUCT_ROADMAP Phase 1). Sets `verifiedCommit` + `verifiedAt` in BOTH the
 * index (the queryable source `catryna drift` reads) and the .mdx frontmatter,
 * then emits `doc.verified` on the suite spine (§2, best-effort).
 *
 * Deliberately does NOT touch `updatedAt`: verification asserts "this doc still
 * matches the code at commit X", which is orthogonal to editing its prose. The
 * frontmatter write is SURGICAL (setFrontmatterScalars) so it preserves the body
 * verbatim — verifying a rich doc never risks the lossy block round-trip.
 *
 * Returns the updated metadata, or null if no doc has that `path`.
 */
export async function recordVerification(
  path: string,
  commit: string,
  verifiedAt: string,
): Promise<DocMetadata | null> {
  const meta = await withIndexLock<DocMetadata | null>(async () => {
    const index = await loadIndex();
    const i = index.docs.findIndex((d) => d.path === path);
    if (i === -1) return null;

    const m = { ...index.docs[i] };
    m.verifiedCommit = commit;
    m.verifiedAt = verifiedAt;

    // Surgically rewrite the .mdx frontmatter, body untouched. Best-effort on
    // the file: the index is the source of truth for these fields, so a
    // missing/unreadable .mdx still records the baseline in the index.
    try {
      const raw = await readFile(docPathToFilePath(path), "utf-8");
      await writeFile(
        docPathToFilePath(path),
        setFrontmatterScalars(raw, { verifiedCommit: commit, verifiedAt }),
      );
    } catch {
      // File gone/unreadable — the index entry below still carries the baseline.
    }

    index.docs[i] = m;
    await saveIndex(index);
    return m;
  });

  if (!meta) return null;

  // Durable in our store — announce it (§2, best-effort; trust = "verified").
  await emitEvent("doc.verified", [docUri(path)], {
    path,
    verifiedAt: meta.verifiedAt,
    trust: "verified",
  });

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
