/**
 * Tests for the Phase-2 READ trust surface (src/freshness.ts) and the additive
 * `only` filter it relies on in `computeDrift`.
 *
 * The point of freshness is that a read WARNS before an agent trusts a stale
 * doc, so these assertions are about the two things an agent acts on: the
 * `status`, and the `summary` line that carries it. Each is mutation-checkable —
 * drop the wiring and the test fails.
 *
 * Same fixture shape as drift.test.ts: a real temp git repo, seeded `.docs/`,
 * and commits that mutate anchored files to manufacture drift.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { computeDrift, runGit, runGitViaBun, runGitViaNode, selectGitRunner } from "./drift";
import { docFreshness, docsFreshness, freshnessHeadline } from "./freshness";

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
  const dir = await mkdtemp(join(tmpdir(), "catryna-fresh-"));
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
  relatedFiles: string[];
  verifiedCommit?: string;
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
    verifiedCommit: d.verifiedCommit ?? "",
    verifiedAt: d.verifiedCommit ? new Date(now).toISOString() : "",
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
    await writeFile(
      file,
      `---\nid: ${m.id}\ntitle: ${JSON.stringify(m.title)}\npath: ${JSON.stringify(m.path)}\n` +
        `tags: []\nrelatedFiles: ${JSON.stringify(m.relatedFiles)}\nevidence: []\nrefs: []\n` +
        `verifiedCommit: ${JSON.stringify(m.verifiedCommit)}\nverifiedAt: ${JSON.stringify(m.verifiedAt)}\n` +
        `createdAt: ${m.createdAt}\nupdatedAt: ${m.updatedAt}\ncreatedBy: "test"\n---\n\n# ${m.title}\n`,
    );
  }
}

describe("computeDrift `only` filter", () => {
  test("restricts the run to the named docs without changing their verdicts", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" });
    const base = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "doc-a", relatedFiles: ["src/a.ts"], verifiedCommit: base },
      { path: "doc-b", relatedFiles: ["src/b.ts"], verifiedCommit: base },
    ]);
    await writeFileAt(dir, "src/a.ts", "export const a = 2;\n");
    await writeFileAt(dir, "src/b.ts", "export const b = 2;\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "change both"]);

    const full = await computeDrift(dir, { emit: false });
    const only = await computeDrift(dir, { emit: false, only: ["doc-a"] });

    expect(full.drifted.map((d) => d.path).sort()).toEqual(["doc-a", "doc-b"]);
    // Narrowed to one doc...
    expect(only.drifted.map((d) => d.path)).toEqual(["doc-a"]);
    expect(only.clean).toHaveLength(0);
    // ...and that doc's verdict is byte-identical to the unfiltered run.
    expect(only.drifted[0]).toEqual(full.drifted.find((d) => d.path === "doc-a")!);
  });

  test("an empty `only` array means no docs, not all docs", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const base = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "doc-a", relatedFiles: ["src/a.ts"], verifiedCommit: base }]);

    const report = await computeDrift(dir, { emit: false, only: [] });
    expect(report.clean).toHaveLength(0);
    expect(report.drifted).toHaveLength(0);
    expect(report.broken).toHaveLength(0);
    expect(report.unverified).toHaveLength(0);
  });
});

describe("docFreshness", () => {
  test("clean doc reports VERIFIED and is marked safe to trust", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const base = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "doc-a", relatedFiles: ["src/a.ts"], verifiedCommit: base }]);

    const f = await docFreshness(dir, "doc-a");
    expect(f.status).toBe("clean");
    expect(f.verifiedCommit).toBe(base);
    expect(f.changedFiles).toEqual([]);
    expect(f.summary).toContain("VERIFIED");
    expect(f.summary).toContain("Safe to trust");
  });

  test("drifted doc reports STALE, names the changed file, and points at repair", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const base = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "doc-a", relatedFiles: ["src/a.ts"], verifiedCommit: base }]);
    await writeFileAt(dir, "src/a.ts", "export const a = 99;\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "change a"]);

    const f = await docFreshness(dir, "doc-a");
    expect(f.status).toBe("drifted");
    expect(f.changedFiles).toContain("src/a.ts");
    expect(f.summary).toContain("STALE");
    expect(f.summary).toContain("src/a.ts");
    expect(f.summary).toContain("catryna repair doc-a");
  });

  test("broken doc reports BROKEN and names the vanished file", async () => {
    const dir = await initRepo({ "src/gone.ts": "export const g = 1;\n" });
    const base = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "doc-a", relatedFiles: ["src/gone.ts"], verifiedCommit: base }]);
    await git(dir, ["rm", "-q", "src/gone.ts"]);
    await git(dir, ["commit", "-q", "-m", "delete"]);

    const f = await docFreshness(dir, "doc-a");
    expect(f.status).toBe("broken");
    expect(f.brokenFiles).toContain("src/gone.ts");
    expect(f.summary).toContain("BROKEN");
    expect(f.summary).toContain("unreliable");
  });

  test("doc with no baseline reports UNVERIFIED, never clean", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [{ path: "doc-a", relatedFiles: ["src/a.ts"] }]);

    const f = await docFreshness(dir, "doc-a");
    expect(f.status).toBe("unverified");
    expect(f.verifiedCommit).toBe("");
    expect(f.summary).toContain("UNVERIFIED");
    expect(f.summary).not.toContain("Safe to trust");
  });

  test("anchorless doc reports UNANCHORED rather than being silently called clean", async () => {
    // This is the trap: drift omits anchorless docs entirely. Reporting that
    // silence as `clean` would tell an agent an unchecked doc is trustworthy.
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [{ path: "doc-a", relatedFiles: [] }]);

    const report = await computeDrift(dir, { emit: false });
    expect([...report.clean, ...report.drifted, ...report.unverified, ...report.broken]).toHaveLength(0);

    const f = await docFreshness(dir, "doc-a");
    expect(f.status).toBe("unanchored");
    expect(f.summary).toContain("UNANCHORED");
    expect(f.summary).not.toContain("VERIFIED —");
  });

  test("outside a git repo reports UNKNOWN, not clean", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catryna-nogit-"));
    dirs.push(dir);
    await seedDocs(dir, [{ path: "doc-a", relatedFiles: ["src/a.ts"] }]);

    const f = await docFreshness(dir, "doc-a");
    expect(f.status).toBe("unknown");
    expect(f.summary).toContain("UNKNOWN");
  });
});

describe("docsFreshness + headline", () => {
  test("resolves every requested path in a single pass, including anchorless ones", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" });
    const base = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "clean-doc", relatedFiles: ["src/b.ts"], verifiedCommit: base },
      { path: "stale-doc", relatedFiles: ["src/a.ts"], verifiedCommit: base },
      { path: "bare-doc", relatedFiles: [] },
    ]);
    await writeFileAt(dir, "src/a.ts", "export const a = 2;\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "change a"]);

    const m = await docsFreshness(dir, ["clean-doc", "stale-doc", "bare-doc"]);
    expect(m.size).toBe(3);
    expect(m.get("clean-doc")!.status).toBe("clean");
    expect(m.get("stale-doc")!.status).toBe("drifted");
    expect(m.get("bare-doc")!.status).toBe("unanchored");
  });

  test("empty input does no work and returns an empty map", async () => {
    const dir = await initRepo();
    expect((await docsFreshness(dir, [])).size).toBe(0);
  });

  test("headline counts the problem buckets and stays silent when all is well", async () => {
    const mk = (status: string) => ({ status, verifiedCommit: "", head: null, changedFiles: [], summary: "" }) as any;
    expect(freshnessHeadline([mk("broken"), mk("drifted"), mk("drifted"), mk("unverified"), mk("clean")]))
      .toBe("Trust warning: 1 BROKEN, 2 STALE, 1 unverified in these results.");
    expect(freshnessHeadline([mk("clean"), mk("clean")])).toBe("");
  });
});

describe("runGit runtime portability", () => {
  // Regression guard. The viewer's Vite plugin imports the drift engine in a
  // module context with no `Bun` global. Because every git failure degrades
  // quietly, a Bun-only spawn did not throw there — it reported a real git
  // repository as "not a git repository" and every doc as unverified. Silent
  // wrongness, which is exactly what this project exists to prevent.
  //
  // `Bun` is a non-configurable global, so a test cannot hide it to force the
  // fallback; the Node implementation is exported and exercised directly.

  test("the node fallback reads real git output", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const head = await git(dir, ["rev-parse", "HEAD"]);

    const inside = await runGitViaNode(dir, ["rev-parse", "--is-inside-work-tree"]);
    expect(inside.ok).toBe(true);
    expect(inside.stdout.trim()).toBe("true");

    const rev = await runGitViaNode(dir, ["rev-parse", "HEAD"]);
    expect(rev.stdout.trim()).toBe(head);
  });

  test("the node fallback degrades quietly outside a repo, matching the Bun path", async () => {
    const plain = await mkdtemp(join(tmpdir(), "catryna-nogit-node-"));
    dirs.push(plain);

    const viaNode = await runGitViaNode(plain, ["rev-parse", "--is-inside-work-tree"]);
    const viaDefault = await runGit(plain, ["rev-parse", "--is-inside-work-tree"]);
    expect(viaNode.ok).toBe(false);
    expect(viaDefault.ok).toBe(false);
    expect(viaNode.stdout.trim()).toBe(viaDefault.stdout.trim());
  });

  test("both paths agree on identical git output", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const args = ["rev-parse", "HEAD"];
    const viaNode = await runGitViaNode(dir, args);
    const viaDefault = await runGit(dir, args);
    expect(viaNode.ok).toBe(viaDefault.ok);
    expect(viaNode.stdout.trim()).toBe(viaDefault.stdout.trim());
  });
});

describe("the `only` filter must not change a verdict — symbol anchors", () => {
  test("a filtered read reports the same verdict as an unfiltered run (hayven path)", async () => {
    // REGRESSION. The original filter test used file-level anchors, which are
    // genuinely per-doc independent, so it passed while the invariant was false
    // for SYMBOL anchors.
    //
    // buildHayvenAffected derives its symbol universe from the docs in the run,
    // and affected = changed ∪ impact(changed). Narrowing the run shrank that
    // universe, so `affected` shrank — always a subset — meaning filtering could
    // only ever UNDER-report drift. `get_doc` answered "clean / Safe to trust"
    // for a doc `catryna drift` called drifted, because the symbol that changed
    // lived in a DIFFERENT doc and impacted this one.
    const dir = await initRepo({
      "src/f1.ts": "export function foo(){}\n",
      "src/f2.ts": "export function bar(){}\n",
    });
    const base = await git(dir, ["rev-parse", "HEAD"]);

    const docsDir = join(dir, ".docs");
    await mkdir(docsDir, { recursive: true });
    const mk = (p: string, file: string, symbol: string) => ({
      id: p, path: p, title: p, tags: [], relatedFiles: [],
      anchors: [{ file, symbol }], evidence: [], refs: [],
      verifiedCommit: base, verifiedAt: "x", driftSuspectSince: "", driftSuspectReason: "",
      createdAt: 0, updatedAt: 0, createdBy: "test",
    });
    await writeFile(join(docsDir, "_index.json"), JSON.stringify({
      version: 1,
      docs: [mk("doc-a", "src/f1.ts", "foo"), mk("doc-b", "src/f2.ts", "bar")],
    }));

    // Only f2.ts changes; hayven reports that changing `bar` impacts `foo`.
    await writeFileAt(dir, "src/f2.ts", "export function bar(){ return 42; }\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "change bar"]);

    const hayven = {
      doctorOk: async () => true,
      context: async (_c: string, s: string) => ({
        id: s, name: s, file: s === "foo" ? "src/f1.ts" : "src/f2.ts",
        startLine: 1, endLine: 1, callees: [],
      }),
      impact: async (_c: string, id: string) => (id === "bar" ? ["bar", "foo"] : [id]),
    } as any;

    const bucketOf = (r: any, p: string) =>
      (["broken", "drifted", "unverified", "clean"] as const).find((k) =>
        r[k].some((d: any) => d.path === p),
      ) ?? "absent";

    const full = await computeDrift(dir, { emit: false, hayven });
    const only = await computeDrift(dir, { emit: false, hayven, only: ["doc-a"] });

    expect(bucketOf(full, "doc-a")).toBe("drifted");
    expect(bucketOf(only, "doc-a")).toBe("drifted"); // was "clean" — a false all-clear
    expect(bucketOf(only, "doc-a")).toBe(bucketOf(full, "doc-a"));

    // Asserted on computeDrift rather than docFreshness deliberately: the latter
    // cannot take an injected hayven client, so on a machine without the daemon
    // it correctly falls back to git-diff and calls this doc clean. That is not
    // the bug — the bug was the filter changing the verdict on the hayven path,
    // and this is where that is observable.
  });
});

describe("reads must not write (the invariant that had no test)", () => {
  // Asserted in prose at the top of src/freshness.ts and in a commit message,
  // with nothing behind it: flipping `emit: false` to `emit: true` left the
  // whole suite green while a read wrote .suite/events/*.jsonl into the repo.
  // Emission is observable on disk, so assert on disk.

  const suiteDir = (dir: string) => join(dir, ".suite");

  async function exists(p: string): Promise<boolean> {
    try { await stat(p); return true; } catch { return false; }
  }

  test("docFreshness emits nothing to the suite spine, on any status", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const base = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "clean-doc", relatedFiles: ["src/a.ts"], verifiedCommit: base },
      { path: "stale-doc", relatedFiles: ["src/a.ts"], verifiedCommit: base },
      { path: "bare-doc", relatedFiles: [] },
    ]);
    await writeFileAt(dir, "src/a.ts", "export const a = 2;\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "drift it"]);

    expect(await exists(suiteDir(dir))).toBe(false);

    for (const p of ["clean-doc", "stale-doc", "bare-doc", "no-such-doc"]) {
      await docFreshness(dir, p);
    }
    expect(await exists(suiteDir(dir))).toBe(false);
  });

  test("docsFreshness emits nothing either", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const base = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "d", relatedFiles: ["src/a.ts"], verifiedCommit: base }]);
    await writeFileAt(dir, "src/a.ts", "export const a = 3;\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "drift"]);

    await docsFreshness(dir, ["d"]);
    expect(await exists(suiteDir(dir))).toBe(false);
  });

  test("a drift run WITH emit does write — proving the check above can fail", async () => {
    // Without this, the two tests above would also pass if emission were broken
    // outright, or if .suite/ simply never got created for unrelated reasons.
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const base = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "d", relatedFiles: ["src/a.ts"], verifiedCommit: base }]);
    await writeFileAt(dir, "src/a.ts", "export const a = 4;\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "drift"]);

    await computeDrift(dir, { emit: true });
    expect(await exists(suiteDir(dir))).toBe(true);
  });
});

describe("runGit dispatch (not just the fallback in isolation)", () => {
  test("selects the node runner when Bun is unavailable, the Bun runner when present", () => {
    // The branch itself, pinned. Testing runGitViaNode alone proved the fallback
    // works but not that runGit ever reaches it — a Bun-only revert stayed green.
    expect(selectGitRunner(false)).toBe(runGitViaNode);
    expect(selectGitRunner(true)).toBe(runGitViaBun);
  });

  test("the selected node runner produces the same result runGit does", async () => {
    const dir = await initRepo({ "src/a.ts": "" });
    const head = await git(dir, ["rev-parse", "HEAD"]);
    const viaSelected = await selectGitRunner(false)(dir, ["rev-parse", "HEAD"]);
    expect(viaSelected.stdout.trim()).toBe(head);
    expect((await runGit(dir, ["rev-parse", "HEAD"])).stdout.trim()).toBe(head);
  });
});
