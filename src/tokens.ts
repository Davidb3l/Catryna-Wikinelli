/**
 * COMPUTED-FACT TOKENS (CAT-2) — docs carry the QUERY, not the answer.
 *
 * Some volatile facts genuinely belong in a doc: a line count, a file count, a
 * version. Written as a literal number they rot the moment the code moves, and
 * drift can never catch it because no anchor spans "the whole repo" (that is
 * CAT-1's whole premise). The fix is to store the QUESTION and answer it at read
 * time:
 *
 *     {{count: src/*.rs}}        → how many files match the glob
 *     {{loc: src/}}              → total line count under a path/glob
 *     {{version: Cargo.toml}}    → the version field parsed from a manifest
 *
 * Both the viewer and MCP `get_doc` evaluate these on every read, so the shown
 * value is regenerated from the live tree and CANNOT go stale by construction.
 *
 * ## The security posture (the reason the vocabulary is tiny)
 *
 * A doc is DATA, authored by anyone, and letting data run commands is an
 * injection surface. So this is NOT a shell: it is three read-only filesystem
 * queries over an explicit allowlist, and every one is CONTAINED to the project
 * root — a token can never read, glob, or escape above it (`{{loc: ../../etc}}`
 * resolves to a containment error, not a file read). Work is bounded (file count
 * and total bytes capped, heavy dirs skipped) so a `{{loc: /}}`-shaped query
 * can't wedge a read. Extend the vocabulary only by explicit allowlist here.
 *
 * ## Graceful degradation (agents Read .mdx directly)
 *
 * A failed query renders the RAW `{{…}}` token verbatim — never a stale cached
 * number, never a crash. The raw form is self-describing, so a plain-file read
 * (an agent Reading `.docs/x.mdx`) still shows the intent even though no
 * evaluator ran. CAT-1's `volatile-fact` lint treats a token as the CORRECT
 * form and never warns on it, so the two rules teach the same habit.
 *
 * `cwd`/`root` is injected everywhere (never `process.cwd()` directly), so the
 * viewer (whose root is switchable at runtime) and the MCP server agree.
 */
import { readFile, readdir, stat, realpath } from "node:fs/promises";
import { join, resolve, sep, dirname, basename } from "node:path";

/**
 * The token grammar — the SINGLE source of truth for the syntax, reused by
 * CAT-1's lint (which must stay silent on it) so the form lint blesses and the
 * form the evaluator runs can never diverge. Capture 1 = kind, capture 2 = arg.
 * `g` + `i`: callers using `.exec`/`.replace` iterate all matches; a `.test`
 * caller must reset `lastIndex`.
 */
export const COMPUTED_TOKEN_RE = /\{\{\s*(count|loc|version)\s*:\s*([^}]*)\}\}/gi;

export type TokenKind = "count" | "loc" | "version";

/** The outcome of evaluating one token. `ok:false` → the raw token is kept. */
export interface TokenResult {
  ok: boolean;
  value?: string;
  error?: string;
}

// Bounds — a token must never be able to wedge a read, and must never answer
// with a number it isn't sure of. Exceeding any of these fails the token (→ the
// raw form) rather than returning a truncated count: a confidently-wrong
// repo-wide number is the exact failure this whole feature exists to prevent.
const MAX_FILES = 5000;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/** Longest token argument accepted — the first ReDoS bound. */
const MAX_GLOB_LEN = 256;
/** Most `*`/`?` wildcards accepted in one argument — the second ReDoS bound. */
const MAX_GLOB_WILDCARDS = 16;
/** Directories never walked: build output, VCS, deps, and the suite's own dirs. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "target",
  ".next",
  ".cache",
  ".turbo",
  "coverage",
  ".docs",
  ".suite",
  ".ametrite",
  ".sirius",
  ".hayven",
]);

/** Escape a string for literal use inside a RegExp (glob non-wildcard chars). */
function escapeRe(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split a glob arg into its longest non-glob directory PREFIX (where the walk
 * starts) and a RegExp that matches a candidate path relative to that prefix.
 *
 * `src/*.rs`     → base `src`, matches `foo.rs` (one segment, non-recursive)
 * `src/` + star-star + `/*.rs` → base `src`, matches `a/b/foo.rs` (recursive)
 * `src/`         → base `src`, a bare dir means everything under it, recursively
 * `Cargo.toml`   → base `.`,   matches exactly `Cargo.toml`
 */
function compileGlob(arg: string): { base: string; re: RegExp } | null {
  // ReDoS GUARD. Each `**/` compiles to `(?:.*/)?`, and nested optional greedy
  // stars backtrack exponentially: an arg of `d/` + `**/`×14 + `zzz` took ~6s to
  // match, ×24 never finished, and because matching is synchronous JS it wedged
  // the whole event loop — starving every other request on the viewer, which is
  // reachable on 0.0.0.0. The caps below make that unreachable:
  //   1. collapse runs of `**/` to one (semantically identical — "any depth"
  //      twice is still "any depth") which removes the nesting entirely;
  //   2. bound the argument length and the wildcard count outright.
  // Note MAX_FILES/MAX_TOTAL_BYTES bound the WALK, never the MATCH, so this
  // guard is the only thing standing between a doc and a hung server.
  if (arg.length > MAX_GLOB_LEN) return null;
  const collapsed = arg.replace(/(?:\*\*\/)+/g, "**/");
  if ((collapsed.match(/[*?]/g) ?? []).length > MAX_GLOB_WILDCARDS) return null;

  const cleaned = collapsed.replace(/\/+$/, (m) => (m ? "/**" : "")); // trailing "/" = recurse
  const parts = cleaned.split("/");
  const baseParts: string[] = [];
  let i = 0;
  for (; i < parts.length; i++) {
    if (/[*?]/.test(parts[i])) break;
    baseParts.push(parts[i]);
  }
  // A pure path with no glob and no trailing slash: the "pattern" is empty and
  // we match the single leaf exactly (handled by the caller via a file check).
  const globParts = parts.slice(i);
  const base = baseParts.join("/") || ".";

  // Build the regex from the glob remainder, relative to `base`.
  const pattern = globParts.length ? globParts.join("/") : basename(base);
  let re = "";
  for (let k = 0; k < pattern.length; k++) {
    if (pattern.startsWith("**/", k)) {
      re += "(?:.*/)?"; // zero or more directories
      k += 2;
    } else if (pattern.startsWith("**", k)) {
      re += ".*";
      k += 1;
    } else if (pattern[k] === "*") {
      re += "[^/]*";
    } else if (pattern[k] === "?") {
      re += "[^/]";
    } else {
      re += escapeRe(pattern[k]);
    }
  }
  return { base, re: new RegExp(`^${re}$`) };
}

/**
 * Resolve `rel` under `root`, or `null` if it escapes — the containment guard.
 *
 * TWO checks, and the second is the one that matters. The textual check
 * (`resolve` + prefix) rejects `..` and absolute paths, but `path.resolve` does
 * NOT resolve symlinks, so a committed symlink (`vendor -> /`) plus one `.mdx`
 * walked straight out of the root and `{{version: vendor/etc/…}}` leaked file
 * CONTENT off the machine — over the network, since the viewer binds 0.0.0.0.
 * `.docs/` is git-shared and git stores symlinks, so that was a one-PR exploit.
 *
 * So the real containment is done on REALPATHS. A path that does not exist yet
 * cannot be realpath'd, so we realpath its nearest existing ancestor instead and
 * require THAT to stay inside — a nonexistent leaf under a contained directory
 * is safe, while a nonexistent leaf under a symlinked one is not.
 */
async function containedResolve(root: string, rel: string): Promise<string | null> {
  if (rel.startsWith("/") || rel.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(rel)) {
    return null; // absolute
  }
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, rel);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) return null; // textual `..`

  let rootReal: string;
  try {
    rootReal = await realpath(rootAbs);
  } catch {
    return null; // no root, nothing is contained
  }

  // Realpath the deepest existing ancestor of `abs` (usually `abs` itself).
  let probe = abs;
  for (;;) {
    try {
      const real = await realpath(probe);
      if (real !== rootReal && !real.startsWith(rootReal + sep)) return null;
      return abs;
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return null; // walked past the filesystem root
      probe = parent;
    }
  }
}

/**
 * Every file under `baseAbs`, as paths relative to `baseAbs`.
 *
 * `truncated` is the important half of the return: hitting MAX_FILES used to
 * return a SHORT list that the caller happily reported as the answer, so a
 * 6,000-file tree rendered a confident "5000" that never changed as the repo
 * grew — strictly worse than the literal number the token replaced. Callers
 * must fail the token when this is set.
 *
 * Symlinked entries are skipped: a `Dirent` for a symlink reports neither
 * `isFile()` nor `isDirectory()`, so a symlinked subdirectory is never
 * descended into (no escape, and no infinite loop on a self-referential link).
 */
async function walkFiles(baseAbs: string): Promise<{ files: string[]; truncated: boolean }> {
  const out: string[] = [];
  let truncated = false;
  async function walk(dir: string, rel: string): Promise<void> {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(join(dir, e.name), childRel);
        if (truncated) return;
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  }
  await walk(baseAbs, "");
  return { files: out, truncated };
}

/**
 * Files matching `arg`, contained to `root`, returned as ROOT-relative paths.
 *
 * Three shapes: a glob (`src/*.rs`), a plain file (`README.md` → itself), and a
 * directory (`src` or `src/` → every file under it, recursively). Returns `null`
 * only for a CONTAINMENT failure (escape/absolute); a path that simply doesn't
 * exist yields `[]` (a legitimate count of zero).
 */
async function matchFiles(root: string, arg: string): Promise<string[] | null> {
  const trimmed = arg.trim();
  if (!trimmed || trimmed.length > MAX_GLOB_LEN) return null;
  // Reject absolute forms BEFORE any normalization: stripping a trailing slash
  // first turned "/" into "" and slipped past the absolute check, which then
  // produced paths like "/src/a.rs" that every later resolve rejected — so
  // `{{loc: /}}` rendered a silent, confident "0".
  if (trimmed.startsWith("/") || trimmed.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return null;
  }

  // Plain path (no wildcard): a file matches itself; a directory recurses.
  if (!/[*?]/.test(trimmed)) {
    // "./" and "." both mean the root; an empty `clean` would mean "" and
    // silently mis-prefix every result.
    const clean = trimmed.replace(/^\.\//, "").replace(/\/+$/, "") || ".";
    const abs = await containedResolve(root, clean);
    if (!abs) return null;
    let st;
    try {
      st = await stat(abs);
    } catch {
      // A PLAIN path that doesn't exist is a typo, not an empty result — fail so
      // the token renders raw. (`{{count: …}}` with a literal ellipsis used to
      // render a confident "0".) A GLOB matching nothing is still a real 0,
      // handled on the glob branch below.
      return null;
    }
    if (st.isFile()) return [clean];
    const { files, truncated } = await walkFiles(abs);
    if (truncated) return null;
    return files.map((r) => (clean === "." ? r : `${clean}/${r}`));
  }

  const compiled = compileGlob(trimmed);
  if (!compiled) return null; // over the ReDoS bounds
  const { base, re } = compiled;
  const baseAbs = await containedResolve(root, base);
  if (!baseAbs) return null;
  const { files, truncated } = await walkFiles(baseAbs);
  if (truncated) return null;
  return files
    .filter((r) => re.test(r))
    .map((r) => (base === "." ? r : `${base}/${r}`));
}

/**
 * Parse a version string from a manifest file's text.
 *
 * TOML is SECTION-AWARE, and that is not a nicety: taking the first
 * line-anchored `version = "…"` reported a DEPENDENCY's version as the
 * project's whenever a `[dependencies.x]` or `[workspace.dependencies]` table
 * appeared before `[package]` — which cargo accepts. A wrong number presented as
 * authoritative is the one thing this module promises never to produce, so the
 * `[package]`/`[project]`/`[tool.poetry]` table wins, and the loose first-match
 * fallback applies only to a file with no recognizable table at all.
 */
function parseVersion(file: string, text: string): string | null {
  const name = basename(file).toLowerCase();
  if (name.endsWith(".json")) {
    try {
      const v = JSON.parse(text)?.version;
      // A numeric version (`"version": 3`) is a legitimate manifest value;
      // stringify rather than failing to raw.
      if (typeof v === "string") return v || null;
      if (typeof v === "number") return String(v);
      return null;
    } catch {
      return null;
    }
  }

  // TOML: walk tables, and only accept `version` inside a package-ish one.
  const VERSION_LINE = /^\s*version\s*=\s*["']([^"']+)["']/;
  const TABLE_LINE = /^\s*\[\s*([^\]]+?)\s*\]\s*$/;
  const PACKAGE_TABLES = new Set(["package", "project", "tool.poetry"]);
  let table = "";
  let sawTable = false;
  for (const line of text.split("\n")) {
    const t = line.match(TABLE_LINE);
    if (t) {
      table = t[1].trim();
      sawTable = true;
      continue;
    }
    const v = line.match(VERSION_LINE);
    if (v && PACKAGE_TABLES.has(table)) return v[1];
  }
  // No table structure at all (a plain `version = "x"` file) — accept the first.
  if (!sawTable) {
    const m = text.match(new RegExp(VERSION_LINE.source, "m"));
    return m ? m[1] : null;
  }
  return null;
}

/** Evaluate one token against `root`. Never throws — failure is a result. */
export async function evaluateToken(
  kind: TokenKind,
  arg: string,
  root: string,
): Promise<TokenResult> {
  const a = arg.trim();
  if (!a) return { ok: false, error: "empty argument" };

  if (kind === "version") {
    const abs = await containedResolve(root, a);
    if (!abs) return { ok: false, error: "path escapes project root" };
    let text: string;
    try {
      text = await readFile(abs, "utf-8");
    } catch {
      return { ok: false, error: `cannot read ${a}` };
    }
    const v = parseVersion(a, text);
    return v ? { ok: true, value: v } : { ok: false, error: `no version field in ${a}` };
  }

  const files = await matchFiles(root, a);
  // null = refused: escaped the root, or exceeded a bound. Either way the token
  // must FAIL (render raw) rather than answer with a partial number.
  if (files === null) {
    return { ok: false, error: "query refused (outside project root, or too large)" };
  }

  if (kind === "count") {
    return { ok: true, value: String(files.length) };
  }

  // loc: sum line counts, bounded by total bytes.
  let total = 0;
  let bytes = 0;
  for (const f of files) {
    const abs = await containedResolve(root, f);
    if (!abs) continue;
    // Check the size BEFORE reading: checking after meant the cap never guarded
    // the first file and could be overshot by one arbitrarily large file on
    // every iteration, so a single huge file could still blow memory.
    try {
      const st = await stat(abs);
      if (bytes + st.size > MAX_TOTAL_BYTES) {
        return { ok: false, error: "loc query exceeds size cap" };
      }
      bytes += st.size;
    } catch {
      continue;
    }
    let text: string;
    try {
      text = await readFile(abs, "utf-8");
    } catch {
      continue;
    }
    // Line count: newline count, plus one for a final line without a trailing
    // newline. An empty file is 0 lines. CRLF is counted the same as LF, since
    // the "\n" split is unaffected by the preceding "\r".
    if (text.length === 0) continue;
    total += text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  }
  return { ok: true, value: String(total) };
}

/**
 * Character ranges of `text` that are CODE — fenced blocks and inline code
 * spans — and must therefore be left alone.
 *
 * A doc that documents this feature necessarily writes the token syntax as a
 * literal, and substituting there destroys the very reference the reader came
 * for. That is not hypothetical: before this guard, `features/computed-facts`
 * rendered its own syntax table as `| 28 | how many files match the glob | …`,
 * and the sentence explaining that a raw token survives a plain-file read
 * rendered as "sees the raw `0` form". `catryna lint` already reads code spans
 * as text (`stripCode`), so without this the two halves of the feature disagreed
 * about what a code span means.
 *
 * Handles ``` / ~~~ fences (marker-matched, length-aware, per CommonMark) and
 * inline spans of any backtick run length.
 */
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const lines = text.split("\n");
  let offset = 0;
  let fenceMarker: string | null = null;
  let fenceWidth = 0;

  for (const line of lines) {
    const start = offset;
    const end = offset + line.length;
    offset = end + 1; // + newline

    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fenceMarker === null) {
      if (fence) {
        const marker = fence[1][0];
        if (!(marker === "`" && fence[2].includes("`"))) {
          fenceMarker = marker;
          fenceWidth = fence[1].length;
          ranges.push([start, end]);
          continue;
        }
      }
    } else {
      ranges.push([start, end]); // inside a fence: the whole line is code
      if (
        fence &&
        fence[1][0] === fenceMarker &&
        fence[1].length >= fenceWidth &&
        fence[2].trim() === ""
      ) {
        fenceMarker = null;
      }
      continue;
    }

    // Prose line: mark inline code spans. A span opens on a run of N backticks
    // and closes on the next run of exactly N.
    const spanRe = /(`+)(?:[^`]|(?!\1)`)*?\1/g;
    let s: RegExpExecArray | null;
    while ((s = spanRe.exec(line)) !== null) {
      ranges.push([start + s.index, start + s.index + s[0].length]);
    }
  }
  return ranges;
}

/** One token that was actually rendered, and where its value landed. */
interface RenderedOccurrence {
  /** The verbatim token, e.g. `{{count: src/*.ts}}`. */
  raw: string;
  /** What it evaluated to, e.g. `28`. */
  value: string;
  /** Bounds of `value` in the RENDERED text (not the source). */
  renderedStart: number;
  renderedEnd: number;
}

/**
 * Render tokens AND report where each value landed — the inverse map
 * `retokenize` needs to put the queries back.
 */
async function renderWithMap(
  text: string,
  root: string,
): Promise<{ rendered: string; occurrences: RenderedOccurrence[] }> {
  if (!text || !text.includes("{{")) return { rendered: text, occurrences: [] };

  const protectedRanges = codeRanges(text);
  const isProtected = (i: number) =>
    protectedRanges.some(([a, b]) => i >= a && i < b);

  // Collect the tokens we will actually render (skipping code), evaluating each
  // distinct (kind, arg) once.
  const hits: Array<{ start: number; end: number; key: string; raw: string }> = [];
  const jobs = new Map<string, { kind: TokenKind; arg: string }>();
  COMPUTED_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMPUTED_TOKEN_RE.exec(text)) !== null) {
    if (isProtected(m.index)) continue;
    const kind = m[1].toLowerCase() as TokenKind;
    const arg = m[2];
    const key = `${kind}:${arg}`;
    jobs.set(key, { kind, arg });
    hits.push({ start: m.index, end: m.index + m[0].length, key, raw: m[0] });
  }
  if (hits.length === 0) return { rendered: text, occurrences: [] };

  const values = new Map<string, string | null>();
  for (const [key, j] of jobs) {
    const r = await evaluateToken(j.kind, j.arg, root);
    values.set(key, r.ok && r.value !== undefined ? r.value : null);
  }

  // Build forward so the rendered positions come out directly.
  let out = "";
  let cursor = 0;
  const occurrences: RenderedOccurrence[] = [];
  for (const h of hits) {
    const v = values.get(h.key);
    if (v === null || v === undefined) continue; // failed → the raw token stays
    out += text.slice(cursor, h.start);
    const renderedStart = out.length;
    out += v;
    occurrences.push({ raw: h.raw, value: v, renderedStart, renderedEnd: out.length });
    cursor = h.end;
  }
  out += text.slice(cursor);
  return { rendered: out, occurrences };
}

/**
 * Replace every computed token in `text` with its evaluated value. A failed or
 * unknown token is left VERBATIM (raw, self-describing) — never a stale number.
 * Tokens inside code fences or inline code spans are left alone (see
 * `codeRanges`). Identical tokens are evaluated once.
 */
export async function renderComputedTokens(text: string, root: string): Promise<string> {
  return (await renderWithMap(text, root)).rendered;
}

/** How much surrounding text must still match for a token to be restored. */
const RETOKENIZE_CONTEXT = 24;

/**
 * Put the QUERIES back after a round-trip — the inverse of `renderComputedTokens`.
 *
 * `get_doc` hands an agent RENDERED blocks ("Has 28 files"). If the agent edits
 * the prose and calls `update_doc`, that rendered number is what gets written to
 * disk, silently converting a live token into the frozen literal it was created
 * to replace. This restores the token wherever the surrounding text shows the
 * value was carried over rather than deliberately rewritten.
 *
 * DELIBERATELY CONSERVATIVE, because a wrong restore corrupts a user's prose —
 * strictly worse than the stale number it is preventing:
 *
 *   - The exact case is handled exactly. If `newText` is byte-identical to what
 *     rendering `oldRaw` produced, the block was untouched and the original raw
 *     is returned verbatim. This is the common path and involves no guessing.
 *   - Otherwise each token is restored only where its immediately-preceding
 *     CONTEXT and its value both still appear, scanning forward in document
 *     order so repeated values can't be matched out of sequence.
 *   - Anything unmatched is LEFT ALONE. A value the agent genuinely rewrote
 *     ("28" → "30") won't match, so their edit survives as a literal rather than
 *     being silently reverted to a token that renders something else.
 *
 * Never substitutes a value that was not produced by a token in `oldRaw`, so a
 * number the agent typed can never be turned into a query.
 */
export async function retokenize(
  newText: string,
  oldRaw: string,
  root: string,
): Promise<string> {
  if (!newText || !oldRaw.includes("{{")) return newText;
  const { rendered, occurrences } = await renderWithMap(oldRaw, root);
  if (occurrences.length === 0) return newText;

  // Untouched relative to what the reader was handed → restore exactly.
  if (newText === rendered) return oldRaw;

  let out = "";
  let searchFrom = 0;
  let prevRenderedEnd = 0;
  for (const occ of occurrences) {
    // Context stops at the previous token's value so one token's restore can
    // never consume another's anchor.
    const ctxStart = Math.max(prevRenderedEnd, occ.renderedStart - RETOKENIZE_CONTEXT);
    const ctx = rendered.slice(ctxStart, occ.renderedStart);
    const needle = ctx + occ.value;
    const idx = newText.indexOf(needle, searchFrom);
    prevRenderedEnd = occ.renderedEnd;
    if (idx === -1) continue; // context changed — leave the agent's text alone
    out += newText.slice(searchFrom, idx + ctx.length);
    out += occ.raw;
    searchFrom = idx + needle.length;
  }
  out += newText.slice(searchFrom);
  return out;
}

/**
 * Restore tokens across a block list, pairing blocks BY INDEX with the doc's
 * previous blocks. Index pairing is the honest limit: an agent that reorders or
 * inserts blocks simply gets no restore for the shifted ones (their text is
 * preserved untouched), which is the safe direction to fail.
 */
export async function retokenizeBlocks(
  newBlocks: Array<{ type: string; data?: Record<string, unknown> }>,
  oldBlocks: Array<{ type: string; data?: Record<string, unknown> }>,
  root: string,
): Promise<Array<{ type: string; data?: Record<string, unknown> }>> {
  const out = [];
  for (let i = 0; i < newBlocks.length; i++) {
    const nb = newBlocks[i];
    const ob = oldBlocks[i];
    const oldContent = ob?.data?.content;
    const newContent = nb?.data?.content;
    if (
      !CODE_BLOCK_TYPES.has(nb.type) &&
      typeof oldContent === "string" &&
      typeof newContent === "string" &&
      oldContent.includes("{{")
    ) {
      out.push({
        ...nb,
        data: { ...nb.data, content: await retokenize(newContent, oldContent, root) },
      });
    } else {
      out.push(nb);
    }
  }
  return out;
}

/**
 * Block types whose content is CODE, not prose. Their text is shown verbatim to
 * the reader, so a token inside one is a literal being documented — rendering it
 * would destroy a syntax example, exactly as it did in this feature's own doc.
 */
const CODE_BLOCK_TYPES = new Set(["code", "mermaid", "react-flow", "whiteboard", "raw"]);

/**
 * Render tokens in-place across a doc's block content (the shape `get_doc`
 * returns). Only string `content` fields on PROSE blocks are touched; structure
 * is preserved and code-ish blocks pass through untouched.
 */
export async function renderTokensInBlocks(
  blocks: Array<{ type: string; data?: Record<string, unknown> }>,
  root: string,
): Promise<Array<{ type: string; data?: Record<string, unknown> }>> {
  const out = [];
  for (const b of blocks) {
    if (
      !CODE_BLOCK_TYPES.has(b.type) &&
      b.data &&
      typeof b.data.content === "string" &&
      b.data.content.includes("{{")
    ) {
      out.push({ ...b, data: { ...b.data, content: await renderComputedTokens(b.data.content, root) } });
    } else {
      out.push(b);
    }
  }
  return out;
}
