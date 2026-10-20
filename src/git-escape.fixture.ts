// Run only by git-env-isolation.test.ts (not matched by `bun test`'s
// *.test.ts pattern). Does what many suite tests do: builds a throwaway repo
// and configures and commits in it.
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("fixture: a throwaway repo is configured and committed", () => {
  const dir = mkdtempSync(join(tmpdir(), "catryna-escape-fixture-"));
  try {
    const git = (...args: string[]) =>
      Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    expect(git("init", "-q").exitCode).toBe(0);
    git("config", "user.email", "escape@catryna.test");
    git("config", "user.name", "Escape Fixture");
    git("config", "diff.noprefix", "true");
    writeFileSync(join(dir, "a.txt"), "a\n");
    git("add", "a.txt");
    expect(git("commit", "-q", "-m", "fixture commit").exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A call that passes `env` explicitly but as `undefined` (e.g. forwarding an
// optional `opts.env`) must not get Bun's ORIGINAL environment back.
const PROBE = "console.log(process.env.GIT_DIR ?? 'unset')";

test("fixture: spawnSync with `env: undefined` gets the cleaned environment", () => {
  for (const spawn of [
    () => Bun.spawnSync([process.execPath, "-e", PROBE], { env: undefined, stdout: "pipe" }),
    () => Bun.spawnSync({ cmd: [process.execPath, "-e", PROBE], env: undefined, stdout: "pipe" }),
  ]) {
    expect(spawn().stdout.toString().trim()).toBe("unset");
  }
});

test("fixture: spawn with `env: undefined` gets the cleaned environment", async () => {
  const run = async (proc: ReturnType<typeof Bun.spawn>) =>
    (await new Response(proc.stdout as ReadableStream).text()).trim();
  expect(await run(Bun.spawn([process.execPath, "-e", PROBE], { env: undefined, stdout: "pipe" }))).toBe("unset");
  expect(await run(Bun.spawn({ cmd: [process.execPath, "-e", PROBE], env: undefined, stdout: "pipe" }))).toBe("unset");
});
