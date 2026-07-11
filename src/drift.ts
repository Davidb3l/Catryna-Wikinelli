/**
 * `catryna drift` / `catryna verify` — doc-drift detection with VALIDATED
 * ANCHORS, rename/delete detection, and optional Hayvenhurst symbol-precision
 * (PRODUCT_ROADMAP Phase 1, the wedge feature).
 *
 * The mechanic:
 *
 *   - `catryna verify <path>` records the repo's current HEAD SHA as that doc's
 *     `verifiedCommit` (the drift baseline) and emits `doc.verified` (§2). It
 *     also validates each anchor's file still exists (rename/delete warning).
 *   - `catryna drift` walks every doc with EFFECTIVE ANCHORS (its structured
 *     `anchors` ∪ file-level anchors from legacy `relatedFiles`, merged by
 *     `effectiveAnchors`) and classifies each into one of FOUR statuses:
 *       · `broken`     — an anchored file was DELETED or RENAMED away (no longer
 *                        exists). Highest severity ("red = anchors broken"); it
 *                        outranks drifted/clean/unverified regardless of baseline.
 *       · `drifted`    — anchored code changed between `verifiedCommit` and HEAD,
 *                        narrowed to the anchor's symbol/line-range when it has
 *                        one (a file-level anchor drifts on any file change).
 *       · `unverified` — anchored, but no baseline yet (surfaced, never "clean").
 *       · `clean`      — verified and its anchored code is untouched at HEAD.
 *     Emits `doc.drifted {path, anchors, since}` per drifted/broken doc (§2).
 *
 * Baseline = `verifiedCommit`, NOT `updatedAt`: editing prose does not re-verify
 * a doc against code.
 *
 * SYMBOL PRECISION (SUITE_CONTRACTS §3 capability gating). When the anchor names
 * a `symbol`, drift is narrowed two ways, chosen per-run by a `hayven doctor`
 * probe:
 *   - Hayvenhurst present + healthy → symbol-precise via the code graph: resolve
 *     each anchored symbol (and its 1-hop callees) to graph nodes with line
 *     spans, intersect their spans with the changed hunks to find CHANGED
 *     symbols, then `hayven impact` each → the affected symbol set. A doc drifts
 *     iff its anchored symbol is in that set (its own code changed, or something
 *     it depends on did). Precise: an unrelated edit to the same file does NOT
 *     drift a symbol-anchored doc.
 *   - Hayvenhurst absent/unhealthy, or a symbol it can't resolve → git-diff
 *     fallback (the zero-dependency default): a symbol anchor drifts iff a
 *     changed hunk of its file mentions the symbol name; a `lines` anchor drifts
 *     iff a changed hunk overlaps its range. A hayven failure NEVER crashes
 *     drift — every hayven call degrades to git-diff.
 *
 * CLI conventions (SUITE_CONTRACTS §4), enforced by the CLI layer:
 *   - `--json` ⇒ EXACTLY ONE JSON object on stdout, all logs to stderr.
 *   - `drift --json` always exits 0 (it is a REPORT; machine consumers read the
 *     JSON body, incl. `gitRepo:false`, not the exit code).
 *   - `drift` human mode is a CI GATE: exit 3 (soft-blocked, §4) when any doc is
 *     DRIFTED, exit 1 on operational failure (not a git repo), else 0.
 *     Unverified docs are WARNINGS — surfaced, but they do not fail the gate
 *     (a repo mid-adoption has many; only real contradictions should break CI).
 *   - `verify` is an ACTION: exit 0 on success, 1 on operational failure
 *     (not a git repo, doc not found), under `--json` still one JSON object.
 *
 * `cwd` is injected everywhere so the logic is testable against temp git repos.
 * Production passes `process.cwd()`; the doc store (storage.ts) resolves `.docs/`
 * from `process.cwd()` too, so the two agree for the real CLI and in the
 * subprocess-based tests.
 */
import {
  effectiveAnchors,
  readIndexAt,
  recordVerification,
  type DocAnchor,
  type DocMetadata,
} from "./storage";
import { docUri, emitEvent } from "./events";
import { stat } from "node:fs/promises";
import { join } from "node:path";

/** Result of one git invocation. `ok` mirrors a zero exit code. */
interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run `git <args>` in `cwd`. Never throws: a missing `git` binary (ENOENT) or
 * any spawn failure degrades to `{ok:false}` with the message in `stderr`, so
 * "not a git repo" / "no git" both flow through the same clean-degrade path.
 */
export async function runGit(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0, stdout, stderr };
  } catch (err) {
    return { ok: false, stdout: "", stderr: (err as Error).message };
  }
}

/** True iff `cwd` is inside a git work tree. */
export async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return r.ok && r.stdout.trim() === "true";
}

/** The current HEAD SHA, or null if it can't be resolved (e.g. no commits yet). */
export async function gitHead(cwd: string): Promise<string | null> {
  const r = await runGit(cwd, ["rev-parse", "HEAD"]);
  const sha = r.stdout.trim();
  return r.ok && sha ? sha : null;
}

/** Files under `paths` that changed between `commit` and HEAD. */
interface ChangedResult {
  ok: boolean;
  files: string[];
  stderr: string;
}

/**
 * `git diff --name-only <commit>..HEAD -- <paths>` — the anchored files that
 * changed since the baseline. `ok:false` means git rejected the range (most
 * often: the baseline commit is no longer in history, e.g. after a rebase) —
 * the caller treats that as "can't trust this baseline", i.e. drifted.
 */
async function changedFilesSince(
  cwd: string,
  commit: string,
  paths: string[],
): Promise<ChangedResult> {
  const r = await runGit(cwd, ["diff", "--name-only", `${commit}..HEAD`, "--", ...paths]);
  if (!r.ok) return { ok: false, files: [], stderr: r.stderr.trim() };
  const files = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  return { ok: true, files, stderr: "" };
}

/** True iff `rel` exists in `cwd`'s working tree (used for broken-anchor detection). */
async function fileExists(cwd: string, rel: string): Promise<boolean> {
  try {
    await stat(join(cwd, rel));
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether git recorded `file` as RENAMED (and to where) between `commit` and
 * HEAD. Best-effort context for a broken-anchor note ("renamed to X"); the
 * authoritative broken signal is `fileExists` (the file is simply gone now).
 *
 * The diff is run WITHOUT a pathspec: rename detection has to see BOTH the old
 * and new path, and restricting to the old file alone hides the new one (git
 * would then report a plain deletion and never pair the rename).
 */
async function renamedTo(cwd: string, commit: string, file: string): Promise<string | null> {
  const r = await runGit(cwd, [
    "diff",
    "--name-status",
    "--find-renames",
    `${commit}..HEAD`,
  ]);
  if (!r.ok) return null;
  for (const line of r.stdout.split("\n")) {
    // `R<score>\t<old>\t<new>` — a rename FROM `file`.
    const m = line.match(/^R\d*\t(.+?)\t(.+)$/);
    if (m && m[1] === file) return m[2];
  }
  return null;
}

/** A changed line range, inclusive, 1-based. */
type Range = [number, number];

/** Changed hunks of one file since a baseline: old-side + new-side ranges + text. */
interface FileHunks {
  ok: boolean;
  /** Ranges in the BASELINE version (for `lines` anchors, declared vs baseline). */
  oldRanges: Range[];
  /** Ranges in the HEAD version (for HEAD-resolved symbol spans, e.g. hayven). */
  newRanges: Range[];
  /** The raw unified=0 diff body (for the symbol-name git fallback heuristic). */
  raw: string;
  stderr: string;
}

/**
 * `git diff --unified=0 <commit>..HEAD -- <file>` parsed into changed line
 * ranges on BOTH sides. `--unified=0` gives zero context, so each `@@` hunk's
 * ranges are exactly the changed lines. Header form:
 *   `@@ -oldStart[,oldLen] +newStart[,newLen] @@`
 * A missing length means 1; a length of 0 (pure insertion/deletion on that side)
 * collapses to a point range at the boundary line so overlap tests stay total.
 */
async function changedHunks(cwd: string, commit: string, file: string): Promise<FileHunks> {
  const r = await runGit(cwd, ["diff", "--unified=0", `${commit}..HEAD`, "--", file]);
  if (!r.ok) return { ok: false, oldRanges: [], newRanges: [], raw: "", stderr: r.stderr.trim() };
  const oldRanges: Range[] = [];
  const newRanges: Range[] = [];
  for (const line of r.stdout.split("\n")) {
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!m) continue;
    const oldStart = parseInt(m[1], 10);
    const oldLen = m[2] === undefined ? 1 : parseInt(m[2], 10);
    const newStart = parseInt(m[3], 10);
    const newLen = m[4] === undefined ? 1 : parseInt(m[4], 10);
    oldRanges.push(oldLen > 0 ? [oldStart, oldStart + oldLen - 1] : [oldStart, oldStart]);
    newRanges.push(newLen > 0 ? [newStart, newStart + newLen - 1] : [newStart, newStart]);
  }
  return { ok: true, oldRanges, newRanges, raw: r.stdout, stderr: "" };
}

/** Inclusive-range overlap. */
function rangesOverlap(a: Range, b: Range): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** True iff any hunk range overlaps `[s, e]`. */
function anyOverlap(hunks: Range[], s: number, e: number): boolean {
  return hunks.some((h) => rangesOverlap(h, [s, e]));
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The added/removed CONTENT of a unified diff — the `+`/`-` body lines only,
 * with their marker stripped. Deliberately EXCLUDES the `@@ … @@ <context>`
 * hunk-header lines: git fills that trailing context with the nearest enclosing
 * function signature, so a change to `bar()` right below `foo()` would otherwise
 * make the header mention `foo` and give the symbol-name heuristic a false hit.
 */
function diffChangedText(raw: string): string {
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue; // file headers
    if (line.startsWith("+") || line.startsWith("-")) out.push(line.slice(1));
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Hayvenhurst symbol-precision (optional; SUITE_CONTRACTS §3 capability gating).
// A minimal, INJECTABLE client so drift stays testable without a live daemon.
// The real client shells out to `hayven`; every call degrades to a null/empty
// result on any failure so a missing or unhealthy daemon NEVER crashes drift.
// ---------------------------------------------------------------------------

/** A symbol resolved through the Hayvenhurst graph: its node, location + callees. */
export interface HayvenSymbol {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  /** 1-hop dependencies (callees) of this symbol, with their own locations. */
  callees: Array<{ id: string; file: string; startLine: number; endLine: number }>;
}

/**
 * The slice of Hayvenhurst drift needs. Injectable (see `computeDrift` opts) so
 * tests can drive both the present-and-precise and absent-fallback branches
 * deterministically without a daemon.
 */
export interface HayvenClient {
  /** §3 handshake: `hayven doctor --json` present AND `ok:true`. */
  doctorOk(cwd: string): Promise<boolean>;
  /** Resolve a symbol name to its graph node (id + span + callees), or null. */
  context(cwd: string, symbol: string): Promise<HayvenSymbol | null>;
  /** Forward blast radius: the node ids `hayven impact <id>` reports as affected. */
  impact(cwd: string, id: string): Promise<string[]>;
}

/** Run `hayven <args>` in `cwd` with a wall-clock timeout; never throws (§3). */
async function runHayven(
  cwd: string,
  args: string[],
  timeoutMs = 2000,
): Promise<{ ok: boolean; stdout: string }> {
  try {
    const proc = Bun.spawn(["hayven", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
    }, timeoutMs);
    // Drain BOTH pipes: an undrained stderr can fill its buffer and block the
    // child from exiting (then `proc.exited` never resolves before the kill).
    const [stdout, , code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { ok: code === 0, stdout };
  } catch {
    // ENOENT (no `hayven` on PATH) or any spawn failure → treat as absent.
    return { ok: false, stdout: "" };
  }
}

/**
 * Doctor-probe cache. §3: "Probe at startup or per-command; cache briefly; never
 * hard-depend." Keyed by cwd, short TTL so a long-lived process re-checks a
 * daemon that came up or went down, but repeated calls in one drift run reuse it.
 */
const doctorCache = new Map<string, { ok: boolean; at: number }>();
const DOCTOR_TTL_MS = 5000;

/** The production Hayvenhurst client — shells out to the `hayven` CLI. */
export const realHayven: HayvenClient = {
  async doctorOk(cwd: string): Promise<boolean> {
    const cached = doctorCache.get(cwd);
    if (cached && Date.now() - cached.at < DOCTOR_TTL_MS) return cached.ok;
    let ok = false;
    const r = await runHayven(cwd, ["doctor", "--json"]);
    if (r.ok) {
      try {
        const env = JSON.parse(r.stdout.trim());
        // §3: match the reply's `tool` against the CLI we invoked; require ok:true.
        ok = env && env.tool === "hayven" && env.ok === true;
      } catch {
        // §3.1: unparseable stdout under --json ⇒ absent.
        ok = false;
      }
    }
    doctorCache.set(cwd, { ok, at: Date.now() });
    return ok;
  },

  async context(cwd: string, symbol: string): Promise<HayvenSymbol | null> {
    const r = await runHayven(cwd, ["context", symbol, "--json"]);
    if (!r.ok) return null;
    try {
      const parsed = JSON.parse(r.stdout.trim());
      const slices: any[] = Array.isArray(parsed?.slices) ? parsed.slices : [];
      const target = slices.find((s) => s?.role === "target");
      const tStart = Number(target?.startLine);
      const tEnd = Number(target?.endLine);
      // Require a resolvable node WITH a finite span. Without the span guard a
      // malformed target would be treated as "resolved" yet its NaN span never
      // overlaps a hunk → the doc would be silently classified clean even when
      // its code changed. Returning null instead makes the anchor fall back to
      // git-diff, which flags the change correctly.
      if (
        !target ||
        typeof target.id !== "string" ||
        typeof target.file !== "string" ||
        !Number.isFinite(tStart) ||
        !Number.isFinite(tEnd)
      ) {
        return null;
      }
      const callees = slices
        .filter((s) => s?.role === "neighbor" && s?.via === "call" && typeof s?.id === "string")
        .map((s) => ({
          id: String(s.id),
          file: String(s.file),
          startLine: Number(s.startLine),
          endLine: Number(s.endLine),
        }))
        .filter((c) => c.file && Number.isFinite(c.startLine) && Number.isFinite(c.endLine));
      return { id: target.id, file: target.file, startLine: tStart, endLine: tEnd, callees };
    } catch {
      return null;
    }
  },

  async impact(cwd: string, id: string): Promise<string[]> {
    const r = await runHayven(cwd, ["impact", id, "--json"]);
    if (!r.ok) return [];
    try {
      const parsed = JSON.parse(r.stdout.trim());
      const hits: any[] = Array.isArray(parsed?.hits) ? parsed.hits : [];
      return hits.map((h) => h?.id).filter((id): id is string => typeof id === "string" && id.length > 0);
    } catch {
      return [];
    }
  },
};

/**
 * The affected symbol set for a hayven-precise run (computed ONCE per drift run).
 *
 * 1. Resolve every distinct anchored `symbol` (plus its 1-hop callees) to graph
 *    nodes with line spans — the "universe" of symbols drift can reason about.
 * 2. CHANGED symbols = universe nodes whose HEAD span overlaps a changed hunk of
 *    their file (git diff, new-side ranges) since the doc's baseline.
 * 3. Affected = changed ∪ ⋃ `hayven impact(changed)` — the forward blast radius
 *    (the roadmap's "`impact` of changed symbols → docs anchored to them").
 *
 * Including callees in the universe means a change to a symbol a doc DEPENDS ON
 * (even an undocumented one) enters `changed`, and `impact` carries it forward to
 * the anchored symbol. Precision boundary (documented, honest): dependency edges
 * beyond a documented symbol's 1-hop callees are only followed once a changed
 * node is already in the universe — deeper undocumented-only chains fall through
 * to git-diff. A symbol that fails to resolve is reported in `unresolved` so its
 * anchor falls back to git-diff.
 */
interface HayvenAffected {
  /** Resolved node id per anchored symbol name. */
  idBySymbol: Map<string, string>;
  /** Node ids in the affected (changed ∪ impacted) set. */
  affected: Set<string>;
  /** Anchored symbol names hayven could not resolve (→ git-diff fallback). */
  unresolved: Set<string>;
}

async function buildHayvenAffected(
  cwd: string,
  baseline: string,
  symbols: string[],
  hv: HayvenClient,
): Promise<HayvenAffected> {
  const idBySymbol = new Map<string, string>();
  const unresolved = new Set<string>();
  // Universe: node id → its HEAD location. Seeded with anchored symbols + callees.
  const universe = new Map<string, { file: string; startLine: number; endLine: number }>();

  for (const symbol of new Set(symbols)) {
    const ctx = await hv.context(cwd, symbol);
    if (!ctx) {
      unresolved.add(symbol);
      continue;
    }
    idBySymbol.set(symbol, ctx.id);
    universe.set(ctx.id, { file: ctx.file, startLine: ctx.startLine, endLine: ctx.endLine });
    for (const c of ctx.callees) {
      if (!universe.has(c.id)) {
        universe.set(c.id, { file: c.file, startLine: c.startLine, endLine: c.endLine });
      }
    }
  }

  // Changed symbols: universe nodes whose HEAD span overlaps a changed hunk.
  const hunksByFile = new Map<string, Range[]>();
  const changed: string[] = [];
  for (const [id, loc] of universe) {
    let hunks = hunksByFile.get(loc.file);
    if (hunks === undefined) {
      const h = await changedHunks(cwd, baseline, loc.file);
      hunks = h.ok ? h.newRanges : [];
      hunksByFile.set(loc.file, hunks);
    }
    if (anyOverlap(hunks, loc.startLine, loc.endLine)) changed.push(id);
  }

  // Affected = changed ∪ impact(changed).
  const affected = new Set<string>(changed);
  for (const id of changed) {
    for (const hitId of await hv.impact(cwd, id)) affected.add(hitId);
  }

  return { idBySymbol, affected, unresolved };
}

/**
 * Drift classification for a single doc. `broken` (an anchored file deleted or
 * renamed away) is ADDITIVE over the original three and is the highest severity.
 */
export type DriftStatus = "drifted" | "clean" | "unverified" | "broken";

/** How a doc's drift verdict was decided (which precision path ran). */
export type DriftPrecision = "git" | "hayven";

/** Per-doc drift result. */
export interface DocDriftResult {
  path: string;
  status: DriftStatus;
  /** The baseline SHA the doc was verified against; "" when unverified. */
  verifiedCommit: string;
  /** Anchored files that changed since `verifiedCommit` (the drift anchors). */
  changedFiles: string[];
  /** The doc's declared anchors (relatedFiles). */
  relatedFiles: string[];
  /**
   * The doc's EFFECTIVE anchors (structured `anchors` ∪ file-level from
   * `relatedFiles`) — the precise units drift was computed over. Additive.
   */
  anchors?: DocAnchor[];
  /**
   * The anchored files that no longer exist (deleted / renamed away). Populated
   * only for `status: "broken"`. Additive.
   */
  brokenFiles?: string[];
  /**
   * Which precision path decided this doc's verdict: `"hayven"` when the
   * Hayvenhurst code graph was used for a symbol anchor, else `"git"`. Additive.
   */
  precision?: DriftPrecision;
  /** Human note for edge cases (e.g. a baseline commit missing from history). */
  note?: string;
}

/** The full outcome of a `catryna drift` run. */
export interface DriftReport {
  gitRepo: boolean;
  head: string | null;
  drifted: DocDriftResult[];
  unverified: DocDriftResult[];
  clean: DocDriftResult[];
  /**
   * Docs with a BROKEN anchor (anchored file deleted/renamed away). Additive —
   * a read-only consumer that only knows drifted/unverified/clean keeps working;
   * this is the highest-severity bucket ("red = anchors broken").
   */
  broken: DocDriftResult[];
  /**
   * Whether Hayvenhurst symbol-precision was ENABLED this run — i.e. the §3
   * `hayven doctor` probe reported ok AND at least one symbol anchor had a
   * baseline to check. `false` = pure git-diff. Note: enabled ≠ every doc used
   * it — a symbol hayven can't resolve still falls back to git-diff (its
   * `DocDriftResult.precision` is then `"git"`).
   */
  hayven: boolean;
  /**
   * The resolved commit used as a GLOBAL baseline override for this run (from
   * `--since`), when set. Overrides every doc's own `verifiedCommit` so the
   * report answers "what drifted since <commit>" — the way to get a drift
   * signal on a corpus that was never `catryna verify`'d. Non-destructive:
   * nothing is written; it only changes the diff range. Absent on a normal run.
   */
  baseline?: string;
  /** Set only when the run could not proceed (e.g. not a git repository). */
  error?: string;
}

/**
 * Resolve a `--since` value to a commit SHA. Accepts a commit-ish (SHA, tag,
 * ref, `HEAD~50`) OR a date (`2026-02-18`) → the last commit on HEAD at/before
 * that date. Returns null when nothing resolves (the caller reports the error).
 */
export async function resolveRev(cwd: string, rev: string): Promise<string | null> {
  const asCommit = await runGit(cwd, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  const sha = asCommit.stdout.trim();
  if (asCommit.ok && sha) return sha;
  // Not a commit-ish. Try it as a DATE (newest commit on HEAD at/before it) —
  // but ONLY when it actually looks like an ISO date. git's approxidate parser
  // is so lenient it turns arbitrary garbage ("nonsense") into "now", which
  // would silently baseline at HEAD and report a false "all clean"; the shape
  // gate makes genuinely-invalid input resolve to null (→ a reported error).
  if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/.test(rev.trim())) return null;
  const asDate = await runGit(cwd, ["rev-list", "-1", `--before=${rev}`, "HEAD"]);
  const dsha = asDate.stdout.trim();
  return asDate.ok && dsha ? dsha : null;
}

/** Read the doc index read-only; an absent/broken `.docs/` yields no docs. */
async function readDocs(cwd: string): Promise<DocMetadata[]> {
  try {
    const index = await readIndexAt(cwd);
    return Array.isArray(index.docs) ? index.docs : [];
  } catch {
    // No .docs/ (or unreadable index) — nothing to check, not an error here.
    return [];
  }
}

/**
 * Compute drift for every doc with EFFECTIVE ANCHORS (structured `anchors` ∪
 * file-level anchors from legacy `relatedFiles`). Pure of process I/O beyond git,
 * an optional hayven probe, and the read-only index read.
 *
 * `opts.emit` (default true) controls whether `doc.drifted` is announced on the
 * spine, so unit tests can assert classification without writing telemetry.
 * `opts.hayven` (default `realHayven`) is the Hayvenhurst client — injectable so
 * tests drive both the symbol-precise and git-diff-fallback branches without a
 * live daemon.
 */
export async function computeDrift(
  cwd: string,
  opts: { emit?: boolean; hayven?: HayvenClient; since?: string } = {},
): Promise<DriftReport> {
  const emit = opts.emit ?? true;
  const hv = opts.hayven ?? realHayven;

  if (!(await isGitRepo(cwd))) {
    return {
      gitRepo: false,
      head: null,
      drifted: [],
      unverified: [],
      clean: [],
      broken: [],
      hayven: false,
      error: `not a git repository: ${cwd}`,
    };
  }

  const head = await gitHead(cwd);

  // --since: a GLOBAL baseline override. Resolve it once; if it doesn't resolve,
  // report the error rather than silently diffing against nothing.
  let baselineOverride: string | null = null;
  if (opts.since) {
    baselineOverride = await resolveRev(cwd, opts.since);
    if (!baselineOverride) {
      return {
        gitRepo: true,
        head,
        drifted: [],
        unverified: [],
        clean: [],
        broken: [],
        hayven: false,
        error: `could not resolve --since "${opts.since}" to a commit`,
      };
    }
  }
  // The effective baseline for a doc: the global override wins, else the doc's
  // own recorded verification commit (empty = unverified).
  const baselineFor = (doc: DocMetadata): string =>
    baselineOverride ?? (typeof doc.verifiedCommit === "string" ? doc.verifiedCommit : "");

  const docs = await readDocs(cwd);

  // Effective anchors per doc (structured ∪ file-level from relatedFiles). A doc
  // with no effective anchor is not driftable — nothing to diff (unchanged).
  const anchored = docs
    .map((doc) => ({ doc, anchors: effectiveAnchors(doc) }))
    .filter((d) => d.anchors.length > 0);

  // Decide symbol precision ONCE per run (SUITE_CONTRACTS §3 gating). Only probe
  // hayven when at least one doc has a SYMBOL anchor WITH a baseline — a purely
  // file-level corpus stays zero-dependency and never spawns the daemon.
  const symbolAnchorsWithBaseline = anchored.flatMap(({ doc, anchors }) =>
    baselineFor(doc) ? anchors.filter((a) => a.symbol).map((a) => ({ doc, a })) : [],
  );
  const useHayven =
    symbolAnchorsWithBaseline.length > 0 ? await hv.doctorOk(cwd) : false;

  // When precise, build the affected set once PER DISTINCT BASELINE (docs may be
  // verified at different commits); the changed-symbol scan is baseline-relative.
  const affectedByBaseline = new Map<string, HayvenAffected>();
  if (useHayven) {
    const symsByBaseline = new Map<string, Set<string>>();
    for (const { doc, a } of symbolAnchorsWithBaseline) {
      const set = symsByBaseline.get(baselineFor(doc)) ?? new Set<string>();
      set.add(a.symbol!);
      symsByBaseline.set(baselineFor(doc), set);
    }
    for (const [baseline, syms] of symsByBaseline) {
      affectedByBaseline.set(baseline, await buildHayvenAffected(cwd, baseline, [...syms], hv));
    }
  }

  const drifted: DocDriftResult[] = [];
  const unverified: DocDriftResult[] = [];
  const clean: DocDriftResult[] = [];
  const broken: DocDriftResult[] = [];

  for (const { doc, anchors } of anchored) {
    const relatedFiles = Array.isArray(doc.relatedFiles) ? doc.relatedFiles : [];
    // The baseline this doc is measured against: the --since override if set,
    // else the doc's own verifiedCommit ("" = unverified).
    const verifiedCommit = baselineFor(doc);
    const anchorFiles = [...new Set(anchors.map((a) => a.file))];

    // BROKEN first — highest severity and baseline-independent: an anchored file
    // that no longer exists (deleted or renamed away) is wrong no matter what.
    const brokenFiles: string[] = [];
    for (const f of anchorFiles) {
      if (!(await fileExists(cwd, f))) brokenFiles.push(f);
    }
    if (brokenFiles.length > 0) {
      const notes: string[] = [];
      for (const f of brokenFiles) {
        const to = verifiedCommit ? await renamedTo(cwd, verifiedCommit, f) : null;
        notes.push(to ? `${f} → renamed to ${to}` : `${f} deleted`);
      }
      broken.push({
        path: doc.path,
        status: "broken",
        verifiedCommit,
        changedFiles: [],
        relatedFiles,
        anchors,
        brokenFiles,
        precision: "git",
        note: `anchored file(s) no longer exist: ${notes.join("; ")}`,
      });
      continue;
    }

    if (!verifiedCommit) {
      unverified.push({
        path: doc.path,
        status: "unverified",
        verifiedCommit: "",
        changedFiles: [],
        relatedFiles,
        anchors,
        note: "never verified — run `catryna verify` to set a drift baseline",
      });
      continue;
    }

    // Baseline sanity: if the range is unusable (commit not in history), be
    // conservative — DRIFTED with the same note as the pre-anchor MVP.
    const rangeCheck = await changedFilesSince(cwd, verifiedCommit, anchorFiles);
    if (!rangeCheck.ok) {
      drifted.push({
        path: doc.path,
        status: "drifted",
        verifiedCommit,
        changedFiles: [],
        relatedFiles,
        anchors,
        precision: "git",
        note: `baseline commit ${verifiedCommit.slice(0, 7)} not found in history — re-verify`,
      });
      continue;
    }
    const changedAnchorFiles = new Set(rangeCheck.files);
    const affected = affectedByBaseline.get(verifiedCommit);

    // Per-anchor drift decision, narrowed by symbol/lines where present.
    const driftedFiles = new Set<string>();
    let usedHayven = false;
    for (const anchor of anchors) {
      // Symbol anchor + hayven-precise (symbol resolved) → the code-graph verdict.
      // NOT gated on the anchored file changing: a change to a DEPENDENCY (even in
      // another file) can drift the doc — that's the whole point of impact.
      if (
        anchor.symbol &&
        useHayven &&
        affected &&
        !affected.unresolved.has(anchor.symbol) &&
        affected.idBySymbol.has(anchor.symbol)
      ) {
        usedHayven = true;
        if (affected.affected.has(affected.idBySymbol.get(anchor.symbol)!)) {
          driftedFiles.add(anchor.file);
        }
        continue;
      }

      // git-diff paths: the anchored file must have changed at all.
      if (!changedAnchorFiles.has(anchor.file)) continue;

      if (anchor.lines) {
        // Line-range anchor → a changed hunk overlaps the declared range
        // (baseline-side, since the range was declared against the baseline).
        const h = await changedHunks(cwd, verifiedCommit, anchor.file);
        if (!h.ok || anyOverlap(h.oldRanges, anchor.lines[0], anchor.lines[1])) {
          driftedFiles.add(anchor.file);
        }
        continue;
      }

      if (anchor.symbol) {
        // Symbol anchor, git fallback → the symbol name appears in a changed
        // hunk's added/removed lines (word-boundary match; the hunk-header
        // context is excluded so an edit to an adjacent symbol doesn't false-hit).
        // Heuristic and honest: no parser, zero deps.
        const h = await changedHunks(cwd, verifiedCommit, anchor.file);
        const re = new RegExp(`\\b${escapeRegExp(anchor.symbol)}\\b`);
        if (!h.ok || re.test(diffChangedText(h.raw))) driftedFiles.add(anchor.file);
        continue;
      }

      // File-level anchor → any change to the file drifts (original behavior).
      driftedFiles.add(anchor.file);
    }

    const precision: DriftPrecision = usedHayven ? "hayven" : "git";
    if (driftedFiles.size > 0) {
      drifted.push({
        path: doc.path,
        status: "drifted",
        verifiedCommit,
        changedFiles: [...driftedFiles],
        relatedFiles,
        anchors,
        precision,
      });
    } else {
      clean.push({
        path: doc.path,
        status: "clean",
        verifiedCommit,
        changedFiles: [],
        relatedFiles,
        anchors,
        precision,
      });
    }
  }

  if (emit) {
    // Announce drifted AND broken docs (§2, best-effort; never gates the report).
    // Drifted: anchors = the changed files, since = the baseline it drifted from.
    for (const d of drifted) {
      await emitEvent(
        "doc.drifted",
        [docUri(d.path)],
        { path: d.path, anchors: d.changedFiles, since: d.verifiedCommit },
        cwd,
      );
    }
    // Broken: the strongest drift signal — carry the gone files + broken:true so
    // a consumer (Sirius) can distinguish a rename/delete from ordinary drift.
    for (const d of broken) {
      await emitEvent(
        "doc.drifted",
        [docUri(d.path)],
        { path: d.path, anchors: d.brokenFiles ?? [], since: d.verifiedCommit, broken: true },
        cwd,
      );
    }
  }

  return {
    gitRepo: true,
    head,
    drifted,
    unverified,
    clean,
    broken,
    hayven: useHayven,
    ...(baselineOverride ? { baseline: baselineOverride } : {}),
  };
}

/** The result of a `catryna verify` run. */
export interface VerifyResult {
  ok: boolean;
  path: string;
  verifiedCommit?: string;
  verifiedAt?: string;
  trust?: string;
  /**
   * Anchored files that don't exist at verify time (verify-on-write rename/delete
   * detection). A WARNING, not a failure — the baseline is still recorded — so a
   * doc mid-refactor can re-verify while surfacing that an anchor needs fixing.
   * Additive; absent/empty means every anchor's file was present.
   */
  brokenAnchors?: string[];
  error?: string;
}

/**
 * Verify one doc against the repo's current HEAD: read HEAD, then write the
 * baseline via `recordVerification` (which also emits `doc.verified`). As part of
 * verify-on-write it validates each EFFECTIVE anchor's file still exists and
 * reports any that don't (`brokenAnchors`) — a warning surfaced to the CLI, not a
 * failure. Returns a structured result; the CLI layer maps it to bytes + code.
 */
export async function verifyDoc(cwd: string, path: string): Promise<VerifyResult> {
  if (!(await isGitRepo(cwd))) {
    return { ok: false, path, error: `not a git repository: ${cwd}` };
  }
  const head = await gitHead(cwd);
  if (!head) {
    return { ok: false, path, error: "cannot resolve HEAD (no commits yet?)" };
  }
  const verifiedAt = new Date().toISOString();
  const meta = await recordVerification(path, head, verifiedAt);
  if (!meta) {
    return { ok: false, path, error: `no doc at path "${path}"` };
  }

  // Verify-on-write anchor validation: flag any anchored file that's gone.
  const brokenAnchors: string[] = [];
  for (const f of new Set(effectiveAnchors(meta).map((a) => a.file))) {
    if (!(await fileExists(cwd, f))) brokenAnchors.push(f);
  }

  return {
    ok: true,
    path,
    verifiedCommit: meta.verifiedCommit,
    verifiedAt: meta.verifiedAt,
    trust: "verified",
    ...(brokenAnchors.length > 0 ? { brokenAnchors } : {}),
  };
}

// ---------------------------------------------------------------------------
// Rendering + run wrappers (mirror doctor.ts: pure of process I/O, testable).
// ---------------------------------------------------------------------------

/** What a run produced, without touching process I/O (see cli.ts). */
export interface CliRun {
  stdout: string;
  stderr: string;
  code: number;
}

const short = (sha: string) => (sha ? sha.slice(0, 7) : "");

/** The JSON body for `catryna drift --json` (one object, §4 rule 1). */
export function buildDriftJson(report: DriftReport): Record<string, unknown> {
  return {
    tool: "catryna",
    command: "drift",
    gitRepo: report.gitRepo,
    head: report.head,
    // The global --since baseline override, when used (else absent).
    ...(report.baseline ? { baseline: report.baseline } : {}),
    // Whether Hayvenhurst symbol-precision was used this run (§3 gating).
    hayven: report.hayven,
    summary: {
      broken: report.broken.length,
      drifted: report.drifted.length,
      unverified: report.unverified.length,
      clean: report.clean.length,
    },
    // Highest severity first (§ roadmap "red = anchors broken").
    broken: report.broken.map((d) => ({
      path: d.path,
      since: d.verifiedCommit,
      brokenFiles: d.brokenFiles ?? [],
      relatedFiles: d.relatedFiles,
      ...(d.note ? { note: d.note } : {}),
    })),
    drifted: report.drifted.map((d) => ({
      path: d.path,
      // `since` is the baseline the doc drifted from; `anchors` the changed
      // files (matching the doc.drifted event payload, §2).
      since: d.verifiedCommit,
      anchors: d.changedFiles,
      relatedFiles: d.relatedFiles,
      ...(d.precision ? { precision: d.precision } : {}),
      ...(d.note ? { note: d.note } : {}),
    })),
    unverified: report.unverified.map((d) => ({
      path: d.path,
      relatedFiles: d.relatedFiles,
    })),
    clean: report.clean.map((d) => ({ path: d.path, since: d.verifiedCommit })),
    ...(report.error ? { error: report.error } : {}),
  };
}

/** The human report for `catryna drift`. */
export function renderDriftHuman(report: DriftReport): string {
  const lines: string[] = [];
  if (!report.gitRepo || report.error) {
    return `catryna drift\n\n  ${report.error ?? "not a git repository"}\n`;
  }

  lines.push("catryna drift", `  HEAD: ${short(report.head ?? "")}`);
  if (report.baseline) lines.push(`  baseline (--since): ${short(report.baseline)}`);
  lines.push("");

  if (
    report.broken.length === 0 &&
    report.drifted.length === 0 &&
    report.unverified.length === 0
  ) {
    lines.push(
      `  no drift — ${report.clean.length} verified doc(s) match the code at HEAD ✓`,
    );
    return lines.join("\n") + "\n";
  }

  if (report.broken.length > 0) {
    lines.push(`  BROKEN (${report.broken.length}) — anchored file deleted or renamed away:`);
    for (const d of report.broken) {
      lines.push(`    ✗✗ ${d.path}`);
      for (const f of d.brokenFiles ?? []) lines.push(`        ⌫ ${f}`);
    }
    lines.push("");
  }

  if (report.drifted.length > 0) {
    lines.push(`  DRIFTED (${report.drifted.length}) — anchored code changed since verification:`);
    for (const d of report.drifted) {
      lines.push(`    ✗ ${d.path}   (since ${short(d.verifiedCommit)})`);
      if (d.note) lines.push(`        ${d.note}`);
      for (const f of d.changedFiles) lines.push(`        ~ ${f}`);
    }
    lines.push("");
  }

  if (report.unverified.length > 0) {
    lines.push(`  UNVERIFIED (${report.unverified.length}) — no drift baseline yet:`);
    for (const d of report.unverified) lines.push(`    ? ${d.path}`);
    lines.push("");
  }

  lines.push(`  clean: ${report.clean.length}`);
  return lines.join("\n") + "\n";
}

/**
 * Run `catryna drift` and return bytes + exit code, no process side effects.
 * `--json`: one JSON object, always exit 0. Human: exit 3 on drift (CI gate),
 * 1 on operational failure (not a git repo), else 0.
 */
export async function runDrift(opts: { json: boolean; cwd: string; since?: string }): Promise<CliRun> {
  const report = await computeDrift(opts.cwd, opts.since ? { since: opts.since } : {});

  if (opts.json) {
    return { stdout: JSON.stringify(buildDriftJson(report)) + "\n", stderr: "", code: 0 };
  }

  if (!report.gitRepo || report.error) {
    // Operational failure in a shell context (not a git repo, or an unresolved
    // --since) — can't run the check here.
    return { stdout: "", stderr: renderDriftHuman(report), code: 1 };
  }
  // Soft-block (§4 code 3) when drift OR a broken anchor is found so CI fails;
  // unverified is a warning (a repo mid-adoption has many).
  const code = report.drifted.length > 0 || report.broken.length > 0 ? 3 : 0;
  return { stdout: renderDriftHuman(report), stderr: "", code };
}

/** The JSON body for `catryna verify --json`. */
export function buildVerifyJson(result: VerifyResult): Record<string, unknown> {
  return {
    tool: "catryna",
    command: "verify",
    ok: result.ok,
    path: result.path,
    ...(result.ok
      ? {
          verifiedCommit: result.verifiedCommit,
          verifiedAt: result.verifiedAt,
          trust: result.trust,
          // Verify-on-write warning: anchored files that no longer exist.
          ...(result.brokenAnchors && result.brokenAnchors.length > 0
            ? { brokenAnchors: result.brokenAnchors }
            : {}),
        }
      : { error: result.error }),
  };
}

/** The human line for `catryna verify`. */
export function renderVerifyHuman(result: VerifyResult): string {
  if (!result.ok) return `catryna verify: ${result.error}\n`;
  let out =
    `catryna verify\n` +
    `  verified ${result.path}\n` +
    `  against  ${short(result.verifiedCommit ?? "")} (${result.verifiedAt})\n`;
  if (result.brokenAnchors && result.brokenAnchors.length > 0) {
    out += `  ⚠ anchored file(s) missing: ${result.brokenAnchors.join(", ")}\n`;
  }
  return out;
}

/**
 * Run `catryna verify <path>` and return bytes + exit code. `--json`: one JSON
 * object on stdout; exit 0 on success, 1 on operational failure (verify is an
 * action, so its exit code reflects success — unlike the drift report).
 */
export async function runVerify(opts: {
  json: boolean;
  cwd: string;
  path: string;
}): Promise<CliRun> {
  const result = await verifyDoc(opts.cwd, opts.path);

  if (opts.json) {
    return {
      stdout: JSON.stringify(buildVerifyJson(result)) + "\n",
      stderr: result.ok ? "" : `verify: ${result.error}\n`,
      code: result.ok ? 0 : 1,
    };
  }

  if (!result.ok) return { stdout: "", stderr: renderVerifyHuman(result), code: 1 };
  return { stdout: renderVerifyHuman(result), stderr: "", code: 0 };
}
