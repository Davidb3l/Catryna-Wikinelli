/**
 * The plugin's two hooks, ported from POSIX `sh` to Bun TypeScript so they run
 * on a Windows machine with no `sh` on PATH. The pure logic (message wording,
 * JSON parsing, the suite hint) is pinned here; the Stop hook end to end is in
 * hooks-drift.test.ts.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkCatryna,
  driftCheck,
  driftCounts,
  driftMessage,
  isSuiteRepo,
  lintErrorCount,
  lintMessage,
  suiteHint,
} from "./hooks";

setDefaultTimeout(30_000);

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});
async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "catryna-hooks-"));
  dirs.push(d);
  return d;
}

describe("hooks.json is shell-free", () => {
  const hooks = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8")).hooks;
  const commands: string[] = Object.values<any[]>(hooks).flatMap((groups) =>
    groups.flatMap((g) => g.hooks.map((h: { command: string }) => h.command)),
  );

  test("both hooks run through bun, with no sh/bash and no shell operators", () => {
    expect(commands).toHaveLength(2);
    for (const c of commands) {
      expect(c.startsWith('bun "${CLAUDE_PLUGIN_ROOT}/')).toBe(true);
      expect(c).not.toMatch(/\b(sh|bash)\b/);
      expect(c).not.toMatch(/\|\||&&|2>&1/); // PowerShell 5.1 has none of these
    }
  });

  test("every script a hook names exists in the plugin", () => {
    for (const c of commands) {
      const rel = c.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/)![1];
      expect(() => readFileSync(join(ROOT, rel))).not.toThrow();
    }
  });
});

describe("SessionStart check (scripts/check-catryna.ts)", () => {
  const all = () => true;
  const none = () => false;

  test("reports ready", () => {
    expect(checkCatryna({ has: all, suiteRepo: false })[0]).toBe(
      "catryna: ready (MCP server runs via bun; docs live in .docs/)",
    );
  });

  test("outside a suite repo it never nags, even with every tool missing", () => {
    expect(checkCatryna({ has: none, suiteRepo: false })).toHaveLength(1);
  });

  test("in a suite repo with everything installed it stays quiet", () => {
    expect(checkCatryna({ has: all, suiteRepo: true })).toHaveLength(1);
    expect(suiteHint(all)).toEqual([]);
  });

  test("the hint points at the Sothis suite, not the retired per-tool marketplaces", () => {
    const text = suiteHint(none).join("\n");
    expect(text).toContain("missing: Ametrite Hayvenhurst Sirius");
    expect(text).toContain("/plugin marketplace add Davidb3l/Sothis");
    expect(text).toContain("/plugin install sirius@sothis");
    expect(text).toContain("/plugin install hayvenhurst@sothis");
    expect(text).toContain("sothis install --profile docs");
    expect(text).not.toContain("Sirius-Forester");
    expect(text).not.toContain("Hayvenhurst-dev");
    expect(text).not.toContain("@sirius-forester");
    expect(text).not.toContain("@hayvenhurst\n");
  });

  test("only the missing tools get a line", () => {
    const onlySirius = suiteHint((b) => b !== "sirius").join("\n");
    expect(onlySirius).toContain("missing: Sirius.");
    expect(onlySirius).toContain("sirius@sothis");
    expect(onlySirius).not.toContain("hayvenhurst@sothis");
    expect(onlySirius).not.toContain("Ametrite (task board)");
  });

  test("a missing bun is reported (the seam; the real hook is bun, so it cannot be absent)", () => {
    const lines = checkCatryna({ has: all, suiteRepo: false, bunPresent: false });
    expect(lines[0]).toContain("bun not found");
  });

  test("isSuiteRepo needs a suite marker; a bare .docs/ is too generic", async () => {
    const dir = await tempDir();
    expect(isSuiteRepo(dir)).toBe(false);
    await mkdir(join(dir, ".docs"), { recursive: true });
    expect(isSuiteRepo(dir)).toBe(false);
    await writeFile(join(dir, ".docs", "_index.json"), "{}");
    expect(isSuiteRepo(dir)).toBe(true);
    const other = await tempDir();
    await mkdir(join(other, ".sirius"));
    expect(isSuiteRepo(other)).toBe(true);
  });
});

describe("Stop hook pieces (hooks/drift-check.ts)", () => {
  test("driftCounts reads summary.drifted and summary.broken, nothing else", () => {
    const json = JSON.stringify({
      summary: { broken: 2, drifted: 3, unverified: 9, clean: 4 },
      drifted: [{ path: "a" }],
      broken: [],
    });
    expect(driftCounts(json)).toEqual({ drifted: 3, broken: 2 });
  });

  test("anything unreadable counts as zero, never throws", () => {
    for (const bad of ["", "not json", "null", "[]", '{"summary":null}', '{"summary":{"drifted":"3"}}', '{"summary":{"drifted":-1}}']) {
      expect(driftCounts(bad)).toEqual({ drifted: 0, broken: 0 });
    }
    for (const bad of ["", "nope", "null", '{"errors":"2"}', '{"errors":-3}']) {
      expect(lintErrorCount(bad)).toBe(0);
    }
  });

  test("lintErrorCount reads the top-level errors", () => {
    expect(lintErrorCount('{"ok":false,"checked":16,"errors":2,"warnings":5,"issues":[]}')).toBe(2);
  });

  test("drift messages: silent at 0, singular at 1, plural above", () => {
    expect(driftMessage(0)).toBeNull();
    expect(driftMessage(1)).toBe(
      "catryna: 1 doc no longer matches the code it documents (drifted or a broken anchor) — run `catryna repair` (or update the affected doc, then `catryna verify`).",
    );
    expect(driftMessage(4)).toBe(
      "catryna: 4 docs no longer match the code they document (drifted or broken anchors) — run `catryna repair` (or update the affected docs, then `catryna verify`).",
    );
  });

  test("lint messages: silent at 0, singular at 1, plural above", () => {
    expect(lintMessage(0)).toBeNull();
    expect(lintMessage(1)).toBe(
      "catryna: 1 doc is malformed (structure or anchors) — run `catryna lint` to see it. `catryna verify` will refuse to baseline it until fixed.",
    );
    expect(lintMessage(2)).toBe(
      "catryna: 2 docs are malformed (structure or anchors) — run `catryna lint` to see them. `catryna verify` will refuse to baseline them until fixed.",
    );
  });

  test("driftCheck is silent without a Catryna index, and without the CLI", async () => {
    const dir = await tempDir();
    expect(await driftCheck(dir, ROOT)).toEqual([]); // no .docs/_index.json
    await mkdir(join(dir, ".docs"), { recursive: true });
    await writeFile(join(dir, ".docs", "_index.json"), '{"version":1,"docs":[]}');
    expect(await driftCheck(dir, ROOT)).toEqual([]); // not a git repo
    expect(await driftCheck(dir, join(dir, "no-such-plugin"))).toEqual([]);
  });
});
