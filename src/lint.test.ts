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

/**
 * `lint` used to check fence BALANCE, not fence CONTENT — so a doc could be
 * structurally perfect and almost entirely empty and still be reported
 * well-formed. One real doc had 12 blank fences, including the ```mermaid block
 * that was supposed to BE the architecture diagram, and survived a full repair
 * pass reported clean throughout. A human going looking is what found it.
 */
describe("empty-fence — the hollow-doc rule", () => {
  const fence = (info: string, body: string) => "```" + info + "\n" + body + "```\n";
  const doc = (body: string) => `---\na: 1\n---\n\n${body}`;
  const rules = (raw: string) => lintContent("d", raw).map((i) => i.rule);

  test("an empty ```mermaid block is reported", () => {
    const issues = lintContent("d", doc(`# Architecture\n\n${fence("mermaid", "")}`));
    expect(issues.map((i) => i.rule)).toEqual(["empty-fence"]);
    expect(issues[0].message).toContain("1 empty code fence(s)");
    expect(issues[0].message).toContain("(mermaid)");
  });

  test("a fence containing only whitespace is still empty", () => {
    expect(rules(doc(fence("typescript", "   \n\n\t\n")))).toEqual(["empty-fence"]);
  });

  test("NOT over-firing: a doc whose fences all have content passes", () => {
    const raw = doc(
      `# T\n\n${fence("mermaid", "flowchart TD\n  A --> B\n")}\n${fence("typescript", "const a = 1;\n")}`,
    );
    expect(lintContent("d", raw)).toEqual([]);
  });

  test("one issue per DOC, listing the lines — not one issue per fence", () => {
    const raw = doc(
      `# T\n\n${fence("mermaid", "")}\n${fence("ts", "")}\n${fence("ts", "const ok = 1;\n")}`,
    );
    const issues = lintContent("d", raw);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("2 empty code fence(s)");
  });

  test("line numbers are FILE-relative, counting the frontmatter", () => {
    // frontmatter is 3 lines (---, a: 1, ---), then a blank, then the fence.
    const issues = lintContent("d", `---\na: 1\n---\n\n${fence("mermaid", "")}`);
    expect(issues[0].message).toContain("line 5");
  });

  test("warning, never an error — it must surface without gating", () => {
    const issues = lintContent("d", doc(fence("mermaid", "")));
    expect(issues[0].severity).toBe("warning");
    // And it is not structural, so `catryna verify` still records a baseline:
    // an in-progress doc must remain verifiable.
    expect(STRUCTURAL_RULES.has("empty-fence" as never)).toBe(false);
  });

  test("an UNCLOSED trailing fence is unclosed-fence's finding alone", () => {
    // Naming one defect twice trains people to ignore the report.
    expect(rules(doc("```mermaid\n"))).toEqual(["unclosed-fence"]);
  });

  /**
   * REGRESSION — a 4-backtick wrapper around a populated example.
   *
   * A naive "any line starting with ```" pairs the outer ```` with the inner
   * ```, and reports a fully-populated mermaid diagram as TWO empty blocks.
   * Fence parity stays even so `unclosed-fence` says nothing, meaning the doc
   * lint-passed before the rule existed and would be called hollow after — the
   * precise false positive that gets a validator ignored.
   */
  test("a 4-backtick wrapper around a populated fence is not hollow", () => {
    const raw = doc(
      "````markdown\n```mermaid\nflowchart TD\n  A-->B\n```\n````\n",
    );
    expect(lintContent("d", raw)).toEqual([]);
  });

  test("...but a 4-backtick wrapper around nothing still is", () => {
    expect(rules(doc("````markdown\n````\n"))).toEqual(["empty-fence"]);
  });

  test("~~~ fences are checked too (stripCode already honors them)", () => {
    expect(rules(doc("~~~mermaid\n~~~\n"))).toEqual(["empty-fence"]);
    expect(lintContent("d", doc("~~~mermaid\nflowchart TD\n  A-->B\n~~~\n"))).toEqual([]);
  });

  test("a fence closed by a LONGER run of the same marker still closes", () => {
    // CommonMark: the closing fence may be longer than the opening one.
    expect(rules(doc("```ts\nconst a = 1;\n``````\n"))).toEqual([]);
  });

  test("a ``` line with trailing text is CONTENT, not a close", () => {
    // Only whitespace may follow a closing fence. The block below therefore has
    // a body and a real closing fence, and is entirely well-formed. The old
    // parity count called it unclosed (3 fence-opening lines, odd) — an
    // error-severity false positive that gated CI on a legitimate doc.
    expect(lintContent("d", doc("```ts\n``` not a close\n```\n"))).toEqual([]);
  });

  test("unclosed-fence still fires on a genuinely unclosed fence, and names the line", () => {
    const issues = lintContent("d", doc("# T\n\n```ts\nconst a = 1;\n"));
    expect(issues.map((i) => i.rule)).toEqual(["unclosed-fence"]);
    // frontmatter (3 lines) + blank + "# T" + blank => the fence opens at line 7
    expect(issues[0].message).toContain("line 7");
  });

  test("an even number of fence lines is not automatically well-formed", () => {
    // Two openers, no closer: parity says even, the scanner says unclosed.
    expect(rules(doc("````md\n```ts\nconst a = 1;\n"))).toEqual(["unclosed-fence"]);
  });

  test("the gate does not fail on it (warnings never gate)", async () => {
    const dir = await project([
      { path: "hollow", body: `---\nid: x\npath: "hollow"\ntitle: "Doc 0"\n---\n\n# T\n\n\`\`\`mermaid\n\`\`\`\n` },
    ]);
    const r = await runLint({ json: false, cwd: dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("empty-fence");
    expect(r.stdout).toContain("WARNINGS");
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
