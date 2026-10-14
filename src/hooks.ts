/**
 * Logic behind the plugin's two hooks, kept in src/ so it is type-checked and
 * unit-tested. The hooks themselves are thin entry points that call into here:
 *
 *   - scripts/check-catryna.ts  (SessionStart) -> checkCatryna
 *   - hooks/drift-check.ts      (Stop)         -> driftCheck
 *
 * Both used to be POSIX `sh` scripts run as `sh <script> 2>&1 || true`, which
 * needs a shell on PATH that Windows outside Git Bash does not have. They are
 * Bun TypeScript now, the same interpreter the MCP server already requires.
 * Their messages are returned as lines and the entry points print them on
 * STDOUT: the shell versions wrote stderr and hooks.json merged it into stdout.
 *
 * Contract for both: informational and NON-BLOCKING. The entry points always
 * exit 0 and swallow every failure.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Which suite tools are installed, plus whether this repo already uses the suite. */
export interface CheckEnv {
  /** Is `bin` on PATH? */
  has(bin: string): boolean;
  /** Does the cwd already use any suite tool? */
  suiteRepo: boolean;
  /** Is Bun itself available? Always true when running as the hook; a seam for tests. */
  bunPresent?: boolean;
}

/**
 * True when `cwd` already uses any suite tool. This hook runs in EVERY repo; the
 * nudge stays quiet outside suite repos so it never nags unrelated projects.
 * `.docs/` alone is too generic a name; Catryna's own index file is required.
 */
export function isSuiteRepo(cwd: string): boolean {
  return (
    existsSync(join(cwd, ".sirius")) ||
    existsSync(join(cwd, ".ametrite")) ||
    existsSync(join(cwd, ".hayven")) ||
    existsSync(join(cwd, ".docs", "_index.json"))
  );
}

/** The marketplace/installer pointers shown when suite tools are missing. */
export const MARKETPLACE_ADD = "/plugin marketplace add Davidb3l/Sothis";

/**
 * Catryna is the wiki of the suite: Ametrite holds the board, Hayvenhurst the
 * code graph, Sirius the foreman loop. One short block, only when something is
 * missing — full fleet control needs all four. Returns no lines when nothing is.
 */
export function suiteHint(has: (bin: string) => boolean): string[] {
  const missing: string[] = [];
  if (!has("amt")) missing.push("Ametrite");
  if (!has("hayven")) missing.push("Hayvenhurst");
  if (!has("sirius")) missing.push("Sirius");
  if (missing.length === 0) return [];

  const lines = [
    "",
    `fleet suite: missing: ${missing.join(" ")}. Catryna is the suite's wiki; for full fleet control install the whole Sothis suite:`,
  ];
  if (missing.includes("Hayvenhurst")) {
    lines.push(
      `  Hayvenhurst (code graph): ${MARKETPLACE_ADD}, /plugin install hayvenhurst@sothis, then /hayvenhurst:install-binary`,
    );
  }
  if (missing.includes("Sirius")) {
    lines.push(
      `  Sirius Forester (fleet foreman): ${MARKETPLACE_ADD}, /plugin install sirius@sothis, then /sirius:install-binary`,
    );
  }
  if (missing.includes("Ametrite")) {
    lines.push(`  Ametrite (task board): ask Claude to "ametrite this repo" — the skill bootstraps the amt CLI`);
  }
  lines.push("  All the CLIs at once: sothis install --profile docs");
  return lines;
}

/** The hook's full output, as lines. Pure: everything it needs comes from `env`. */
export function checkCatryna(env: CheckEnv): string[] {
  const lines: string[] = [];
  if (env.bunPresent ?? true) {
    lines.push("catryna: ready (MCP server runs via bun; docs live in .docs/)");
  } else {
    lines.push(
      "catryna: bun not found — the Catryna MCP server needs Bun. Install it: curl -fsSL https://bun.sh/install | bash",
    );
  }
  if (env.suiteRepo) lines.push(...suiteHint(env.has));
  return lines;
}

/** `summary.drifted` / `summary.broken` out of `catryna drift --json`; 0 when unreadable. */
export function driftCounts(json: string): { drifted: number; broken: number } {
  try {
    const summary = JSON.parse(json)?.summary;
    const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0);
    return { drifted: n(summary?.drifted), broken: n(summary?.broken) };
  } catch {
    return { drifted: 0, broken: 0 };
  }
}

/** The top-level `errors` count out of `catryna lint --json`; 0 when unreadable. */
export function lintErrorCount(json: string): number {
  try {
    const v = JSON.parse(json)?.errors;
    return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

/** The drift reminder for `count` drifted-or-broken docs; null when there are none. */
export function driftMessage(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) {
    return "catryna: 1 doc no longer matches the code it documents (drifted or a broken anchor) — run `catryna repair` (or update the affected doc, then `catryna verify`).";
  }
  return `catryna: ${count} docs no longer match the code they document (drifted or broken anchors) — run \`catryna repair\` (or update the affected docs, then \`catryna verify\`).`;
}

/** The lint reminder for `errors` malformed docs; null when there are none. */
export function lintMessage(errors: number): string | null {
  if (errors <= 0) return null;
  if (errors === 1) {
    return "catryna: 1 doc is malformed (structure or anchors) — run `catryna lint` to see it. `catryna verify` will refuse to baseline it until fixed.";
  }
  return `catryna: ${errors} docs are malformed (structure or anchors) — run \`catryna lint\` to see them. \`catryna verify\` will refuse to baseline them until fixed.`;
}

interface Ran {
  ok: boolean;
  stdout: string;
}

/** Run a command, never throwing. stdin is closed so nothing can wait on it. */
async function run(cmd: string[], cwd: string): Promise<Ran> {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, , code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

/**
 * The hook's whole job, as lines to print. Empty means "say nothing".
 * `pluginRoot` is where the plugin is installed (CLAUDE_PLUGIN_ROOT).
 */
export async function driftCheck(cwd: string, pluginRoot: string): Promise<string[]> {
  // Nothing anchored here → nothing to check.
  if (!existsSync(join(cwd, ".docs", "_index.json"))) return [];

  // Drift is a git diff; outside a work tree there is no baseline to compare.
  const inside = await run(["git", "rev-parse", "--is-inside-work-tree"], cwd);
  if (!inside.ok) return [];

  const cli = join(pluginRoot, "src", "cli.ts");
  if (!existsSync(cli)) return [];
  const bun = process.execPath;

  // Pre-step: apply any drift-suspect marks the suite spine has published since
  // the last run, so drift below is reported against the freshest signal.
  // Best-effort and quiet by contract (§2): consume already exits 0 on every
  // no-op (absent / empty / foreign spine); its output and exit code are ignored.
  await run([bun, "run", cli, "consume"], cwd);

  // `drift --json` prints exactly one JSON object and always exits 0; we read
  // summary.drifted AND summary.broken (a deleted/renamed anchor is the highest-
  // severity, most-actionable drift class). Any failure degrades to silence.
  const drift = await run([bun, "run", cli, "drift", "--json"], cwd);
  if (!drift.ok) return [];

  const lines: string[] = [];
  const { drifted, broken } = driftCounts(drift.stdout);
  const driftMsg = driftMessage(drifted + broken);
  if (driftMsg) lines.push(driftMsg);

  // Structural health, reported alongside drift. Same contract: best-effort, and
  // any failure to parse degrades to silence rather than a spurious nag.
  //
  // `lint --json` exits 3 when errors exist, so its exit code is IGNORED here —
  // a non-zero exit from a Stop hook can block the session, and this hook must
  // never do that.
  const lint = await run([bun, "run", cli, "lint", "--json"], cwd);
  const lintMsg = lintMessage(lintErrorCount(lint.stdout));
  if (lintMsg) lines.push(lintMsg);

  return lines;
}
