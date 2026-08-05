/**
 * The drift LIFECYCLE traps — the ways a correct user still ends up with a
 * wrong-but-verified doc. Each block here names the trap it closes; every one of
 * them cost real time in a 101-doc corpus repaired across parallel agents.
 *
 *  1. `verify` did not sync frontmatter `relatedFiles` into `_index.json`, so
 *     the obvious repair (add the file to the doc's frontmatter) did nothing:
 *     drift kept reading the stale list and the doc stayed unmonitored, with no
 *     way to tell.
 *  2. (in lint.test.ts) `lint` reported hollow docs as well-formed.
 *  3. `drift` gave no signal when the working tree was dirty, so a repair pass
 *     could run against a report that could not see the code it was repairing.
 *  4. `verify` wrote the shared `_index.json` with no cross-PROCESS lock, so
 *     parallel agents each shelling out to `catryna verify` clobbered each
 *     other's baselines.
 *
 * Fixture is a real temp git repo, as in drift.test.ts. Anything that WRITES
 * goes through the real CLI in a subprocess, because storage.ts resolves
 * `.docs/` from the `process.cwd()` captured at module load — which is also what
 * makes the concurrency test in #4 a genuine multi-process race rather than a
 * simulation of one.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { computeDrift, countDirtyFiles } from "./drift";

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url));

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function git(dir: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${err}`);
  return out.trim();
}

async function writeFileAt(dir: string, rel: string, content: string): Promise<void> {
  const p = join(dir, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content);
}

async function initRepo(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "catryna-lifecycle-"));
  dirs.push(dir);
  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.email", "test@catryna.local"]);
  await git(dir, ["config", "user.name", "Catryna Test"]);
  await git(dir, ["config", "commit.gpgsign", "false"]);
  for (const [rel, content] of Object.entries(files)) await writeFileAt(dir, rel, content);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "--allow-empty", "-m", "initial"]);
  return dir;
}

interface SeedDoc {
  path: string;
  /** What the INDEX records (what drift reads today). */
  relatedFiles: string[];
  /** What the .mdx FRONTMATTER records; defaults to `relatedFiles`. */
  frontmatterRelatedFiles?: string[];
  verifiedCommit?: string;
}

/** Seed `.docs/` directly, letting the index and the frontmatter DISAGREE. */
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
    anchors: [] as unknown[],
    evidence: [] as string[],
    refs: [] as string[],
    verifiedCommit: d.verifiedCommit ?? "",
    verifiedAt: d.verifiedCommit ? new Date(now).toISOString() : "",
    driftSuspectSince: "",
    driftSuspectReason: "",
    createdAt: now,
    updatedAt: now,
    createdBy: "test",
  }));
  await writeFile(
    join(docsDir, "_index.json"),
    JSON.stringify({ version: 1, docs: meta, lastUpdated: now }, null, 2),
  );
  for (const [i, m] of meta.entries()) {
    const file = join(docsDir, `${m.path}.mdx`);
    await mkdir(dirname(file), { recursive: true });
    const fmRelated = docs[i].frontmatterRelatedFiles ?? docs[i].relatedFiles;
    await writeFile(
      file,
      `---\nid: ${m.id}\ntitle: ${JSON.stringify(m.title)}\npath: ${JSON.stringify(m.path)}\n` +
        `tags: []\nrelatedFiles: ${JSON.stringify(fmRelated)}\nanchors: []\nevidence: []\nrefs: []\n` +
        `verifiedCommit: ${JSON.stringify(m.verifiedCommit)}\nverifiedAt: ${JSON.stringify(m.verifiedAt)}\n` +
        `driftSuspectSince: ""\ndriftSuspectReason: ""\n` +
        `createdAt: ${m.createdAt}\nupdatedAt: ${m.updatedAt}\ncreatedBy: "test"\n---\n\n` +
        `# ${m.title}\n\nBody paragraph that must survive verify.\n`,
    );
  }
}

async function readIndex(dir: string): Promise<{ docs: any[] }> {
  return JSON.parse(await readFile(join(dir, ".docs", "_index.json"), "utf-8"));
}

const indexEntry = async (dir: string, path: string) =>
  (await readIndex(dir)).docs.find((d) => d.path === path);

interface CliOut {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Invoke the real `catryna` CLI with cwd = `dir`.
 *
 * `timeoutMs` kills the child and reports `timedOut` rather than letting the
 * suite hang — a hang is a FINDING here (see the lock tests), and it has to be
 * observable as a failed assertion instead of a wedged test run.
 */
async function runCli(
  dir: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<CliOut & { timedOut: boolean }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill(9);
    } catch {
      /* already gone */
    }
  }, timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { stdout, stderr, code, timedOut };
}

// ---------------------------------------------------------------------------
// #1 — verify reconciles frontmatter anchors into the index.
// ---------------------------------------------------------------------------

describe("#1 verify syncs frontmatter relatedFiles into _index.json", () => {
  /**
   * BOTH halves, per the acceptance bar: the index must reflect the new anchor,
   * AND drift must then actually flag the doc when that file changes. Asserting
   * only the first would pass on a fix that wrote the field somewhere drift
   * never reads.
   */
  test("a hand-added frontmatter anchor reaches the index, and drift then flags it", async () => {
    const dir = await initRepo({
      "src/a.ts": "export const a = 1;\n",
      "src/late.ts": "export const late = 1;\n",
    });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    // The trap exactly: the index lists only a.ts, but a human has edited the
    // .mdx frontmatter to also claim late.ts — the file the doc describes.
    await seedDocs(dir, [
      {
        path: "modules/a",
        relatedFiles: ["src/a.ts"],
        frontmatterRelatedFiles: ["src/a.ts", "src/late.ts"],
        verifiedCommit: baseline,
      },
    ]);

    expect((await indexEntry(dir, "modules/a")).relatedFiles).toEqual(["src/a.ts"]);

    const run = await runCli(dir, ["verify", "modules/a"]);
    expect(run.code).toBe(0);

    // Half one: the index caught up with the file.
    expect((await indexEntry(dir, "modules/a")).relatedFiles).toEqual([
      "src/a.ts",
      "src/late.ts",
    ]);

    // Half two: the new anchor is LIVE — changing late.ts drifts the doc.
    await writeFileAt(dir, "src/late.ts", "export const late = 2; // changed\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "touch late"]);

    const report = await computeDrift(dir, { emit: false });
    expect(report.drifted.map((d) => d.path)).toEqual(["modules/a"]);
    expect(report.drifted[0].changedFiles).toEqual(["src/late.ts"]);
  });

  test("structured `anchors` sync the same way", async () => {
    const dir = await initRepo({ "src/a.ts": "export function hi() { return 1; }\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "modules/a", relatedFiles: [], verifiedCommit: baseline },
    ]);
    // Hand-edit the frontmatter's `anchors` line, as a repairing agent would.
    const mdx = join(dir, ".docs", "modules", "a.mdx");
    const raw = await readFile(mdx, "utf-8");
    await writeFile(
      mdx,
      raw.replace(
        "anchors: []",
        `anchors: [{"file":"src/a.ts","symbol":"hi"}]`,
      ),
    );

    expect((await runCli(dir, ["verify", "modules/a"])).code).toBe(0);
    expect((await indexEntry(dir, "modules/a")).anchors).toEqual([
      { file: "src/a.ts", symbol: "hi" },
    ]);
  });

  /**
   * The guard against over-firing: a doc whose frontmatter predates the field
   * must not have its index anchors wiped by an ABSENT key. "Absent" and "empty"
   * are different statements and only one of them means "anchors nothing".
   */
  test("an absent frontmatter key does not erase the index's anchors", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"] }]);
    const mdx = join(dir, ".docs", "modules", "a.mdx");
    const raw = await readFile(mdx, "utf-8");
    await writeFile(
      mdx,
      raw
        .split("\n")
        .filter((l) => !l.startsWith("relatedFiles:") && !l.startsWith("anchors:"))
        .join("\n"),
    );

    expect((await runCli(dir, ["verify", "modules/a"])).code).toBe(0);
    expect((await indexEntry(dir, "modules/a")).relatedFiles).toEqual(["src/a.ts"]);
  });

  /**
   * A frontmatter `relatedFiles: []` IS a statement — "this doc anchors
   * nothing" — and must be honored, or removing a wrong anchor stays impossible.
   */
  test("an explicitly empty frontmatter list clears the index's anchors", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [
      { path: "modules/a", relatedFiles: ["src/a.ts"], frontmatterRelatedFiles: [] },
    ]);
    expect((await runCli(dir, ["verify", "modules/a"])).code).toBe(0);
    expect((await indexEntry(dir, "modules/a")).relatedFiles).toEqual([]);
  });
});

/**
 * REGRESSION — the sync must never DELETE anchors it merely failed to read.
 *
 * Both parsers behind it return `[]` for input they can't decode, and `[]` is
 * also how a doc says "I anchor nothing". Conflating those turned the fix into
 * something strictly worse than the bug: a plain `catryna verify` erased the
 * doc's working anchors, the .mdx still visibly claimed them, and drift then
 * reported the doc clean forever with nothing anywhere saying otherwise.
 */
describe("#1 regression — undecodable frontmatter must not wipe the index", () => {
  /** Seed one doc whose index anchors are good and whose frontmatter is `fm`. */
  async function docWithFrontmatter(fm: string): Promise<string> {
    const dir = await initRepo({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 1;\n",
    });
    await seedDocs(dir, [
      { path: "modules/a", relatedFiles: ["src/a.ts", "src/b.ts"] },
    ]);
    const mdx = join(dir, ".docs", "modules", "a.mdx");
    const raw = await readFile(mdx, "utf-8");
    await writeFile(
      mdx,
      raw
        .split("\n")
        .filter((l) => !l.startsWith("relatedFiles:") && !l.startsWith("anchors:"))
        .join("\n")
        .replace("tags: []", `tags: []\n${fm}`),
    );
    // Give the index a structured anchor too, so both fields are at risk.
    const idx = await readIndex(dir);
    idx.docs[0].anchors = [{ file: "src/a.ts", symbol: "a" }];
    await writeFile(join(dir, ".docs", "_index.json"), JSON.stringify(idx));
    return dir;
  }

  test("a YAML block sequence is refused, not read as an empty list", async () => {
    const dir = await docWithFrontmatter("relatedFiles:\n  - src/a.ts\n  - src/b.ts");
    const run = await runCli(dir, ["verify", "modules/a"]);
    expect(run.code).toBe(0);

    const entry = await indexEntry(dir, "modules/a");
    expect(entry.relatedFiles).toEqual(["src/a.ts", "src/b.ts"]); // NOT wiped
    // ...and it says so, because a silent no-op is the original bug.
    expect(run.stdout).toContain("could not read frontmatter relatedFiles");
  });

  test("a YAML flow mapping in `anchors` is refused, not read as an empty list", async () => {
    const dir = await docWithFrontmatter(`anchors: [{file: "src/a.ts", symbol: "a"}]`);
    const run = await runCli(dir, ["verify", "modules/a"]);
    expect(run.code).toBe(0);
    expect((await indexEntry(dir, "modules/a")).anchors).toEqual([
      { file: "src/a.ts", symbol: "a" },
    ]);
    expect(run.stdout).toContain("could not read frontmatter anchors");
  });

  test("the refusal is reported in --json too", async () => {
    const dir = await docWithFrontmatter("relatedFiles:\n  - src/a.ts");
    const body = JSON.parse((await runCli(dir, ["verify", "modules/a", "--json"])).stdout);
    expect(body.ok).toBe(true);
    expect(body.unsyncedAnchorFields).toEqual(["relatedFiles"]);
  });

  test("and in a batch verify", async () => {
    const dir = await docWithFrontmatter("relatedFiles:\n  - src/a.ts");
    await seedDocs(dir, [
      { path: "modules/a", relatedFiles: ["src/a.ts", "src/b.ts"] },
      { path: "modules/b", relatedFiles: ["src/b.ts"] },
    ]);
    // seedDocs rewrote a.mdx — put the bad frontmatter back.
    const mdx = join(dir, ".docs", "modules", "a.mdx");
    const raw = await readFile(mdx, "utf-8");
    await writeFile(mdx, raw.replace(/^relatedFiles: .*$/m, "relatedFiles:\n  - src/a.ts"));

    const run = await runCli(dir, ["verify", "modules/a", "modules/b"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("could not read frontmatter relatedFiles");
    expect((await indexEntry(dir, "modules/a")).relatedFiles).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  test("a legacy single-quoted array still syncs (the fix must not over-refuse)", async () => {
    const dir = await docWithFrontmatter("relatedFiles: ['src/b.ts']");
    const run = await runCli(dir, ["verify", "modules/a"]);
    expect(run.code).toBe(0);
    expect((await indexEntry(dir, "modules/a")).relatedFiles).toEqual(["src/b.ts"]);
    expect(run.stdout).not.toContain("could not read frontmatter relatedFiles");
  });

  test("an explicit `[]` is still honored as a deliberate empty", async () => {
    const dir = await docWithFrontmatter("relatedFiles: []");
    expect((await runCli(dir, ["verify", "modules/a"])).code).toBe(0);
    expect((await indexEntry(dir, "modules/a")).relatedFiles).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #3 — drift says out loud what it cannot see.
// ---------------------------------------------------------------------------

describe("#3 drift warns when the working tree is dirty", () => {
  test("dirty tree prints the note; clean tree does not", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "modules/a", relatedFiles: ["src/a.ts"], verifiedCommit: baseline },
    ]);
    // `.docs/` itself is untracked here, which is realistic and would make every
    // run look dirty — commit it so the clean case is genuinely clean.
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "docs"]);

    const clean = await runCli(dir, ["drift"]);
    expect(clean.code).toBe(0);
    expect(clean.stdout).not.toContain("not committed");

    // Now dirty the tree WITHOUT committing — exactly the state in which a
    // repair pass silently works from an undercount.
    await writeFileAt(dir, "src/a.ts", "export const a = 2; // uncommitted\n");

    const dirty = await runCli(dir, ["drift"]);
    expect(dirty.stdout).toContain("1 file(s) modified but not committed");
    expect(dirty.stdout).toContain("Commit code first, then repair docs.");
    // Still not a gate on its own: the change is uncommitted, so no doc drifted.
    expect(dirty.code).toBe(0);
  });

  test("--json carries dirtyFiles, and 0 means probed-and-clean", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "modules/a", relatedFiles: ["src/a.ts"], verifiedCommit: baseline },
    ]);
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "docs"]);

    const clean = JSON.parse((await runCli(dir, ["drift", "--json"])).stdout);
    expect(clean.dirtyFiles).toBe(0);

    await writeFileAt(dir, "src/a.ts", "export const a = 2;\n");
    await writeFileAt(dir, "src/b.ts", "export const b = 1;\n"); // untracked counts
    const dirty = JSON.parse((await runCli(dir, ["drift", "--json"])).stdout);
    expect(dirty.dirtyFiles).toBe(2);
  });

  test("--dirty-is-error soft-blocks (exit 3) only when the tree is dirty", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "modules/a", relatedFiles: ["src/a.ts"], verifiedCommit: baseline },
    ]);
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "docs"]);

    expect((await runCli(dir, ["drift", "--dirty-is-error"])).code).toBe(0);

    await writeFileAt(dir, "src/a.ts", "export const a = 2;\n");
    expect((await runCli(dir, ["drift", "--dirty-is-error"])).code).toBe(3);
    // §4 rule 2 is untouched: --json is a report and still always exits 0.
    expect((await runCli(dir, ["drift", "--dirty-is-error", "--json"])).code).toBe(0);
  });

  /**
   * REGRESSION — `computeDrift` WRITES `.suite/` (it emits `doc.drifted`). In a
   * consumer repo that has not git-ignored it, the first run creates it and
   * every run after warns about the dirt it made — forever, and with
   * `--dirty-is-error` a permanently red CI gate. A warning that fires on the
   * tool's own exhaust is a warning people learn to ignore.
   */
  test("the tool's own .suite/ spine does not count as a dirty tree", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "modules/a", relatedFiles: ["src/a.ts"], verifiedCommit: baseline },
    ]);
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "docs"]);
    // Real drift, so the run emits doc.drifted into an untracked .suite/.
    await writeFileAt(dir, "src/a.ts", "export const a = 2;\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "touch a"]);

    const first = await runCli(dir, ["drift", "--json"]);
    expect(JSON.parse(first.stdout).summary.drifted).toBe(1);
    // .suite/ now exists and is untracked.
    expect(await git(dir, ["status", "--porcelain"])).toContain(".suite/");

    const second = JSON.parse((await runCli(dir, ["drift", "--json"])).stdout);
    expect(second.dirtyFiles).toBe(0);
    expect((await runCli(dir, ["drift"])).stdout).not.toContain("not committed");
    // ...and the CI gate stays honest: exit 3 for the real drift, not the spine.
    expect((await runCli(dir, ["drift", "--dirty-is-error"])).code).toBe(3);
    const clean = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(clean, [{ path: "modules/a", relatedFiles: ["src/a.ts"] }]);
    await git(clean, ["add", "-A"]);
    await git(clean, ["commit", "-q", "-m", "docs"]);
    expect((await runCli(clean, ["drift", "--dirty-is-error"])).code).toBe(0);
  });

  test("countDirtyFiles returns 0 outside a git repo rather than inventing a warning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catryna-nogit-"));
    dirs.push(dir);
    expect(await countDirtyFiles(dir)).toBe(0);
  });

  test("repair carries the same note", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "modules/a", relatedFiles: ["src/a.ts"], verifiedCommit: baseline },
    ]);
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "docs"]);
    await writeFileAt(dir, "src/a.ts", "export const a = 2; // uncommitted\n");

    const run = await runCli(dir, ["repair"]);
    expect(run.stdout).toContain("modified but not committed");
    expect(JSON.parse((await runCli(dir, ["repair", "--json"])).stdout).dirtyFiles).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// #4 — the shared index survives concurrent verifies, and batch verify exists.
// ---------------------------------------------------------------------------

describe("#4 concurrent verify does not clobber the shared index", () => {
  /**
   * Proven by RUNNING the race, not by reasoning about the lock: N real
   * `catryna verify` processes on N different docs, all started at once, then
   * every one of their baselines must be present in the single `_index.json`
   * they fought over. Before the lock file this loses baselines reliably.
   *
   * Repeated, because a race that only sometimes loses is still a race.
   */
  test("8 concurrent `catryna verify` processes all land, every round", async () => {
    const N = 8;
    const ROUNDS = 3;
    const files: Record<string, string> = {};
    for (let i = 0; i < N; i++) files[`src/m${i}.ts`] = `export const m${i} = 1;\n`;
    const dir = await initRepo(files);

    for (let round = 0; round < ROUNDS; round++) {
      // Fresh unverified corpus each round so "all verified" is a real result.
      await seedDocs(
        dir,
        Array.from({ length: N }, (_, i) => ({
          path: `modules/m${i}`,
          relatedFiles: [`src/m${i}.ts`],
        })),
      );

      const runs = await Promise.all(
        Array.from({ length: N }, (_, i) => runCli(dir, ["verify", `modules/m${i}`])),
      );
      for (const r of runs) expect(r.code).toBe(0);

      const index = await readIndex(dir);
      const unbaselined = index.docs
        .filter((d) => !d.verifiedCommit)
        .map((d) => d.path);
      expect(unbaselined).toEqual([]);
      expect(index.docs).toHaveLength(N);
    }
  }, 60_000);

  test("the lock file is not left behind after a verify", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"] }]);
    expect((await runCli(dir, ["verify", "modules/a"])).code).toBe(0);
    await expect(readFile(join(dir, ".docs", "_index.lock"), "utf-8")).rejects.toThrow();
  });

  /**
   * REGRESSION — an unremovable lock must not hang the process.
   *
   * The stale-break path swallowed stat/unlink failures with `continue`, which
   * skipped BOTH the sleep and the deadline check, so a lock that could not be
   * unlinked busy-looped forever at 100% CPU with no escape. `withIndexLock`
   * wraps createDoc/updateDoc/recordVerification, so this hung the MCP server
   * for a whole session, not just the CLI.
   *
   * A directory at the lock path is the cheap deterministic trigger (`wx` fails
   * EEXIST, `unlink` fails EPERM/EISDIR); an immutable flag or a Windows EPERM
   * behaves the same. The lock is an optimization, so the correct outcome is to
   * give up on it and complete the write.
   */
  test("an UNREMOVABLE lock is given up on, not spun on forever", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"] }]);
    await mkdir(join(dir, ".docs", "_index.lock"), { recursive: true });

    const started = Date.now();
    const run = await runCli(dir, ["verify", "modules/a"], 90_000);
    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0);
    // It must actually finish the write, not just exit.
    expect((await indexEntry(dir, "modules/a")).verifiedCommit).not.toBe("");
    // And it must give up within the documented timeout, not grind on.
    expect(Date.now() - started).toBeLessThan(75_000);
  }, 120_000);

  /**
   * REGRESSION — the BOUNDED-WAIT path: a lock that never goes stale must make
   * the waiter give up and proceed unlocked, leaving the foreign lock intact.
   * The old code broke the lock at the deadline and took it instead.
   *
   * An external toucher keeps the lock fresh, which is the only deterministic
   * way to reach this path — a lock left alone becomes breakable at
   * LOCK_STALE_MS, well before the wait deadline.
   *
   * Scope note: this does NOT cover `releaseOwned`'s token check. Reaching that
   * branch needs OUR lock to be broken while we hold it, and the critical
   * section is milliseconds long — see the comment on `releaseOwned` in
   * storage.ts, which says plainly that it is defensive and untested.
   */
  test("giving up on a live foreign lock leaves it alone", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"] }]);
    const lock = join(dir, ".docs", "_index.lock");
    const contents = "99999 0 someoneelseslock\n";
    await writeFile(lock, contents);

    // Keep it fresh for longer than LOCK_TIMEOUT_MS so it is never stale.
    const { utimes } = await import("node:fs/promises");
    let touching = true;
    const toucher = (async () => {
      while (touching) {
        try {
          const now = new Date();
          await utimes(lock, now, now);
        } catch {
          /* removed — the assertion below will catch it */
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    })();

    const run = await runCli(dir, ["verify", "modules/a"], 90_000);
    touching = false;
    await toucher;

    expect(run.timedOut).toBe(false);
    expect(run.code).toBe(0); // proceeded unlocked rather than failing or hanging
    expect((await indexEntry(dir, "modules/a")).verifiedCommit).not.toBe("");
    // The foreign lock is untouched — we never owned it.
    expect(await readFile(lock, "utf-8")).toBe(contents);
  }, 120_000);

  test("a STALE lock file is broken rather than wedging the store forever", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"] }]);
    // A lock left by a process that died. Its mtime is now, so it is not stale
    // yet — the waiter must break it on the timeout path instead. Backdating it
    // exercises the cheaper stale path directly.
    const lock = join(dir, ".docs", "_index.lock");
    await writeFile(lock, "99999 0\n");
    const past = new Date(Date.now() - 60_000);
    await (await import("node:fs/promises")).utimes(lock, past, past);

    const run = await runCli(dir, ["verify", "modules/a"]);
    expect(run.code).toBe(0);
    expect((await indexEntry(dir, "modules/a")).verifiedCommit).not.toBe("");
  }, 30_000);
});

describe("#4 batch verify", () => {
  test("several paths verify in one command", async () => {
    const dir = await initRepo({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 1;\n",
      "src/c.ts": "export const c = 1;\n",
    });
    await seedDocs(dir, [
      { path: "modules/a", relatedFiles: ["src/a.ts"] },
      { path: "modules/b", relatedFiles: ["src/b.ts"] },
      { path: "modules/c", relatedFiles: ["src/c.ts"] },
    ]);

    const run = await runCli(dir, ["verify", "modules/a", "modules/b", "modules/c"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("verified 3 of 3");

    const index = await readIndex(dir);
    expect(index.docs.every((d) => d.verifiedCommit)).toBe(true);
  });

  test("--json emits ONE batch object; a failure is reported and exits 1", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"] }]);

    const run = await runCli(dir, ["verify", "modules/a", "modules/nope", "--json"]);
    expect(run.code).toBe(1);
    const body = JSON.parse(run.stdout); // one object, or this throws
    expect(body.batch).toBe(true);
    expect(body.ok).toBe(false);
    expect(body.summary).toEqual({ total: 2, verified: 1, failed: 1 });
    expect(body.results.map((r: any) => r.ok)).toEqual([true, false]);
    // The good doc still landed — a bad path in the batch must not poison it.
    expect((await indexEntry(dir, "modules/a")).verifiedCommit).not.toBe("");
  });

  test("a SINGLE path keeps the original --json shape (no `batch`, `path` at top level)", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"] }]);
    const body = JSON.parse((await runCli(dir, ["verify", "modules/a", "--json"])).stdout);
    expect(body.batch).toBeUndefined();
    expect(body.path).toBe("modules/a");
    expect(body.ok).toBe(true);
  });

  test("--all-drifted re-baselines exactly the drifted docs, not the unverified ones", async () => {
    const dir = await initRepo({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 1;\n",
      "src/c.ts": "export const c = 1;\n",
    });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "modules/a", relatedFiles: ["src/a.ts"], verifiedCommit: baseline },
      { path: "modules/b", relatedFiles: ["src/b.ts"], verifiedCommit: baseline },
      // Never verified — --all-drifted must NOT stamp this one. Blanket-verifying
      // docs nobody has read is how a wrong doc gets a fresh baseline.
      { path: "modules/c", relatedFiles: ["src/c.ts"] },
    ]);
    await writeFileAt(dir, "src/a.ts", "export const a = 2;\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "touch a"]);

    const run = await runCli(dir, ["verify", "--all-drifted", "--json"]);
    expect(run.code).toBe(0);
    const body = JSON.parse(run.stdout);
    expect(body.batch).toBe(true);
    expect(body.results.map((r: any) => r.path)).toEqual(["modules/a"]);

    const index = await readIndex(dir);
    const byPath = Object.fromEntries(index.docs.map((d) => [d.path, d]));
    expect(byPath["modules/a"].verifiedCommit).not.toBe(baseline); // re-baselined
    expect(byPath["modules/b"].verifiedCommit).toBe(baseline); // untouched
    expect(byPath["modules/c"].verifiedCommit).toBe(""); // still unverified
  });

  test("--all-drifted on a clean corpus says so and exits 0", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "modules/a", relatedFiles: ["src/a.ts"], verifiedCommit: baseline },
    ]);
    const run = await runCli(dir, ["verify", "--all-drifted"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("nothing to re-baseline");
  });

  test("--all-drifted with explicit paths is a usage error, not a silent ignore", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"] }]);
    const run = await runCli(dir, ["verify", "--all-drifted", "modules/a"]);
    expect(run.code).toBe(2);
    expect(run.stdout).toBe("");
  });

  test("bare `verify` is still a usage error", async () => {
    const dir = await initRepo();
    expect((await runCli(dir, ["verify"])).code).toBe(2);
  });
});
