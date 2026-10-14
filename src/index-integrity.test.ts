/**
 * `_index.json` is the only record of every doc's metadata, drift baseline and
 * anchors. These tests pin two things about how storage treats it:
 *
 *   - B2: an index that EXISTS but can't be parsed (merge-conflict markers,
 *     truncation) is an error and is left byte-for-byte untouched. It used to be
 *     silently replaced by an empty index. Only a MISSING index is created.
 *   - B5: breaking a stale lock must not delete a live lock that replaced it.
 *
 * Storage resolves `.docs/` from `process.cwd()` at module load, so each
 * scenario runs in a subprocess whose cwd is a fresh temp project.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { retryTransientFs } from "./storage";

const STORAGE_PATH = fileURLToPath(new URL("./storage.ts", import.meta.url));

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function project(index?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "catryna-integrity-"));
  dirs.push(dir);
  await mkdir(join(dir, ".docs"), { recursive: true });
  if (index !== undefined) await writeFile(join(dir, ".docs", "_index.json"), index);
  return dir;
}

/** Run `body` in a subprocess with cwd = `dir`; return its last stdout line as JSON. */
async function scenario(dir: string, body: string): Promise<any> {
  const fixture = join(dir, "fixture.ts");
  await writeFile(
    fixture,
    `import * as storage from ${JSON.stringify(STORAGE_PATH)};
import { readFile, writeFile, utimes, readdir } from "node:fs/promises";
import { join } from "node:path";
const { loadIndex, readIndexAt, createDoc, listDocs, saveIndex } = storage;
const DOCS = join(process.cwd(), ".docs");
const msg = (e: any) => ({ name: e?.name, code: e?.code, message: String(e?.message ?? e) });
${body}
`,
  );
  const proc = Bun.spawn([process.execPath, "run", fixture], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`fixture exited ${code}: ${stderr}`);
  const lines = stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

const indexPath = (dir: string) => join(dir, ".docs", "_index.json");

const GOOD = JSON.stringify({ version: 1, docs: [{ id: "x", path: "a/b", title: "T" }], lastUpdated: 1 });
const CONFLICTED =
  '{\n  "version": 1,\n  "docs": [\n<<<<<<< HEAD\n    {"id": "a", "path": "a"}\n=======\n    {"id": "b", "path": "b"}\n>>>>>>> feature\n  ]\n}\n';

describe("a corrupt _index.json is an error and is never overwritten (B2)", () => {
  test("merge-conflict markers: loadIndex throws naming the file and the markers; file unchanged", async () => {
    const dir = await project(CONFLICTED);
    const r = await scenario(
      dir,
      `try { await loadIndex(); console.log(JSON.stringify({ threw: false })); }
       catch (e) { console.log(JSON.stringify({ threw: true, ...msg(e) })); }`,
    );
    expect(r.threw).toBe(true);
    expect(r.name).toBe("IndexUnreadableError");
    expect(r.message).toContain("_index.json");
    expect(r.message).toContain("merge-conflict markers");
    expect(r.message).toContain("<<<<<<<");
    expect(await readFile(indexPath(dir), "utf-8")).toBe(CONFLICTED);
  });

  test("truncated JSON: loadIndex throws; file unchanged", async () => {
    const truncated = GOOD.slice(0, GOOD.length - 9);
    const dir = await project(truncated);
    const r = await scenario(
      dir,
      `try { await loadIndex(); console.log(JSON.stringify({ threw: false })); }
       catch (e) { console.log(JSON.stringify({ threw: true, ...msg(e) })); }`,
    );
    expect(r.threw).toBe(true);
    expect(r.name).toBe("IndexUnreadableError");
    expect(r.message).toContain("_index.json");
    expect(r.message).not.toContain("contains git merge-conflict markers");
    expect(await readFile(indexPath(dir), "utf-8")).toBe(truncated);
  });

  test("an empty file or a non-index JSON value is an error too, and left alone", async () => {
    for (const content of ["", "null", "[]", '{"version":1}']) {
      const dir = await project(content);
      const r = await scenario(
        dir,
        `try { await loadIndex(); console.log(JSON.stringify({ threw: false })); }
         catch (e) { console.log(JSON.stringify({ threw: true, ...msg(e) })); }`,
      );
      expect(r.threw).toBe(true);
      expect(await readFile(indexPath(dir), "utf-8")).toBe(content);
    }
  });

  test("a write tool (createDoc) refuses a conflicted index instead of replacing it", async () => {
    const dir = await project(CONFLICTED);
    const r = await scenario(
      dir,
      `try { await createDoc("m/a", "A", [{ type: "text", data: { content: "x" } }]); console.log(JSON.stringify({ threw: false })); }
       catch (e) { console.log(JSON.stringify({ threw: true, ...msg(e) })); }`,
    );
    expect(r.threw).toBe(true);
    expect(r.message).toContain("merge-conflict markers");
    expect(await readFile(indexPath(dir), "utf-8")).toBe(CONFLICTED);
  });

  test("readIndexAt (read-only callers) throws the same clear error and writes nothing", async () => {
    const dir = await project(CONFLICTED);
    const r = await scenario(
      dir,
      `try { await readIndexAt(process.cwd()); console.log(JSON.stringify({ threw: false })); }
       catch (e) { console.log(JSON.stringify({ threw: true, ...msg(e) })); }`,
    );
    expect(r.threw).toBe(true);
    expect(r.message).toContain("merge-conflict markers");
    expect(await readFile(indexPath(dir), "utf-8")).toBe(CONFLICTED);
  });

  test("a MISSING index is still created, empty", async () => {
    const dir = await project(); // .docs/ exists, no _index.json
    const r = await scenario(dir, `const i = await loadIndex(); console.log(JSON.stringify({ docs: i.docs.length }));`);
    expect(r.docs).toBe(0);
    const written = JSON.parse(await readFile(indexPath(dir), "utf-8"));
    expect(written.docs).toEqual([]);
    expect(written.version).toBe(1);
  });

  test("a missing .docs/ directory is created along with the index", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catryna-integrity-"));
    dirs.push(dir);
    const r = await scenario(dir, `const i = await loadIndex(); console.log(JSON.stringify({ docs: i.docs.length }));`);
    expect(r.docs).toBe(0);
    expect(JSON.parse(await readFile(indexPath(dir), "utf-8")).docs).toEqual([]);
  });

  test("a good index loads and is not rewritten by a read", async () => {
    const dir = await project(GOOD);
    const r = await scenario(dir, `const i = await loadIndex(); console.log(JSON.stringify({ docs: i.docs.length }));`);
    expect(r.docs).toBe(1);
    expect(await readFile(indexPath(dir), "utf-8")).toBe(GOOD);
  });

  test("a torn read is re-read, not reported: a file that becomes valid within the retry window loads", async () => {
    const dir = await project('{"version":1,"docs":[');
    const r = await scenario(
      dir,
      `setTimeout(() => { writeFile(join(DOCS, "_index.json"), ${JSON.stringify(GOOD)}); }, 10);
       const i = await loadIndex();
       console.log(JSON.stringify({ docs: i.docs.length }));`,
    );
    expect(r.docs).toBe(1);
    expect(await readFile(indexPath(dir), "utf-8")).toBe(GOOD);
  });
});

describe("retryTransientFs", () => {
  const noSleep = async () => {};
  const fail = (code: string) => Object.assign(new Error(code), { code });

  test("retries EBUSY / EPERM / EACCES, then succeeds", async () => {
    for (const code of ["EBUSY", "EPERM", "EACCES"]) {
      let calls = 0;
      const v = await retryTransientFs(
        async () => {
          if (++calls < 3) throw fail(code);
          return "ok";
        },
        6,
        noSleep,
      );
      expect(v).toBe("ok");
      expect(calls).toBe(3);
    }
  });

  test("gives up after the attempt budget and rethrows the last error", async () => {
    let calls = 0;
    await expect(
      retryTransientFs(
        async () => {
          calls++;
          throw fail("EBUSY");
        },
        4,
        noSleep,
      ),
    ).rejects.toMatchObject({ code: "EBUSY" });
    expect(calls).toBe(4);
  });

  test("any other error is not retried (ENOENT must reach the caller at once)", async () => {
    let calls = 0;
    await expect(
      retryTransientFs(
        async () => {
          calls++;
          throw fail("ENOENT");
        },
        6,
        noSleep,
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls).toBe(1);
  });
});

describe("breaking a stale lock never deletes a live one (B5)", () => {
  const STALE_SCRIPT = (body: string) => `
    const LOCK = join(DOCS, "_index.lock");
    const past = new Date(Date.now() - 60_000);
    ${body}
  `;

  test("a stale lock is broken and leaves no tombstone behind", async () => {
    const dir = await project(GOOD);
    const r = await scenario(
      dir,
      STALE_SCRIPT(`
        await writeFile(LOCK, "dead-owner");
        await utimes(LOCK, past, past);
        await storage.breakStaleLock();
        const left = (await readdir(DOCS)).filter((f) => f.startsWith("_index.lock"));
        console.log(JSON.stringify({ left }));
      `),
    );
    expect(r.left).toEqual([]);
  });

  test("a fresh lock is left alone", async () => {
    const dir = await project(GOOD);
    const r = await scenario(
      dir,
      STALE_SCRIPT(`
        await writeFile(LOCK, "live-owner");
        await storage.breakStaleLock();
        console.log(JSON.stringify({ content: await readFile(LOCK, "utf-8") }));
      `),
    );
    expect(r.content).toBe("live-owner");
  });

  test("the stale lock was replaced by a LIVE one after we judged it: the live lock survives", async () => {
    const dir = await project(GOOD);
    const r = await scenario(
      dir,
      STALE_SCRIPT(`
        await writeFile(LOCK, "dead-owner");
        await utimes(LOCK, past, past);
        // Between the stale verdict and the break: another waiter breaks the
        // stale lock and a new holder takes a fresh one.
        storage.__setStaleBreakHookForTesting(async () => {
          const { unlink } = await import("node:fs/promises");
          await unlink(LOCK);
          await writeFile(LOCK, "live-owner", { flag: "wx" });
        });
        await storage.breakStaleLock();
        const files = (await readdir(DOCS)).filter((f) => f.startsWith("_index.lock"));
        console.log(JSON.stringify({ files, content: await readFile(LOCK, "utf-8") }));
      `),
    );
    // Unfixed (stat + unlink): the live lock is gone.
    expect(r.content).toBe("live-owner");
    expect(r.files).toEqual(["_index.lock"]); // and no tombstone left behind
  });

  test("the stale lock was already broken by someone else: nothing is deleted", async () => {
    const dir = await project(GOOD);
    const r = await scenario(
      dir,
      STALE_SCRIPT(`
        await writeFile(LOCK, "dead-owner");
        await utimes(LOCK, past, past);
        storage.__setStaleBreakHookForTesting(async () => {
          const { unlink } = await import("node:fs/promises");
          await unlink(LOCK);
        });
        await storage.breakStaleLock();
        console.log(JSON.stringify({ files: (await readdir(DOCS)).filter((f) => f.startsWith("_index.lock")) }));
      `),
    );
    expect(r.files).toEqual([]);
  });

  test("a directory at the lock path is never renamed away", async () => {
    const dir = await project(GOOD);
    const r = await scenario(
      dir,
      STALE_SCRIPT(`
        const { mkdir } = await import("node:fs/promises");
        await mkdir(LOCK);
        await utimes(LOCK, past, past);
        await storage.breakStaleLock();
        console.log(JSON.stringify({ files: (await readdir(DOCS)).filter((f) => f.startsWith("_index.lock")) }));
      `),
    );
    expect(r.files).toEqual(["_index.lock"]);
  });
});
