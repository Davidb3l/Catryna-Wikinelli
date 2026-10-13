/**
 * Drift must read git correctly no matter how the host's git is configured or
 * what the repo's file names look like.
 *
 *   - B1: git's default `core.quotePath=true` wraps non-ASCII paths in quotes
 *     and octal escapes, so `src/café.ts` never matched the anchor and a
 *     changed anchored file read as CLEAN. Every name list is parsed with `-z`.
 *   - B4: `color.diff=always` puts ANSI escapes in `@@` lines, and
 *     `diff.noprefix=true` drops the `a/` `b/` prefixes. Hunk parsing must not
 *     depend on either.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { computeDrift, countDirtyFiles, DIFF_FLAGS, runGit, splitNul } from "./drift";

setDefaultTimeout(30_000);

const ESC = String.fromCharCode(27);
const NUL = String.fromCharCode(0);

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function git(dir: string, args: string[]): Promise<string> {
  const r = await runGit(dir, args);
  if (!r.ok) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

async function put(dir: string, rel: string, content: string): Promise<void> {
  const p = join(dir, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content);
}

async function initRepo(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "catryna-gitrobust-"));
  dirs.push(dir);
  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.email", "test@catryna.local"]);
  await git(dir, ["config", "user.name", "Catryna Test"]);
  await git(dir, ["config", "commit.gpgsign", "false"]);
  for (const [rel, content] of Object.entries(files)) await put(dir, rel, content);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "initial"]);
  return dir;
}

/** One doc anchored by `anchors`, verified at `baseline`. */
async function seedDoc(
  dir: string,
  baseline: string,
  anchors: { file: string; lines?: [number, number] }[],
): Promise<void> {
  const now = Date.now();
  const meta = {
    id: "seed-0",
    path: "modules/doc",
    title: "Doc",
    tags: [],
    relatedFiles: anchors.filter((a) => !a.lines).map((a) => a.file),
    anchors: anchors.filter((a) => a.lines),
    evidence: [],
    refs: [],
    verifiedCommit: baseline,
    verifiedAt: new Date(now).toISOString(),
    createdAt: now,
    updatedAt: now,
    createdBy: "test",
  };
  await put(dir, ".docs/_index.json", JSON.stringify({ version: 1, docs: [meta], lastUpdated: now }));
  await put(dir, ".docs/modules/doc.mdx", `---\nid: seed-0\ntitle: "Doc"\npath: "modules/doc"\n---\n\n# Doc\n`);
}

async function commitAll(dir: string, msg: string): Promise<void> {
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", msg]);
}

describe("splitNul", () => {
  test("splits on NUL and drops empty fields", () => {
    expect(splitNul(`a${NUL}b c${NUL}${NUL}`)).toEqual(["a", "b c"]);
    expect(splitNul("")).toEqual([]);
  });
});

describe("non-ASCII file names (B1)", () => {
  test("an anchored src/café.ts changed after the baseline is DRIFTED, not clean", async () => {
    const dir = await initRepo({ "src/café.ts": "export const a = 1;\n", "src/other.ts": "x\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDoc(dir, baseline, [{ file: "src/café.ts" }]);
    await put(dir, "src/café.ts", "export const a = 2;\n");
    await commitAll(dir, "touch café");

    const report = await computeDrift(dir, { emit: false });
    expect(report.drifted.map((d) => d.path)).toEqual(["modules/doc"]);
    expect(report.drifted[0].changedFiles).toEqual(["src/café.ts"]);
    expect(report.clean).toEqual([]);
  });

  test("an unchanged non-ASCII anchor stays clean", async () => {
    const dir = await initRepo({ "src/café.ts": "export const a = 1;\n", "src/other.ts": "x\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDoc(dir, baseline, [{ file: "src/café.ts" }]);
    await put(dir, "src/other.ts", "y\n");
    await commitAll(dir, "touch other");

    const report = await computeDrift(dir, { emit: false });
    expect(report.clean.map((d) => d.path)).toEqual(["modules/doc"]);
    expect(report.drifted).toEqual([]);
  });

  test("a non-ASCII anchor renamed away is BROKEN and names its new path", async () => {
    const dir = await initRepo({ "src/café.ts": "export const a = 1;\nexport const b = 2;\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDoc(dir, baseline, [{ file: "src/café.ts" }]);
    await rename(join(dir, "src", "café.ts"), join(dir, "src", "thé.ts"));
    await commitAll(dir, "rename");

    const report = await computeDrift(dir, { emit: false });
    expect(report.broken.map((d) => d.path)).toEqual(["modules/doc"]);
    expect(report.broken[0].note).toContain("renamed to src/thé.ts");
  });

  test("countDirtyFiles counts non-ASCII paths, and a staged rename once", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    expect(await countDirtyFiles(dir)).toBe(0);
    await put(dir, "src/café.ts", "export const c = 3;\nexport const d = 4;\n");
    expect(await countDirtyFiles(dir)).toBe(1);
    await commitAll(dir, "add café");
    await rename(join(dir, "src", "café.ts"), join(dir, "src", "thé.ts"));
    await git(dir, ["add", "-A"]); // staged rename: porcelain -z emits the origin as a 2nd field
    expect(await countDirtyFiles(dir)).toBe(1);
  });
});

describe("user git config must not change how diffs are parsed (B4)", () => {
  const body = (changed?: Record<number, string>): string =>
    Array.from({ length: 20 }, (_, i) => changed?.[i + 1] ?? `line ${i + 1}`).join("\n") + "\n";

  async function hostileRepo(): Promise<{ dir: string; baseline: string }> {
    const dir = await initRepo({ "src/a.ts": body() });
    await git(dir, ["config", "color.diff", "always"]);
    await git(dir, ["config", "color.ui", "always"]);
    await git(dir, ["config", "diff.noprefix", "true"]);
    return { dir, baseline: await git(dir, ["rev-parse", "HEAD"]) };
  }

  test("DIFF_FLAGS neutralize color.diff=always and diff.noprefix=true", async () => {
    const { dir, baseline } = await hostileRepo();
    await put(dir, "src/a.ts", body({ 3: "changed" }));
    await commitAll(dir, "edit");

    const hostile = await git(dir, ["diff", "--unified=0", `${baseline}..HEAD`, "--", "src/a.ts"]);
    expect(hostile).toContain(ESC + "["); // the hazard is real in this repo
    expect(hostile).not.toContain("--- a/src/a.ts");

    const safe = await git(dir, ["diff", "--unified=0", ...DIFF_FLAGS, `${baseline}..HEAD`, "--", "src/a.ts"]);
    expect(safe).not.toContain(ESC + "[");
    expect(safe).toContain("--- a/src/a.ts");
    expect(safe).toContain("+++ b/src/a.ts");
    expect(safe).toMatch(/^@@ -3 \+3 @@/m);
  });

  test("a line-range anchor drifts only when its range changed", async () => {
    const { dir, baseline } = await hostileRepo();
    await seedDoc(dir, baseline, [{ file: "src/a.ts", lines: [1, 5] }]);

    // Line 15 only: outside 1-5 -> clean.
    await put(dir, "src/a.ts", body({ 15: "changed far away" }));
    await commitAll(dir, "far edit");
    let report = await computeDrift(dir, { emit: false });
    expect(report.clean.map((d) => d.path)).toEqual(["modules/doc"]);

    // Line 2 as well: inside 1-5 -> drifted.
    await put(dir, "src/a.ts", body({ 15: "changed far away", 2: "changed in range" }));
    await commitAll(dir, "near edit");
    report = await computeDrift(dir, { emit: false });
    expect(report.drifted.map((d) => d.path)).toEqual(["modules/doc"]);
  });
});
