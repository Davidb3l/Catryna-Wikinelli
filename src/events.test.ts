/**
 * Tests for the suite event spine producer (SUITE_CONTRACTS §2).
 *
 * Covers the envelope shape, the daily bucket, the append-only write, the
 * best-effort swallow, and — end to end in a subprocess — that `createDoc`
 * actually lands a `doc.created` line on the spine after the store write.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bucketFor,
  buildEvent,
  docUri,
  emitEvent,
  eventsDir,
  hayvenNodeName,
  parseHayvenNodeRef,
  SPINE_VERSION,
} from "./events";

const STORAGE_PATH = fileURLToPath(new URL("./storage.ts", import.meta.url));

let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "catryna-events-"));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("envelope + helpers (pure)", () => {
  test("buildEvent produces a conformant §2 envelope", () => {
    const ev = buildEvent(
      "doc.created",
      [docUri("modules/auth")],
      { path: "modules/auth" },
      "id-123",
      "2026-07-11T18:42:11.000Z",
    );
    expect(ev.v).toBe(SPINE_VERSION);
    expect(ev.v).toBe(1);
    expect(ev.id).toBe("id-123");
    expect(ev.ts).toBe("2026-07-11T18:42:11.000Z");
    expect(ev.source).toBe("catryna");
    expect(ev.type).toBe("doc.created");
    expect(ev.refs).toEqual(["catryna:doc/modules/auth"]);
    expect(ev.data).toEqual({ path: "modules/auth" });
  });

  test("docUri uses the catryna: scheme", () => {
    expect(docUri("a/b/c")).toBe("catryna:doc/a/b/c");
  });

  test("bucketFor is the event's UTC day", () => {
    expect(bucketFor("2026-07-11T23:59:59.999Z")).toBe("2026-07-11.jsonl");
    expect(bucketFor("2026-01-02T00:00:00.000Z")).toBe("2026-01-02.jsonl");
  });
});

describe("hayven node helpers (pure)", () => {
  test("hayvenNodeName is the last /-delimited segment of a node id", () => {
    expect(hayvenNodeName("daemon/graph/ingest/runIngest")).toBe("runIngest");
    // Method segments keep their dot.
    expect(hayvenNodeName("auth/login/Session.refresh")).toBe("Session.refresh");
    // A bare name (no slash) is returned unchanged.
    expect(hayvenNodeName("runIngest")).toBe("runIngest");
    // A trailing slash yields the empty final segment.
    expect(hayvenNodeName("a/b/")).toBe("");
  });

  test("parseHayvenNodeRef strips the hayven:node/ prefix, else null", () => {
    expect(parseHayvenNodeRef("hayven:node/daemon/graph/ingest/runIngest")).toBe(
      "daemon/graph/ingest/runIngest",
    );
    expect(parseHayvenNodeRef("hayven:node/runIngest")).toBe("runIngest");
    // Foreign / non-node URIs are not node refs.
    expect(parseHayvenNodeRef("catryna:doc/modules/auth")).toBeNull();
    expect(parseHayvenNodeRef("sirius:receipt/1")).toBeNull();
    expect(parseHayvenNodeRef("runIngest")).toBeNull();
  });

  test("the ref and data.symbols paths agree on the bare name", () => {
    // A hayven:node/<id> ref reduces to the SAME bare name as <id> in data.symbols.
    const id = "daemon/graph/ingest/runIngest";
    expect(hayvenNodeName(parseHayvenNodeRef(`hayven:node/${id}`)!)).toBe(hayvenNodeName(id));
  });
});

describe("emitEvent (I/O)", () => {
  test("appends one parseable JSON line to the daily bucket", async () => {
    await emitEvent("doc.created", [docUri("x")], { path: "x" }, tmp);

    const dir = eventsDir(tmp);
    const files = await readdir(dir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/);

    const raw = await readFile(join(dir, files[0]), "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
    const ev = JSON.parse(lines[0]);
    expect(ev.source).toBe("catryna");
    expect(ev.type).toBe("doc.created");
    expect(ev.refs).toEqual(["catryna:doc/x"]);
    expect(typeof ev.id).toBe("string");
    expect(ev.id.length).toBeGreaterThan(0);
    // The bucket filename matches the event's own ts (both UTC).
    expect(files[0]).toBe(bucketFor(ev.ts));
  });

  test("is append-only: a second emit adds a line, never rewrites", async () => {
    const dir = eventsDir(tmp);
    const before = (await readFile(join(dir, (await readdir(dir))[0]), "utf-8"))
      .split("\n")
      .filter(Boolean).length;

    await emitEvent("doc.updated", [docUri("x")], { path: "x" }, tmp);

    const files = await readdir(dir);
    // Same day → same bucket; the line count grew by exactly one.
    const raw = await readFile(join(dir, files[0]), "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines.length).toBe(before + 1);
    expect(JSON.parse(lines[lines.length - 1]).type).toBe("doc.updated");
  });

  test("best-effort: a failing write never throws into the caller", async () => {
    // Point cwd at a FILE, so mkdir(.suite/events) fails with ENOTDIR. emitEvent
    // must swallow it and resolve. (Uses this test file itself as the 'cwd'.)
    const asFileCwd = fileURLToPath(import.meta.url);
    let threw = false;
    try {
      await emitEvent("doc.created", [docUri("y")], { path: "y" }, asFileCwd);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe("end-to-end: createDoc emits on the spine", () => {
  test("a doc write lands a doc.created line in a fresh project dir", async () => {
    const proj = await mkdtemp(join(tmpdir(), "catryna-proj-"));
    // Run storage in a subprocess whose cwd IS the temp project, so both the
    // store (.docs/) and the spine (.suite/) resolve there. Proves the wiring:
    // remove the emitEvent call in createDoc and this fails.
    const fixture = join(proj, "emit-fixture.ts");
    await writeFile(
      fixture,
      `import { createDoc } from ${JSON.stringify(STORAGE_PATH)};\n` +
        `await createDoc("modules/auth", "Auth", [{ type: "text", data: { content: "hi" } }]);\n`,
    );
    const proc = Bun.spawn(["bun", "run", fixture], {
      cwd: proj,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    if (code !== 0) console.error(stderr);

    const dir = eventsDir(proj);
    const files = await readdir(dir);
    expect(files.length).toBe(1);
    const raw = await readFile(join(dir, files[0]), "utf-8");
    const events = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const created = events.find((e) => e.type === "doc.created");
    expect(created).toBeDefined();
    expect(created.source).toBe("catryna");
    expect(created.refs).toEqual(["catryna:doc/modules/auth"]);
    expect(created.data.path).toBe("modules/auth");
    expect(created.data.title).toBe("Auth");

    await rm(proj, { recursive: true, force: true });
  });
});
