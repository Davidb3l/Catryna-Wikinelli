/**
 * Freshness — the trust surface for READS (PRODUCT_ROADMAP Phase 2).
 *
 * `catryna drift` answers "which docs has the code outgrown?" for a human or a
 * CI gate, after the fact. Freshness answers the same question *inline, at the
 * moment a doc is read*, so an agent is warned BEFORE it trusts a stale doc
 * rather than after it has already acted on one. That is the context-rot failure
 * mode this targets: a doc that reads as authoritative but describes code that
 * no longer exists.
 *
 * This module is a thin, read-only projection over `computeDrift` in src/drift.ts
 * — the same engine, the same verdicts. It adds no drift logic of its own; it
 * only maps a `DocDriftResult` into something an agent can act on in one line,
 * and names the two states drift itself has no bucket for (see below).
 *
 * Nothing here writes, and nothing here emits on the spine: a read must not have
 * side effects, so every call passes `emit: false`.
 */

import { computeDrift, gitHead, type DocDriftResult, type DriftStatus } from "./drift";
import { stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Read-path cache for the corpus drift report.
 *
 * READS ONLY. `catryna drift`, `check_drift`, and `verify` go straight to
 * `computeDrift` and are never served from here — the authoritative gate must
 * always re-measure. This exists because reads are frequent and repetitive: the
 * viewer mounts two independent drift consumers, and an agent may call
 * `list_docs` several times in a session with nothing having changed.
 *
 * Keyed on everything that can change a verdict: repo HEAD, and the doc index's
 * mtime+size (docs can be edited or re-verified without a commit). If either
 * moves, the entry is discarded. A stale badge is the exact failure this module
 * exists to prevent, so the key is deliberately conservative — when in doubt it
 * misses and re-measures rather than serving a possibly-wrong verdict.
 */
interface CacheEntry {
  key: string;
  report: Awaited<ReturnType<typeof computeDrift>>;
}
const reportCache = new Map<string, CacheEntry>();

/** Cache key for `cwd`, or null when it cannot be established (never cache then). */
async function cacheKey(cwd: string): Promise<string | null> {
  const head = await gitHead(cwd);
  if (!head) return null;
  try {
    const s = await stat(join(cwd, ".docs", "_index.json"));
    return `${head}:${s.mtimeMs}:${s.size}`;
  } catch {
    // No index — nothing to be stale about, but also nothing worth caching.
    return null;
  }
}

/** Drop cached reports. Exported for tests and for callers that mutate docs. */
export function clearFreshnessCache(): void {
  reportCache.clear();
}

/**
 * The corpus drift report for `cwd`, cached per (HEAD, index state).
 *
 * Always computes the FULL corpus rather than the `only` subset, so a single
 * `get_doc` warms the same entry a later `list_docs` reads. That is the right
 * trade now that drift costs one diff per baseline rather than one per doc.
 */
async function cachedReport(cwd: string) {
  const key = await cacheKey(cwd);
  if (!key) return await computeDrift(cwd, { emit: false });

  const hit = reportCache.get(cwd);
  if (hit && hit.key === key) return hit.report;

  const report = await computeDrift(cwd, { emit: false });
  reportCache.set(cwd, { key, report });
  return report;
}

/**
 * A doc's freshness verdict. The four `DriftStatus` values, plus two states the
 * drift report has no bucket for because they are not drift verdicts at all:
 *
 *  - `unanchored` — the doc declares no anchors, so it is not driftable. Drift
 *    silently omits these docs; a read must NOT report that silence as `clean`.
 *    "Nothing to check" and "checked and fine" are different claims.
 *  - `unknown` — drift could not run (e.g. not a git repository). Also not a
 *    clean bill of health.
 */
export type FreshnessStatus = DriftStatus | "unanchored" | "unknown";

/** What a read response carries alongside a doc. */
export interface DocFreshness {
  status: FreshnessStatus;
  /** The drift baseline this doc was verified against; "" when never verified. */
  verifiedCommit: string;
  /** Repo HEAD at read time; null when drift could not run. */
  head: string | null;
  /** Anchored files changed since `verifiedCommit`. */
  changedFiles: string[];
  /** Anchored files that no longer exist (deleted/renamed). Only when `broken`. */
  brokenFiles?: string[];
  /**
   * One line written FOR THE READING AGENT — the whole point of this module.
   * Leads with the verdict so it survives truncation, and states the action.
   */
  summary: string;
}

/** Short SHA for human-facing text. Empty stays empty. */
function short(sha: string): string {
  return sha ? sha.slice(0, 7) : sha;
}

/** Cap a file list so one pathological doc can't flood a read response. */
function sample(files: string[], max = 5): string {
  const head = files.slice(0, max).join(", ");
  return files.length > max ? `${head}, +${files.length - max} more` : head;
}

/**
 * Render the agent-facing warning. Deliberately blunt: an agent skimming a read
 * response should not have to infer severity from field values.
 */
function summarize(status: FreshnessStatus, r: Partial<DocDriftResult>): string {
  const at = r.verifiedCommit ? `verified at ${short(r.verifiedCommit)}` : "never verified";
  switch (status) {
    case "clean":
      return `VERIFIED — ${at}; anchored code is unchanged since. Safe to trust.`;
    case "drifted":
      return (
        `STALE — ${at}, but ${r.changedFiles!.length} anchored file(s) have changed since: ` +
        `${sample(r.changedFiles!)}. Re-read the code before trusting this doc; ` +
        `run \`catryna repair ${r.path}\` to fix it.`
      );
    case "broken":
      return (
        `BROKEN — ${r.brokenFiles!.length} anchored file(s) no longer exist: ` +
        `${sample(r.brokenFiles!)}. This doc describes code that has been deleted or ` +
        `moved; treat its claims as unreliable.`
      );
    case "unverified":
      return (
        `UNVERIFIED — this doc has no drift baseline, so it has never been checked ` +
        `against the code. Its accuracy is unknown, not confirmed.`
      );
    case "unanchored":
      return (
        `UNANCHORED — this doc declares no anchors, so drift cannot be computed for ` +
        `it. Its accuracy is unknown. Add \`relatedFiles\`/\`anchors\` to make it checkable.`
      );
    case "unknown":
      return `UNKNOWN — drift could not be computed here, so freshness is unknown.`;
  }
}

/** Build a `DocFreshness` for one doc from a (possibly absent) drift result. */
function toFreshness(
  found: DocDriftResult | undefined,
  head: string | null,
  driftRan: boolean,
): DocFreshness {
  if (!driftRan) {
    return {
      status: "unknown",
      verifiedCommit: "",
      head,
      changedFiles: [],
      summary: summarize("unknown", {}),
    };
  }
  // Absent from every bucket == no effective anchors. Drift omits these; we name it.
  if (!found) {
    return {
      status: "unanchored",
      verifiedCommit: "",
      head,
      changedFiles: [],
      summary: summarize("unanchored", {}),
    };
  }
  return {
    status: found.status,
    verifiedCommit: found.verifiedCommit,
    head,
    changedFiles: found.changedFiles,
    ...(found.brokenFiles ? { brokenFiles: found.brokenFiles } : {}),
    summary: summarize(found.status, found),
  };
}

/** Index every bucket of a report by doc path. */
function byPath(
  report: Awaited<ReturnType<typeof computeDrift>>,
): Map<string, DocDriftResult> {
  const m = new Map<string, DocDriftResult>();
  for (const r of [...report.broken, ...report.drifted, ...report.unverified, ...report.clean]) {
    m.set(r.path, r);
  }
  return m;
}

/**
 * Freshness for a SINGLE doc. Uses `computeDrift`'s `only` filter, so this costs
 * one doc's worth of git work rather than a corpus scan.
 */
export async function docFreshness(cwd: string, path: string): Promise<DocFreshness> {
  const report = await cachedReport(cwd);
  const driftRan = report.gitRepo && !report.error;
  return toFreshness(byPath(report).get(path), report.head, driftRan);
}

/**
 * Freshness for MANY docs in ONE drift pass — for `list_docs` / `search_docs`,
 * where per-doc calls would re-run git once per result.
 */
export async function docsFreshness(
  cwd: string,
  paths: string[],
): Promise<Map<string, DocFreshness>> {
  const out = new Map<string, DocFreshness>();
  if (paths.length === 0) return out;

  const report = await cachedReport(cwd);
  const driftRan = report.gitRepo && !report.error;
  const found = byPath(report);
  for (const p of paths) out.set(p, toFreshness(found.get(p), report.head, driftRan));
  return out;
}

/**
 * A corpus-level one-liner for list responses, so an agent sees the shape of the
 * problem without reading every entry. Returns "" when nothing needs attention.
 */
export function freshnessHeadline(all: Iterable<DocFreshness>): string {
  let broken = 0,
    drifted = 0,
    unverified = 0;
  for (const f of all) {
    if (f.status === "broken") broken++;
    else if (f.status === "drifted") drifted++;
    else if (f.status === "unverified") unverified++;
  }
  const parts: string[] = [];
  if (broken) parts.push(`${broken} BROKEN`);
  if (drifted) parts.push(`${drifted} STALE`);
  if (unverified) parts.push(`${unverified} unverified`);
  return parts.length ? `Trust warning: ${parts.join(", ")} in these results.` : "";
}
