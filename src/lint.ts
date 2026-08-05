/**
 * `catryna lint` — is each doc WELL-FORMED?
 *
 * This is a different question from every other command in the suite, and the
 * distinction is the point:
 *
 *   - `catryna drift`   — has the CODE outgrown this doc?
 *   - `catryna lint`    — is this doc structurally sound and honestly anchored?
 *
 * Drift can only speak about docs that anchor code, and only about whether that
 * code moved. It says nothing about a doc whose frontmatter is unparseable, whose
 * callout tags are orphaned, or whose anchors point at paths that were never
 * there. Those docs render broken or silently document nothing, and until now
 * nothing in the toolchain looked for them.
 *
 * ## Rules, and why each one exists
 *
 * Every rule below was earned by a real failure in this repo, not invented:
 *
 * - `frontmatter`     — a doc with no parseable frontmatter has no path, tags or
 *                       baseline; the index and the file disagree from then on.
 * - `unclosed-callout`— the lossy MDX round-trip left orphaned `</Callout>` tags
 *                       that render as literal text mid-document.
 * - `unclosed-fence`  — an odd number of ``` swallows the rest of the doc into a
 *                       code block.
 * - `empty-fence`     — fence BALANCE is not fence CONTENT. A doc can be
 *                       structurally perfect and almost entirely empty: one real
 *                       corpus had a doc with 12 blank fences, including the
 *                       ```mermaid block that was supposed to BE the architecture
 *                       diagram, and it passed a full repair pass reported clean
 *                       throughout. It renders as headings wrapped around blank
 *                       boxes, and only a human going looking ever found it.
 * - `missing-anchor`  — an anchor pointing at a path not on disk documents
 *                       nothing. Drift calls this `broken` ONLY once the doc has
 *                       a baseline; lint catches it immediately.
 * - `windows-anchor`  — a backslash anchor resolves to nothing on macOS/Linux,
 *                       so the doc silently stops being checked at all.
 * - `index-mismatch`  — `_index.json` and the `.mdx` frontmatter disagreeing
 *                       means one of them is lying to whoever read it first.
 * - `orphan-file`     — a `.mdx` on disk that no index entry names is invisible
 *                       to search, drift and coverage.
 * - `missing-file`    — an index entry with no `.mdx` behind it 404s in the viewer.
 *
 * ## What this deliberately does NOT do
 *
 * No prose opinions — no line length, no heading order, no spelling. Those are
 * style, and a gate that fails on style trains people to bypass the gate.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { normalizeAnchorPath, parseMdx, readIndexAt, type DocMetadata } from "./storage";

/** A single problem with a single doc. */
export interface LintIssue {
  path: string;
  rule: LintRule;
  severity: "error" | "warning";
  message: string;
  /** What to do about it, in one line. */
  hint: string;
}

/**
 * Rules about the doc's own STRUCTURE — its text is malformed, independent of
 * any code. These are the only rules `catryna verify` refuses on.
 *
 * Anchor rules are deliberately excluded: an anchor pointing at a vanished file
 * means the CODE moved, which is drift's question, and `verifyDoc` already
 * surfaces it as a `brokenAnchors` warning while still recording the baseline.
 * Blocking there would overrule an existing product decision and make
 * re-verifying after a rename impossible.
 */
export const STRUCTURAL_RULES = new Set<LintRule>([
  "frontmatter",
  "unclosed-callout",
  "unclosed-fence",
]);

export type LintRule =
  | "frontmatter"
  | "unclosed-callout"
  | "unclosed-fence"
  | "empty-fence"
  | "missing-anchor"
  | "windows-anchor"
  | "index-mismatch"
  | "orphan-file"
  | "missing-file";

export interface LintReport {
  issues: LintIssue[];
  /** Docs examined (index entries plus any orphaned files found). */
  checked: number;
  errors: number;
  warnings: number;
  error?: string;
}

/**
 * Strip fenced blocks and inline code before looking for markup.
 *
 * Without this the checker reports a doc that merely *mentions* a closing tag
 * inside backticks — which happened in this repo, on a doc describing this very
 * failure mode. A validator that cries wolf gets ignored, so it must read code
 * spans as text, exactly as the renderer does.
 */
export function stripCode(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");
}

/** One fenced block with nothing but whitespace inside it. */
export interface EmptyFence {
  /** 1-based line of the OPENING fence, relative to the text passed in. */
  line: number;
  /** The info string (`mermaid`, `typescript`, …); "" for a bare ```. */
  info: string;
}

/**
 * Fenced blocks whose body is entirely blank.
 *
 * Pairs fences the way CommonMark does, which matters more than it sounds:
 *
 *   - A closing fence must use the SAME marker character, be AT LEAST AS LONG as
 *     the opening one, and carry nothing but whitespace after it. A naive
 *     "any line starting with ```" pairs the outer ```` of a wrapped example
 *     with the inner ``` and reports a fully-populated diagram as two empty
 *     blocks — the exact false positive that makes a validator get ignored.
 *   - A backtick info string may not itself contain a backtick, so ` ```` ` used
 *     as a wrapper opens one fence rather than being read as an opener plus text.
 *   - `~~~` fences count too. `stripCode` already honors them, and a hollow
 *     `~~~mermaid` block is exactly as hollow as a ```mermaid one.
 *
 * A fence still OPEN at EOF is deliberately not reported: that is
 * `unclosed-fence`'s finding, and reporting both would name one defect twice.
 */
export function scanFences(body: string): { empty: EmptyFence[]; unclosedAt: number | null } {
  const lines = body.split("\n");
  const empty: EmptyFence[] = [];
  let open: (EmptyFence & { marker: string; width: number }) | null = null;
  let inner: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (open === null) {
      if (!m) continue;
      const marker = m[1][0];
      if (marker === "`" && m[2].includes("`")) continue; // not a valid opener
      open = { line: i + 1, info: m[2].trim(), marker, width: m[1].length };
      inner = [];
      continue;
    }
    const closes =
      m !== null && m[1][0] === open.marker && m[1].length >= open.width && m[2].trim() === "";
    if (closes) {
      if (inner.every((l) => l.trim() === "")) empty.push({ line: open.line, info: open.info });
      open = null;
      continue;
    }
    inner.push(lines[i]);
  }
  return { empty, unclosedAt: open ? open.line : null };
}

/** Just the empty blocks — the shape the `empty-fence` rule reports. */
export function findEmptyFences(body: string): EmptyFence[] {
  return scanFences(body).empty;
}

/** Split frontmatter from body. `null` frontmatter means none was parseable. */
function splitFrontmatter(raw: string): { frontmatter: string | null; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { frontmatter: null, body: raw };
  return { frontmatter: m[1], body: raw.slice(m[0].length) };
}

/** Every `.mdx` under `docsRoot`, as index-style paths (no extension, `/` joined). */
async function findDocFiles(docsRoot: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith(".mdx")) {
        out.push(relative(docsRoot, full).split(sep).join("/").replace(/\.mdx$/, ""));
      }
    }
  }
  await walk(docsRoot);
  return out.sort();
}

/** Lint the body of one doc. Exported so a single-doc check can reuse it. */
export function lintContent(path: string, raw: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const { frontmatter, body } = splitFrontmatter(raw);

  if (frontmatter === null) {
    issues.push({
      path,
      rule: "frontmatter",
      severity: "error",
      message: "no parseable frontmatter block",
      hint: "The file must start with a --- delimited block; the index and the file will disagree without it.",
    });
  }

  const prose = stripCode(body);

  const opens = (prose.match(/<Callout\b/g) ?? []).length;
  const closes = (prose.match(/<\/Callout>/g) ?? []).length;
  if (opens !== closes) {
    issues.push({
      path,
      rule: "unclosed-callout",
      severity: "error",
      message: `unbalanced <Callout> tags (${opens} open, ${closes} closing)`,
      hint:
        closes > opens
          ? "An orphaned </Callout> renders as literal text — usually left by a lossy round-trip."
          : "An unclosed <Callout> swallows the rest of the document.",
    });
  }

  // Both fence rules come from ONE scanner. `unclosed-fence` used to count
  // fence-opening lines and flag an odd total, which is wrong in both
  // directions: a 4-backtick block wrapping a ``` example has an even count and
  // is fine, but so does `​```ts` followed by a `​``` trailing-text` line that
  // does not actually close it. The parity heuristic called the first malformed
  // and the second fine — and it is an ERROR severity, so its false positives
  // gated CI on legitimate docs.
  //
  // Line numbers are file-relative (the frontmatter block is counted back in),
  // so they can be jumped to directly.
  const offset = raw.slice(0, raw.length - body.length).split("\n").length - 1;
  const { empty: emptyFences, unclosedAt } = scanFences(body);

  if (unclosedAt !== null) {
    issues.push({
      path,
      rule: "unclosed-fence",
      severity: "error",
      message: `code fence opened at line ${unclosedAt + offset} is never closed`,
      hint: "An unclosed ``` swallows the remainder of the document into a code block.",
    });
  }

  // Empty fences. Reported as ONE issue per doc, not one per fence: the failure
  // is a hollow document, and a doc with a dozen blank blocks should read as a
  // dozen-block problem, not flood the report.
  //
  // WARNING, not error. An empty fence is legitimate in a template or a doc
  // being drafted, and a gate that fails on it trains people to bypass the gate.
  // It must still SURFACE — silence is what let a hollow doc pass as well-formed.
  if (emptyFences.length > 0) {
    const shown = emptyFences
      .slice(0, 5)
      .map((f) => `line ${f.line + offset}${f.info ? ` (${f.info})` : ""}`);
    const more = emptyFences.length - shown.length;
    issues.push({
      path,
      rule: "empty-fence",
      severity: "warning",
      message:
        `${emptyFences.length} empty code fence(s): ` +
        shown.join(", ") +
        (more > 0 ? `, +${more} more` : ""),
      hint: "An empty fence renders as a blank box — headings and prose wrapped around nothing. Fill it in or drop the fence; balance alone does not make a doc well-formed.",
    });
  }

  return issues;
}

/** Anchor-level checks for one index entry. */
async function lintAnchors(cwd: string, doc: DocMetadata): Promise<LintIssue[]> {
  const issues: LintIssue[] = [];
  const raw = [
    ...(Array.isArray(doc.relatedFiles) ? doc.relatedFiles : []),
    ...(Array.isArray(doc.anchors) ? doc.anchors.map((a) => a?.file) : []),
  ].filter((f): f is string => typeof f === "string" && f.length > 0);

  for (const f of raw) {
    if (f.includes("\\")) {
      issues.push({
        path: doc.path,
        rule: "windows-anchor",
        severity: "error",
        message: `anchor uses backslashes: ${f}`,
        hint: "Anchors are git pathspecs and git speaks '/' everywhere. A backslash path matches nothing off Windows, so the doc silently stops being drift-checked.",
      });
      continue; // the missing-file check below would be noise on top of this
    }
    const norm = normalizeAnchorPath(f);
    try {
      await stat(join(cwd, norm));
    } catch {
      issues.push({
        path: doc.path,
        rule: "missing-anchor",
        severity: "error",
        message: `anchored path does not exist: ${norm}`,
        hint: "Point the anchor at a real file or drop it — an anchor to nothing documents nothing.",
      });
    }
  }
  return issues;
}

/**
 * Lint an entire corpus.
 *
 * `cwd` is the project root; `.docs/` is resolved beneath it, so this never
 * reads `process.cwd()` — same rule as coverage, for the same reason (the viewer
 * and the CLI run from different directories).
 */
export async function lintDocs(cwd: string): Promise<LintReport> {
  const docsRoot = join(cwd, ".docs");

  let index;
  try {
    index = await readIndexAt(cwd);
  } catch (e) {
    return { issues: [], checked: 0, errors: 0, warnings: 0, error: `unreadable .docs/_index.json: ${e}` };
  }

  const docs = Array.isArray(index.docs) ? index.docs : [];
  const issues: LintIssue[] = [];
  const onDisk = new Set(await findDocFiles(docsRoot));
  const indexed = new Set(docs.map((d) => d.path));

  for (const doc of docs) {
    const file = join(docsRoot, `${doc.path}.mdx`);
    let raw: string | null = null;
    try {
      raw = await readFile(file, "utf-8");
    } catch {
      issues.push({
        path: doc.path,
        rule: "missing-file",
        severity: "error",
        message: `index entry has no file at .docs/${doc.path}.mdx`,
        hint: "The viewer 404s on this doc. Restore the file or remove the index entry.",
      });
    }

    if (raw !== null) {
      issues.push(...lintContent(doc.path, raw));

      // Frontmatter vs index. The index is a cache; the .mdx is the record, so a
      // disagreement means whichever a reader consulted first may be wrong.
      const parsed = parseMdx(raw);
      const fmPath = parsed.metadata?.path;
      if (typeof fmPath === "string" && fmPath.length > 0 && fmPath !== doc.path) {
        issues.push({
          path: doc.path,
          rule: "index-mismatch",
          severity: "error",
          message: `frontmatter path "${fmPath}" does not match index path "${doc.path}"`,
          hint: "The .mdx is the record and _index.json is a cache — reconcile them.",
        });
      }
      const fmTitle = parsed.metadata?.title;
      if (typeof fmTitle === "string" && fmTitle.length > 0 && fmTitle !== doc.title) {
        issues.push({
          path: doc.path,
          rule: "index-mismatch",
          severity: "warning",
          message: `frontmatter title "${fmTitle}" does not match index title "${doc.title}"`,
          hint: "Search and the sidebar read the index; the page reads the file. They will disagree.",
        });
      }
    }

    issues.push(...(await lintAnchors(cwd, doc)));
  }

  for (const p of onDisk) {
    if (indexed.has(p)) continue;
    issues.push({
      path: p,
      rule: "orphan-file",
      severity: "warning",
      message: `.docs/${p}.mdx is not listed in _index.json`,
      hint: "Unindexed docs are invisible to search, drift and coverage.",
    });
  }

  issues.sort((a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule));

  return {
    issues,
    checked: new Set([...indexed, ...onDisk]).size,
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}

/** Machine-readable form, matching the shape of `buildDriftJson`. */
export function buildLintJson(report: LintReport): Record<string, unknown> {
  return {
    ok: report.errors === 0 && !report.error,
    checked: report.checked,
    errors: report.errors,
    warnings: report.warnings,
    ...(report.error ? { error: report.error } : {}),
    issues: report.issues,
  };
}

/** Human-readable form, matching the tone of `renderDriftHuman`. */
export function renderLintHuman(report: LintReport): string {
  if (report.error) return `catryna lint\n\n  error: ${report.error}\n`;

  const lines = ["catryna lint", ""];
  if (report.issues.length === 0) {
    lines.push(`  no issues — ${report.checked} doc(s) are well-formed ✓`, "");
    return lines.join("\n");
  }

  const errs = report.issues.filter((i) => i.severity === "error");
  const warns = report.issues.filter((i) => i.severity === "warning");

  const render = (i: LintIssue) => {
    lines.push(`    ${i.severity === "error" ? "✗" : "!"} ${i.path}  [${i.rule}]`);
    lines.push(`        ${i.message}`);
    lines.push(`        → ${i.hint}`);
  };

  if (errs.length) {
    lines.push(`  ERRORS (${errs.length}):`);
    errs.forEach(render);
    lines.push("");
  }
  if (warns.length) {
    lines.push(`  WARNINGS (${warns.length}):`);
    warns.forEach(render);
    lines.push("");
  }
  lines.push(`  checked: ${report.checked}`, "");
  return lines.join("\n");
}

/**
 * CLI entry.
 *
 * Exit codes follow `runDrift` exactly (SUITE_CONTRACTS §4), and the `--json`
 * rule is the one that matters:
 *
 *   --json  → ALWAYS exit 0. It is a REPORT; machine consumers read the body,
 *             not the exit code. Getting this wrong broke the Stop hook, which
 *             does `out=$(catryna lint --json) || out=""` — a non-zero exit
 *             blanked the output in precisely the case worth reporting.
 *   human   → 3 when errors exist (the gate), 1 on operational failure
 *             (unreadable index — the check could not run at all), else 0.
 *             Warnings never gate.
 */
export async function runLint(opts: { json: boolean; cwd: string }): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  const report = await lintDocs(opts.cwd);

  if (opts.json) {
    return { stdout: JSON.stringify(buildLintJson(report), null, 2) + "\n", stderr: "", code: 0 };
  }

  if (report.error) {
    return { stdout: "", stderr: renderLintHuman(report), code: 1 };
  }
  return { stdout: renderLintHuman(report), stderr: "", code: report.errors > 0 ? 3 : 0 };
}

/**
 * Lint ONE doc by path — content plus anchors. Used by `catryna verify` to
 * refuse a baseline on a malformed doc, so nothing structurally broken can ever
 * claim to be verified.
 */
export async function lintDocFile(cwd: string, path: string): Promise<LintIssue[]> {
  const file = join(cwd, ".docs", `${path}.mdx`);
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch {
    // A missing file is verify's own error to report, not lint's.
    return [];
  }
  const issues = lintContent(path, raw);

  try {
    const index = await readIndexAt(cwd);
    const doc = (Array.isArray(index.docs) ? index.docs : []).find((d) => d.path === path);
    if (doc) issues.push(...(await lintAnchors(cwd, doc)));
  } catch {
    // Unreadable index is not this doc's fault.
  }
  return issues;
}
