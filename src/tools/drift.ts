/**
 * Drift + repair CONSUMPTION surfaces (PRODUCT_ROADMAP Phase 1):
 *
 *   - `check_drift`        MCP tool — an in-session agent queries the drift
 *                          report as JSON without shelling out.
 *   - `verify_doc`         MCP tool — re-baseline a doc against HEAD from inside
 *                          a session (mirrors `catryna verify`).
 *   - `propose_doc_repair` MCP tool — "close the loop": hand the agent a REPAIR
 *                          CONTEXT bundle (current doc + the git diff of each
 *                          drifted anchor) so it can PROPOSE a reviewable
 *                          `update_doc`. This tool never edits docs itself.
 *   - `buildRepairContext` / `runRepair` — the same repair-context logic behind
 *                          the `catryna repair` CLI subcommand (cli.ts imports
 *                          `runRepair`), cwd-injected so it is testable.
 *
 * This module CONSUMES `src/drift.ts` read-only (computeDrift/verifyDoc/runGit +
 * the JSON builders). It never mutates docs: it produces the reviewable context;
 * the agent proposes the diff via `update_doc`, then re-baselines via
 * `catryna verify` / `verify_doc`.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  computeDrift,
  verifyDoc,
  buildDriftJson,
  buildVerifyJson,
  runGit,
  type CliRun,
} from "../drift";

// ---------------------------------------------------------------------------
// Repair context — the "close the loop" bundle.
// ---------------------------------------------------------------------------

/** A single anchored file's diff since the doc's verification baseline. */
export interface ChangedFileDiff {
  /** The anchored source file (as git reports it, repo-relative). */
  file: string;
  /** Unified `git diff verifiedCommit..HEAD -- file`; "" if unavailable. */
  diff: string;
  /** Set when git could not produce the diff (e.g. baseline missing). */
  diffError?: string;
}

/** Everything an agent needs to PROPOSE a repair for one drifted doc. */
export interface DocRepairContext {
  /** The drifted doc's path (e.g. "modules/auth"). */
  path: string;
  /** The baseline the doc drifted from (its `verifiedCommit`). */
  since: string;
  /** Repo HEAD the drift is measured against. */
  head: string | null;
  /** Raw `.docs/<path>.mdx` content, or "" if unreadable. */
  currentContent: string;
  /** The anchored files that changed since `since`. */
  changedFiles: string[];
  /** Per-file git diffs since `since`. */
  diffs: ChangedFileDiff[];
  /** Edge-case note carried over from the drift result (e.g. baseline missing). */
  note?: string;
}

/** The full result of a repair-context request. */
export interface RepairContextResult {
  gitRepo: boolean;
  head: string | null;
  /** "all", or the specific doc path requested. */
  requested: string;
  repairs: DocRepairContext[];
  /** A specific path was requested but is not currently drifted. */
  notDrifted?: string[];
  /** Set only when the run could not proceed (e.g. not a git repository). */
  error?: string;
}

/** Read a doc's raw .mdx verbatim from `cwd`; "" if missing/unreadable. */
async function readDocRaw(cwd: string, path: string): Promise<string> {
  try {
    return await readFile(join(cwd, ".docs", `${path}.mdx`), "utf-8");
  } catch {
    return "";
  }
}

/**
 * Build the repair context for `target` ("all" or a doc path) in `cwd`.
 *
 * Consumes `computeDrift` (emit:false — inspecting for a repair is side-effect
 * free) to find the drifted docs, then for each one attaches the current doc
 * content and a `git diff <since>..HEAD` for every changed anchor. The agent
 * reads this and proposes an `update_doc`; nothing here writes.
 */
export async function buildRepairContext(
  cwd: string,
  target: string,
): Promise<RepairContextResult> {
  const report = await computeDrift(cwd, { emit: false });

  if (!report.gitRepo) {
    return {
      gitRepo: false,
      head: null,
      requested: target || "all",
      repairs: [],
      error: report.error,
    };
  }

  const wantAll = target === "all" || target === "";
  const drifted = report.drifted.filter((d) => wantAll || d.path === target);

  const repairs: DocRepairContext[] = [];
  for (const d of drifted) {
    const currentContent = await readDocRaw(cwd, d.path);
    const diffs: ChangedFileDiff[] = [];
    for (const file of d.changedFiles) {
      // Defensive: consume computeDrift's per-doc baseline; if git rejects the
      // range (baseline gone), record the error rather than throwing.
      const r = await runGit(cwd, ["diff", `${d.verifiedCommit}..HEAD`, "--", file]);
      diffs.push(
        r.ok ? { file, diff: r.stdout } : { file, diff: "", diffError: r.stderr.trim() },
      );
    }
    repairs.push({
      path: d.path,
      since: d.verifiedCommit,
      head: report.head,
      currentContent,
      changedFiles: d.changedFiles,
      diffs,
      ...(d.note ? { note: d.note } : {}),
    });
  }

  let notDrifted: string[] | undefined;
  if (!wantAll && repairs.length === 0) {
    // Requested a specific doc that isn't drifted — is it even a known doc?
    const known = [...report.drifted, ...report.unverified, ...report.clean].some(
      (d) => d.path === target,
    );
    notDrifted = known ? [target] : [];
  }

  return {
    gitRepo: true,
    head: report.head,
    requested: wantAll ? "all" : target,
    repairs,
    ...(notDrifted ? { notDrifted } : {}),
  };
}

const REPAIR_GUIDANCE =
  "For each repair: read `currentContent` alongside the anchored-file `diffs`, " +
  "then call the `update_doc` MCP tool (or edit .docs/<path>.mdx) to reconcile " +
  "the doc with the code. Do NOT rewrite anchors you did not review. After the " +
  "doc matches the code, run `catryna verify <path>` (or the `verify_doc` tool) " +
  "to re-baseline it so it reports clean.";

/** The JSON body for `propose_doc_repair` / `catryna repair --json`. */
export function buildRepairJson(r: RepairContextResult): Record<string, unknown> {
  return {
    tool: "catryna",
    command: "repair",
    gitRepo: r.gitRepo,
    head: r.head,
    requested: r.requested,
    summary: { repairs: r.repairs.length },
    guidance: r.repairs.length > 0 ? REPAIR_GUIDANCE : "No drifted docs to repair.",
    repairs: r.repairs.map((d) => ({
      path: d.path,
      since: d.since,
      head: d.head,
      changedFiles: d.changedFiles,
      currentContent: d.currentContent,
      diffs: d.diffs,
      ...(d.note ? { note: d.note } : {}),
    })),
    ...(r.notDrifted ? { notDrifted: r.notDrifted } : {}),
    ...(r.error ? { error: r.error } : {}),
  };
}

const short = (sha: string) => (sha ? sha.slice(0, 7) : "");

/** The human report for `catryna repair`. */
export function renderRepairHuman(r: RepairContextResult): string {
  if (!r.gitRepo) {
    return `catryna repair\n\n  ${r.error ?? "not a git repository"}\n`;
  }

  const lines: string[] = ["catryna repair", `  HEAD: ${short(r.head ?? "")}`, ""];

  if (r.repairs.length === 0) {
    if (r.notDrifted && r.notDrifted.length > 0) {
      lines.push(`  ${r.requested} is not drifted — nothing to repair ✓`);
    } else if (r.notDrifted && r.notDrifted.length === 0) {
      // Not among the driftable docs — either no such doc, or it exists but has
      // no anchors yet (computeDrift skips unanchored docs), so don't claim it
      // doesn't exist. `catryna drift` shows the full driftable set.
      lines.push(
        `  no drifted doc "${r.requested}" to repair (unknown, or not anchored yet — see \`catryna drift\`)`,
      );
    } else {
      lines.push("  no drifted docs — nothing to repair ✓");
    }
    return lines.join("\n") + "\n";
  }

  lines.push(
    `  ${r.repairs.length} drifted doc(s) — repair context (hand to the agent):`,
    "",
  );
  for (const d of r.repairs) {
    lines.push(`  ▸ ${d.path}   (drifted since ${short(d.since)})`);
    if (d.note) lines.push(`      note: ${d.note}`);
    for (const f of d.diffs) {
      const n = f.diff ? f.diff.split("\n").filter((l) => l.startsWith("@@")).length : 0;
      lines.push(
        `      ~ ${f.file}` +
          (f.diffError ? `  (diff unavailable: ${f.diffError})` : `  (${n} hunk(s))`),
      );
    }
    lines.push("");
  }
  lines.push(
    "  Next: read each doc + its anchor diffs, propose an `update_doc`, then",
    "  `catryna verify <path>` to re-baseline. Use `--json` for the full bundle.",
  );
  return lines.join("\n") + "\n";
}

/**
 * Run `catryna repair [<path>]` and return bytes + exit code, no process I/O.
 * Like `drift`, it is a CONTEXT REPORT: `--json` emits one JSON object and
 * always exits 0; human mode exits 0, or 1 on operational failure (not a git
 * repo). It never fails on "found drift" — repairing is the point.
 */
export async function runRepair(opts: {
  json: boolean;
  cwd: string;
  target: string;
}): Promise<CliRun> {
  const result = await buildRepairContext(opts.cwd, opts.target);

  if (opts.json) {
    return { stdout: JSON.stringify(buildRepairJson(result)) + "\n", stderr: "", code: 0 };
  }

  if (!result.gitRepo) {
    return { stdout: "", stderr: renderRepairHuman(result), code: 1 };
  }
  return { stdout: renderRepairHuman(result), stderr: "", code: 0 };
}

// ---------------------------------------------------------------------------
// MCP tool registration.
// ---------------------------------------------------------------------------

export function registerDriftTools(server: McpServer): void {
  // CHECK DRIFT — read-only inspection of the drift report. `emit:false`: a
  // query must not spam the spine (the CLI gate + Stop hook own emission).
  server.tool(
    "check_drift",
    {},
    async () => {
      try {
        const report = await computeDrift(process.cwd(), { emit: false });
        return {
          content: [{ type: "text", text: JSON.stringify(buildDriftJson(report)) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        };
      }
    },
  );

  // VERIFY DOC — record HEAD as a doc's drift baseline (has side effects: emits
  // doc.verified). The in-session counterpart to `catryna verify`.
  server.tool(
    "verify_doc",
    {
      path: z
        .string()
        .describe("Doc path to re-baseline against the repo's current HEAD, e.g. 'modules/auth'"),
    },
    async ({ path }) => {
      try {
        const result = await verifyDoc(process.cwd(), path);
        return {
          content: [{ type: "text", text: JSON.stringify(buildVerifyJson(result)) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        };
      }
    },
  );

  // PROPOSE DOC REPAIR — the agent-repair loop. Returns the reviewable REPAIR
  // CONTEXT (doc content + anchor diffs); the agent then proposes update_doc.
  // This tool NEVER edits a doc.
  server.tool(
    "propose_doc_repair",
    {
      doc: z
        .string()
        .optional()
        .describe(
          "Doc path to build repair context for, or 'all' (default) for every drifted doc. " +
            "Returns current doc content + the git diff of each changed anchor since verification.",
        ),
    },
    async ({ doc }) => {
      try {
        const result = await buildRepairContext(process.cwd(), doc ?? "all");
        return {
          content: [{ type: "text", text: JSON.stringify(buildRepairJson(result)) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        };
      }
    },
  );
}
