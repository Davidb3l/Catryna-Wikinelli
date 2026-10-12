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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dir, "..");

// Self-heal: first run after plugin install has no dependencies yet, and an
// install interrupted partway (e.g. killed by the client's startup timeout)
// leaves a node_modules/ that LOOKS installed — the direct dependencies can be
// present while a transitive one is missing, and the server then dies on every
// launch. So a completed install drops a marker, and anything short of "marker
// present and every direct dependency present" reinstalls. stdout is the MCP
// protocol channel, so the installer's output must go to stderr, and its stdin
// must not consume the client's first messages.
const INSTALLED_MARKER = join(ROOT, "node_modules", ".catryna-install-ok");
const DEPENDENCIES = Object.keys(
  JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies ?? {},
);
const installed =
  existsSync(INSTALLED_MARKER) &&
  DEPENDENCIES.every((d) => existsSync(join(ROOT, "node_modules", d, "package.json")));
if (!installed) {
  console.error("[catryna] installing server dependencies...");
  const install = Bun.spawnSync([process.execPath, "install", "--silent"], {
    cwd: ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  process.stderr.write(install.stdout);
  process.stderr.write(install.stderr);
  if (install.exitCode !== 0) {
    console.error(`[catryna] bun install failed (exit ${install.exitCode}) in ${ROOT}`);
    process.exit(1);
  }
  writeFileSync(INSTALLED_MARKER, "");
}

await import(pathToFileURL(join(ROOT, "src", "index.ts")).href);
