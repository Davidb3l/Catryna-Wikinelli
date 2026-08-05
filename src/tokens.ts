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
import { readFile, readdir, stat } from "node:fs/promises";
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

// Bounds — a token must never be able to wedge a read.
const MAX_FILES = 5000;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
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
function compileGlob(arg: string): { base: string; re: RegExp } {
  const cleaned = arg.replace(/\/+$/, (m) => (m ? "/**" : "")); // trailing "/" = recurse
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

/** Resolve `rel` under `root`, or `null` if it escapes (containment guard). */
function containedResolve(root: string, rel: string): string | null {
  if (rel.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(rel)) return null; // absolute
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, rel);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) return null;
  return abs;
}

/** Every file under `baseAbs` (bounded), as paths relative to `baseAbs`. */
async function walkFiles(baseAbs: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    if (out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(join(dir, e.name), childRel);
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  }
  await walk(baseAbs, "");
  return out;
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
  if (!trimmed) return null;

  // Plain path (no wildcard): a file matches itself; a directory recurses.
  if (!/[*?]/.test(trimmed)) {
    const clean = trimmed.replace(/^\.\//, "").replace(/\/+$/, "");
    const abs = containedResolve(root, clean);
    if (!abs) return null;
    let st;
    try {
      st = await stat(abs);
    } catch {
      return []; // nonexistent → zero matches, not a containment error
    }
    if (st.isFile()) return [clean];
    const rels = await walkFiles(abs);
    return rels.map((r) => (clean === "." ? r : `${clean}/${r}`));
  }

  const { base, re } = compileGlob(trimmed);
  const baseAbs = containedResolve(root, base);
  if (!baseAbs) return null;
  const rels = await walkFiles(baseAbs);
  return rels
    .filter((r) => re.test(r))
    .map((r) => (base === "." ? r : `${base}/${r}`));
}

/** Parse a version string from a manifest file's text. */
function parseVersion(file: string, text: string): string | null {
  const name = basename(file).toLowerCase();
  if (name === "package.json" || name.endsWith(".json")) {
    try {
      const v = JSON.parse(text)?.version;
      return typeof v === "string" ? v : null;
    } catch {
      return null;
    }
  }
  // TOML (Cargo.toml, pyproject.toml) or any KEY = "x" manifest: first
  // `version = "…"`. Kept deliberately simple — a real TOML parser is a
  // dependency, and the first version field is the package version in practice.
  const m = text.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
  return m ? m[1] : null;
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
    const abs = containedResolve(root, a);
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
  if (files === null) return { ok: false, error: "path escapes project root" };

  if (kind === "count") {
    return { ok: true, value: String(files.length) };
  }

  // loc: sum line counts, bounded by total bytes read.
  let total = 0;
  let bytes = 0;
  for (const f of files) {
    const abs = containedResolve(root, f);
    if (!abs) continue;
    let text: string;
    try {
      text = await readFile(abs, "utf-8");
    } catch {
      continue;
    }
    bytes += Buffer.byteLength(text);
    if (bytes > MAX_TOTAL_BYTES) {
      return { ok: false, error: "loc query exceeds size cap" };
    }
    // Line count: newline count, plus one for a final line without a trailing
    // newline. An empty file is 0 lines.
    if (text.length === 0) continue;
    total += text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  }
  return { ok: true, value: String(total) };
}

/**
 * Replace every computed token in `text` with its evaluated value. A failed or
 * unknown token is left VERBATIM (raw, self-describing) — never a stale number.
 * Identical tokens are evaluated once.
 */
export async function renderComputedTokens(text: string, root: string): Promise<string> {
  if (!text || !text.includes("{{")) return text;

  // Collect distinct (kind, arg) pairs first, evaluate each once, then replace.
  const cache = new Map<string, string>();
  const jobs: Array<{ key: string; kind: TokenKind; arg: string }> = [];
  COMPUTED_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMPUTED_TOKEN_RE.exec(text)) !== null) {
    const kind = m[1].toLowerCase() as TokenKind;
    const arg = m[2];
    const key = `${kind}:${arg}`;
    if (!cache.has(key)) {
      cache.set(key, ""); // reserve
      jobs.push({ key, kind, arg });
    }
  }
  for (const j of jobs) {
    const r = await evaluateToken(j.kind, j.arg, root);
    cache.set(j.key, r.ok && r.value !== undefined ? r.value : "");
  }

  return text.replace(COMPUTED_TOKEN_RE, (raw, k: string, arg: string) => {
    const val = cache.get(`${k.toLowerCase()}:${arg}`);
    // Empty string = evaluation failed → keep the raw token, self-describing.
    return val ? val : raw;
  });
}

/**
 * Render tokens in-place across a doc's block content (the shape `get_doc`
 * returns). Only string `content` fields are touched; structure is preserved.
 */
export async function renderTokensInBlocks(
  blocks: Array<{ type: string; data?: Record<string, unknown> }>,
  root: string,
): Promise<Array<{ type: string; data?: Record<string, unknown> }>> {
  const out = [];
  for (const b of blocks) {
    if (b.data && typeof b.data.content === "string" && b.data.content.includes("{{")) {
      out.push({ ...b, data: { ...b.data, content: await renderComputedTokens(b.data.content, root) } });
    } else {
      out.push(b);
    }
  }
  return out;
}
