/**
 * Tests for `catryna drift` / `catryna verify` — the Phase-1 wedge
 * (PRODUCT_ROADMAP Phase 1; git-diff doc-drift detection).
 *
 * Each assertion is mutation-checkable: it fails if the corresponding wiring is
 * removed. The drift CLASSIFICATION tests run in-process (computeDrift honors an
 * injected `cwd`: it reads the index via `readIndexAt(cwd)` and runs git in
 * `cwd`). The VERIFY WRITE path goes through the real CLI in a subprocess,
 * because storage.ts resolves `.docs/` from `process.cwd()` captured at module
 * load — so a fresh temp project must be the subprocess's cwd (same pattern as
 * storage.test.ts / events.test.ts).
 *
 * A real temp GIT repo is the fixture: `git init`, an initial commit with source
 * files, then commits that mutate anchored files to manufacture drift.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { computeDrift, isGitRepo } from "./drift";

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url));

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/** Run git in `dir`; throw with stderr on non-zero so fixtures fail loudly. */
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

/** A temp git repo with `files` committed as the initial commit. */
async function initRepo(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "catryna-drift-"));
  dirs.push(dir);
  await git(dir, ["init", "-q"]);
  await git(dir, ["config", "user.email", "test@catryna.local"]);
  await git(dir, ["config", "user.name", "Catryna Test"]);
  await git(dir, ["config", "commit.gpgsign", "false"]);
  for (const [rel, content] of Object.entries(files)) await writeFileAt(dir, rel, content);
  await git(dir, ["add", "-A"]);
  // --allow-empty so a repo seeded with no files still gets an initial HEAD.
  await git(dir, ["commit", "-q", "--allow-empty", "-m", "initial"]);
  return dir;
}

interface SeedDoc {
  path: string;
  relatedFiles: string[];
  verifiedCommit?: string; // "" / omitted = never verified
}

/** Seed `.docs/_index.json` + `.mdx` files directly (no MCP round-trip). */
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
        `# ${m.title}\n\nBody paragraph that must survive verify.\n`,
    );
  }
}

async function readIndex(dir: string): Promise<{ docs: any[] }> {
  return JSON.parse(await readFile(join(dir, ".docs", "_index.json"), "utf-8"));
}

async function readMdx(dir: string, path: string): Promise<string> {
  return readFile(join(dir, ".docs", `${path}.mdx`), "utf-8");
}

/** All spine events in `dir`, parsed. */
async function readSpine(dir: string): Promise<any[]> {
  const evDir = join(dir, ".suite", "events");
  try {
    const files = await readdir(evDir);
    const out: any[] = [];
    for (const f of files) {
      const raw = await readFile(join(evDir, f), "utf-8");
      for (const line of raw.split("\n").filter(Boolean)) out.push(JSON.parse(line));
    }
    return out;
  } catch {
    return [];
  }
}

interface CliOut {
  stdout: string;
  stderr: string;
  code: number;
}

/** Invoke the real `catryna` CLI with cwd = `dir`. */
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

// ---------------------------------------------------------------------------

describe("computeDrift — classification (in-process)", () => {
  test("detects EXACTLY the doc whose anchored file changed since its baseline", async () => {
    const dir = await initRepo({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 1;\n",
    });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [
      { path: "modules/a", relatedFiles: ["src/a.ts"], verifiedCommit: baseline },
      { path: "modules/b", relatedFiles: ["src/b.ts"], verifiedCommit: baseline },
    ]);

    // Change ONLY a.ts and commit it — b.ts is untouched.
    await writeFileAt(dir, "src/a.ts", "export const a = 2; // changed\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "touch a"]);

    const report = await computeDrift(dir, { emit: false });
    expect(report.gitRepo).toBe(true);

    // modules/a drifted; modules/b clean. (Fails if the diff pathspec or the
    // per-doc baseline is dropped.)
    expect(report.drifted.map((d) => d.path)).toEqual(["modules/a"]);
    expect(report.clean.map((d) => d.path)).toEqual(["modules/b"]);
    expect(report.unverified).toEqual([]);

    const a = report.drifted[0];
    expect(a.changedFiles).toContain("src/a.ts");
    expect(a.verifiedCommit).toBe(baseline); // `since` = the baseline it drifted from
  });

  test("a doc verified at HEAD with no later change does NOT drift", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const head = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "m/a", relatedFiles: ["src/a.ts"], verifiedCommit: head }]);

    const report = await computeDrift(dir, { emit: false });
    expect(report.drifted).toEqual([]);
    expect(report.clean.map((d) => d.path)).toEqual(["m/a"]);
  });

  test("a never-verified doc is reported UNVERIFIED, not drifted/clean", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    // No verifiedCommit → no baseline.
    await seedDocs(dir, [{ path: "m/a", relatedFiles: ["src/a.ts"] }]);

    const report = await computeDrift(dir, { emit: false });
    expect(report.unverified.map((d) => d.path)).toEqual(["m/a"]);
    expect(report.drifted).toEqual([]);
    expect(report.clean).toEqual([]);
  });

  test("a doc with no relatedFiles is not driftable (skipped)", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const head = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "m/none", relatedFiles: [], verifiedCommit: head }]);

    const report = await computeDrift(dir, { emit: false });
    expect(report.drifted).toEqual([]);
    expect(report.clean).toEqual([]);
    expect(report.unverified).toEqual([]);
  });

  test("a baseline commit missing from history is conservatively DRIFTED", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [
      { path: "m/a", relatedFiles: ["src/a.ts"], verifiedCommit: "0000000000000000000000000000000000000000" },
    ]);
    const report = await computeDrift(dir, { emit: false });
    expect(report.drifted.map((d) => d.path)).toEqual(["m/a"]);
    expect(report.drifted[0].note).toContain("not found");
  });

  test("not a git repository → degrades cleanly, never throws", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catryna-nogit-"));
    dirs.push(dir);
    expect(await isGitRepo(dir)).toBe(false);

    const report = await computeDrift(dir, { emit: false });
    expect(report.gitRepo).toBe(false);
    expect(report.error).toBeTruthy();
    expect(report.drifted).toEqual([]);
  });
});

describe("computeDrift — emits doc.drifted on the spine (§2)", () => {
  test("emit:true lands a doc.drifted event per drifted doc {path, anchors, since}", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "m/a", relatedFiles: ["src/a.ts"], verifiedCommit: baseline }]);
    await writeFileAt(dir, "src/a.ts", "export const a = 2;\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "touch a"]);

    await computeDrift(dir, { emit: true });

    const drifted = (await readSpine(dir)).filter((e) => e.type === "doc.drifted");
    expect(drifted.length).toBe(1);
    expect(drifted[0].source).toBe("catryna");
    expect(drifted[0].refs).toEqual(["catryna:doc/m/a"]);
    expect(drifted[0].data.path).toBe("m/a");
    expect(drifted[0].data.since).toBe(baseline);
    expect(drifted[0].data.anchors).toContain("src/a.ts");
  });

  test("emit:false writes NO spine events (classification stays side-effect-free)", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "m/a", relatedFiles: ["src/a.ts"], verifiedCommit: baseline }]);
    await writeFileAt(dir, "src/a.ts", "export const a = 2;\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "touch a"]);

    await computeDrift(dir, { emit: false });
    expect(await readSpine(dir)).toEqual([]);
  });
});

describe("catryna verify (end-to-end through the CLI)", () => {
  test("records HEAD as the doc's baseline in index + frontmatter, and emits doc.verified", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"] }]);
    const head = await git(dir, ["rev-parse", "HEAD"]);

    const { stdout, stderr, code } = await runCli(dir, ["verify", "modules/a", "--json"]);
    expect(code, stderr).toBe(0);

    // §4 rule 1: exactly one JSON object on stdout.
    const parsed = JSON.parse(stdout.trim());
    expect(stdout.trim()).toBe(JSON.stringify(parsed));
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("verify");
    expect(parsed.verifiedCommit).toBe(head);
    expect(parsed.trust).toBe("verified");
    expect(typeof parsed.verifiedAt).toBe("string");
    expect(parsed.verifiedAt.length).toBeGreaterThan(0);

    // Index carries the baseline (the queryable source drift reads).
    const idx = await readIndex(dir);
    const entry = idx.docs.find((d) => d.path === "modules/a");
    expect(entry.verifiedCommit).toBe(head);
    expect(entry.verifiedAt).toBe(parsed.verifiedAt);

    // Frontmatter updated SURGICALLY: baseline written, body preserved verbatim.
    const mdx = await readMdx(dir, "modules/a");
    expect(mdx).toContain(`verifiedCommit: "${head}"`);
    expect(mdx).toContain("Body paragraph that must survive verify.");

    // Spine carries doc.verified {path, verifiedAt, trust} (§2).
    const verified = (await readSpine(dir)).filter((e) => e.type === "doc.verified");
    expect(verified.length).toBe(1);
    expect(verified[0].data.path).toBe("modules/a");
    expect(verified[0].data.trust).toBe("verified");
    expect(verified[0].data.verifiedAt).toBe(parsed.verifiedAt);
  });

  test("verify then drift: a freshly verified doc is clean until its code changes", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"] }]);

    // Verify at HEAD, then drift → clean.
    expect((await runCli(dir, ["verify", "modules/a"])).code).toBe(0);
    let report = await computeDrift(dir, { emit: false });
    expect(report.clean.map((d) => d.path)).toEqual(["modules/a"]);
    expect(report.drifted).toEqual([]);

    // Change the anchored file + commit → now drifted.
    await writeFileAt(dir, "src/a.ts", "export const a = 99;\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "change a"]);
    report = await computeDrift(dir, { emit: false });
    expect(report.drifted.map((d) => d.path)).toEqual(["modules/a"]);
  });

  test("verifying a nonexistent doc is an operational failure (exit 1)", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"] }]);

    const { stdout, code } = await runCli(dir, ["verify", "does/not/exist", "--json"]);
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("no doc");
  });

  test("verify requires a <path> (usage error, exit 2)", async () => {
    const dir = await initRepo();
    const { code, stderr } = await runCli(dir, ["verify"]);
    expect(code).toBe(2);
    expect(stderr).toContain("requires a <path>");
  });
});

describe("catryna drift (end-to-end through the CLI)", () => {
  /** Build a repo with modules/a drifted (a.ts changed since verification). */
  async function driftedRepo(): Promise<string> {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const baseline = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"], verifiedCommit: baseline }]);
    await writeFileAt(dir, "src/a.ts", "export const a = 2;\n");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "touch a"]);
    return dir;
  }

  test("--json emits exactly ONE JSON object and exits 0 (§4 rule 1)", async () => {
    const dir = await driftedRepo();
    const { stdout, stderr, code } = await runCli(dir, ["drift", "--json"]);
    expect(code, stderr).toBe(0); // report command: always exit 0 under --json

    const trimmed = stdout.trim();
    const parsed = JSON.parse(trimmed);
    expect(trimmed).toBe(JSON.stringify(parsed)); // nothing else on stdout
    expect(parsed.tool).toBe("catryna");
    expect(parsed.command).toBe("drift");
    expect(parsed.gitRepo).toBe(true);
    expect(parsed.summary.drifted).toBe(1);
    expect(parsed.drifted[0].path).toBe("modules/a");
    expect(parsed.drifted[0].anchors).toContain("src/a.ts");
  });

  test("human mode is a CI gate: exit 3 (soft-blocked) when drift is found", async () => {
    const dir = await driftedRepo();
    const { stdout, code } = await runCli(dir, ["drift"]);
    expect(code).toBe(3);
    expect(stdout).toContain("DRIFTED");
    expect(stdout).toContain("modules/a");
  });

  test("human mode exits 0 when everything verified matches HEAD", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const head = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"], verifiedCommit: head }]);
    const { stdout, code } = await runCli(dir, ["drift"]);
    expect(code).toBe(0);
    expect(stdout).toContain("no drift");
  });

  test("not a git repo: --json degrades (exit 0, gitRepo:false); human is exit 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catryna-nogit-cli-"));
    dirs.push(dir);

    const jsonRun = await runCli(dir, ["drift", "--json"]);
    expect(jsonRun.code).toBe(0);
    const parsed = JSON.parse(jsonRun.stdout.trim());
    expect(parsed.gitRepo).toBe(false);
    expect(parsed.error).toBeTruthy();

    const humanRun = await runCli(dir, ["drift"]);
    expect(humanRun.code).toBe(1); // operational failure in a shell context
    expect(humanRun.stderr).toContain("not a git repository");
  });
});
