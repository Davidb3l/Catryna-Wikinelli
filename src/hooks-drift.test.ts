/**
 * Tests for the Claude Code Stop hook (hooks/drift-check.sh) — the third
 * consumption surface (PRODUCT_ROADMAP Phase 1): a session that touched anchored
 * files ends with a reminder to update the affected docs.
 *
 * Contract under test: INFORMATIONAL + NON-BLOCKING.
 *   - drift present  → concise reminder on STDERR, exit 0;
 *   - no drift       → SILENT, exit 0;
 *   - no .docs index → SILENT, exit 0;
 *   - not a git repo → SILENT, exit 0.
 *
 * The hook shells out to the real `catryna drift --json` (bun) with
 * CLAUDE_PLUGIN_ROOT pointed at the repo root, cwd = a temp git fixture.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOOK = join(ROOT, "hooks", "drift-check.sh");

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
  const dir = await mkdtemp(join(tmpdir(), "catryna-hook-"));
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

async function seedDocs(
  dir: string,
  docs: { path: string; relatedFiles: string[]; verifiedCommit?: string }[],
): Promise<void> {
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

interface HookOut {
  stdout: string;
  stderr: string;
  code: number;
}
/** Run the Stop hook with cwd=`dir` and CLAUDE_PLUGIN_ROOT=repo root. */
async function runHook(dir: string): Promise<HookOut> {
  const proc = Bun.spawn(["sh", HOOK], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

/** A repo where `count` docs are drifted (their anchors changed since verify). */
async function driftedRepo(count: number): Promise<string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) files[`src/f${i}.ts`] = `export const v${i} = 1;\n`;
  const dir = await initRepo(files);
  const baseline = await git(dir, ["rev-parse", "HEAD"]);
  await seedDocs(
    dir,
    Array.from({ length: count }, (_, i) => ({
      path: `modules/m${i}`,
      relatedFiles: [`src/f${i}.ts`],
      verifiedCommit: baseline,
    })),
  );
  for (let i = 0; i < count; i++) await writeFileAt(dir, `src/f${i}.ts`, `export const v${i} = 2;\n`);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "touch anchors"]);
  return dir;
}

// ---------------------------------------------------------------------------

describe("Stop hook (drift-check.sh) — informational + non-blocking", () => {
  test("drift present → reminder on STDERR, exit 0", async () => {
    const dir = await driftedRepo(1);
    const { stdout, stderr, code } = await runHook(dir);
    expect(code).toBe(0); // never blocks the session
    expect(stderr).toContain("catryna:");
    expect(stderr).toContain("1 doc drifted");
    expect(stderr).toContain("catryna repair");
    expect(stdout).toBe(""); // reminder goes to stderr, not stdout
  });

  test("multiple drifted docs → pluralized count on stderr, exit 0", async () => {
    const dir = await driftedRepo(2);
    const { stderr, code } = await runHook(dir);
    expect(code).toBe(0);
    expect(stderr).toContain("2 docs drifted");
  });

  test("no drift (all verified at HEAD) → SILENT, exit 0", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const head = await git(dir, ["rev-parse", "HEAD"]);
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"], verifiedCommit: head }]);

    const { stdout, stderr, code } = await runHook(dir);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
  });

  test("no .docs index → SILENT, exit 0 (never nags unrelated repos)", async () => {
    const dir = await initRepo({ "src/a.ts": "export const a = 1;\n" });
    const { stdout, stderr, code } = await runHook(dir);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
  });

  test("not a git repo (but has a .docs index) → SILENT, exit 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catryna-hook-nogit-"));
    dirs.push(dir);
    // Seed a .docs index without git init.
    await seedDocs(dir, [{ path: "modules/a", relatedFiles: ["src/a.ts"] }]);

    const { stdout, stderr, code } = await runHook(dir);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
  });
});
