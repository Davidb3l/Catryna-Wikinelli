/**
 * Coverage trend over time (PRODUCT_ROADMAP Phase 2, item 3 — "trend over time").
 *
 * Answers the question a single coverage number cannot: **is documentation
 * keeping pace with the code?** A line sliding downward means features shipped
 * and nobody documented them; a cliff points at the commit where it happened.
 *
 * ## Derived from git, not persisted
 *
 * Every sample is computed from what git already stores — the commit's file tree
 * and its `.docs/_index.json`. Nothing is written, no snapshot file accumulates,
 * and history is complete from the first commit the moment this ships rather
 * than starting empty and filling in over months.
 *
 * The alternative (append a sample per run) would add a write side-effect to a
 * read, produce no retroactive history, and drift from reality whenever someone
 * forgot to run it. Git is already the record; this just reads it.
 *
 * ## The invariant that matters
 *
 * The newest sample MUST equal what `computeCoverage` reports at HEAD. If the
 * two ever disagreed, the chart would quietly misstate today — the one point a
 * reader trusts most. Both therefore share `isSourcePath` from src/coverage.ts,
 * and a test pins the equality.
 *
 * Caveat worth knowing: samples classify by *committed* paths, so a file present
 * on disk but never committed is invisible to the trend while it does count
 * toward live coverage. HEAD with a dirty tree is the only place they can differ.
 */

import { anchoredFiles, coveragePct, isSourcePath } from "./coverage";
import { isGitRepo, runGit } from "./drift";
import type { DocMetadata } from "./storage";

/** Coverage as of one commit. */
export interface CoverageSample {
  commit: string;
  /** Commit timestamp, ms since epoch (author-independent: uses committer date). */
  timestamp: number;
  coveragePercent: number;
  totalModules: number;
  documentedModules: number;
  /** Docs in the index at that commit. */
  totalDocs: number;
}

export interface CoverageTrend {
  samples: CoverageSample[];
  /** Commits considered before downsampling. */
  totalCommits: number;
  /** True when `samples` is a downsample of `totalCommits`, not every commit. */
  sampled: boolean;
  error?: string;
}

/** One `git log` line: `<sha> <unix-seconds>`. */
interface CommitRef {
  sha: string;
  timestamp: number;
}

/**
 * Commits on HEAD, **sorted by committer timestamp ascending**.
 *
 * `git log --reverse` alone reverses traversal (ancestry) order, which is NOT
 * chronological: a rebase, cherry-pick, imported history, or a skewed clock can
 * place an older committer date later in the walk. Since the chart plots
 * timestamp on the x-axis, that draws a line doubling back on itself.
 *
 * BOTH parts are load-bearing. `--reverse` supplies ancestry order, and the
 * stable sort then corrects genuinely out-of-order dates while preserving
 * ancestry for ties — and ties are the common case, not the exotic one, because
 * `%ct` has one-second granularity and any batch of quick commits shares a
 * timestamp. Sorting without `--reverse` would leave those ties in git's default
 * newest-first order and silently invert the whole series.
 */
async function listCommits(cwd: string): Promise<CommitRef[]> {
  const r = await runGit(cwd, ["log", "--format=%H %ct", "--reverse"]);
  if (!r.ok) return [];
  return r.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, ts] = line.split(" ");
      return { sha, timestamp: Number(ts) * 1000 };
    })
    .filter((c) => c.sha && Number.isFinite(c.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Where `cwd` sits inside its git repository, as a repo-root-relative prefix
 * ("" at the root, "frontend/" in a subdirectory).
 *
 * This matters because `git ls-tree` emits paths relative to the **process
 * cwd**, while `git show <sha>:<path>` is always **repo-root** relative. Reading
 * both without reconciling them meant that, from a subdirectory, source paths
 * lost their prefix while anchor paths kept theirs — nothing matched, and the
 * trend reported a flat 0% for a fully documented project. That is reachable in
 * production: the viewer passes a runtime-switchable project root.
 */
async function repoPrefix(cwd: string): Promise<string> {
  const r = await runGit(cwd, ["rev-parse", "--show-prefix"]);
  return r.ok ? r.stdout.trim() : "";
}

/**
 * Evenly downsample to at most `max` points, keeping the first and last.
 *
 * `max` must be a positive integer; callers sanitize. At `max === 1` only the
 * NEWEST is kept — there is one slot and today's number is the one a reader
 * checks against the dashboard.
 *
 * No dedupe: when `items.length > max`, `step > 1`, so `Math.round(i * step)` is
 * strictly increasing and index collisions are impossible. A `new Set` here
 * would additionally collapse *value*-equal items, silently returning fewer than
 * `max` points for any caller whose items compare equal.
 */
export function downsample<T>(items: T[], max: number): T[] {
  if (!Number.isFinite(max) || max <= 0) return [];
  const cap = Math.floor(max);
  if (items.length <= cap) return [...items];
  if (cap === 1) return [items[items.length - 1]];

  const out: T[] = [];
  const step = (items.length - 1) / (cap - 1);
  for (let i = 0; i < cap; i++) out.push(items[Math.round(i * step)]);
  return out;
}

/**
 * Source files tracked at `sha`, relative to `prefix`, classified exactly as
 * live coverage classifies them.
 *
 * Two git details this has to get right, both of which silently corrupted the
 * result before:
 *
 * - **`-z`, not newline-splitting.** With the default `core.quotePath=true`, git
 *   C-quotes any path containing non-ASCII or special characters, emitting
 *   `"src/caf\303\251.ts"`. That string fails `isSourcePath`, so every accented
 *   or CJK-named file silently vanished from the sample. `-z` emits raw
 *   NUL-separated paths, which also handles newlines in filenames.
 * - **`--full-name`.** Without it `ls-tree` reports paths relative to the
 *   process cwd, while `git show <sha>:<path>` is always repo-root relative.
 */
async function sourceFilesAt(cwd: string, sha: string, prefix: string): Promise<string[]> {
  const r = await runGit(cwd, ["ls-tree", "-r", "-z", "--full-name", "--name-only", sha]);
  if (!r.ok) return [];
  const out: string[] = [];
  for (const raw of r.stdout.split("\0")) {
    if (!raw) continue;
    if (prefix && !raw.startsWith(prefix)) continue;
    // Re-root to match live coverage, which reports paths relative to rootDir.
    const rel = prefix ? raw.slice(prefix.length) : raw;
    if (rel && isSourcePath(rel)) out.push(rel);
  }
  return out;
}

/** The doc index at `sha`. Absent or unparseable → no docs (not an error). */
async function docsAt(cwd: string, sha: string, prefix: string): Promise<DocMetadata[]> {
  const r = await runGit(cwd, ["show", `${sha}:${prefix}.docs/_index.json`]);
  if (!r.ok) return [];
  try {
    const parsed = JSON.parse(r.stdout);
    return Array.isArray(parsed.docs) ? parsed.docs : [];
  } catch {
    return [];
  }
}

/** Coverage as of a single commit. `prefix` re-roots both halves consistently. */
export async function sampleAt(cwd: string, ref: CommitRef, prefix = ""): Promise<CoverageSample> {
  const [sourceFiles, docs] = await Promise.all([
    sourceFilesAt(cwd, ref.sha, prefix),
    docsAt(cwd, ref.sha, prefix),
  ]);
  const anchored = anchoredFiles(docs);
  const documented = sourceFiles.filter((f) => anchored.has(f)).length;

  return {
    commit: ref.sha,
    timestamp: ref.timestamp,
    totalModules: sourceFiles.length,
    documentedModules: documented,
    coveragePercent: coveragePct(documented, sourceFiles.length),
    totalDocs: docs.length,
  };
}

/**
 * Compute the coverage trend for `cwd`.
 *
 * `maxPoints` bounds the work: each sample costs two git reads, so a long
 * history is downsampled rather than walked commit by commit. `sampled` tells
 * the caller whether it is looking at every commit or a selection — a chart that
 * silently dropped points would misrepresent when a change happened.
 */
export async function computeCoverageTrend(
  cwd: string,
  opts: { maxPoints?: number } = {},
): Promise<CoverageTrend> {
  // Sanitize rather than trust: a fractional `maxPoints` made `Math.round`
  // overshoot the array and push `undefined`, crashing `sampleAt` (reachable as
  // an unhandled 500 from `?points=2.5`), and NaN silently produced an empty
  // chart with no error.
  const raw = opts.maxPoints ?? 40;
  const maxPoints = Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 40;

  if (!(await isGitRepo(cwd))) {
    return { samples: [], totalCommits: 0, sampled: false, error: `not a git repository: ${cwd}` };
  }

  const commits = await listCommits(cwd);
  if (commits.length === 0) {
    // No commits (or `git log` failed) — say so rather than returning an empty
    // series that renders identically to "this project has no history".
    return { samples: [], totalCommits: 0, sampled: false, error: `no commits found in ${cwd}` };
  }

  const prefix = await repoPrefix(cwd);
  const picked = downsample(commits, maxPoints);
  // Sequential, not parallel: this spawns two git processes per sample, and a
  // wide fan-out on a long history would flood the process table for no gain.
  const samples: CoverageSample[] = [];
  for (const ref of picked) samples.push(await sampleAt(cwd, ref, prefix));

  return {
    samples,
    totalCommits: commits.length,
    sampled: picked.length < commits.length,
  };
}
