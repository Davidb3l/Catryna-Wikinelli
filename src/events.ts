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
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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

// ===========================================================================
// CONSUMER side (SUITE_CONTRACTS §2 "Consumer rules").
//
// Additive — none of the producer exports above change. Catryna consumes the
// spine to react to peers (today: hayven's `code.changed` → real-time
// drift-suspect marking, PRODUCT_ROADMAP Phase 1). The contract:
//   - Track our OWN cursor in `.suite/cursors/catryna.json` (`{file, offset}`),
//     consumer-owned, never shared.
//   - Advance across the daily rollover; never move a cursor backward.
//   - Read only WHOLE lines; a trailing partial line means "no more yet".
//   - Ignore unknown `type`s, unknown fields, and unknown `v` silently.
//   - Consuming is ALWAYS optional: an absent / empty / unreadable / all-foreign
//     spine is a clean no-op, never an error.
// ===========================================================================

/** A consumer cursor (§2): a byte offset within a named daily bucket. */
export interface SuiteCursor {
  /** Bare `<YYYY-MM-DD>.jsonl` basename (never a path). */
  file: string;
  /** Byte position within `file` — always at a line boundary (after a `\n`). */
  offset: number;
}

/**
 * An event READ from the spine. Unlike `SuiteEvent` (Catryna's own producer
 * shape, `source: "catryna"`), a consumed line can come from ANY peer, so
 * `source`/`type` are open strings and `data` is whatever the producer wrote.
 */
export interface SpineEvent {
  v: number;
  id: string;
  ts: string;
  source: string;
  type: string;
  refs: string[];
  data: Record<string, unknown>;
}

/** A spine daily-bucket basename, e.g. `2026-07-11.jsonl`. */
const DAY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

/** The cursors directory for a working dir: `<cwd>/.suite/cursors/`. */
export function cursorsDir(cwd: string = process.cwd()): string {
  return join(cwd, ".suite", "cursors");
}

/** This tool's cursor file. Consumer-owned, never shared (§2). */
export function cursorPath(cwd: string = process.cwd(), tool = "catryna"): string {
  return join(cursorsDir(cwd), `${tool}.json`);
}

/**
 * Read this tool's cursor, or `null` when it's absent OR malformed. Never
 * throws: a missing/garbage cursor degrades to a fresh start (§2), it does not
 * fail the consume.
 */
export async function readCursor(
  cwd: string = process.cwd(),
  tool = "catryna",
): Promise<SuiteCursor | null> {
  try {
    const parsed = JSON.parse(await readFile(cursorPath(cwd, tool), "utf-8")) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as SuiteCursor).file === "string" &&
      DAY_FILE_RE.test((parsed as SuiteCursor).file) &&
      typeof (parsed as SuiteCursor).offset === "number" &&
      Number.isFinite((parsed as SuiteCursor).offset) &&
      (parsed as SuiteCursor).offset >= 0
    ) {
      const c = parsed as SuiteCursor;
      return { file: c.file, offset: Math.floor(c.offset) };
    }
  } catch {
    // Absent or unreadable/garbage — treat as no cursor (fresh start).
  }
  return null;
}

/** Persist this tool's cursor, creating `.suite/cursors/` as needed. */
export async function writeCursor(
  cursor: SuiteCursor,
  cwd: string = process.cwd(),
  tool = "catryna",
): Promise<void> {
  await mkdir(cursorsDir(cwd), { recursive: true });
  await writeFile(cursorPath(cwd, tool), JSON.stringify(cursor) + "\n", "utf-8");
}

/** List spine daily buckets in `cwd`, lexically ascending (= chronological). */
async function listDayFiles(cwd: string): Promise<string[]> {
  try {
    return (await readdir(eventsDir(cwd))).filter((f) => DAY_FILE_RE.test(f)).sort();
  } catch {
    // No `.suite/events/` — absent spine.
    return [];
  }
}

/** Parse one spine line to a safe v1 envelope, or `null` if it must be skipped. */
function parseSpineLine(line: string): SpineEvent | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null; // malformed line — skip, not fatal (§2)
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  // Skip envelope versions we don't understand (§2 forward-compat).
  if (rec.v !== SPINE_VERSION) return null;
  if (typeof rec.type !== "string") return null;
  // Coerce the rest defensively so a non-conformant line can't crash a consumer:
  // refs → string[], data → object. Unknown extra keys are simply ignored.
  return {
    v: SPINE_VERSION,
    id: typeof rec.id === "string" ? rec.id : "",
    ts: typeof rec.ts === "string" ? rec.ts : "",
    source: typeof rec.source === "string" ? rec.source : "",
    type: rec.type,
    refs: Array.isArray(rec.refs) ? rec.refs.filter((r): r is string => typeof r === "string") : [],
    data:
      rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)
        ? (rec.data as Record<string, unknown>)
        : {},
  };
}

/** The outcome of draining the spine from a cursor. */
export interface SpineDrain {
  /**
   * Newly-read events (v===1), in file+byte order. ALL types are returned —
   * incl. foreign/unknown ones — because the cursor advances past every line;
   * the caller filters to the types it acts on.
   */
  events: SpineEvent[];
  /** Where to resume next time, or `null` when there is no spine at all. */
  cursor: SuiteCursor | null;
  /** True iff at least one daily bucket exists (the spine is present). */
  present: boolean;
}

/**
 * Read every WHOLE line after `from` to the end of the spine, advancing across
 * the daily rollover (§2). Never throws: an absent/empty/unreadable spine yields
 * `{events: [], cursor: from, present:false}`. Only complete lines (terminated
 * by `\n`) are consumed; a trailing partial line is left for next time (the
 * cursor stops before it). With no cursor (first run) it starts at the OLDEST
 * bucket so no history is missed.
 */
export async function drainSpine(cwd: string, from: SuiteCursor | null): Promise<SpineDrain> {
  const dayFiles = await listDayFiles(cwd);
  if (dayFiles.length === 0) return { events: [], cursor: from, present: false };

  // Resolve the starting file + offset.
  let startIdx: number;
  let startOffset: number;
  if (from && dayFiles.includes(from.file)) {
    startIdx = dayFiles.indexOf(from.file);
    startOffset = from.offset;
  } else if (from) {
    // The cursor's file is gone (or older than everything present). Resume at
    // the earliest bucket lexically greater than it; if none, nothing new.
    const nextIdx = dayFiles.findIndex((f) => f > from.file);
    if (nextIdx === -1) return { events: [], cursor: from, present: true };
    startIdx = nextIdx;
    startOffset = 0;
  } else {
    // First run, no cursor: process from the oldest bucket forward.
    startIdx = 0;
    startOffset = 0;
  }

  const events: SpineEvent[] = [];
  let cursor: SuiteCursor = { file: dayFiles[startIdx], offset: startOffset };

  for (let i = startIdx; i < dayFiles.length; i++) {
    const f = dayFiles[i];
    // At the top of each iteration `cursor` already points at (f, offset): the
    // initial value for the first file, or {f, 0} set by the previous rollover.
    const offset = i === startIdx ? startOffset : 0;

    let buf: Buffer;
    try {
      buf = await readFile(join(eventsDir(cwd), f));
    } catch {
      // An unreadable bucket (EACCES, or rotated away between readdir and here)
      // must not throw (§2: consuming is optional / never fatal). Stop cleanly,
      // leaving the cursor BEFORE this file so a later run can retry it — and
      // keeping every event already collected from earlier buckets.
      break;
    }

    const start = Math.min(offset, buf.length);
    const region = buf.subarray(start);
    const lastNl = region.lastIndexOf(0x0a); // last '\n'

    let newOffset = start;
    if (lastNl >= 0) {
      const complete = region.subarray(0, lastNl + 1).toString("utf-8");
      for (const line of complete.split("\n")) {
        if (!line) continue;
        const ev = parseSpineLine(line);
        if (ev) events.push(ev);
      }
      newOffset = start + lastNl + 1;
    }

    const isLast = i === dayFiles.length - 1;
    if (!isLast) {
      // Any bucket that is not the lexically-greatest is SEALED: producers only
      // ever append to TODAY's file, so an older file never grows again. We've
      // read all its complete lines; roll forward to the next day at offset 0.
      // A trailing partial tail in a sealed file (a torn/crashed append) is
      // deliberately skipped rather than waited on — otherwise it would wedge
      // the cursor forever, since it can never be completed.
      cursor = { file: dayFiles[i + 1], offset: 0 };
      continue;
    }
    // TODAY's file (the last one): a trailing partial line is a producer append
    // caught mid-flight — stop at the last `\n` and resume from there next time.
    cursor = { file: f, offset: newOffset };
    break;
  }

  return { events, cursor, present: true };
}
