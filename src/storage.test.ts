/**
 * Concurrency test for the `_index.json` read-modify-write path.
 *
 * `createDoc`/`updateDoc`/`deleteDoc` share a single index file and mutate it
 * with `loadIndex()` → mutate → `saveIndex()`. Without serialization, two
 * concurrent MCP write calls interleave and the second overwrite drops the
 * first entry. These tests fire many writes concurrently and assert nothing is
 * lost — they FAIL if the `withIndexLock` serialization regresses (verified by
 * mutation).
 *
 * Storage resolves paths from `process.cwd()` captured at module load, so each
 * scenario runs in a subprocess whose cwd is a fresh temp project.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const STORAGE_PATH = fileURLToPath(new URL("./storage.ts", import.meta.url));

/** Run `code` in a subprocess with cwd = a fresh temp project; return its dir. */
async function runInProject(code: string): Promise<{ dir: string; code: number; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), "catryna-store-"));
  const fixture = join(dir, "fixture.ts");
  await writeFile(fixture, `import { createDoc, updateDoc, deleteDoc } from ${JSON.stringify(STORAGE_PATH)};\n${code}\n`);
  const proc = Bun.spawn(["bun", "run", fixture], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { dir, code: exit, stderr };
}

async function readIndex(dir: string): Promise<{ docs: { path: string }[] }> {
  return JSON.parse(await readFile(join(dir, ".docs", "_index.json"), "utf-8"));
}

const dirs: string[] = [];
beforeAll(() => {});
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe("index read-modify-write is serialized", () => {
  test("20 concurrent createDoc calls all survive in _index.json", async () => {
    const { dir, code, stderr } = await runInProject(`
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          createDoc("m/doc" + i, "Doc " + i, [{ type: "text", data: { content: "x" } }])
        )
      );
    `);
    dirs.push(dir);
    expect(code, stderr).toBe(0);

    const index = await readIndex(dir);
    expect(index.docs.length).toBe(20);
    // Every path is present exactly once (no clobber, no dupe).
    const paths = new Set(index.docs.map((d) => d.path));
    expect(paths.size).toBe(20);
    for (let i = 0; i < 20; i++) expect(paths.has("m/doc" + i)).toBe(true);
  });

  test("concurrent same-path createDoc yields exactly one index entry", async () => {
    // Two+ concurrent createDoc for the SAME path each load a fresh index inside
    // the lock; without an in-lock same-path dedupe they both push, leaving
    // duplicate entries (later getDoc/updateDoc/deleteDoc see only the first and
    // dangle the rest). The invariant is "at most one entry per path".
    const { dir, code, stderr } = await runInProject(`
      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          createDoc("dup/same", "Title " + i, [{ type: "text", data: { content: "x" + i } }])
        )
      );
    `);
    dirs.push(dir);
    expect(code, stderr).toBe(0);

    const index = await readIndex(dir);
    const sameEntries = index.docs.filter((d) => d.path === "dup/same");
    expect(sameEntries.length).toBe(1);
  });

  test("concurrent createDoc + updateDoc: no entry lost", async () => {
    const { dir, code, stderr } = await runInProject(`
      // Seed a doc, then fire a batch of new creates concurrently with an update
      // to the seed. The update must not overwrite the index without the creates.
      await createDoc("seed", "Seed", [{ type: "text", data: { content: "s" } }]);
      await Promise.all([
        updateDoc("seed", { title: "Seed v2" }),
        ...Array.from({ length: 10 }, (_, i) =>
          createDoc("c/doc" + i, "Doc " + i, [{ type: "text", data: { content: "x" } }])
        ),
      ]);
    `);
    dirs.push(dir);
    expect(code, stderr).toBe(0);

    const index = await readIndex(dir);
    // seed + 10 creates = 11 entries; the update kept the seed (retitled).
    expect(index.docs.length).toBe(11);
    const bySeed = index.docs.find((d) => d.path === "seed");
    expect(bySeed).toBeDefined();
    for (let i = 0; i < 10; i++) {
      expect(index.docs.some((d) => d.path === "c/doc" + i)).toBe(true);
    }
  });
});
