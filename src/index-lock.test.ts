/**
 * The cross-process `_index.json` lock must HOLD on the errors Windows raises.
 *
 * `acquireIndexFileLock` creates `.docs/_index.lock` with `{flag:"wx"}`. On
 * Windows, a lock file that another process is in the middle of deleting (or
 * has open) makes that create fail with EPERM / EACCES / EBUSY rather than
 * EEXIST. The lock treated every non-EEXIST error as "can't lock here" and ran
 * the index write UNLOCKED, so concurrent `catryna verify` processes lost each
 * other's baselines (seen as a flaky drift-lifecycle failure on windows-latest).
 *
 * These tests inject the error codes through `__setIndexLockCreateForTesting`
 * rather than relying on Windows timing, so they are deterministic on every OS.
 * Storage resolves `.docs/` from `process.cwd()` at module load, so each
 * scenario runs in a subprocess whose cwd is a fresh temp project.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const STORAGE_PATH = fileURLToPath(new URL("./storage.ts", import.meta.url));

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Run `body` in a subprocess (cwd = fresh project); return its last stdout line as JSON. */
async function scenario(body: string): Promise<any> {
  const dir = await mkdtemp(join(tmpdir(), "catryna-lock-"));
  dirs.push(dir);
  const fixture = join(dir, "fixture.ts");
  await writeFile(
    fixture,
    `import { __setIndexLockCreateForTesting, createDoc } from ${JSON.stringify(STORAGE_PATH)};
import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
const LOCK = join(process.cwd(), ".docs", "_index.lock");
const fail = (code: string) => Object.assign(new Error(code + ": injected"), { code });
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

describe("index lock under Windows contention errors", () => {
  for (const code of ["EPERM", "EACCES", "EBUSY"]) {
    test(`${code} from the lock create means "held": retry, then write UNDER the lock`, async () => {
      const r = await scenario(`
        let calls = 0;
        let lockHeldWhileCreated = false;
        __setIndexLockCreateForTesting(async (path, token) => {
          calls++;
          if (calls <= 3) throw fail(${JSON.stringify(code)});
          await writeFile(path, token, { flag: "wx" });
        });
        await createDoc("m/a", "A", [{ type: "text", data: { content: "x" } }]);
        console.log(JSON.stringify({ calls, lockGoneAfter: !existsSync(LOCK) }));
      `);
      // Unfixed: one call, then the write ran unlocked.
      expect(r.calls).toBe(4);
      expect(r.lockGoneAfter).toBe(true); // released afterwards
    }, 30_000);
  }

  test("a lock that is mid-delete (EPERM while it still exists) is WAITED for", async () => {
    // The real Windows shape: the previous holder's lock still exists, and the
    // create fails with EPERM rather than EEXIST until it is gone.
    const r = await scenario(`
      await createDoc("m/seed", "Seed", [{ type: "text", data: { content: "x" } }]);
      await writeFile(LOCK, "someone else");
      __setIndexLockCreateForTesting(async (path, token) => {
        if (existsSync(path)) throw fail("EPERM");
        await writeFile(path, token, { flag: "wx" });
      });
      setTimeout(() => unlink(LOCK), 400);
      const t0 = Date.now();
      await createDoc("m/a", "A", [{ type: "text", data: { content: "x" } }]);
      console.log(JSON.stringify({ waitedMs: Date.now() - t0 }));
    `);
    // Unfixed: returned at once and wrote while "someone else" held the lock.
    expect(r.waitedMs).toBeGreaterThanOrEqual(350);
  }, 30_000);

  test("any other error keeps the unlocked fallback: the write still succeeds, at once", async () => {
    // EROFS / ENOSPC mean the directory can't hold a lock at all. Waiting 30s on
    // every write there would turn the lock into a new failure mode.
    const r = await scenario(`
      let calls = 0;
      __setIndexLockCreateForTesting(async () => {
        calls++;
        throw fail("EROFS");
      });
      const t0 = Date.now();
      const meta = await createDoc("m/a", "A", [{ type: "text", data: { content: "x" } }]);
      console.log(JSON.stringify({ calls, ms: Date.now() - t0, created: meta.path }));
    `);
    expect(r.calls).toBe(1);
    expect(r.created).toBe("m/a");
    expect(r.ms).toBeLessThan(5_000);
  }, 30_000);
});
