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
