#!/usr/bin/env bun
/**
 * `catryna` — the CLI companion to the Catryna MCP server.
 *
 * This is a SEPARATE entry from the MCP server (`src/index.ts`, still run by
 * scripts/run-server.sh). Subcommands:
 *   - `doctor` — the suite discovery handshake (SUITE_CONTRACTS §3).
 *   - `verify` — record HEAD as a doc's drift baseline (`verifiedCommit`).
 *   - `drift`  — report docs whose anchored code changed since verification
 *                (PRODUCT_ROADMAP Phase 1, the wedge; a CI gate).
 *
 * Arg parsing is hand-rolled (no yargs/commander) to match the suite's style.
 * Bun runs .ts directly, so `bunx catryna drift --json` needs no build step.
 *
 * CLI conventions (§4):
 *   1. `--json` ⇒ exactly one JSON object on stdout; all logs to stderr.
 *   2. Exit codes: 0 ok · 1 operational failure · 2 usage error ·
 *      3 soft-blocked (drift found — the `drift` CI gate).
 */
import { fileURLToPath } from "node:url";

import { runDoctor, type DoctorEnv } from "./doctor";
import { runDrift, runVerify } from "./drift";

const USAGE = `catryna — living documentation for agents + humans

Usage:
  catryna doctor [--json]          Suite discovery health check (SUITE_CONTRACTS §3)
  catryna verify <path> [--json]   Record HEAD as a doc's drift baseline
  catryna drift [--json]           Report docs whose anchored code drifted (CI gate)
  catryna --help                   Show this help

The MCP server is a separate entry (catryna-mcp / scripts/run-server.sh).`;

/** Resolve the version from package.json (never hardcoded). */
async function readVersion(): Promise<string> {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(await Bun.file(fileURLToPath(pkgUrl)).text());
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** The real runtime environment for doctor's checks. */
async function buildEnv(): Promise<DoctorEnv> {
  return {
    cwd: process.cwd(),
    // The MCP server sits next to this file in the install.
    mcpEntryPath: fileURLToPath(new URL("./index.ts", import.meta.url)),
    version: await readVersion(),
    bunVersion: typeof Bun !== "undefined" ? Bun.version : null,
  };
}

/**
 * Parse args and dispatch. Returns an exit code; writes only through the
 * returned run (so stdout stays clean under --json).
 */
export async function main(argv: string[]): Promise<number> {
  // Global flags may appear before or after the subcommand (amt-style).
  const args = argv.slice();
  const json = args.includes("--json");
  const wantsHelp = args.includes("--help") || args.includes("-h");
  const positionals = args.filter((a) => !a.startsWith("-"));
  const sub = positionals[0];

  if (wantsHelp && !sub) {
    // §4 rule 1: never put non-JSON on stdout under --json. `--json --help`
    // with no subcommand is contradictory (there's nothing to emit as JSON), so
    // route the help banner to stderr and use the usage-error code — matching a
    // bare `catryna --json`. Without --json, help is a normal stdout/exit-0 affordance.
    if (json) {
      process.stderr.write(USAGE + "\n");
      return 2;
    }
    process.stdout.write(USAGE + "\n");
    return 0;
  }

  switch (sub) {
    case "doctor": {
      const run = await runDoctor({ json, env: await buildEnv() });
      if (run.stderr) process.stderr.write(run.stderr);
      process.stdout.write(run.stdout);
      return run.code;
    }
    case "verify": {
      const path = positionals[1];
      if (!path) {
        // Usage error: verify needs a doc path. Keep stdout clean under --json.
        process.stderr.write(`catryna: verify requires a <path>\n\n${USAGE}\n`);
        return 2;
      }
      const run = await runVerify({ json, cwd: process.cwd(), path });
      if (run.stderr) process.stderr.write(run.stderr);
      process.stdout.write(run.stdout);
      return run.code;
    }
    case "drift": {
      const run = await runDrift({ json, cwd: process.cwd() });
      if (run.stderr) process.stderr.write(run.stderr);
      process.stdout.write(run.stdout);
      return run.code;
    }
    case undefined:
      // No subcommand: usage to stderr (stdout stays empty), usage-error code.
      process.stderr.write(USAGE + "\n");
      return 2;
    default:
      process.stderr.write(`catryna: unknown command '${sub}'\n\n${USAGE}\n`);
      return 2;
  }
}

// Only run when invoked directly (not when imported by tests).
if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      // Last-resort guard: never leak a stack trace onto stdout.
      process.stderr.write(`catryna: fatal: ${err?.message ?? err}\n`);
      process.exit(1);
    },
  );
}
