/**
 * `catryna consume` — the suite spine CONSUMER (SUITE_CONTRACTS §2 consumer
 * rules; PRODUCT_ROADMAP Phase 1: "Consume code.changed → real-time
 * drift-suspect marking").
 *
 * The mechanic:
 *   - Read new `code.changed` events off the shared spine (`.suite/events/`),
 *     tracking our own cursor in `.suite/cursors/catryna.json` so a re-run
 *     resumes where the last one stopped (no double-processing).
 *   - For each changed file a `code.changed` reports, mark every doc that
 *     anchors that file (`relatedFiles`) as DRIFT-SUSPECT — a cheap,
 *     event-driven hint that reacts BETWEEN full `catryna drift` runs. The
 *     marker is written to Catryna's OWN store only (`.docs/`, §4 rule 4), never
 *     another tool's store.
 *
 * No daemon — this is invoked on demand (a hook, CI, or before `catryna drift`).
 * It degrades cleanly per §2: an absent / empty / unreadable / all-foreign spine
 * and an absent / broken `.docs/` each yield a clean no-op report, never a throw.
 *
 * The authoritative drift check stays `catryna drift` (git-diff over
 * `verifiedCommit..HEAD`, drift.ts). This consumer is the fast real-time signal
 * that a `drift` run is warranted; it never replaces it.
 *
 * `cwd` is injected so the logic is testable against temp projects. The
 * classification (`computeMarks`) is a pure function of (events, docs); the I/O
 * wrappers mirror doctor.ts / drift.ts (pure of process I/O, return bytes+code).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  drainSpine,
  readCursor,
  writeCursor,
  type SpineDrain,
  type SpineEvent,
  type SuiteCursor,
} from "./events";
import { effectiveAnchors, readIndexAt, setFrontmatterScalars, type DocIndex, type DocMetadata } from "./storage";

/** One doc newly flagged drift-suspect by a `code.changed` event. */
export interface SuspectMark {
  path: string;
  /** The doc's anchor files that a `code.changed` event touched (deduped). */
  anchors: string[];
}

/** The outcome of a `catryna consume` run. */
export interface ConsumeReport {
  /** True iff the spine (`.suite/events/`) exists at all. */
  spinePresent: boolean;
  /** How many `code.changed` events were consumed this run. */
  codeChangedConsumed: number;
  /** Total spine events consumed this run (all types, incl. foreign/ignored). */
  eventsConsumed: number;
  /** Docs NEWLY marked drift-suspect (were not already suspect). */
  marked: SuspectMark[];
  /** Docs whose anchors matched but were already suspect (left unchanged). */
  alreadySuspect: string[];
  /** The cursor after draining, or `null` when there is no spine. */
  cursor: SuiteCursor | null;
}

/**
 * The anchor files of a doc — the SAME source of truth `drift.ts` uses:
 * `effectiveAnchors` (Phase 1) merges structured symbol/line `anchors` with
 * file-level `relatedFiles`, so a doc anchored ONLY by symbol still participates
 * in drift-suspect matching. Returns the deduped set of anchored file paths.
 */
function anchorFilesOf(doc: DocMetadata): string[] {
  return [...new Set(effectiveAnchors(doc).map((a) => a.file))];
}

/** The `files` a `code.changed` event reports (§2 registry: `{files, symbols}`). */
function changedFilesOf(ev: SpineEvent): string[] {
  const files = (ev.data as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  return files.filter((f): f is string => typeof f === "string");
}

/** True iff `doc` is currently flagged drift-suspect. */
function isSuspect(doc: DocMetadata): boolean {
  return typeof doc.driftSuspectSince === "string" && doc.driftSuspectSince !== "";
}

/** The result of classifying a drain against the current docs (pure). */
export interface MarkPlan {
  /** Union of every file reported by a `code.changed` event this run. */
  changedFiles: string[];
  /** How many `code.changed` events contributed. */
  codeChangedCount: number;
  /** Docs to newly mark suspect (matched anchors AND not already suspect). */
  marked: SuspectMark[];
  /** Docs that matched anchors but were already suspect (left as-is). */
  alreadySuspect: string[];
}

/**
 * PURE classification: given the events drained from the spine and the current
 * docs, decide which docs a `code.changed` touches. Only `code.changed` events
 * participate — every other type (foreign or otherwise) is ignored silently
 * (§2). Matching is exact path equality between a changed file and a doc anchor,
 * mirroring how `drift.ts` treats `relatedFiles` as git pathspecs. No I/O — the
 * seam that makes marking directly unit-testable.
 */
export function computeMarks(events: SpineEvent[], docs: DocMetadata[]): MarkPlan {
  const changed = new Set<string>();
  let codeChangedCount = 0;
  for (const ev of events) {
    if (ev.type !== "code.changed") continue; // ignore all other types (§2)
    codeChangedCount++;
    for (const f of changedFilesOf(ev)) changed.add(f);
  }

  const marked: SuspectMark[] = [];
  const alreadySuspect: string[] = [];
  if (changed.size > 0) {
    for (const doc of docs) {
      const hits = [...new Set(anchorFilesOf(doc).filter((f) => changed.has(f)))];
      if (hits.length === 0) continue;
      if (isSuspect(doc)) alreadySuspect.push(doc.path);
      else marked.push({ path: doc.path, anchors: hits });
    }
  }

  return { changedFiles: [...changed], codeChangedCount, marked, alreadySuspect };
}

/**
 * Write the drift-suspect markers to Catryna's OWN store (`<cwd>/.docs/`, §4
 * rule 4): the queryable `_index.json` AND each doc's `.mdx` frontmatter. The
 * frontmatter write is SURGICAL (`setFrontmatterScalars`) so the body is
 * preserved verbatim — marking a rich doc never risks the lossy block
 * round-trip, exactly like `recordVerification`. Best-effort per doc file: the
 * index is the source of truth, so a missing/unreadable `.mdx` still records the
 * marker in the index.
 */
async function applyMarks(cwd: string, marks: SuspectMark[], since: string): Promise<void> {
  const docsDir = join(cwd, ".docs");
  let index: DocIndex;
  try {
    index = await readIndexAt(cwd);
  } catch {
    return; // no readable store to write (we only call this when marks exist)
  }
  if (!Array.isArray(index.docs)) return;

  const byPath = new Map(marks.map((m) => [m.path, m]));
  let wrote = false;
  for (const doc of index.docs) {
    const mark = byPath.get(doc.path);
    if (!mark) continue;
    const reason = `code.changed touched ${mark.anchors.join(", ")}`;
    doc.driftSuspectSince = since;
    doc.driftSuspectReason = reason;
    wrote = true;

    const mdxPath = join(docsDir, `${doc.path}.mdx`);
    try {
      const raw = await readFile(mdxPath, "utf-8");
      await writeFile(
        mdxPath,
        setFrontmatterScalars(raw, { driftSuspectSince: since, driftSuspectReason: reason }),
      );
    } catch {
      // File gone/unreadable — the index entry above still carries the marker.
    }
  }

  if (wrote) {
    index.lastUpdated = Date.now();
    await writeFile(join(docsDir, "_index.json"), JSON.stringify(index, null, 2));
  }
}

/**
 * Drain the spine and mark drift-suspects. Reads the cursor, drains new events,
 * matches them against our docs, writes the new markers, then ADVANCES the
 * cursor — so a second run with no new events is a clean no-op (the cursor
 * guarantees no double-processing). Every absence degrades to a no-op report.
 *
 * `now` is injectable so the marking timestamp is deterministic in tests.
 */
export async function runConsume(opts: { cwd: string; now?: () => string }): Promise<ConsumeReport> {
  const { cwd } = opts;
  const now = opts.now ?? (() => new Date().toISOString());

  const from = await readCursor(cwd);
  const drain: SpineDrain = await drainSpine(cwd, from);

  // Read our own docs read-only. Absent/broken index → no docs → clean no-op.
  let docs: DocMetadata[] = [];
  try {
    const index = await readIndexAt(cwd);
    if (Array.isArray(index.docs)) docs = index.docs;
  } catch {
    docs = [];
  }

  const plan = computeMarks(drain.events, docs);

  if (plan.marked.length > 0) {
    await applyMarks(cwd, plan.marked, now());
  }

  // Advance the cursor whenever a spine exists, even if nothing matched — so a
  // re-run re-reads NOTHING (no double-processing). No spine → nothing to
  // persist, and we don't litter `.suite/cursors/` into a repo with no spine.
  if (drain.present && drain.cursor) {
    await writeCursor(drain.cursor, cwd);
  }

  return {
    spinePresent: drain.present,
    codeChangedConsumed: plan.codeChangedCount,
    eventsConsumed: drain.events.length,
    marked: plan.marked,
    alreadySuspect: plan.alreadySuspect,
    cursor: drain.cursor,
  };
}

// ---------------------------------------------------------------------------
// Rendering + run wrapper (mirror doctor.ts / drift.ts: pure of process I/O).
// ---------------------------------------------------------------------------

/** What a run produced, without touching process I/O (see cli.ts). */
export interface CliRun {
  stdout: string;
  stderr: string;
  code: number;
}

/** The JSON body for `catryna consume --json` (one object, §4 rule 1). */
export function buildConsumeJson(report: ConsumeReport): Record<string, unknown> {
  return {
    tool: "catryna",
    command: "consume",
    spinePresent: report.spinePresent,
    summary: {
      codeChanged: report.codeChangedConsumed,
      events: report.eventsConsumed,
      marked: report.marked.length,
      alreadySuspect: report.alreadySuspect.length,
    },
    marked: report.marked.map((m) => ({ path: m.path, anchors: m.anchors })),
    alreadySuspect: report.alreadySuspect,
    cursor: report.cursor,
  };
}

/** The human report for `catryna consume`. */
export function renderConsumeHuman(report: ConsumeReport): string {
  const lines: string[] = ["catryna consume"];
  if (!report.spinePresent) {
    lines.push("", "  no suite spine (.suite/events/) — nothing to consume");
    return lines.join("\n") + "\n";
  }

  lines.push(
    "",
    `  consumed ${report.codeChangedConsumed} code.changed event(s) of ${report.eventsConsumed} total`,
  );
  if (report.marked.length === 0) {
    lines.push("  no docs newly marked drift-suspect");
  } else {
    lines.push(`  marked ${report.marked.length} doc(s) drift-suspect:`);
    for (const m of report.marked) lines.push(`    ! ${m.path}   (${m.anchors.join(", ")})`);
  }
  if (report.alreadySuspect.length > 0) {
    lines.push(`  already suspect (unchanged): ${report.alreadySuspect.length}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Run `catryna consume` and return bytes + exit code, no process side effects.
 * Consume is an ACTION that succeeds even when there's nothing to do, so it
 * exits 0 on any completed run (incl. every clean no-op); `--json` emits exactly
 * one JSON object on stdout.
 */
export async function runConsumeCli(opts: { json: boolean; cwd: string }): Promise<CliRun> {
  const report = await runConsume({ cwd: opts.cwd });
  if (opts.json) {
    return { stdout: JSON.stringify(buildConsumeJson(report)) + "\n", stderr: "", code: 0 };
  }
  return { stdout: renderConsumeHuman(report), stderr: "", code: 0 };
}
