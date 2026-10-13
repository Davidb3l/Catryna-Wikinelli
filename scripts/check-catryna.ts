#!/usr/bin/env bun
/**
 * SessionStart status check for the Catryna plugin (was scripts/check-catryna.sh).
 *
 * Reports that Bun — the one hard requirement — is present (reaching this
 * script proves it), and, in repos that already use the Sothis suite, nudges
 * toward the missing companion tools. The logic lives in src/hooks.ts.
 *
 * Why TypeScript and not `sh`: hooks.json used to run `sh check-catryna.sh`,
 * which needs a POSIX shell on PATH. Outside Git Bash on Windows there isn't
 * one. Bun is already required, so it is the interpreter every supported OS is
 * guaranteed to have — the same reason the MCP server launches through `bun`.
 *
 * Output goes to STDOUT: the shell version wrote stderr and hooks.json merged it
 * into stdout with `2>&1`. NEVER BLOCKS: always exits 0, failures are swallowed.
 */
import { checkCatryna, isSuiteRepo } from "../src/hooks";

try {
  const lines = checkCatryna({
    has: (bin) => Bun.which(bin) !== null,
    suiteRepo: isSuiteRepo(process.cwd()),
    bunPresent: true,
  });
  process.stdout.write(lines.join("\n") + "\n");
} catch {
  // Informational only: a failed status line must never fail a session.
}
process.exitCode = 0;
