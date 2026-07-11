/**
 * Tests for the `catryna doctor` suite handshake (SUITE_CONTRACTS §3).
 *
 * Each test targets an assertion peers actually depend on: the envelope shape,
 * `tool === "catryna"`, the `ui` capability + loopback URL (§3.2), the
 * `ok:false` path, and that `--json` stdout parses as a single JSON object. The
 * real CLI is also spawned end-to-end so we prove nothing leaks onto stdout
 * alongside the JSON.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildEnvelope,
  collectReport,
  computeOk,
  envelopeForFailure,
  renderHuman,
  runDoctor,
  viewerPort,
  viewerUrl,
  DEFAULT_VIEWER_PORT,
  type DoctorCheck,
  type DoctorEnv,
} from "./doctor";

/**
 * Mirrors the consumer's `isLoopbackUrl` (Sirius Forester web/src/discovery.ts):
 * `classify()` counts `ui` only when the hostname is loopback. Kept local so the
 * test stays self-contained (no cross-repo import).
 */
function isLoopbackUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return (
    u.hostname === "localhost" ||
    u.hostname === "127.0.0.1" ||
    u.hostname === "::1" ||
    u.hostname === "[::1]"
  );
}

// A real MCP entry path that exists, so the mcp_entry check passes by default.
const REAL_MCP_ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url));
const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url));

/** Build an env pointing at `cwd`, healthy by default. */
function envFor(cwd: string, over: Partial<DoctorEnv> = {}): DoctorEnv {
  return {
    cwd,
    mcpEntryPath: REAL_MCP_ENTRY,
    version: "9.9.9",
    bunVersion: "1.3.0",
    ...over,
  };
}

// Temp dirs for the various .docs/ states.
let noDocs: string; // no .docs/ at all
let goodDocs: string; // .docs/_index.json valid, 2 docs
let corruptDocs: string; // .docs/_index.json malformed

beforeAll(async () => {
  noDocs = await mkdtemp(join(tmpdir(), "catryna-nodocs-"));

  goodDocs = await mkdtemp(join(tmpdir(), "catryna-good-"));
  await mkdir(join(goodDocs, ".docs"), { recursive: true });
  await writeFile(
    join(goodDocs, ".docs", "_index.json"),
    JSON.stringify({ version: 1, docs: [{ path: "a" }, { path: "b" }], lastUpdated: null }),
  );

  corruptDocs = await mkdtemp(join(tmpdir(), "catryna-corrupt-"));
  await mkdir(join(corruptDocs, ".docs"), { recursive: true });
  await writeFile(join(corruptDocs, ".docs", "_index.json"), "{ this is not json ");
});

afterAll(async () => {
  for (const d of [noDocs, goodDocs, corruptDocs]) {
    await rm(d, { recursive: true, force: true });
  }
});

describe("envelope shape", () => {
  test("healthy repo → conformant §3 envelope", async () => {
    const env = envFor(goodDocs);
    const report = await collectReport(env);
    const env0 = buildEnvelope(report);

    expect(env0.tool).toBe("catryna");
    expect(env0.schemaVersion).toBe(1);
    expect(env0.ok).toBe(true);
    // version comes from the injected env (package.json in prod), not hardcoded.
    expect(env0.version).toBe("9.9.9");
    expect(env0.capabilities).toEqual(["mcp", "events.emit", "drift", "verify", "ui"]);

    const checks = env0.checks as DoctorCheck[];
    expect(Array.isArray(checks)).toBe(true);
    for (const c of checks) {
      expect(typeof c.name).toBe("string");
      expect(typeof c.ok).toBe("boolean");
      expect(typeof c.detail).toBe("string");
    }
    const names = checks.map((c) => c.name);
    expect(names).toEqual(["bun_present", "mcp_entry", "docs_dir"]);
  });

  test("tool is exactly 'catryna' (peers match on this)", async () => {
    const env0 = buildEnvelope(await collectReport(envFor(goodDocs)));
    expect(env0.tool).toBe("catryna");
    // Guard against a copy-paste from a sibling tool.
    expect(env0.tool).not.toBe("hayven");
    expect(env0.tool).not.toBe("amt");
  });

  test("advertises the `ui` capability AND a loopback top-level `ui` URL (§3.2)", async () => {
    const env0 = buildEnvelope(await collectReport(envFor(goodDocs)));
    // §3.2: a tool that serves a web UI includes "ui" in capabilities AND sets
    // a top-level `ui` to the URL it serves on. Catryna ships the frontend/
    // viewer (the `catryna:viewer` skill), so it advertises both.
    expect(env0.capabilities).toContain("ui");
    expect(env0.ui).toBe(`http://localhost:${DEFAULT_VIEWER_PORT}`);
    expect(env0.ui).toBe("http://localhost:1307");
    // MUST be loopback or the hub's classify() won't count the UI.
    expect(isLoopbackUrl(env0.ui as string)).toBe(true);
  });

  test("viewerPort/viewerUrl: default, override, and robust fallback (§3.2)", () => {
    // Default when the env var is unset.
    expect(viewerPort({})).toBe(1307);
    expect(viewerUrl({})).toBe("http://localhost:1307");

    // A valid override is honored (the tool owns its port).
    expect(viewerPort({ CATRYNA_VIEWER_PORT: "4242" })).toBe(4242);
    expect(viewerUrl({ CATRYNA_VIEWER_PORT: "4242" })).toBe("http://localhost:4242");
    // Whitespace is trimmed.
    expect(viewerPort({ CATRYNA_VIEWER_PORT: "  8080  " })).toBe(8080);

    // Bogus values fall back to the default (parse must not lie). Includes a
    // signed "+7" (regex must reject the sign) and a huge all-digit string
    // (passes the \d+ regex, so the range guard must catch it — deleting
    // `n > 65535` regresses here).
    for (const bad of [
      "0", "nope", "99999", "-1", "", "   ", "12.5", "80x", "+7", "0x10",
      "1_000", "99999999999999999999",
    ]) {
      expect(viewerPort({ CATRYNA_VIEWER_PORT: bad })).toBe(1307);
      expect(viewerUrl({ CATRYNA_VIEWER_PORT: bad })).toBe("http://localhost:1307");
    }

    // Leading zeros are honored numerically ("007" → 7), not treated as bogus.
    expect(viewerPort({ CATRYNA_VIEWER_PORT: "007" })).toBe(7);

    // Boundaries: 1 and 65535 valid; 65536 out of range.
    expect(viewerPort({ CATRYNA_VIEWER_PORT: "1" })).toBe(1);
    expect(viewerPort({ CATRYNA_VIEWER_PORT: "65535" })).toBe(65535);
    expect(viewerPort({ CATRYNA_VIEWER_PORT: "65536" })).toBe(1307);

    // Every advertised URL is loopback.
    expect(isLoopbackUrl(viewerUrl({}))).toBe(true);
    expect(isLoopbackUrl(viewerUrl({ CATRYNA_VIEWER_PORT: "4242" }))).toBe(true);
  });

  test("envelopeForFailure still carries the `ui` field (degraded, not absent)", () => {
    const env0 = envelopeForFailure("9.9.9", new Error("boom"));
    expect(env0.capabilities).toContain("ui");
    expect(env0.ui).toBe("http://localhost:1307");
  });

  test("advertises the implemented caps (incl. Phase-1 drift/verify) but not unimplemented ones", async () => {
    const env0 = buildEnvelope(await collectReport(envFor(goodDocs)));
    const caps = env0.capabilities as string[];
    expect(caps).toContain("events.emit"); // the spine producer is real
    // Phase-1 drift/verify are IMPLEMENTED now (CLI subcommands), so advertised.
    expect(caps).toContain("drift");
    expect(caps).toContain("verify");
    // Still-unimplemented: CONSUMING code.changed for real-time drift marking.
    expect(caps).not.toContain("events.consume");
  });
});

describe("health / ok:false paths", () => {
  test("absent .docs/ is healthy (not-initialized-here, like hayven)", async () => {
    const report = await collectReport(envFor(noDocs));
    expect(report.ok).toBe(true);
    expect(report.initialized).toBe(false);
    const docs = report.checks.find((c) => c.name === "docs_dir")!;
    expect(docs.ok).toBe(true);
  });

  test("corrupt _index.json → ok:false, but still a full envelope", async () => {
    const report = await collectReport(envFor(corruptDocs));
    expect(report.ok).toBe(false);
    const env0 = buildEnvelope(report);
    expect(env0.ok).toBe(false);
    const docs = (env0.checks as DoctorCheck[]).find((c) => c.name === "docs_dir")!;
    expect(docs.ok).toBe(false);
  });

  test("missing MCP entry → gating failure → ok:false", async () => {
    const report = await collectReport(
      envFor(goodDocs, { mcpEntryPath: "/nope/does/not/exist/index.ts" }),
    );
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "mcp_entry")!.ok).toBe(false);
  });

  test("wrong runtime (Bun undefined) → ok:false", async () => {
    const report = await collectReport(envFor(goodDocs, { bunVersion: null }));
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "bun_present")!.ok).toBe(false);
  });

  test("doctor is READ-ONLY: probing a repo with no .docs/ never creates it", async () => {
    // §4 rule 4: a tool never writes another tool's store. Doctor must probe
    // read-only — if a refactor swapped `readIndexAt` for `loadIndex` (which
    // materializes an empty store) or otherwise wrote, this leaves a .docs/
    // behind. Use a fresh dir so the assertion is unambiguous.
    const pristine = await mkdtemp(join(tmpdir(), "catryna-readonly-"));
    try {
      await collectReport(envFor(pristine));
      expect(existsSync(join(pristine, ".docs"))).toBe(false);
      // The JSON path (through buildEnvelope/runDoctor) must also stay read-only.
      await runDoctor({ json: true, env: envFor(pristine) });
      expect(existsSync(join(pristine, ".docs"))).toBe(false);
    } finally {
      await rm(pristine, { recursive: true, force: true });
    }
  });

  test("computeOk: a non-gating failure does not drag health down", () => {
    const checks: DoctorCheck[] = [
      { name: "a", ok: true, gating: true, detail: "" },
      { name: "b", ok: false, gating: false, detail: "" },
    ];
    expect(computeOk(checks)).toBe(true);
    checks[0].ok = false;
    expect(computeOk(checks)).toBe(false);
  });
});

describe("runDoctor --json", () => {
  test("stdout is a single parseable JSON object; exit 0 even when unhealthy", async () => {
    const run = await runDoctor({ json: true, env: envFor(corruptDocs) });
    expect(run.code).toBe(0); // §3.1: unhealthy ≠ absent; envelope was produced
    const parsed = JSON.parse(run.stdout); // throws if not exactly one object
    expect(parsed.tool).toBe("catryna");
    expect(parsed.ok).toBe(false);
    // Exactly one JSON value: re-stringifying round-trips the whole stdout.
    expect(run.stdout.trim()).toBe(JSON.stringify(parsed));
  });

  test("envelopeForFailure has the conformant §3 shape", () => {
    const env0 = envelopeForFailure("9.9.9", new Error("boom"));
    expect(env0.tool).toBe("catryna");
    expect(env0.ok).toBe(false);
    expect(env0.version).toBe("9.9.9");
    const checks = env0.checks as DoctorCheck[];
    expect(checks[0].ok).toBe(false);
    expect(checks[0].detail).toContain("boom");
  });

  test("a thrown collect is CAUGHT by runDoctor → ok:false at exit 0", async () => {
    // Force collectReport to throw from inside runDoctor: a null cwd makes
    // path.join throw synchronously (before probeDocs's own try/catch). This
    // exercises runDoctor's guard itself — deleting that try/catch fails here.
    const run = await runDoctor({
      json: true,
      env: envFor(goodDocs, { cwd: null as unknown as string }),
    });
    expect(run.code).toBe(0); // envelope was produced → not absent
    const parsed = JSON.parse(run.stdout); // still exactly one JSON object
    expect(parsed.tool).toBe("catryna");
    expect(parsed.ok).toBe(false);
    expect(run.stdout.trim()).toBe(JSON.stringify(parsed));
    expect(run.stderr).not.toBe(""); // the reason went to stderr, not stdout
  });

  test("human mode exits 1 when unhealthy, 0 when healthy", async () => {
    const bad = await runDoctor({ json: false, env: envFor(corruptDocs) });
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain("unhealthy");

    const good = await runDoctor({ json: false, env: envFor(goodDocs) });
    expect(good.code).toBe(0);
    expect(good.stdout).toContain("healthy");
  });

  test("renderHuman lists every check row", async () => {
    const out = renderHuman(await collectReport(envFor(goodDocs)));
    expect(out).toContain("bun_present");
    expect(out).toContain("mcp_entry");
    expect(out).toContain("docs_dir");
  });
});

describe("end-to-end: the real CLI binary", () => {
  test("`catryna doctor --json` emits ONLY the JSON object on stdout", async () => {
    // Run from a dir with a valid .docs/ so it reports healthy.
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "doctor", "--json"], {
      cwd: goodDocs,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;

    expect(code).toBe(0);
    // stdout must be exactly one JSON object and nothing else.
    const trimmed = stdout.trim();
    const parsed = JSON.parse(trimmed);
    expect(trimmed).toBe(JSON.stringify(parsed));
    expect(parsed.tool).toBe("catryna");
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.ok).toBe(true);
    expect(parsed.capabilities).toEqual(["mcp", "events.emit", "drift", "verify", "ui"]);
    expect(parsed.ui).toBe("http://localhost:1307");
  });

  test("`CATRYNA_VIEWER_PORT` moves the advertised `ui` URL end-to-end", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "doctor", "--json"], {
      cwd: goodDocs,
      env: { ...process.env, CATRYNA_VIEWER_PORT: "4242" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ui).toBe("http://localhost:4242");
  });

  test("no subcommand → usage on stderr, empty stdout, exit 2", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH], {
      cwd: goodDocs,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(code).toBe(2);
    expect(stdout.trim()).toBe("");
  });

  test("unknown subcommand → usage on stderr, empty stdout, exit 2", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "frobnicate"], {
      cwd: goodDocs,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect(code).toBe(2); // §4: usage error
    expect(stdout.trim()).toBe(""); // usage errors keep stdout empty
    expect(stderr).toContain("unknown command");
  });

  test("`catryna -h` → USAGE on stdout, exit 0", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "-h"], {
      cwd: goodDocs,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(stdout).toContain("catryna");
    expect(stdout).toContain("doctor");
  });

  test("`doctor --json` on an UNHEALTHY repo still emits ONLY the JSON (exit 0)", async () => {
    // The healthy e2e proves the happy path; this proves the FAILURE path keeps
    // stdout to a single JSON object with no diagnostics leaking onto stdout —
    // a leak here would make the hub classify Catryna absent (§3.1/§4 rule 1).
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "doctor", "--json"], {
      cwd: corruptDocs,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(code).toBe(0); // §3.1: unhealthy ≠ absent
    const trimmed = stdout.trim();
    const parsed = JSON.parse(trimmed);
    expect(trimmed).toBe(JSON.stringify(parsed)); // exactly one JSON value
    expect(parsed.tool).toBe("catryna");
    expect(parsed.ok).toBe(false);
  });

  test("`--help` alongside `doctor --json` never leaks USAGE onto stdout", async () => {
    // Guards main()'s precedence: a present subcommand wins over -h/--help, so
    // `doctor --json --help` still emits a single JSON object, not the USAGE
    // banner (which would break the single-JSON-object invariant).
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "doctor", "--json", "--help"], {
      cwd: goodDocs,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    const trimmed = stdout.trim();
    const parsed = JSON.parse(trimmed); // throws if USAGE leaked alongside JSON
    expect(trimmed).toBe(JSON.stringify(parsed));
    expect(parsed.tool).toBe("catryna");
  });

  test("`--json --help` with NO subcommand keeps stdout clean (§4 rule 1)", async () => {
    // The real leak case: no subcommand + --json + --help. Help is non-JSON, so
    // under --json it must NOT reach stdout — it goes to stderr with the
    // usage-error code, matching a bare `catryna --json`.
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "--json", "--help"], {
      cwd: goodDocs,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect(stdout.trim()).toBe(""); // no USAGE banner on stdout under --json
    expect(code).toBe(2); // §4: usage error
    expect(stderr).toContain("catryna"); // help/usage went to stderr instead
  });
});
