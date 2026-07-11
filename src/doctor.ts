/**
 * `catryna doctor [--json]` — the suite discovery handshake (SUITE_CONTRACTS
 * §3, schemaVersion 1).
 *
 * With `--json`, this emits EXACTLY ONE JSON object on stdout so peers — the
 * Sirius Suite Hub, `sirius`, `amt`, `hayven` — can discover Catryna without
 * any Catryna-specific knowledge (§4 rule 1: one JSON object on stdout, all
 * logs to stderr). Health lives in the `ok` field, never in the exit code
 * (§3.1: exit 0 + `ok:false` = present-but-unhealthy; a non-zero exit means
 * absent). The CLI layer (`cli.ts`) owns process I/O and exit codes; everything
 * here is pure and directly testable.
 *
 * Capabilities are deliberately conservative. A capability string is a promise
 * a peer will act on, so it is advertised only when the feature exists TODAY:
 *
 *   - `mcp`          — Catryna ships a stdio MCP server (`src/index.ts`).
 *   - `events.emit`  — the MCP write tools append `doc.*` facts to the suite
 *                      event spine (`.suite/events/`, SUITE_CONTRACTS §2).
 *   - `events.consume` — `catryna consume` tails the spine, consuming hayven's
 *                      `code.changed` events to mark anchored docs drift-suspect
 *                      in real time (PRODUCT_ROADMAP Phase 1). Real today, so
 *                      advertised — a peer MAY now rely on Catryna reacting to
 *                      `code.changed`.
 *   - `drift`        — `catryna drift` detects git-diff doc drift and emits
 *                      `doc.drifted` (PRODUCT_ROADMAP Phase 1; git-diff baseline,
 *                      no Hayvenhurst dependency). Real today, so advertised.
 *   - `verify`       — `catryna verify <path>` records a doc's drift baseline
 *                      (`verifiedCommit`) and emits `doc.verified`.
 *   - `ui`           — Catryna ships a real human viewer: the Vite React app in
 *                      `frontend/`, launched by the `catryna:viewer` skill,
 *                      serving `.docs/` on :1307. Per §3.2 a tool that serves a
 *                      web UI advertises `"ui"` AND a top-level `ui` URL naming
 *                      the address it serves on. Doctor answers standalone and
 *                      can't itself confirm the viewer process is up — but §3.2
 *                      is explicit that an advertised-but-currently-unreachable
 *                      UI is a *degraded UI, not an absent tool*. The hub runs
 *                      its own reachability probe (Sirius's `probeUi`) to
 *                      resolve up/down, so advertising the address is correct
 *                      and truthful even when the viewer isn't running. The URL
 *                      MUST be loopback so the hub's `isLoopbackUrl` accepts it.
 *
 * Every capability advertised here exists TODAY; nothing is aspirational.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { readIndexAt } from "./storage";

/** Capabilities Catryna actually implements today (see file header). */
export const CAPABILITIES: readonly string[] = [
  "mcp",
  "events.emit",
  "events.consume",
  "drift",
  "verify",
  "ui",
];

export const SCHEMA_VERSION = 1;

/** The viewer's default port when `CATRYNA_VIEWER_PORT` is unset/invalid. */
export const DEFAULT_VIEWER_PORT = 1307;

/**
 * The port the human viewer (frontend/, the `catryna:viewer` skill) serves on,
 * honoring `CATRYNA_VIEWER_PORT` (SUITE_CONTRACTS §3.2: the `ui` URL reflects
 * the tool's own port-override env var). `frontend/vite.config.ts` MUST agree
 * with this parse — else doctor advertises a UI at an address the viewer never
 * bound. Robust like amt's `ui_port()`: anything empty, non-numeric, out of
 * 1..65535, or 0 falls back to the default.
 */
export function viewerPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CATRYNA_VIEWER_PORT?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_VIEWER_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return DEFAULT_VIEWER_PORT;
  return n;
}

/** The loopback URL doctor advertises for the human viewer (§3.2). */
export function viewerUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `http://localhost:${viewerPort(env)}`;
}

/** One §3 check row: a stable snake_case name, its state, and a human detail. */
export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  /**
   * Whether this check gates overall health. Overall `ok` = every gating check
   * passing (mirrors hayven's fold). A non-gating failure surfaces in the row
   * without dragging the envelope unhealthy.
   */
  gating: boolean;
}

/** Everything doctor learned, rendered by either the human or JSON path. */
export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
  version: string;
  /** Free-form, additive detail for the envelope's `report` field. */
  docsPath: string;
  docCount: number | null;
  initialized: boolean;
}

/** Inputs doctor needs, injected so the checks are testable against temp dirs. */
export interface DoctorEnv {
  /** Where to look for `.docs/` — the invoking repo (process.cwd() in prod). */
  cwd: string;
  /** Absolute path to the MCP entry (`src/index.ts`) inside the install. */
  mcpEntryPath: string;
  /** Catryna's version, read from package.json (never hardcoded). */
  version: string;
  /** `Bun.version` when running under Bun, else null. */
  bunVersion: string | null;
}

/**
 * Overall health = the GATING checks only. Exported so the fold is directly
 * testable: a non-gating failure MUST NOT drag the envelope unhealthy.
 */
export function computeOk(checks: readonly DoctorCheck[]): boolean {
  return checks.every((c) => !c.gating || c.ok);
}

/** Result of the docs-store probe: the check row plus the doc count (if any). */
interface DocsProbe {
  check: DoctorCheck;
  docCount: number | null;
}

/**
 * Probe the `.docs/` store, read-only. An ABSENT `.docs/` is healthy, not a
 * failure: like hayven's "project not initialized here", a repo that simply
 * hasn't been documented yet is a normal standalone state, and the Suite Hub
 * launches probes from directories that have no `.docs/` at all. A `.docs/`
 * that EXISTS but whose `_index.json` is missing, unreadable, or malformed is a
 * genuinely broken store — that gates the envelope unhealthy.
 */
async function probeDocs(env: DoctorEnv): Promise<DocsProbe> {
  const docsRoot = join(env.cwd, ".docs");
  const indexPath = join(docsRoot, "_index.json");

  if (!existsSync(docsRoot)) {
    return {
      check: {
        name: "docs_dir",
        ok: true,
        detail: `no .docs/ in ${env.cwd} — nothing documented here yet`,
        gating: true,
      },
      docCount: null,
    };
  }
  if (!existsSync(indexPath)) {
    return {
      check: {
        name: "docs_dir",
        ok: false,
        detail: ".docs/ exists but its _index.json is missing",
        gating: true,
      },
      docCount: null,
    };
  }
  let index;
  try {
    index = await readIndexAt(env.cwd);
  } catch (err) {
    return {
      check: {
        name: "docs_dir",
        ok: false,
        detail: `.docs/_index.json is not readable JSON: ${(err as Error).message}`,
        gating: true,
      },
      docCount: null,
    };
  }
  if (!index || !Array.isArray(index.docs)) {
    return {
      check: {
        name: "docs_dir",
        ok: false,
        detail: ".docs/_index.json is missing its docs[] array",
        gating: true,
      },
      docCount: null,
    };
  }
  return {
    check: {
      name: "docs_dir",
      ok: true,
      detail: `.docs/ present, ${index.docs.length} doc(s) indexed`,
      gating: true,
    },
    docCount: index.docs.length,
  };
}

/**
 * Run every check. Read-only — never writes any store. Each row is verifiable
 * standalone (no daemon, no MCP round-trip, no network).
 */
export async function collectReport(env: DoctorEnv): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  // The runtime: Catryna is Bun-run (no compiled binary). If Bun is undefined
  // the tool was launched under the wrong runtime and won't work.
  checks.push({
    name: "bun_present",
    ok: env.bunVersion !== null,
    detail: env.bunVersion ? `Bun ${env.bunVersion}` : "not running under Bun",
    gating: true,
  });

  // The MCP entry must resolve inside the install, or `run-server.sh` (which
  // execs src/index.ts) is broken and the MCP server can't start.
  const mcpOk = existsSync(env.mcpEntryPath);
  checks.push({
    name: "mcp_entry",
    ok: mcpOk,
    detail: mcpOk ? env.mcpEntryPath : `MCP entry not found: ${env.mcpEntryPath}`,
    gating: true,
  });

  // The docs store (read-only).
  const docs = await probeDocs(env);
  checks.push(docs.check);

  return {
    ok: computeOk(checks),
    checks,
    version: env.version,
    docsPath: join(env.cwd, ".docs"),
    docCount: docs.docCount,
    initialized: docs.docCount !== null,
  };
}

/**
 * The SUITE_CONTRACTS §3 handshake envelope. `report` is free-form, additive
 * detail — a consumer only needs the top-level shape. The top-level `ui` names
 * where the human viewer serves (§3.2, see the file header). Health is in `ok`,
 * never in the exit code.
 */
export function buildEnvelope(report: DoctorReport): Record<string, unknown> {
  return {
    tool: "catryna",
    version: report.version,
    schemaVersion: SCHEMA_VERSION,
    ok: report.ok,
    capabilities: [...CAPABILITIES],
    ui: viewerUrl(),
    checks: report.checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
    report: {
      docs_path: report.docsPath,
      doc_count: report.docCount,
      initialized: report.initialized,
    },
  };
}

/**
 * The envelope for a doctor run that couldn't even complete its checks. Without
 * it, a throw escapes, stdout stays empty, and §3.1 makes every consumer
 * classify an INSTALLED-but-broken Catryna as *absent* (with a stack trace on
 * stderr). Reporting `ok:false` with the reason keeps it visible as
 * present-unhealthy. Mirrors hayven's `envelopeForCollectFailure`.
 */
export function envelopeForFailure(version: string, err: Error): Record<string, unknown> {
  return {
    tool: "catryna",
    version,
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    capabilities: [...CAPABILITIES],
    // The viewer address is a constant independent of the failed checks, so it
    // stays truthful even here (§3.2: an unreachable UI is degraded, not absent).
    ui: viewerUrl(),
    checks: [
      {
        name: "doctor_ran",
        ok: false,
        detail: `doctor could not complete its checks: ${err.message}`,
      },
    ],
    report: { error: err.message },
  };
}

/** The human report — printed when `--json` is absent. */
export function renderHuman(report: DoctorReport): string {
  const lines: string[] = ["catryna doctor", `  version: ${report.version}`, ""];
  for (const c of report.checks) {
    lines.push(`  ${c.ok ? "OK  " : "FAIL"} ${c.name}: ${c.detail}`);
  }
  lines.push("");
  lines.push(report.ok ? "healthy ✓" : "unhealthy — some checks are failing (see above)");
  return lines.join("\n") + "\n";
}

/** What a doctor run produced, without touching process I/O (for testing). */
export interface DoctorRun {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Run doctor and return the bytes + exit code, no process side effects.
 *
 * `--json`: EXACTLY ONE JSON object on stdout; exit 0 whenever an envelope was
 * produced — health is carried by `ok`, so exiting non-zero on a failing check
 * would make a degraded-but-installed Catryna indistinguishable from an
 * uninstalled one (absent), hiding the very checks the envelope exists to
 * report (§3/§3.1). The collect step is guarded so even an unexpected throw
 * still yields a parseable `ok:false` envelope at exit 0.
 *
 * Human mode keeps the historical shell/CI-gate contract: exit `ok ? 0 : 1`.
 */
export async function runDoctor(opts: { json: boolean; env: DoctorEnv }): Promise<DoctorRun> {
  const { json, env } = opts;
  if (json) {
    let envelope: Record<string, unknown>;
    let stderr = "";
    try {
      envelope = buildEnvelope(await collectReport(env));
    } catch (err) {
      stderr = `doctor: ${(err as Error).message}\n`;
      envelope = envelopeForFailure(env.version, err as Error);
    }
    return { stdout: JSON.stringify(envelope) + "\n", stderr, code: 0 };
  }

  // Human mode: let a collect failure surface as an operational error (exit 1).
  const report = await collectReport(env);
  return { stdout: renderHuman(report), stderr: "", code: report.ok ? 0 : 1 };
}
