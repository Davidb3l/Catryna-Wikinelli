#!/usr/bin/env bun
/**
 * Claude Code Stop hook for the Catryna plugin (was hooks/drift-check.sh).
 *
 * When a coding session ENDS, remind the agent about docs that need attention:
 * drift (has the code outgrown a doc?) and lint (is a doc malformed?). The logic
 * lives in src/hooks.ts; this is the entry point.
 *
 * INFORMATIONAL + NON-BLOCKING by contract: always exits 0 (a Stop hook that
 * exits non-zero can block the session), swallows every failure, and stays
 * SILENT when there is no drift, no Catryna index, no git repo or no CLI.
 *
 * Output goes to STDOUT: the shell version wrote stderr and hooks.json merged it
 * into stdout with `2>&1`.
 */
import { join } from "node:path";
import { driftCheck } from "../src/hooks";

try {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || join(import.meta.dir, "..");
  const lines = await driftCheck(process.cwd(), pluginRoot);
  if (lines.length > 0) process.stdout.write(lines.join("\n") + "\n");
} catch {
  // Informational only: never block the session.
}
process.exitCode = 0;
