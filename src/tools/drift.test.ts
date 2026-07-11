/**
 * Tests for the CONSUMPTION surfaces (PRODUCT_ROADMAP Phase 1):
 *   - the `check_drift` / `verify_doc` / `propose_doc_repair` MCP tools,
 *   - the repair-context builder behind `propose_doc_repair` + `catryna repair`,
 *   - the `catryna repair` CLI subcommand (end-to-end through the real CLI).
 *
 * Fixtures mirror src/drift.test.ts: a real temp GIT repo (git init, an initial
 * commit, then a commit that mutates an anchored file to manufacture drift) with
 * `.docs/_index.json` + `.mdx` seeded directly (no MCP round-trip). computeDrift
 * / buildRepairContext honor an injected `cwd`, so classification runs
 * in-process; the CLI path runs in a subprocess whose cwd is the temp repo.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { registerDriftTools, buildRepairContext, buildRepairJson } from "./drift";

const CLI_PATH = fileURLToPath(new URL("../cli.ts", import.meta.url));

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
  const dir = await mkdtemp(join(tmpdir(), "catryna-consume-"));
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
        `createdAt: ${m.createdAt}\nupdatedAt: ${m.updatedAt}\ncreatedBy: "test"\n---\n\n` +
        `# ${m.title}\n\nDoc prose describing ${m.relatedFiles.join(", ")}.\n`,
    );
  }
}

/** A repo where modules/a is DRIFTED (a.ts changed since verification), b clean. */
async function driftedRepo(): Promise<{ dir: string; baseline: string }> {
  const dir = await initRepo({
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": "export const b = 1;\n",
  });
  const baseline = await git(dir, ["rev-parse", "HEAD"]);
  await seedDocs(dir, [
    { path: "modules/a", relatedFiles: ["src/a.ts"], verifiedCommit: baseline },
    { path: "modules/b", relatedFiles: ["src/b.ts"], verifiedCommit: baseline },
  ]);
  await writeFileAt(dir, "src/a.ts", "export const a = 2; // changed\n");
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "touch a"]);
  return { dir, baseline };
}

interface CliOut {
  stdout: string;
  stderr: string;
  code: number;
}
async function runCli(dir: string, args: string[]): Promise<CliOut> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

/** Capture registerDriftTools' server.tool(...) calls via a recording stub. */
function recordTools() {
  const calls: { name: string; schema: unknown; cb: (args: any) => Promise<any> }[] = [];
  const server = {
    tool(name: string, schema: unknown, cb: (args: any) => Promise<any>) {
      calls.push({ name, schema, cb });
    },
  };
  registerDriftTools(server as any);
  return calls;
}

/** Extract the single text-content payload an MCP tool handler returns. */
function toolText(result: any): string {
  return result.content[0].text as string;
}

// ---------------------------------------------------------------------------

describe("registerDriftTools — MCP wiring", () => {
  test("registers exactly check_drift, verify_doc, propose_doc_repair", () => {
    const calls = recordTools();
    expect(calls.map((c) => c.name)).toEqual([
      "check_drift",
      "verify_doc",
      "propose_doc_repair",
    ]);
  });
});

describe("check_drift MCP tool — returns a well-formed drift report", () => {
  test("handler emits the same JSON body as `catryna drift --json`", async () => {
    const { dir, baseline } = await driftedRepo();
    const check = recordTools().find((c) => c.name === "check_drift")!;

    // The handler reads process.cwd(); point it at the temp repo, then restore.
    const prev = process.cwd();
    let text: string;
    try {
      process.chdir(dir);
      text = toolText(await check.cb({}));
    } finally {
      process.chdir(prev);
    }

    const parsed = JSON.parse(text);
    // Exactly one JSON object (well-formed) with the drift report shape.
    expect(text).toBe(JSON.stringify(parsed));
    expect(parsed.tool).toBe("catryna");
    expect(parsed.command).toBe("drift");
    expect(parsed.gitRepo).toBe(true);
    expect(parsed.summary.drifted).toBe(1);
    expect(parsed.drifted[0].path).toBe("modules/a");
    expect(parsed.drifted[0].anchors).toContain("src/a.ts");
    expect(parsed.drifted[0].since).toBe(baseline);
    expect(parsed.clean.map((d: any) => d.path)).toEqual(["modules/b"]);
  });
});

describe("propose_doc_repair MCP tool — repair context bundle", () => {
  test("handler returns doc content + anchor diff for the drifted doc", async () => {
    const { dir, baseline } = await driftedRepo();
    const propose = recordTools().find((c) => c.name === "propose_doc_repair")!;

    const prev = process.cwd();
    let text: string;
    try {
      process.chdir(dir);
      text = toolText(await propose.cb({ doc: "all" }));
    } finally {
      process.chdir(prev);
    }

    const parsed = JSON.parse(text);
    expect(parsed.command).toBe("repair");
    expect(parsed.summary.repairs).toBe(1);
    const r = parsed.repairs[0];
    expect(r.path).toBe("modules/a");
    expect(r.since).toBe(baseline);
    expect(r.changedFiles).toEqual(["src/a.ts"]);
    // Current doc content is bundled so the agent can propose an update_doc.
    expect(r.currentContent).toContain("Doc prose describing src/a.ts");
    // The anchor's git diff since the baseline is included.
    expect(r.diffs[0].file).toBe("src/a.ts");
    expect(r.diffs[0].diff).toContain("export const a = 2;");
    expect(r.diffs[0].diff).toContain("-export const a = 1;");
    // Guidance points the agent at update_doc + verify (never auto-edits).
    expect(String(parsed.guidance)).toContain("update_doc");
  });
});

describe("buildRepairContext — targeting + edge cases (in-process)", () => {
  test("target a specific drifted doc yields only that doc's context", async () => {
    const { dir } = await driftedRepo();
    const res = await buildRepairContext(dir, "modules/a");
    expect(res.gitRepo).toBe(true);
    expect(res.requested).toBe("modules/a");
    expect(res.repairs.map((r) => r.path)).toEqual(["modules/a"]);
  });

  test("a known-but-not-drifted doc reports notDrifted, no repairs", async () => {
    const { dir } = await driftedRepo();
    const res = await buildRepairContext(dir, "modules/b");
    expect(res.repairs).toEqual([]);
    expect(res.notDrifted).toEqual(["modules/b"]);
  });

  test("no drifted docs → empty repairs, guidance says nothing to repair", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const head = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "m/a", relatedFiles: ["src/a.ts"], verifiedCommit: head }]);
    const res = await buildRepairContext(dir, "all");
    expect(res.repairs).toEqual([]);
    expect(String(buildRepairJson(res).guidance)).toContain("No drifted or broken docs");
  });

  test("broken anchor (deleted file) → included as a broken repair", async () => {
    // Regression: repair used to iterate only report.drifted, so a broken doc
    // (deleted/renamed anchor) got a false "nothing to repair ✓" while drift
    // failed CI on it. It must surface as a broken repair the agent can act on.
    const dir = await initRepo({ "src/gone.ts": "export const g = 1;\n" });
    const head = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "m/gone", relatedFiles: ["src/gone.ts"], verifiedCommit: head }]);
    await rm(join(dir, "src", "gone.ts"), { force: true });
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-qm", "rm gone.ts"]);

    const res = await buildRepairContext(dir, "all");
    expect(res.repairs.length).toBe(1);
    expect(res.repairs[0].path).toBe("m/gone");
    expect(res.repairs[0].broken).toBe(true);
    expect(res.repairs[0].brokenFiles).toContain("src/gone.ts");
    const json = buildRepairJson(res) as { summary: { broken: number } };
    expect(json.summary.broken).toBe(1);
    // Targeting the broken doc by name must NOT report it as unknown.
    const one = await buildRepairContext(dir, "m/gone");
    expect(one.repairs.length).toBe(1);
    expect(one.notDrifted).toBeUndefined();
  });

  test("not a git repo → degrades cleanly (gitRepo:false, error set)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catryna-consume-nogit-"));
    dirs.push(dir);
    const res = await buildRepairContext(dir, "all");
    expect(res.gitRepo).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.repairs).toEqual([]);
  });
});

describe("catryna repair (end-to-end through the CLI)", () => {
  test("--json emits exactly ONE JSON object (exit 0) with the repair bundle", async () => {
    const { dir, baseline } = await driftedRepo();
    const { stdout, stderr, code } = await runCli(dir, ["repair", "--json"]);
    expect(code, stderr).toBe(0);

    const trimmed = stdout.trim();
    const parsed = JSON.parse(trimmed);
    expect(trimmed).toBe(JSON.stringify(parsed)); // nothing else on stdout
    expect(parsed.tool).toBe("catryna");
    expect(parsed.command).toBe("repair");
    expect(parsed.summary.repairs).toBe(1);
    expect(parsed.repairs[0].path).toBe("modules/a");
    expect(parsed.repairs[0].since).toBe(baseline);
    expect(parsed.repairs[0].diffs[0].diff).toContain("export const a = 2;");
  });

  test("human mode lists the drifted doc + its anchors, exit 0 (not a gate)", async () => {
    const { dir } = await driftedRepo();
    const { stdout, code } = await runCli(dir, ["repair"]);
    expect(code).toBe(0); // repair reports context; it never soft-blocks
    expect(stdout).toContain("modules/a");
    expect(stdout).toContain("src/a.ts");
  });

  test("an unknown/unanchored target does not falsely claim the doc is missing", async () => {
    const { dir } = await driftedRepo();
    const { stdout, code } = await runCli(dir, ["repair", "modules/ghost"]);
    expect(code).toBe(0);
    // Reworded message: never asserts "no doc" (an unanchored doc exists but is
    // skipped by computeDrift); points at `catryna drift` instead.
    expect(stdout).toContain("no drifted doc");
    expect(stdout).not.toContain("no doc at");
  });

  test("targeting a specific drifted doc works via positional arg", async () => {
    const { dir } = await driftedRepo();
    const { stdout, code } = await runCli(dir, ["repair", "modules/a", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.requested).toBe("modules/a");
    expect(parsed.repairs.map((r: any) => r.path)).toEqual(["modules/a"]);
  });

  test("not a git repo: --json degrades (exit 0); human is exit 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catryna-consume-nogit-cli-"));
    dirs.push(dir);

    const jsonRun = await runCli(dir, ["repair", "--json"]);
    expect(jsonRun.code).toBe(0);
    const parsed = JSON.parse(jsonRun.stdout.trim());
    expect(parsed.gitRepo).toBe(false);
    expect(parsed.error).toBeTruthy();

    const humanRun = await runCli(dir, ["repair"]);
    expect(humanRun.code).toBe(1);
    expect(humanRun.stderr).toContain("not a git repository");
  });
});
