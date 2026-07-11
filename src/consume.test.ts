/**
 * Tests for the suite spine CONSUMER — `catryna consume`
 * (SUITE_CONTRACTS §2 consumer rules; PRODUCT_ROADMAP Phase 1: consume
 * `code.changed` → real-time drift-suspect marking).
 *
 * Every assertion is mutation-checkable: it fails if the corresponding wiring
 * (cursor tracking, whole-line reading, type filtering, anchor matching, the
 * store write) is removed.
 *
 * `runConsume` is FULLY cwd-parameterized (it reuses `readIndexAt(cwd)` + pure
 * helpers rather than storage's module-level `DOCS_ROOT`), so the whole flow
 * runs in-process against a temp project — no subprocess needed. One end-to-end
 * case still drives the real `catryna` CLI to prove the subcommand wiring, exit
 * code, and single-JSON-object stdout (§4 rule 1).
 *
 * The spine is written by hand (as hayven would): `code.changed` lines plus a
 * foreign `sirius:*` line, to prove the foreign event is ignored.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildConsumeJson,
  computeMarks,
  runConsume,
  type ConsumeReport,
} from "./consume";
import { drainSpine, readCursor, type SpineEvent } from "./events";
import type { DocMetadata } from "./storage";

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url));

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function tempDir(prefix = "catryna-consume-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

// --- spine fixtures ---------------------------------------------------------

/** One conformant §2 envelope line (JSON + no trailing newline). */
function line(source: string, type: string, data: Record<string, unknown>, refs: string[] = []): string {
  return JSON.stringify({
    v: 1,
    id: crypto.randomUUID(),
    ts: "2026-07-11T18:42:11.000Z",
    source,
    type,
    refs,
    data,
  });
}

/** hayven's `code.changed` (§2 registry: `{files, symbols}`). */
function codeChanged(files: string[], symbols: string[] = []): string {
  return line("hayven", "code.changed", { files, symbols }, files.map((f) => `hayven:node/${f}`));
}

/** A foreign sirius event — proves foreign lines are consumed-but-ignored. */
function foreignSirius(): string {
  return line("sirius", "receipt.filed", { issue: "amt:issue/1", symbols: [] }, ["sirius:receipt/1"]);
}

/** Write `.suite/events/<day>.jsonl` with the given lines (each on its own line). */
async function writeSpine(dir: string, day: string, lines: string[]): Promise<void> {
  const evDir = join(dir, ".suite", "events");
  await mkdir(evDir, { recursive: true });
  await writeFile(join(evDir, `${day}.jsonl`), lines.map((l) => l + "\n").join(""), "utf-8");
}

// --- doc fixtures (legacy frontmatter: NO driftSuspect lines → tests append) --

interface SeedDoc {
  path: string;
  relatedFiles: string[];
  /** Pre-existing suspect timestamp (to test the "already suspect" branch). */
  driftSuspectSince?: string;
}

async function seedDocs(dir: string, docs: SeedDoc[]): Promise<void> {
  const now = Date.now();
  const docsDir = join(dir, ".docs");
  await mkdir(docsDir, { recursive: true });
  const meta = docs.map((d, i) => ({
    id: `seed-${i}`,
    path: d.path,
    title: `Doc ${i}`,
    tags: [] as string[],
    relatedFiles: d.relatedFiles,
    evidence: [] as string[],
    refs: [] as string[],
    verifiedCommit: "",
    verifiedAt: "",
    // Only include the marker when the fixture wants it pre-set (else legacy: absent).
    ...(d.driftSuspectSince ? { driftSuspectSince: d.driftSuspectSince, driftSuspectReason: "seed" } : {}),
    createdAt: now,
    updatedAt: now,
    createdBy: "test",
  }));
  await writeFile(
    join(docsDir, "_index.json"),
    JSON.stringify({ version: 1, docs: meta, lastUpdated: now }, null, 2),
  );
  for (const m of meta) {
    const file = join(docsDir, `${m.path}.mdx`);
    await mkdir(dirname(file), { recursive: true });
    // Legacy frontmatter: intentionally OMIT the driftSuspect* lines unless preset,
    // so a successful mark proves setFrontmatterScalars APPENDS them.
    const suspectLines = m.driftSuspectSince
      ? `driftSuspectSince: ${JSON.stringify(m.driftSuspectSince)}\ndriftSuspectReason: "seed"\n`
      : "";
    await writeFile(
      file,
      `---\nid: ${m.id}\ntitle: ${JSON.stringify(m.title)}\npath: ${JSON.stringify(m.path)}\n` +
        `tags: []\nrelatedFiles: ${JSON.stringify(m.relatedFiles)}\nevidence: []\nrefs: []\n` +
        `verifiedCommit: ""\nverifiedAt: ""\n${suspectLines}` +
        `createdAt: ${m.createdAt}\nupdatedAt: ${m.updatedAt}\ncreatedBy: "test"\n---\n\n` +
        `# ${m.title}\n\nBody paragraph that must survive marking.\n`,
    );
  }
}

async function readIndex(dir: string): Promise<{ docs: any[] }> {
  return JSON.parse(await readFile(join(dir, ".docs", "_index.json"), "utf-8"));
}
async function readMdx(dir: string, path: string): Promise<string> {
  return readFile(join(dir, ".docs", `${path}.mdx`), "utf-8");
}

interface CliOut {
  stdout: string;
  stderr: string;
  code: number;
}
async function runCli(dir: string, args: string[]): Promise<CliOut> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

/** Minimal DocMetadata for pure-classification tests. */
function doc(path: string, relatedFiles: string[], driftSuspectSince = ""): DocMetadata {
  return {
    id: path,
    path,
    title: path,
    tags: [],
    relatedFiles,
    anchors: [],
    evidence: [],
    refs: [],
    verifiedCommit: "",
    verifiedAt: "",
    driftSuspectSince,
    driftSuspectReason: "",
    createdAt: 0,
    updatedAt: 0,
    createdBy: "test",
  };
}
function parse(l: string): SpineEvent {
  return JSON.parse(l) as SpineEvent;
}

// ===========================================================================

describe("computeMarks — pure classification (§2)", () => {
  test("marks EXACTLY the doc whose anchor a code.changed touched", () => {
    const events = [parse(codeChanged(["src/a.ts"]))];
    const plan = computeMarks(events, [doc("m/a", ["src/a.ts"]), doc("m/b", ["src/b.ts"])]);
    expect(plan.codeChangedCount).toBe(1);
    expect(plan.changedFiles).toEqual(["src/a.ts"]);
    expect(plan.marked.map((m) => m.path)).toEqual(["m/a"]);
    expect(plan.marked[0].anchors).toEqual(["src/a.ts"]);
    expect(plan.alreadySuspect).toEqual([]);
  });

  test("a foreign sirius:* event is CONSUMED but ignored (not code.changed)", () => {
    const events = [parse(foreignSirius())];
    const plan = computeMarks(events, [doc("m/a", ["src/a.ts"])]);
    expect(plan.codeChangedCount).toBe(0);
    expect(plan.marked).toEqual([]);
  });

  test("an unknown event type is ignored silently (forward-compat)", () => {
    const events = [parse(line("agent", "future.invented", { files: ["src/a.ts"] }))];
    const plan = computeMarks(events, [doc("m/a", ["src/a.ts"])]);
    // Even though its data has a `files` field, only `code.changed` participates.
    expect(plan.codeChangedCount).toBe(0);
    expect(plan.marked).toEqual([]);
  });

  test("a doc already suspect is reported alreadySuspect, not re-marked", () => {
    const events = [parse(codeChanged(["src/a.ts"]))];
    const plan = computeMarks(events, [doc("m/a", ["src/a.ts"], "2026-01-01T00:00:00.000Z")]);
    expect(plan.marked).toEqual([]);
    expect(plan.alreadySuspect).toEqual(["m/a"]);
  });

  test("multiple code.changed events union their files; one doc, one mark", () => {
    const events = [parse(codeChanged(["src/a.ts"])), parse(codeChanged(["src/a.ts", "src/c.ts"]))];
    const plan = computeMarks(events, [doc("m/a", ["src/a.ts"]), doc("m/c", ["src/c.ts"])]);
    expect(plan.codeChangedCount).toBe(2);
    expect(new Set(plan.changedFiles)).toEqual(new Set(["src/a.ts", "src/c.ts"]));
    expect(plan.marked.map((m) => m.path).sort()).toEqual(["m/a", "m/c"]);
  });
});

describe("drainSpine + cursor (§2)", () => {
  test("reads all lines then advances the cursor to EOF; a second drain is empty", async () => {
    const dir = await tempDir();
    const day = "2026-07-11";
    await writeSpine(dir, day, [codeChanged(["src/a.ts"]), foreignSirius()]);

    const first = await drainSpine(dir, null);
    expect(first.present).toBe(true);
    expect(first.events.length).toBe(2); // both lines consumed (foreign incl.)
    expect(first.cursor?.file).toBe(`${day}.jsonl`);
    const bytes = (await readFile(join(dir, ".suite", "events", `${day}.jsonl`))).length;
    expect(first.cursor?.offset).toBe(bytes); // advanced to EOF

    // Resuming from that cursor yields nothing new (no double-processing).
    const second = await drainSpine(dir, first.cursor);
    expect(second.events).toEqual([]);
    expect(second.cursor).toEqual(first.cursor);
  });

  test("absent spine → present:false, no events, cursor unchanged (clean no-op)", async () => {
    const dir = await tempDir();
    const drain = await drainSpine(dir, null);
    expect(drain.present).toBe(false);
    expect(drain.events).toEqual([]);
    expect(drain.cursor).toBeNull();
  });

  test("advances across the daily rollover, reading the newer file from offset 0", async () => {
    const dir = await tempDir();
    await writeSpine(dir, "2026-07-10", [codeChanged(["src/a.ts"])]);
    await writeSpine(dir, "2026-07-11", [codeChanged(["src/b.ts"])]);

    const drain = await drainSpine(dir, null);
    expect(drain.events.length).toBe(2);
    // Cursor lands in the NEWEST bucket at its EOF.
    expect(drain.cursor?.file).toBe("2026-07-11.jsonl");
    const bytes = (await readFile(join(dir, ".suite", "events", "2026-07-11.jsonl"))).length;
    expect(drain.cursor?.offset).toBe(bytes);
  });

  test("a torn trailing line in a SEALED (older) bucket is skipped; rollover still happens", async () => {
    // A crashed append can leave a sealed day-file without its final newline.
    // It can never be completed (producers only append to TODAY's file), so the
    // consumer must skip it and still roll forward — not wedge on it forever.
    const dir = await tempDir();
    const evDir = join(dir, ".suite", "events");
    await mkdir(evDir, { recursive: true });
    await writeFile(
      join(evDir, "2026-07-10.jsonl"),
      codeChanged(["src/a.ts"]) + "\n" + '{"v":1,"type":"code.changed","data":{"files":["torn"]', // no \n
      "utf-8",
    );
    await writeSpine(dir, "2026-07-11", [codeChanged(["src/b.ts"])]);

    const drain = await drainSpine(dir, null);
    // The one complete line from 07-10 + the complete line from 07-11; the torn
    // tail is dropped.
    expect(drain.events.length).toBe(2);
    expect(drain.cursor?.file).toBe("2026-07-11.jsonl");
  });

  test("an unreadable bucket does not throw — drains cleanly up to it", async () => {
    // Simulate an unreadable bucket with a DIRECTORY named like a day-file:
    // readFile(dir) throws EISDIR, which drainSpine must swallow, not propagate.
    const dir = await tempDir();
    const evDir = join(dir, ".suite", "events");
    await mkdir(join(evDir, "2026-07-11.jsonl"), { recursive: true });

    let threw = false;
    let drain;
    try {
      drain = await drainSpine(dir, null);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(drain!.present).toBe(true);
    expect(drain!.events).toEqual([]);
  });

  test("a trailing partial line in TODAY's file is NOT consumed; the cursor stops before it", async () => {
    const dir = await tempDir();
    const evDir = join(dir, ".suite", "events");
    await mkdir(evDir, { recursive: true });
    const whole = codeChanged(["src/a.ts"]) + "\n";
    const partial = '{"v":1,"type":"code.changed","data":{"files":["src/b.ts"]'; // no newline
    await writeFile(join(evDir, "2026-07-11.jsonl"), whole + partial, "utf-8");

    const drain = await drainSpine(dir, null);
    expect(drain.events.length).toBe(1); // only the complete line
    expect(drain.cursor?.offset).toBe(Buffer.byteLength(whole)); // stopped at the last \n
  });
});

describe("runConsume — end-to-end marking (in-process, cwd-injected)", () => {
  test("marks the anchored doc in index + frontmatter, advances the cursor, second run is a no-op", async () => {
    const dir = await tempDir();
    const day = "2026-07-11";
    await writeSpine(dir, day, [codeChanged(["src/a.ts"]), foreignSirius()]);
    await seedDocs(dir, [
      { path: "modules/a", relatedFiles: ["src/a.ts"] },
      { path: "modules/b", relatedFiles: ["src/b.ts"] },
    ]);

    const report = await runConsume({ cwd: dir, now: () => "2026-07-11T19:00:00.000Z" });
    expect(report.spinePresent).toBe(true);
    expect(report.codeChangedConsumed).toBe(1); // the foreign line doesn't count
    expect(report.eventsConsumed).toBe(2); // but IS consumed (cursor past it)
    expect(report.marked.map((m) => m.path)).toEqual(["modules/a"]);

    // Index: modules/a suspect, modules/b untouched.
    const idx = await readIndex(dir);
    const a = idx.docs.find((d) => d.path === "modules/a");
    const b = idx.docs.find((d) => d.path === "modules/b");
    expect(a.driftSuspectSince).toBe("2026-07-11T19:00:00.000Z");
    expect(a.driftSuspectReason).toContain("src/a.ts");
    // modules/b never had the field and must not have gained a suspect marker.
    expect(b.driftSuspectSince ?? "").toBe("");

    // Frontmatter APPENDED surgically; body preserved verbatim.
    const mdx = await readMdx(dir, "modules/a");
    expect(mdx).toContain(`driftSuspectSince: "2026-07-11T19:00:00.000Z"`);
    expect(mdx).toContain("Body paragraph that must survive marking.");

    // Cursor advanced to EOF.
    const cursor = await readCursor(dir);
    expect(cursor?.file).toBe(`${day}.jsonl`);
    const bytes = (await readFile(join(dir, ".suite", "events", `${day}.jsonl`))).length;
    expect(cursor?.offset).toBe(bytes);

    // Second run: nothing new on the spine → clean no-op, no re-marking.
    const again = await runConsume({ cwd: dir, now: () => "2099-01-01T00:00:00.000Z" });
    expect(again.codeChangedConsumed).toBe(0);
    expect(again.marked).toEqual([]);
    // The timestamp did NOT change (no double-processing / no churn).
    const idx2 = await readIndex(dir);
    expect(idx2.docs.find((d) => d.path === "modules/a").driftSuspectSince).toBe(
      "2026-07-11T19:00:00.000Z",
    );
  });

  test("a NEW code.changed touching an already-suspect doc → alreadySuspect, timestamp kept", async () => {
    const dir = await tempDir();
    await seedDocs(dir, [{ path: "m/a", relatedFiles: ["src/a.ts"], driftSuspectSince: "2026-01-01T00:00:00.000Z" }]);
    await writeSpine(dir, "2026-07-11", [codeChanged(["src/a.ts"])]);

    const report = await runConsume({ cwd: dir, now: () => "2026-07-11T19:00:00.000Z" });
    expect(report.marked).toEqual([]);
    expect(report.alreadySuspect).toEqual(["m/a"]);
    // Original timestamp preserved (not overwritten).
    const idx = await readIndex(dir);
    expect(idx.docs.find((d) => d.path === "m/a").driftSuspectSince).toBe("2026-01-01T00:00:00.000Z");
  });

  test("absent spine → clean no-op report (nothing marked)", async () => {
    const dir = await tempDir();
    await seedDocs(dir, [{ path: "m/a", relatedFiles: ["src/a.ts"] }]);
    const report = await runConsume({ cwd: dir });
    expect(report.spinePresent).toBe(false);
    expect(report.marked).toEqual([]);
    expect(report.cursor).toBeNull();
    // No cursor file was littered into a repo without a spine.
    expect(await readCursor(dir)).toBeNull();
  });

  test("spine present but no .docs/ → clean no-op (cursor still advances past events)", async () => {
    const dir = await tempDir();
    await writeSpine(dir, "2026-07-11", [codeChanged(["src/a.ts"])]);
    const report = await runConsume({ cwd: dir });
    expect(report.spinePresent).toBe(true);
    expect(report.marked).toEqual([]);
    // Cursor advanced so a later run (after docs appear) won't reprocess history.
    expect((await readCursor(dir))?.file).toBe("2026-07-11.jsonl");
  });
});

describe("catryna consume (end-to-end through the CLI)", () => {
  test("--json emits exactly ONE JSON object, exits 0, and marks the doc", async () => {
    const dir = await tempDir();
    await writeSpine(dir, "2026-07-11", [codeChanged(["src/a.ts"]), foreignSirius()]);
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"] }]);

    const { stdout, stderr, code } = await runCli(dir, ["consume", "--json"]);
    expect(code, stderr).toBe(0);

    const trimmed = stdout.trim();
    const parsed = JSON.parse(trimmed);
    expect(trimmed).toBe(JSON.stringify(parsed)); // nothing else on stdout (§4 rule 1)
    expect(parsed.tool).toBe("catryna");
    expect(parsed.command).toBe("consume");
    expect(parsed.spinePresent).toBe(true);
    expect(parsed.summary.codeChanged).toBe(1);
    expect(parsed.summary.marked).toBe(1);
    expect(parsed.marked[0].path).toBe("modules/a");
    expect(parsed.marked[0].anchors).toContain("src/a.ts");
    expect(parsed.cursor.file).toBe("2026-07-11.jsonl");

    // The store was actually written.
    const idx = await readIndex(dir);
    expect(idx.docs.find((d) => d.path === "modules/a").driftSuspectSince.length).toBeGreaterThan(0);
  });

  test("human mode: bare temp dir (no spine, no docs) is a clean no-op, exit 0", async () => {
    const dir = await tempDir();
    const { stdout, code } = await runCli(dir, ["consume"]);
    expect(code).toBe(0);
    expect(stdout).toContain("no suite spine");
  });
});

describe("buildConsumeJson shape", () => {
  test("carries command, summary, marked, and cursor (§4 rule 1 body)", () => {
    const report: ConsumeReport = {
      spinePresent: true,
      codeChangedConsumed: 2,
      eventsConsumed: 3,
      marked: [{ path: "m/a", anchors: ["src/a.ts"] }],
      alreadySuspect: ["m/b"],
      cursor: { file: "2026-07-11.jsonl", offset: 512 },
    };
    const json = buildConsumeJson(report) as any;
    expect(json.command).toBe("consume");
    expect(json.summary).toEqual({ codeChanged: 2, events: 3, marked: 1, alreadySuspect: 1 });
    expect(json.marked).toEqual([{ path: "m/a", anchors: ["src/a.ts"] }]);
    expect(json.alreadySuspect).toEqual(["m/b"]);
    expect(json.cursor).toEqual({ file: "2026-07-11.jsonl", offset: 512 });
  });
});
