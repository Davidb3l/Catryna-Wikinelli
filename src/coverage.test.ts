/**
 * Tests for the coverage core (PRODUCT_ROADMAP Phase 2, item 3).
 *
 * The headline assertion is the anchors gap: a doc that anchors PRECISELY
 * (`anchors: [{file, symbol}]`) must count as documenting that file. The old
 * implementation read `relatedFiles` only, so using the more precise feature
 * made your coverage number worse.
 *
 * No git fixture needed — coverage is a filesystem + index question.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { anchoredFiles, computeCoverage, findSourceFiles } from "./coverage";
import type { DocMetadata } from "./storage";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function tree(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "catryna-cov-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }
  return dir;
}

/** Minimal DocMetadata; only the anchor fields matter to coverage. */
function doc(partial: Partial<DocMetadata>): DocMetadata {
  return {
    id: "d", path: "d", title: "D", tags: [], relatedFiles: [], anchors: [],
    evidence: [], refs: [], verifiedCommit: "", verifiedAt: "",
    driftSuspectSince: "", driftSuspectReason: "",
    createdAt: 0, updatedAt: 0, createdBy: "test",
    ...partial,
  } as DocMetadata;
}

describe("findSourceFiles", () => {
  test("finds source files and returns forward-slash relative paths", async () => {
    const dir = await tree({
      "src/a.ts": "", "src/nested/b.tsx": "", "lib/c.py": "", "cmd/d.go": "", "e.rs": "",
      "README.md": "", "data.json": "",
    });
    const files = (await findSourceFiles(dir, dir)).sort();
    expect(files).toEqual(["cmd/d.go", "e.rs", "lib/c.py", "src/a.ts", "src/nested/b.tsx"]);
  });

  test("excludes tests, build output, vendored code, and .docs", async () => {
    const dir = await tree({
      "src/real.ts": "",
      "src/thing.test.ts": "", "src/thing.spec.ts": "",
      "node_modules/pkg/index.js": "", "dist/out.js": "", "build/out.js": "",
      ".docs/note.ts": "", "__pycache__/x.py": "",
    });
    expect(await findSourceFiles(dir, dir)).toEqual(["src/real.ts"]);
  });

  test("a directory merely CONTAINING an excluded word is still scanned", async () => {
    // "distributed/" must not be swallowed by the `dist` rule.
    const dir = await tree({ "distributed/queue.ts": "", "src/buildings.ts": "" });
    expect((await findSourceFiles(dir, dir)).sort()).toEqual(["distributed/queue.ts", "src/buildings.ts"]);
  });

  test("a missing directory yields nothing rather than throwing", async () => {
    expect(await findSourceFiles(join(tmpdir(), "catryna-does-not-exist-xyz"), tmpdir())).toEqual([]);
  });
});

describe("anchoredFiles", () => {
  test("counts precise `anchors`, not just legacy relatedFiles", async () => {
    const files = anchoredFiles([
      doc({ path: "legacy", relatedFiles: ["src/a.ts"] }),
      doc({ path: "precise", anchors: [{ file: "src/b.ts", symbol: "doThing" }] }),
      doc({ path: "both", relatedFiles: ["src/c.ts"], anchors: [{ file: "src/d.ts" }] }),
    ]);
    expect([...files].sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
  });

  test("normalizes Windows-authored backslash anchors", () => {
    const files = anchoredFiles([doc({ relatedFiles: ["src\\win.ts"] })]);
    expect([...files]).toEqual(["src/win.ts"]);
  });
});

describe("computeCoverage", () => {
  test("a symbol-anchored doc counts toward coverage (the anchors gap)", async () => {
    const dir = await tree({ "src/a.ts": "export const a = 1;\n" });
    const precise = await computeCoverage({
      rootDir: dir,
      docs: [doc({ anchors: [{ file: "src/a.ts", symbol: "a" }] })],
    });
    expect(precise.documentedModules).toBe(1);
    expect(precise.coveragePercent).toBe(100);

    // Identical result via the legacy field — precision must not be penalised.
    const legacy = await computeCoverage({ rootDir: dir, docs: [doc({ relatedFiles: ["src/a.ts"] })] });
    expect(legacy.documentedModules).toBe(precise.documentedModules);
    expect(legacy.coveragePercent).toBe(precise.coveragePercent);
  });

  test("computes percent, undocumented list, and anchoring-doc count", async () => {
    const dir = await tree({ "src/a.ts": "", "src/b.ts": "", "src/c.ts": "", "src/d.ts": "" });
    const r = await computeCoverage({
      rootDir: dir,
      docs: [doc({ path: "one", relatedFiles: ["src/a.ts"] }), doc({ path: "none", relatedFiles: [] })],
    });
    expect(r.totalModules).toBe(4);
    expect(r.documentedModules).toBe(1);
    expect(r.coveragePercent).toBe(25);
    expect(r.totalDocs).toBe(2);
    expect(r.anchoringDocs).toBe(1);
    expect(r.undocumented.map((m) => m.filePath).sort()).toEqual(["src/b.ts", "src/c.ts", "src/d.ts"]);
    expect(r.totalUndocumented).toBe(3);
  });

  test("an empty source tree reports 0%, not NaN or a division blowup", async () => {
    const dir = await tree({ "README.md": "" });
    const r = await computeCoverage({ rootDir: dir, docs: [] });
    expect(r.totalModules).toBe(0);
    expect(r.coveragePercent).toBe(0);
  });

  test("the undocumented LIST is capped but the COUNT stays exact", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) files[`src/f${i}.ts`] = "";
    const dir = await tree(files);
    const r = await computeCoverage({ rootDir: dir, docs: [], limit: 5 });
    expect(r.undocumented).toHaveLength(5);
    expect(r.totalUndocumented).toBe(30); // never mistake a capped list for the whole problem
  });

  test("flags anchors pointing at files that do not exist", async () => {
    const dir = await tree({ "src/a.ts": "" });
    const r = await computeCoverage({
      rootDir: dir,
      docs: [doc({ relatedFiles: ["src/a.ts", "src/deleted.ts"] })],
    });
    expect(r.brokenAnchors).toEqual(["src/deleted.ts"]);
    expect(r.documentedModules).toBe(1); // the dead anchor credits nothing
  });

  test("an anchor on an excluded-but-real file is not called broken", async () => {
    // Test files are excluded from the scan, but anchoring one is legitimate.
    const dir = await tree({ "src/a.ts": "", "src/a.test.ts": "" });
    const r = await computeCoverage({ rootDir: dir, docs: [doc({ relatedFiles: ["src/a.test.ts"] })] });
    expect(r.brokenAnchors).toEqual([]);
  });

  test("takes its root as a parameter and never reads process.cwd()", async () => {
    // The viewer runs with cwd=frontend/ and a switchable docs root, so a
    // cwd-derived scan would silently report on the wrong project.
    const a = await tree({ "src/only-in-a.ts": "" });
    const b = await tree({ "src/x.ts": "", "src/y.ts": "" });
    expect((await computeCoverage({ rootDir: a, docs: [] })).totalModules).toBe(1);
    expect((await computeCoverage({ rootDir: b, docs: [] })).totalModules).toBe(2);
  });
});
