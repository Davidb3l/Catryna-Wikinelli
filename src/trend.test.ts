/**
 * Tests for the git-derived coverage trend (PRODUCT_ROADMAP Phase 2, item 3).
 *
 * The load-bearing assertion is the HEAD invariant: the newest trend sample must
 * equal what `computeCoverage` reports live. That is the one point a reader
 * checks against the big number on the dashboard, so a divergence would make the
 * chart quietly misstate today.
 *
 * The rest cover the shape of the history the chart is meant to reveal: coverage
 * dropping when code lands undocumented, and rising when docs catch up.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { computeCoverage } from "./coverage";
import { computeCoverageTrend, downsample, sampleAt } from "./trend";

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

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "catryna-trend-"));
  dirs.push(dir);
  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.email", "test@catryna.local"]);
  await git(dir, ["config", "user.name", "Catryna Test"]);
  await git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

/** Write `.docs/_index.json` with docs anchoring the given files. */
async function setDocs(dir: string, docs: Array<{ path: string; relatedFiles: string[] }>): Promise<void> {
  const now = 0;
  const meta = docs.map((d, i) => ({
    id: `d${i}`, path: d.path, title: `Doc ${i}`, tags: [],
    relatedFiles: d.relatedFiles, anchors: [], evidence: [], refs: [],
    verifiedCommit: "", verifiedAt: "", driftSuspectSince: "", driftSuspectReason: "",
    createdAt: now, updatedAt: now, createdBy: "test",
  }));
  await writeFileAt(dir, ".docs/_index.json", JSON.stringify({ version: 1, docs: meta, lastUpdated: now }));
}

async function commit(dir: string, msg: string): Promise<string> {
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "--allow-empty", "-m", msg]);
  return git(dir, ["rev-parse", "HEAD"]);
}

describe("downsample", () => {
  test("returns everything when under the cap", () => {
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  test("always keeps the first and last point", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const out = downsample(items, 5);
    expect(out.length).toBeLessThanOrEqual(5);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(99); // newest is what a reader checks against today
  });

  test("keeps only the newest when asked for one point", () => {
    expect(downsample([1, 2, 3, 4], 1)).toEqual([4]);
  });

  test("produces no duplicates from rounding collisions", () => {
    const out = downsample([1, 2, 3, 4, 5], 4);
    expect(new Set(out).size).toBe(out.length);
  });

  test("an empty budget yields nothing", () => {
    expect(downsample([1, 2, 3], 0)).toEqual([]);
  });
});

describe("computeCoverageTrend", () => {
  test("the newest sample matches live coverage at HEAD (the invariant)", async () => {
    const dir = await initRepo();
    await writeFileAt(dir, "src/a.ts", "export const a = 1;\n");
    await writeFileAt(dir, "src/b.ts", "export const b = 1;\n");
    await writeFileAt(dir, "src/c.ts", "export const c = 1;\n");
    await setDocs(dir, [{ path: "d", relatedFiles: ["src/a.ts", "src/b.ts"] }]);
    await commit(dir, "code + docs");

    const trend = await computeCoverageTrend(dir);
    const newest = trend.samples[trend.samples.length - 1];

    const index = JSON.parse(await Bun.file(join(dir, ".docs/_index.json")).text());
    const live = await computeCoverage({ rootDir: dir, docs: index.docs });

    expect(newest.coveragePercent).toBe(live.coveragePercent);
    expect(newest.totalModules).toBe(live.totalModules);
    expect(newest.documentedModules).toBe(live.documentedModules);
  });

  test("coverage DROPS when code lands undocumented, and the sample points at that commit", async () => {
    const dir = await initRepo();
    await writeFileAt(dir, "src/a.ts", "export const a = 1;\n");
    await setDocs(dir, [{ path: "d", relatedFiles: ["src/a.ts"] }]);
    await commit(dir, "documented start"); // 100%

    await writeFileAt(dir, "src/b.ts", "export const b = 1;\n");
    await writeFileAt(dir, "src/c.ts", "export const c = 1;\n");
    const undocumentedSha = await commit(dir, "ship two undocumented modules"); // 33%

    const trend = await computeCoverageTrend(dir);
    expect(trend.samples).toHaveLength(2);
    expect(trend.samples[0].coveragePercent).toBe(100);
    expect(trend.samples[1].coveragePercent).toBe(33);
    // The drop is attributable to a specific commit — the whole point of the chart.
    expect(trend.samples[1].commit).toBe(undocumentedSha);
  });

  test("coverage RECOVERS when docs catch up", async () => {
    const dir = await initRepo();
    await writeFileAt(dir, "src/a.ts", "");
    await writeFileAt(dir, "src/b.ts", "");
    await setDocs(dir, [{ path: "d", relatedFiles: ["src/a.ts"] }]);
    await commit(dir, "half documented"); // 50%

    await setDocs(dir, [{ path: "d", relatedFiles: ["src/a.ts", "src/b.ts"] }]);
    await commit(dir, "document the rest"); // 100%

    const trend = await computeCoverageTrend(dir);
    expect(trend.samples.map((s) => s.coveragePercent)).toEqual([50, 100]);
  });

  test("samples are chronological, oldest first", async () => {
    const dir = await initRepo();
    await writeFileAt(dir, "src/a.ts", "");
    await commit(dir, "one");
    await writeFileAt(dir, "src/b.ts", "");
    await commit(dir, "two");
    await writeFileAt(dir, "src/c.ts", "");
    await commit(dir, "three");

    const trend = await computeCoverageTrend(dir);
    const times = trend.samples.map((s) => s.timestamp);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  test("a commit before .docs existed reports 0%, not a crash", async () => {
    const dir = await initRepo();
    await writeFileAt(dir, "src/a.ts", "");
    await commit(dir, "code only, no .docs yet");

    const trend = await computeCoverageTrend(dir);
    expect(trend.samples[0].totalDocs).toBe(0);
    expect(trend.samples[0].coveragePercent).toBe(0);
    expect(trend.samples[0].totalModules).toBe(1);
  });

  test("downsamples long histories and says so", async () => {
    const dir = await initRepo();
    await writeFileAt(dir, "src/a.ts", "");
    for (let i = 0; i < 12; i++) await commit(dir, `c${i}`);

    const trend = await computeCoverageTrend(dir, { maxPoints: 5 });
    expect(trend.totalCommits).toBe(12);
    expect(trend.samples.length).toBeLessThanOrEqual(5);
    expect(trend.sampled).toBe(true);
  });

  test("does not claim to be sampled when every commit is included", async () => {
    const dir = await initRepo();
    await writeFileAt(dir, "src/a.ts", "");
    await commit(dir, "one");
    await commit(dir, "two");

    const trend = await computeCoverageTrend(dir, { maxPoints: 40 });
    expect(trend.sampled).toBe(false);
    expect(trend.samples).toHaveLength(trend.totalCommits);
  });

  test("excluded paths never count, at any point in history", async () => {
    const dir = await initRepo();
    await writeFileAt(dir, "src/a.ts", "");
    await writeFileAt(dir, "src/a.test.ts", "");
    await writeFileAt(dir, "dist/bundle.js", "");
    await writeFileAt(dir, "node_modules/pkg/index.js", "");
    await setDocs(dir, [{ path: "d", relatedFiles: ["src/a.ts"] }]);
    await commit(dir, "with noise");

    const trend = await computeCoverageTrend(dir);
    expect(trend.samples[0].totalModules).toBe(1); // only src/a.ts
    expect(trend.samples[0].coveragePercent).toBe(100);
  });

  test("outside a git repo returns an error, not fabricated samples", async () => {
    const plain = await mkdtemp(join(tmpdir(), "catryna-trend-nogit-"));
    dirs.push(plain);
    const trend = await computeCoverageTrend(plain);
    expect(trend.samples).toEqual([]);
    expect(trend.error).toContain("not a git repository");
  });

  test("sampleAt is consistent for the same commit", async () => {
    const dir = await initRepo();
    await writeFileAt(dir, "src/a.ts", "");
    await setDocs(dir, [{ path: "d", relatedFiles: ["src/a.ts"] }]);
    const sha = await commit(dir, "one");
    const ref = { sha, timestamp: Date.parse("2026-01-01") };
    expect(await sampleAt(dir, ref)).toEqual(await sampleAt(dir, ref));
  });
});
