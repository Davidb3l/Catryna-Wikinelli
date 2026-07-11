/**
 * Tests for the PRECISION half of Phase 1 (PRODUCT_ROADMAP): validated anchors,
 * rename/delete (broken) detection, symbol/line-range narrowing, and the
 * Hayvenhurst symbol-precision path with its git-diff fallback.
 *
 * Structure mirrors drift.test.ts: a real temp GIT repo is the fixture, and
 * `computeDrift(cwd, …)` is exercised in-process (it honors an injected `cwd`).
 * The Hayvenhurst client is INJECTED (`opts.hayven`) so both the present-precise
 * and absent-fallback branches run deterministically without a live daemon —
 * the fake supplies symbol locations + impact, REAL git supplies changed hunks.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  computeDrift,
  type HayvenClient,
  type HayvenSymbol,
} from "./drift";
import {
  effectiveAnchors,
  normalizeAnchor,
  parseAnchors,
  parseMdx,
  type DocAnchor,
} from "./storage";

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
  const dir = await mkdtemp(join(tmpdir(), "catryna-anchors-"));
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

async function commitAll(dir: string, msg: string): Promise<void> {
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", msg]);
}

interface SeedDoc {
  path: string;
  relatedFiles?: string[];
  anchors?: DocAnchor[];
  verifiedCommit?: string;
}

/** Seed `.docs/_index.json` directly (drift reads it read-only via readIndexAt). */
async function seedDocs(dir: string, docs: SeedDoc[]): Promise<void> {
  const now = Date.now();
  const docsDir = join(dir, ".docs");
  await mkdir(docsDir, { recursive: true });
  const meta = docs.map((d, i) => ({
    id: `seed-${i}`,
    path: d.path,
    title: `Doc ${i}`,
    tags: [] as string[],
    relatedFiles: d.relatedFiles ?? [],
    anchors: d.anchors ?? [],
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
}

/** A fake Hayvenhurst client: canned `context`/`impact`, real git supplies hunks. */
function fakeHayven(cfg: {
  ok?: boolean;
  ctx?: Record<string, HayvenSymbol>;
  impact?: Record<string, string[]>;
}): HayvenClient {
  return {
    async doctorOk() {
      return cfg.ok ?? true;
    },
    async context(_cwd, symbol) {
      return cfg.ctx?.[symbol] ?? null;
    },
    async impact(_cwd, id) {
      return cfg.impact?.[id] ?? [];
    },
  };
}

/** Hayven disabled → forces the git-diff fallback everywhere. */
const HAYVEN_OFF: HayvenClient = {
  async doctorOk() {
    return false;
  },
  async context() {
    return null;
  },
  async impact() {
    return [];
  },
};

// ---------------------------------------------------------------------------

describe("anchor model — pure helpers", () => {
  test("normalizeAnchor coerces/validates {file, symbol?, lines?}", () => {
    expect(normalizeAnchor({ file: "src/a.ts" })).toEqual({ file: "src/a.ts" });
    expect(normalizeAnchor({ file: "src/a.ts", symbol: "foo" })).toEqual({
      file: "src/a.ts",
      symbol: "foo",
    });
    // lines sorted; garbage/empty rejected.
    expect(normalizeAnchor({ file: "src/a.ts", lines: [9, 3] })).toEqual({
      file: "src/a.ts",
      lines: [3, 9],
    });
    expect(normalizeAnchor({ file: "" })).toBeNull();
    expect(normalizeAnchor({ symbol: "foo" })).toBeNull();
    expect(normalizeAnchor("nope")).toBeNull();
  });

  test("anchors round-trip through frontmatter (serialize → parseMdx)", () => {
    // A frontmatter block as blocksToMdx would emit it (single-line JSON anchors).
    const anchors: DocAnchor[] = [
      { file: "src/a.ts", symbol: "foo" },
      { file: "src/b.ts", lines: [10, 20] },
    ];
    const mdx =
      `---\nid: x\ntitle: "T"\npath: "m/x"\ntags: []\n` +
      `relatedFiles: []\nanchors: ${JSON.stringify(anchors)}\nevidence: []\nrefs: []\n` +
      `verifiedCommit: ""\nverifiedAt: ""\ncreatedAt: 1\nupdatedAt: 1\ncreatedBy: "t"\n---\n\n# T\n`;
    const { metadata } = parseMdx(mdx);
    expect(metadata.anchors).toEqual(anchors);
  });

  test("parseAnchors drops malformed entries, never throws", () => {
    expect(parseAnchors('[{"file":"a"},{"nope":1},{"file":""}]')).toEqual([{ file: "a" }]);
    expect(parseAnchors("not json")).toEqual([]);
  });

  test("effectiveAnchors merges relatedFiles as file-level anchors, symbol supersedes", () => {
    // relatedFiles-only doc → one file-level anchor each (legacy behavior).
    expect(effectiveAnchors({ anchors: [], relatedFiles: ["src/a.ts", "src/b.ts"] })).toEqual([
      { file: "src/a.ts" },
      { file: "src/b.ts" },
    ]);
    // A symbol anchor for a file present in relatedFiles is NOT also given a
    // redundant file-level anchor (precision would otherwise be drowned).
    expect(
      effectiveAnchors({
        anchors: [{ file: "src/a.ts", symbol: "foo" }],
        relatedFiles: ["src/a.ts", "src/b.ts"],
      }),
    ).toEqual([{ file: "src/a.ts", symbol: "foo" }, { file: "src/b.ts" }]);
  });
});

describe("broken anchors — rename/delete detection", () => {
  test("a DELETED anchored file → broken (not drifted/clean), highest severity", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "m/a", relatedFiles: ["src/a.ts"], verifiedCommit: baseline },
    ]);
    await rm(join(dir, "src/a.ts"));
    await commitAll(dir, "delete a");

    const report = await computeDrift(dir, { emit: false, hayven: HAYVEN_OFF });
    expect(report.broken.map((d) => d.path)).toEqual(["m/a"]);
    expect(report.broken[0].brokenFiles).toEqual(["src/a.ts"]);
    expect(report.broken[0].note).toContain("deleted");
    expect(report.drifted).toEqual([]);
    expect(report.clean).toEqual([]);
  });

  test("a RENAMED-away anchored file → broken, note points at the new path", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "m/a", relatedFiles: ["src/a.ts"], verifiedCommit: baseline },
    ]);
    await git(dir, ["mv", "src/a.ts", "src/c.ts"]);
    await commitAll(dir, "rename a→c");

    const report = await computeDrift(dir, { emit: false, hayven: HAYVEN_OFF });
    expect(report.broken.map((d) => d.path)).toEqual(["m/a"]);
    expect(report.broken[0].note).toContain("src/c.ts");
  });

  test("broken outranks an unusable baseline AND emits doc.drifted{broken:true}", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    // Bogus baseline + deleted file: broken (severity) wins over the baseline note.
    await seedDocs(dir, [
      { path: "m/a", relatedFiles: ["src/a.ts"], verifiedCommit: "0".repeat(40) },
    ]);
    await rm(join(dir, "src/a.ts"));
    await commitAll(dir, "delete a");

    const report = await computeDrift(dir, { emit: true, hayven: HAYVEN_OFF });
    expect(report.broken.map((d) => d.path)).toEqual(["m/a"]);

    // Spine: broken docs still announce doc.drifted, flagged broken:true (§2).
    const evDir = join(dir, ".suite", "events");
    const { readdir, readFile } = await import("node:fs/promises");
    const files = await readdir(evDir);
    const events: any[] = [];
    for (const f of files) {
      for (const line of (await readFile(join(evDir, f), "utf-8")).split("\n").filter(Boolean)) {
        events.push(JSON.parse(line));
      }
    }
    const drifted = events.filter((e) => e.type === "doc.drifted");
    expect(drifted.length).toBe(1);
    expect(drifted[0].data.broken).toBe(true);
    expect(drifted[0].data.anchors).toContain("src/a.ts");
  });
});

describe("symbol/line-range narrowing — git-diff fallback (hayven off)", () => {
  // Two symbols on their own lines so one can change without the other's text.
  const SRC = "export function foo() { return 1; }\nexport function bar() { return 2; }\n";

  test("a LINE anchor drifts only when a changed hunk overlaps its range", async () => {
    const dir = await initRepo({ "src/a.ts": SRC });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "m/foo", anchors: [{ file: "src/a.ts", lines: [1, 1] }], verifiedCommit: baseline },
    ]);

    // Change line 2 (bar) only → line-1 anchor is untouched → clean.
    await writeFileAt(dir, "src/a.ts", "export function foo() { return 1; }\nexport function bar() { return 22; }\n");
    await commitAll(dir, "touch bar");
    let report = await computeDrift(dir, { emit: false, hayven: HAYVEN_OFF });
    expect(report.clean.map((d) => d.path)).toEqual(["m/foo"]);
    expect(report.drifted).toEqual([]);

    // Now change line 1 (foo) → overlaps [1,1] → drifted.
    await writeFileAt(dir, "src/a.ts", "export function foo() { return 111; }\nexport function bar() { return 22; }\n");
    await commitAll(dir, "touch foo");
    report = await computeDrift(dir, { emit: false, hayven: HAYVEN_OFF });
    expect(report.drifted.map((d) => d.path)).toEqual(["m/foo"]);
    expect(report.drifted[0].precision).toBe("git");
  });

  test("a SYMBOL anchor (git fallback) drifts only when a hunk mentions the symbol", async () => {
    const dir = await initRepo({ "src/a.ts": SRC });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "m/foo", anchors: [{ file: "src/a.ts", symbol: "foo" }], verifiedCommit: baseline },
    ]);

    // Change bar's line — the hunk text mentions "bar", not "foo" → foo clean.
    await writeFileAt(dir, "src/a.ts", "export function foo() { return 1; }\nexport function bar() { return 222; }\n");
    await commitAll(dir, "touch bar");
    let report = await computeDrift(dir, { emit: false, hayven: HAYVEN_OFF });
    expect(report.clean.map((d) => d.path)).toEqual(["m/foo"]);

    // Change foo's line — hunk mentions "foo" → drift.
    await writeFileAt(dir, "src/a.ts", "export function foo() { return 999; }\nexport function bar() { return 222; }\n");
    await commitAll(dir, "touch foo");
    report = await computeDrift(dir, { emit: false, hayven: HAYVEN_OFF });
    expect(report.drifted.map((d) => d.path)).toEqual(["m/foo"]);
  });

  test("a bare relatedFiles (file-level) anchor keeps whole-file drift behavior", async () => {
    const dir = await initRepo({ "src/a.ts": SRC });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "m/file", relatedFiles: ["src/a.ts"], verifiedCommit: baseline },
    ]);
    // ANY change to the file drifts a file-level anchor (even the unrelated bar).
    await writeFileAt(dir, "src/a.ts", "export function foo() { return 1; }\nexport function bar() { return 5; }\n");
    await commitAll(dir, "touch bar");
    const report = await computeDrift(dir, { emit: false, hayven: HAYVEN_OFF });
    expect(report.drifted.map((d) => d.path)).toEqual(["m/file"]);
    expect(report.drifted[0].changedFiles).toContain("src/a.ts");
  });
});

describe("Hayvenhurst symbol-precision (injected client)", () => {
  const SRC = "export function foo() { return 1; }\nexport function bar() { return 2; }\n";

  test("present + healthy: symbol drifts iff ITS lines change (unrelated same-file edit stays clean)", async () => {
    const dir = await initRepo({ "src/a.ts": SRC });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "m/foo", anchors: [{ file: "src/a.ts", symbol: "foo" }], verifiedCommit: baseline },
    ]);
    // foo is at line 1; bar at line 2. Neither is a callee of the other here.
    const hv = fakeHayven({
      ok: true,
      ctx: {
        foo: { id: "a/foo", file: "src/a.ts", startLine: 1, endLine: 1, callees: [] },
      },
      impact: { "a/foo": [] },
    });

    // Edit ONLY bar (line 2). foo's span [1,1] doesn't overlap → precise clean.
    await writeFileAt(dir, "src/a.ts", "export function foo() { return 1; }\nexport function bar() { return 2222; }\n");
    await commitAll(dir, "touch bar");
    let report = await computeDrift(dir, { emit: false, hayven: hv });
    expect(report.hayven).toBe(true);
    expect(report.clean.map((d) => d.path)).toEqual(["m/foo"]);
    expect(report.clean[0].precision).toBe("hayven");
    expect(report.drifted).toEqual([]);

    // Edit foo (line 1) → its span overlaps the hunk → precise drift.
    await writeFileAt(dir, "src/a.ts", "export function foo() { return 1000; }\nexport function bar() { return 2222; }\n");
    await commitAll(dir, "touch foo");
    report = await computeDrift(dir, { emit: false, hayven: hv });
    expect(report.drifted.map((d) => d.path)).toEqual(["m/foo"]);
    expect(report.drifted[0].precision).toBe("hayven");
  });

  test("present: a doc drifts when a DEPENDENCY changes (impact), even if its own file didn't", async () => {
    const dir = await initRepo({
      "src/a.ts": "export function foo() { return 1; }\n",
      "src/b.ts": "import { foo } from './a';\nexport function useFoo() { return foo(); }\n",
    });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    // Doc anchored to useFoo (src/b.ts); useFoo calls foo (src/a.ts).
    await seedDocs(dir, [
      { path: "m/useFoo", anchors: [{ file: "src/b.ts", symbol: "useFoo" }], verifiedCommit: baseline },
    ]);
    const hv = fakeHayven({
      ok: true,
      ctx: {
        useFoo: {
          id: "b/useFoo",
          file: "src/b.ts",
          startLine: 2,
          endLine: 2,
          callees: [{ id: "a/foo", file: "src/a.ts", startLine: 1, endLine: 1 }],
        },
      },
      // Changing foo impacts useFoo (forward blast radius).
      impact: { "a/foo": ["b/useFoo"] },
    });

    // Change ONLY src/a.ts (foo) — b.ts is untouched.
    await writeFileAt(dir, "src/a.ts", "export function foo() { return 42; }\n");
    await commitAll(dir, "change foo");

    const report = await computeDrift(dir, { emit: false, hayven: hv });
    // useFoo's own file didn't change, but its dependency foo did → impact → drift.
    expect(report.drifted.map((d) => d.path)).toEqual(["m/useFoo"]);
    expect(report.drifted[0].precision).toBe("hayven");
  });

  test("absent/unhealthy: falls back to git-diff (precision 'git'), classifies correctly", async () => {
    const dir = await initRepo({ "src/a.ts": SRC });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "m/foo", anchors: [{ file: "src/a.ts", symbol: "foo" }], verifiedCommit: baseline },
    ]);
    // Edit foo → git fallback sees "foo" in the hunk → drift, precision git.
    await writeFileAt(dir, "src/a.ts", "export function foo() { return 7; }\nexport function bar() { return 2; }\n");
    await commitAll(dir, "touch foo");

    const report = await computeDrift(dir, { emit: false, hayven: HAYVEN_OFF });
    expect(report.hayven).toBe(false);
    expect(report.drifted.map((d) => d.path)).toEqual(["m/foo"]);
    expect(report.drifted[0].precision).toBe("git");
  });

  test("present but symbol UNRESOLVED by hayven → that anchor falls back to git-diff", async () => {
    const dir = await initRepo({ "src/a.ts": SRC });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "m/foo", anchors: [{ file: "src/a.ts", symbol: "foo" }], verifiedCommit: baseline },
    ]);
    // doctor ok, but context returns null for every symbol (repo not ingested).
    const hv = fakeHayven({ ok: true, ctx: {}, impact: {} });

    // Edit bar only → git fallback: hunk mentions "bar" not "foo" → clean.
    await writeFileAt(dir, "src/a.ts", "export function foo() { return 1; }\nexport function bar() { return 88; }\n");
    await commitAll(dir, "touch bar");
    const report = await computeDrift(dir, { emit: false, hayven: hv });
    expect(report.clean.map((d) => d.path)).toEqual(["m/foo"]);
    // Fell back to git for this anchor (symbol never resolved).
    expect(report.clean[0].precision).toBe("git");
  });
});
