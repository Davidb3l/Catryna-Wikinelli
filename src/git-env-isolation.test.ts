import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Git exports GIT_DIR to hooks, and the pre-push hook runs this suite. Without
// src/test-preload.ts, a test's `git init` / `git config` / `git commit` in a
// temp dir is redirected into the repository being pushed. This runs a
// git-using test the way the hook does and checks the "pushed" repo is intact.
test("tests never touch the repository named by an inherited GIT_DIR", () => {
  const victim = mkdtempSync(join(tmpdir(), "catryna-escape-victim-"));
  try {
    const git = (...args: string[]) =>
      Bun.spawnSync(["git", ...args], { cwd: victim, stdout: "pipe", stderr: "pipe" });
    git("init", "-q");
    git("-c", "user.email=v@v", "-c", "user.name=v", "commit", "-q", "--allow-empty", "-m", "victim");
    const headBefore = git("rev-parse", "HEAD").stdout.toString().trim();

    const child = Bun.spawnSync(["bun", "test", "./src/git-escape.fixture.ts"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, GIT_DIR: join(victim, ".git"), GIT_WORK_TREE: victim },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(child.exitCode).toBe(0);

    expect(git("rev-parse", "HEAD").stdout.toString().trim()).toBe(headBefore);
    expect(git("config", "--local", "--get", "user.email").stdout.toString().trim()).toBe("");
    expect(git("config", "--local", "--get", "diff.noprefix").stdout.toString().trim()).toBe("");
  } finally {
    rmSync(victim, { recursive: true, force: true });
  }
}, 60_000);
