/**
 * Tests for `catryna lint` — is each doc WELL-FORMED?
 *
 * Every rule here was earned by a real failure in this repo, so each test names
 * the failure it prevents. The two that matter most:
 *
 *  - `stripCode`: a doc that MENTIONS `</Callout>` inside backticks is fine, and
 *    reporting it is a false positive. This actually happened, on a doc
 *    describing that very failure mode. A validator that cries wolf gets ignored.
 *  - The verify guard blocks on STRUCTURAL errors only, never on anchor
 *    resolution — a vanished anchor means the code moved, which is drift's
 *    question, and blocking there would make re-verifying after a rename
 *    impossible.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { lintContent, lintDocs, stripCode, STRUCTURAL_RULES, runLint } from "./lint";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function project(
  docs: Array<{ path: string; body?: string; relatedFiles?: string[]; title?: string }>,
  files: Record<string, string> = {},
  opts: { skipFileFor?: string[]; extraFiles?: Record<string, string> } = {},
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "catryna-lint-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }
  const meta = docs.map((d, i) => ({
    id: `d${i}`, path: d.path, title: d.title ?? `Doc ${i}`, tags: [] as string[],
    relatedFiles: d.relatedFiles ?? [], anchors: [] as any[], evidence: [] as string[], refs: [] as string[],
    verifiedCommit: "", verifiedAt: "", driftSuspectSince: "", driftSuspectReason: "",
    createdAt: 0, updatedAt: 0, createdBy: "test",
  }));
  await mkdir(join(dir, ".docs"), { recursive: true });
  await writeFile(join(dir, ".docs", "_index.json"), JSON.stringify({ version: 1, docs: meta }));
  for (const [i, d] of docs.entries()) {
    if (opts.skipFileFor?.includes(d.path)) continue;
    const f = join(dir, ".docs", `${d.path}.mdx`);
    await mkdir(dirname(f), { recursive: true });
    // Title must match the index entry built above, or every fixture trips
    // index-mismatch — which is itself a good sign the rule works.
    const title = d.title ?? `Doc ${i}`;
    await writeFile(
      f,
      d.body ?? `---\nid: x\npath: ${JSON.stringify(d.path)}\ntitle: ${JSON.stringify(title)}\n---\n\n# Doc\n`,
    );
  }
  for (const [rel, content] of Object.entries(opts.extraFiles ?? {})) {
    const p = join(dir, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }
  return dir;
}

const rules = (r: { issues: Array<{ rule: string }> }) => r.issues.map((i) => i.rule).sort();

describe("stripCode — the false-positive guard", () => {
  test("a closing tag inside inline code is prose, not markup", () => {
    const body = "Text mentioning `</Callout>` in backticks.";
    expect(stripCode(body)).not.toContain("</Callout>");
    expect(lintContent("d", `---\na: 1\n---\n\n${body}\n`)).toEqual([]);
  });

  test("a callout inside a fenced block is an example, not markup", () => {
    const body = "```mdx\n<Callout type=\"info\">\nexample\n</Callout>\n```\n";
    expect(lintContent("d", `---\na: 1\n---\n\n${body}`)).toEqual([]);
  });

  test("real markup outside code is still caught", () => {
    const issues = lintContent("d", `---\na: 1\n---\n\n<Callout type="info">\nreal, unclosed\n`);
    expect(issues.map((i) => i.rule)).toEqual(["unclosed-callout"]);
  });
});

describe("lintContent", () => {
  test("flags a missing frontmatter block", () => {
    expect(lintContent("d", "# No frontmatter\n").map((i) => i.rule)).toContain("frontmatter");
  });

  test("flags an orphaned closing callout — the lossy-round-trip signature", () => {
    const issues = lintContent("d", `---\na: 1\n---\n\nText\n</Callout>\n`);
    expect(issues.map((i) => i.rule)).toEqual(["unclosed-callout"]);
    expect(issues[0].message).toContain("0 open, 1 closing");
  });

  test("flags an odd number of code fences", () => {
    const issues = lintContent("d", `---\na: 1\n---\n\n\`\`\`ts\nconst a = 1;\n`);
    expect(issues.map((i) => i.rule)).toContain("unclosed-fence");
  });

  test("a balanced, well-formed doc produces nothing", () => {
    const body = `---\na: 1\n---\n\n# T\n\n<Callout type="info">\nfine\n</Callout>\n\n\`\`\`ts\nconst a = 1;\n\`\`\`\n`;
    expect(lintContent("d", body)).toEqual([]);
  });
});

describe("lintDocs — corpus rules", () => {
  test("clean corpus reports no issues", async () => {
    const dir = await project([{ path: "a", relatedFiles: ["src/a.ts"] }], { "src/a.ts": "" });
    const r = await lintDocs(dir);
    expect(r.issues).toEqual([]);
    expect(r.errors).toBe(0);
    expect(r.checked).toBe(1);
  });

  test("flags an anchor pointing at a path that does not exist", async () => {
    const dir = await project([{ path: "a", relatedFiles: ["src/gone.ts"] }]);
    expect(rules(await lintDocs(dir))).toContain("missing-anchor");
  });

  test("flags a backslash anchor, which silently matches nothing off Windows", async () => {
    const dir = await project([{ path: "a", relatedFiles: ["src\\win.ts"] }], { "src/win.ts": "" });
    const r = await lintDocs(dir);
    expect(rules(r)).toContain("windows-anchor");
    // Not ALSO reported as missing — one problem, one issue.
    expect(rules(r)).not.toContain("missing-anchor");
  });

  test("flags an index entry with no file behind it", async () => {
    const dir = await project([{ path: "ghost" }], {}, { skipFileFor: ["ghost"] });
    expect(rules(await lintDocs(dir))).toContain("missing-file");
  });

  test("flags a .mdx on disk that the index does not list", async () => {
    const dir = await project([{ path: "a" }], {}, {
      extraFiles: { ".docs/orphan.mdx": "---\na: 1\n---\n\n# Orphan\n" },
    });
    const r = await lintDocs(dir);
    expect(rules(r)).toContain("orphan-file");
    // A warning, not an error: it renders fine, it is just invisible.
    expect(r.issues.find((i) => i.rule === "orphan-file")!.severity).toBe("warning");
    expect(r.errors).toBe(0);
  });

  test("flags frontmatter/index path disagreement", async () => {
    const dir = await project([
      { path: "a", body: `---\nid: x\npath: "different"\ntitle: "Doc 0"\n---\n\n# Doc\n` },
    ]);
    expect(rules(await lintDocs(dir))).toContain("index-mismatch");
  });

  test("an unreadable index is an error, not an empty clean report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catryna-lint-bad-"));
    dirs.push(dir);
    await mkdir(join(dir, ".docs"), { recursive: true });
    await writeFile(join(dir, ".docs", "_index.json"), "{ not json");
    const r = await lintDocs(dir);
    expect(r.error).toBeTruthy();
    expect(r.issues).toEqual([]);
  });

  test("takes its root as a parameter, never process.cwd()", async () => {
    const a = await project([{ path: "a", relatedFiles: ["src/a.ts"] }], { "src/a.ts": "" });
    const b = await project([{ path: "a", relatedFiles: ["src/gone.ts"] }]);
    expect((await lintDocs(a)).errors).toBe(0);
    expect((await lintDocs(b)).errors).toBeGreaterThan(0);
  });
});

describe("runLint — the gate", () => {
  test("exits 3 on errors, like drift", async () => {
    const dir = await project([{ path: "a", relatedFiles: ["src/gone.ts"] }]);
    expect((await runLint({ json: false, cwd: dir })).code).toBe(3);
  });

  test("exits 0 when only warnings are present — warnings never gate", async () => {
    const dir = await project([{ path: "a" }], {}, {
      extraFiles: { ".docs/orphan.mdx": "---\na: 1\n---\n\n# Orphan\n" },
    });
    const run = await runLint({ json: false, cwd: dir });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("WARNINGS");
  });

  test("exits 1 on an operational failure, distinct from the gate code", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catryna-lint-op-"));
    dirs.push(dir);
    await mkdir(join(dir, ".docs"), { recursive: true });
    await writeFile(join(dir, ".docs", "_index.json"), "{ not json");
    const run = await runLint({ json: false, cwd: dir });
    expect(run.code).toBe(1);
    // Operational failure goes to stderr so stdout stays clean for pipelines.
    expect(run.stderr).toContain("error");
    expect(run.stdout).toBe("");
    // ...but under --json it is still a body-on-stdout, exit-0 report.
    const asJson = await runLint({ json: true, cwd: dir });
    expect(asJson.code).toBe(0);
    expect(JSON.parse(asJson.stdout).ok).toBe(false);
  });

  test("--json ALWAYS exits 0, even with errors — it is a report, not a gate", async () => {
    // SUITE_CONTRACTS §4, matching `drift --json`. Getting this wrong broke the
    // Stop hook, which does `out=$(catryna lint --json) || out=""` — a non-zero
    // exit blanked the output in exactly the case worth reporting.
    const dir = await project([{ path: "a", relatedFiles: ["src/gone.ts"] }]);
    const run = await runLint({ json: true, cwd: dir });
    expect(run.code).toBe(0);
    expect(run.stderr).toBe("");
    const parsed = JSON.parse(run.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.errors).toBeGreaterThan(0);
    expect(parsed.issues[0]).toHaveProperty("hint");
  });

  test("every issue carries an actionable hint", async () => {
    const dir = await project([
      { path: "a", relatedFiles: ["src\\win.ts", "src/gone.ts"] },
      { path: "b", body: "# no frontmatter\n" },
    ]);
    const r = await lintDocs(dir);
    expect(r.issues.length).toBeGreaterThan(2);
    for (const i of r.issues) expect(i.hint.length).toBeGreaterThan(10);
  });
});

describe("the verify guard scope", () => {
  test("STRUCTURAL_RULES covers malformed content and excludes anchor resolution", () => {
    // Anchors are drift's question. Blocking verify on them would make
    // re-verifying a doc after a rename impossible.
    expect([...STRUCTURAL_RULES].sort()).toEqual(["frontmatter", "unclosed-callout", "unclosed-fence"]);
    expect(STRUCTURAL_RULES.has("missing-anchor" as any)).toBe(false);
    expect(STRUCTURAL_RULES.has("orphan-file" as any)).toBe(false);
  });
});
