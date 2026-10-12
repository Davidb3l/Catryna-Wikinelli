#!/usr/bin/env bun
/**
 * Launch the Catryna MCP server from wherever the plugin is installed.
 *
 * plugin.json runs this with `bun` directly, NOT through a shell. Claude Code
 * spawns an MCP server's command without one, so on Windows a bare `bash`
 * resolves on PATH to C:\Windows\System32\bash.exe — the WSL launcher — which
 * fails with "execvpe(/bin/bash) failed" (or there is no bash at all), and the
 * server never starts. Bun is already required, so it is the one interpreter
 * every supported OS is guaranteed to have.
 *
 * Key contract: the server's cwd MUST stay the user's project directory —
 * storage resolves .docs/ from process.cwd(). So we install deps into the
 * plugin root if missing, but never chdir before loading the server.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dir, "..");

// Self-heal: first run after plugin install has no node_modules yet. stdout is
// the MCP protocol channel, so the installer's output must go to stderr.
if (!existsSync(join(ROOT, "node_modules"))) {
  console.error("[catryna] installing server dependencies (first run)...");
  const install = Bun.spawnSync([process.execPath, "install", "--silent"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  process.stderr.write(install.stdout);
  process.stderr.write(install.stderr);
  if (install.exitCode !== 0) {
    console.error(`[catryna] bun install failed (exit ${install.exitCode}) in ${ROOT}`);
    process.exit(1);
  }
}

await import(pathToFileURL(join(ROOT, "src", "index.ts")).href);
