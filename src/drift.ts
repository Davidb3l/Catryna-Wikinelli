/**
 * `catryna drift` / `catryna verify` — git-diff doc-drift detection
 * (PRODUCT_ROADMAP Phase 1, the wedge feature).
 *
 * The mechanic, git-diff only (symbol-precise Hayvenhurst integration is
 * DEFERRED — see PRODUCT_ROADMAP / the design note at the bottom of this file):
 *
 *   - `catryna verify <path>` records the repo's current HEAD SHA as that doc's
 *     `verifiedCommit` (the drift baseline) and emits `doc.verified` (§2).
 *   - `catryna drift` walks every doc that declares `relatedFiles` and asks git:
 *     "did any anchored file change between the doc's `verifiedCommit` and HEAD?"
 *     If yes → DRIFTED (the doc may now contradict the code). Emits `doc.drifted`
 *     `{path, anchors, since}` per drifted doc (§2). A doc with no baseline is
 *     `unverified` (surfaced, never silently "clean"); one whose anchors are
 *     untouched is `clean`.
 *
 * Baseline = `verifiedCommit`, NOT `updatedAt`: editing prose does not re-verify
 * a doc against code. Path-level anchoring only in this MVP (a whole file is the
 * anchor); symbol/line ranges are deferred.
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
import { readIndexAt, recordVerification, type DocMetadata } from "./storage";
import { docUri, emitEvent } from "./events";

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

/** Drift classification for a single doc. */
export type DriftStatus = "drifted" | "clean" | "unverified";

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
  /** Set only when the run could not proceed (e.g. not a git repository). */
  error?: string;
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
 * Compute drift for every doc that declares `relatedFiles`. Pure of process I/O
 * beyond git + the read-only index read; `opts.emit` (default true) controls
 * whether `doc.drifted` is announced on the spine, so unit tests can assert
 * classification without writing telemetry.
 */
export async function computeDrift(
  cwd: string,
  opts: { emit?: boolean } = {},
): Promise<DriftReport> {
  const emit = opts.emit ?? true;

  if (!(await isGitRepo(cwd))) {
    return {
      gitRepo: false,
      head: null,
      drifted: [],
      unverified: [],
      clean: [],
      error: `not a git repository: ${cwd}`,
    };
  }

  const head = await gitHead(cwd);
  const docs = await readDocs(cwd);

  const drifted: DocDriftResult[] = [];
  const unverified: DocDriftResult[] = [];
  const clean: DocDriftResult[] = [];

  for (const doc of docs) {
    const relatedFiles = Array.isArray(doc.relatedFiles) ? doc.relatedFiles : [];
    // Only anchored docs are driftable — no relatedFiles, nothing to diff.
    if (relatedFiles.length === 0) continue;

    const verifiedCommit = typeof doc.verifiedCommit === "string" ? doc.verifiedCommit : "";

    if (!verifiedCommit) {
      unverified.push({
        path: doc.path,
        status: "unverified",
        verifiedCommit: "",
        changedFiles: [],
        relatedFiles,
        note: "never verified — run `catryna verify` to set a drift baseline",
      });
      continue;
    }

    const changed = await changedFilesSince(cwd, verifiedCommit, relatedFiles);

    if (!changed.ok) {
      // Baseline unusable (commit not in history, etc.) — conservatively drifted.
      drifted.push({
        path: doc.path,
        status: "drifted",
        verifiedCommit,
        changedFiles: [],
        relatedFiles,
        note: `baseline commit ${verifiedCommit.slice(0, 7)} not found in history — re-verify`,
      });
    } else if (changed.files.length > 0) {
      drifted.push({
        path: doc.path,
        status: "drifted",
        verifiedCommit,
        changedFiles: changed.files,
        relatedFiles,
      });
    } else {
      clean.push({
        path: doc.path,
        status: "clean",
        verifiedCommit,
        changedFiles: [],
        relatedFiles,
      });
    }
  }

  if (emit) {
    // Announce each drifted doc (§2, best-effort; anchors = the changed files,
    // since = the baseline it drifted from). Never gates the report.
    for (const d of drifted) {
      await emitEvent(
        "doc.drifted",
        [docUri(d.path)],
        { path: d.path, anchors: d.changedFiles, since: d.verifiedCommit },
        cwd,
      );
    }
  }

  return { gitRepo: true, head, drifted, unverified, clean };
}

/** The result of a `catryna verify` run. */
export interface VerifyResult {
  ok: boolean;
  path: string;
  verifiedCommit?: string;
  verifiedAt?: string;
  trust?: string;
  error?: string;
}

/**
 * Verify one doc against the repo's current HEAD: read HEAD, then write the
 * baseline via `recordVerification` (which also emits `doc.verified`). Returns a
 * structured result; the CLI layer maps it to bytes + an exit code.
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
  return {
    ok: true,
    path,
    verifiedCommit: meta.verifiedCommit,
    verifiedAt: meta.verifiedAt,
    trust: "verified",
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
    summary: {
      drifted: report.drifted.length,
      unverified: report.unverified.length,
      clean: report.clean.length,
    },
    drifted: report.drifted.map((d) => ({
      path: d.path,
      // `since` is the baseline the doc drifted from; `anchors` the changed
      // files (matching the doc.drifted event payload, §2).
      since: d.verifiedCommit,
      anchors: d.changedFiles,
      relatedFiles: d.relatedFiles,
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
  if (!report.gitRepo) {
    return `catryna drift\n\n  ${report.error ?? "not a git repository"}\n`;
  }

  lines.push("catryna drift", `  HEAD: ${short(report.head ?? "")}`, "");

  if (report.drifted.length === 0 && report.unverified.length === 0) {
    lines.push(
      `  no drift — ${report.clean.length} verified doc(s) match the code at HEAD ✓`,
    );
    return lines.join("\n") + "\n";
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
export async function runDrift(opts: { json: boolean; cwd: string }): Promise<CliRun> {
  const report = await computeDrift(opts.cwd);

  if (opts.json) {
    return { stdout: JSON.stringify(buildDriftJson(report)) + "\n", stderr: "", code: 0 };
  }

  if (!report.gitRepo) {
    // Operational failure in a shell context — can't run the check here.
    return { stdout: "", stderr: renderDriftHuman(report), code: 1 };
  }
  // Soft-block (§4 code 3) when drift is found so CI fails; unverified is a warning.
  const code = report.drifted.length > 0 ? 3 : 0;
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
        }
      : { error: result.error }),
  };
}

/** The human line for `catryna verify`. */
export function renderVerifyHuman(result: VerifyResult): string {
  if (!result.ok) return `catryna verify: ${result.error}\n`;
  return (
    `catryna verify\n` +
    `  verified ${result.path}\n` +
    `  against  ${short(result.verifiedCommit ?? "")} (${result.verifiedAt})\n`
  );
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
