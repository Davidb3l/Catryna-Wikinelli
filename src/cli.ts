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
 *   - `consume` — tail the suite spine, consuming hayven `code.changed` events
 *                to mark anchored docs drift-suspect in real time (§2 consumer).
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

import { runConsumeCli } from "./consume";
import { runDoctor, type DoctorEnv } from "./doctor";
import { runDrift, runVerify, runVerifyBatch } from "./drift";
import { runLint } from "./lint";
import { runRepair } from "./tools/drift";

const USAGE = `catryna — living documentation for agents + humans

Usage:
  catryna doctor [--json]          Suite discovery health check (SUITE_CONTRACTS §3)
  catryna verify <path>... [--json]
                                   Record HEAD as the drift baseline of one or more docs.
                                   Several paths run as one batch — no shell loop, and
                                   no race on the shared index.
  catryna verify --all-drifted [--json]
                                   Re-baseline every doc that drift reports drifted or
                                   broken. Verify does NOT read prose — only run this
                                   once you have judged each doc individually.
  catryna drift [--since <commit|date>] [--dirty-is-error] [--json]
                                   Report docs whose anchored code drifted (CI gate).
                                   --since sets a baseline (commit/tag/date) for docs
                                   with no verifiedCommit — e.g. --since 2026-02-18.
                                   --dirty-is-error also exits 3 on an uncommitted tree,
                                   which drift cannot see into.
  catryna repair [<path>] [--since <commit|date>] [--json]
                                   Repair context for drifted docs (hand to the agent).
                                   --since works like drift's, for never-verified corpora.
  catryna lint [--json]            Check docs are WELL-FORMED — frontmatter, callout/fence
                                   balance, anchors that resolve, index/file agreement.
                                   Exits 3 on errors, like drift. Warnings never gate.
  catryna consume [--json]         Consume code.changed → mark docs drift-suspect (spine tail)
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
  // First lift out `--since <rev>` / `--since=<rev>` (drift's baseline override)
  // so its VALUE isn't parsed as a positional/subcommand.
  const raw = argv.slice();
  let since: string | undefined;
  const args: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--since") {
      since = raw[i + 1];
      i++;
      continue;
    }
    if (a.startsWith("--since=")) {
      since = a.slice("--since=".length);
      continue;
    }
    args.push(a);
  }
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
      const paths = [...new Set(positionals.slice(1))];
      const allDrifted = args.includes("--all-drifted");
      if (allDrifted && paths.length > 0) {
        // Ambiguous: --all-drifted derives its own list. Refuse rather than
        // silently ignoring the paths the caller typed.
        process.stderr.write(
          `catryna: verify --all-drifted takes no <path> arguments\n\n${USAGE}\n`,
        );
        return 2;
      }
      if (!allDrifted && paths.length === 0) {
        // Usage error: verify needs a doc path. Keep stdout clean under --json.
        process.stderr.write(`catryna: verify requires a <path>\n\n${USAGE}\n`);
        return 2;
      }
      // ONE path stays on the single-doc path so its `--json` body keeps the
      // exact shape existing consumers parse (`path` at the top level, no
      // `results` array). Multiple paths, or --all-drifted, use the batch body.
      const run =
        !allDrifted && paths.length === 1
          ? await runVerify({ json, cwd: process.cwd(), path: paths[0] })
          : await runVerifyBatch({ json, cwd: process.cwd(), paths, allDrifted });
      if (run.stderr) process.stderr.write(run.stderr);
      process.stdout.write(run.stdout);
      return run.code;
    }
    case "drift": {
      const dirtyIsError = args.includes("--dirty-is-error");
      const run = await runDrift({ json, cwd: process.cwd(), since, dirtyIsError });
      if (run.stderr) process.stderr.write(run.stderr);
      process.stdout.write(run.stdout);
      return run.code;
    }
    case "repair": {
      // Optional positional doc path; default "all". A CONTEXT REPORT, not a
      // gate — it never fails on found drift (repairing is the point).
      const target = positionals[1] ?? "all";
      const run = await runRepair({ json, cwd: process.cwd(), target, since });
      if (run.stderr) process.stderr.write(run.stderr);
      process.stdout.write(run.stdout);
      return run.code;
    }
    case "lint": {
      const run = await runLint({ json, cwd: process.cwd() });
      if (run.stderr) process.stderr.write(run.stderr);
      process.stdout.write(run.stdout);
      return run.code;
    }
    case "consume": {
      const run = await runConsumeCli({ json, cwd: process.cwd() });
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
    (code) => {
      // Set the exit code and let the process end naturally rather than calling
      // process.exit(): process.exit() does NOT wait for a piped stdout to
      // drain, so a large write (e.g. `repair --json` over a big corpus) is
      // truncated at the pipe buffer boundary. Setting exitCode lets stdout
      // flush fully first; with no lingering handles the process then exits.
      process.exitCode = code;
    },
    (err) => {
      // Last-resort guard: never leak a stack trace onto stdout.
      process.stderr.write(`catryna: fatal: ${err?.message ?? err}\n`);
      process.exitCode = 1;
    },
  );
}
