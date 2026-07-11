/**
 * The suite event spine (SUITE_CONTRACTS §2).
 *
 * A shared, append-only, file-based notification log per repo:
 * `<repo-root>/.suite/events/<YYYY-MM-DD>.jsonl`, one JSON envelope per line,
 * bucketed by the event's UTC day. Catryna emits `doc.*` facts here so peers
 * (Sirius, Hayvenhurst) can react — e.g. Sirius dispatching a librarian job on
 * `doc.drifted` — without any point-to-point integration.
 *
 * Producer rules we honor (§2):
 *   - One O_APPEND write per line (no read-modify-write, no history rewrite).
 *   - Emit facts in the PAST tense, AFTER they are durable in our own store
 *     (`.docs/`); the spine is a notification layer, never the source of truth.
 *   - Only ever emit under our own scheme (`catryna:`).
 *   - Keep lines small; bulk stays in the store and is referenced by URI.
 *
 * Emission is BEST-EFFORT: a doc write must still succeed if the spine can't be
 * written (read-only fs, race, etc.). We swallow and log to stderr — never
 * throw into the caller, and never let the spine gate a store write.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Spine envelope version (§2). */
export const SPINE_VERSION = 1;

/** Event types Catryna owns (§2 registry). Only `doc.*` today. */
export type CatrynaEventType =
  | "doc.created"
  | "doc.updated"
  | "doc.drifted"
  | "doc.verified"
  | "observation.added";

/** One line of the spine (§2 envelope). */
export interface SuiteEvent {
  v: number;
  id: string;
  ts: string; // ISO-8601 UTC
  source: "catryna";
  type: CatrynaEventType;
  refs: string[]; // suite URIs this event is about
  data: Record<string, unknown>;
}

/** The `catryna:` suite URI for a doc path (§1). */
export function docUri(path: string): string {
  return `catryna:doc/${path}`;
}

/** The events directory for a working directory (the project root in prod). */
export function eventsDir(cwd: string = process.cwd()): string {
  return join(cwd, ".suite", "events");
}

/** The daily bucket filename for an ISO-8601 UTC timestamp: `YYYY-MM-DD.jsonl`. */
export function bucketFor(ts: string): string {
  return `${ts.slice(0, 10)}.jsonl`;
}

/**
 * Build a spine envelope. Pure and deterministic — `id` and `ts` are injected
 * so the shape is directly testable; `emitEvent` supplies the real values.
 */
export function buildEvent(
  type: CatrynaEventType,
  refs: string[],
  data: Record<string, unknown>,
  id: string,
  ts: string,
): SuiteEvent {
  return { v: SPINE_VERSION, id, ts, source: "catryna", type, refs, data };
}

/**
 * Append one event to the spine. Best-effort: any failure is logged to stderr
 * and swallowed, so a failed emit never breaks the doc write that triggered it.
 * `cwd` is injectable for testing; production uses the process's cwd (which the
 * MCP server keeps pinned to the user's project root — see run-server.sh).
 */
export async function emitEvent(
  type: CatrynaEventType,
  refs: string[],
  data: Record<string, unknown>,
  cwd?: string,
): Promise<void> {
  try {
    // Resolve cwd INSIDE the try: on Linux `process.cwd()` throws ENOENT if the
    // working dir was unlinked mid-run, and this must never escape into the doc
    // write that triggered it (§2: emission is best-effort, never gates the store).
    const resolvedCwd = cwd ?? process.cwd();
    const id = crypto.randomUUID();
    const ts = new Date().toISOString();
    const event = buildEvent(type, refs, data, id, ts);
    const dir = eventsDir(resolvedCwd);
    await mkdir(dir, { recursive: true });
    // Single O_APPEND write (fs/promises appendFile defaults to flag "a").
    await appendFile(join(dir, bucketFor(ts)), JSON.stringify(event) + "\n", "utf-8");
  } catch (err) {
    // The spine is a notification layer; degrade silently, never crash.
    console.error(`[Catryna] suite event emit failed (${type}): ${(err as Error).message}`);
  }
}
