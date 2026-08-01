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

import { anchoredFiles, isSourcePath } from "./coverage";
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
 * Commits on HEAD, oldest first. Only commits that touched source or the doc
 * index can move coverage, but filtering by pathspec would need the source glob
 * up front; walking all commits and downsampling is simpler and bounded anyway.
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
    .filter((c) => c.sha && Number.isFinite(c.timestamp));
}

/**
 * Evenly downsample to at most `max` points, ALWAYS keeping the first and last.
 * The newest commit is what a reader checks against today's number, and the
 * oldest anchors the left edge of the chart.
 */
export function downsample<T>(items: T[], max: number): T[] {
  if (max <= 0) return [];
  if (items.length <= max) return [...items];
  if (max === 1) return [items[items.length - 1]];

  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  // Guard against rounding collisions producing duplicates.
  return [...new Set(out)];
}

/** Source files tracked at `sha`, using the same classification as live coverage. */
async function sourceFilesAt(cwd: string, sha: string): Promise<string[]> {
  const r = await runGit(cwd, ["ls-tree", "-r", "--name-only", sha]);
  if (!r.ok) return [];
  return r.stdout.split("\n").map((l) => l.trim()).filter((p) => p && isSourcePath(p));
}

/** The doc index at `sha`. Absent or unparseable → no docs (not an error). */
async function docsAt(cwd: string, sha: string): Promise<DocMetadata[]> {
  const r = await runGit(cwd, ["show", `${sha}:.docs/_index.json`]);
  if (!r.ok) return [];
  try {
    const parsed = JSON.parse(r.stdout);
    return Array.isArray(parsed.docs) ? parsed.docs : [];
  } catch {
    return [];
  }
}

/** Coverage as of a single commit. */
export async function sampleAt(cwd: string, ref: CommitRef): Promise<CoverageSample> {
  const [sourceFiles, docs] = await Promise.all([
    sourceFilesAt(cwd, ref.sha),
    docsAt(cwd, ref.sha),
  ]);
  const anchored = anchoredFiles(docs);
  const documented = sourceFiles.filter((f) => anchored.has(f)).length;

  return {
    commit: ref.sha,
    timestamp: ref.timestamp,
    totalModules: sourceFiles.length,
    documentedModules: documented,
    coveragePercent:
      sourceFiles.length > 0 ? Math.round((documented / sourceFiles.length) * 100) : 0,
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
  const maxPoints = opts.maxPoints ?? 40;

  if (!(await isGitRepo(cwd))) {
    return { samples: [], totalCommits: 0, sampled: false, error: `not a git repository: ${cwd}` };
  }

  const commits = await listCommits(cwd);
  if (commits.length === 0) {
    return { samples: [], totalCommits: 0, sampled: false };
  }

  const picked = downsample(commits, maxPoints);
  // Sequential, not parallel: this spawns two git processes per sample, and a
  // wide fan-out on a long history would flood the process table for no gain.
  const samples: CoverageSample[] = [];
  for (const ref of picked) samples.push(await sampleAt(cwd, ref));

  return {
    samples,
    totalCommits: commits.length,
    sampled: picked.length < commits.length,
  };
}
