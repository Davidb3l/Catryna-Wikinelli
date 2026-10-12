/**
 * The plugin's MCP launch command, run exactly as Claude Code runs it.
 *
 * Claude Code spawns an MCP server's `command` WITHOUT a shell. plugin.json used
 * `bash scripts/run-server.sh`, and on Windows a bare `bash` resolves to
 * C:\Windows\System32\bash.exe — the WSL launcher — which fails with
 * "execvpe(/bin/bash) failed", so the plugin's server never started there
 * (Claude Code showed it as CONNECTION_CLOSED). The contract pinned here:
 *
 *   - the command is `bun` itself, never a shell;
 *   - spawned with the user's project as cwd, it speaks MCP on stdout (nothing
 *     else may write there) and writes docs into THAT project's `.docs/`;
 *   - a partial first install (node_modules/ present, packages missing) heals.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const dirs: string[] = [];
afterAll(async () => {
  // Retries: on Windows a just-killed server can hold its cwd for a moment.
  for (const d of dirs) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function tempDir(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

interface McpServerConfig {
  command: string;
  args: string[];
}

function pluginServer(): McpServerConfig {
  const plugin = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
  return plugin.mcpServers.catryna;
}

/** plugin.json's args with `${CLAUDE_PLUGIN_ROOT}` substituted, as Claude Code does. */
function substituted(cfg: McpServerConfig, pluginRoot = ROOT): string[] {
  return cfg.args.map((a) => a.replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot));
}

/**
 * Spawn the server, send `messages`, and collect replies until every id in
 * `awaitIds` has answered (or the deadline passes). The server is always
 * stopped, even when an assertion inside the read loop throws.
 */
async function mcpSession(
  argv: string[],
  cwd: string,
  messages: object[],
  awaitIds: number[],
  timeoutMs = 20_000,
): Promise<{ replies: Map<number, any>; stderr: string }> {
  const proc = Bun.spawn(argv, { cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const replies = new Map<number, any>();
  try {
    for (const m of messages) proc.stdin.write(JSON.stringify(m) + "\n");
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + timeoutMs;
    while (!awaitIds.every((id) => replies.has(id)) && Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        Bun.sleep(deadline - Date.now()).then(() => ({ value: undefined, done: true })),
      ]);
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        // Every stdout line must be JSON-RPC — a stray log line breaks the client.
        const msg = JSON.parse(line);
        expect(msg.jsonrpc).toBe("2.0");
        if (typeof msg.id === "number") replies.set(msg.id, msg);
      }
    }
  } finally {
    proc.stdin.end();
    proc.kill();
    await proc.exited;
  }
  return { replies, stderr: await new Response(proc.stderr).text() };
}

const INITIALIZE = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "plugin-launch-test", version: "0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
];

describe("plugin MCP launch", () => {
  test("the server command is bun itself, not a shell", () => {
    const cfg = pluginServer();
    // A shell here is resolved on PATH without Git Bash's help — on Windows,
    // `bash` is the WSL launcher and `sh` usually doesn't exist at all.
    expect(cfg.command).toBe("bun");
    for (const arg of substituted(cfg)) {
      if (arg.includes("/") || arg.includes("\\")) expect(existsSync(arg)).toBe(true);
    }
  });

  test("spawned from the user's project, it speaks MCP on stdout and writes docs there", async () => {
    const project = await tempDir("catryna-plugin-launch-");
    const cfg = pluginServer();
    const { replies, stderr } = await mcpSession(
      [cfg.command, ...substituted(cfg)],
      project,
      [
        ...INITIALIZE,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "create_doc",
            arguments: {
              path: "launch/probe",
              title: "Probe",
              content: [{ type: "text", data: { content: "hello" } }],
            },
          },
        },
      ],
      [1, 2],
    );

    expect(replies.get(1)?.result?.serverInfo).toBeDefined();
    expect(replies.get(2)?.result?.isError).not.toBe(true);
    expect(stderr).toContain("[Catryna] MCP server started on stdio");
    // cwd contract: the doc lands in the USER's project, not the plugin root.
    expect(existsSync(join(project, ".docs", "launch", "probe.mdx"))).toBe(true);
    expect(existsSync(join(ROOT, ".docs", "launch", "probe.mdx"))).toBe(false);
  }, 30_000);

  test("an interrupted first install (node_modules/ present, packages missing) heals", async () => {
    // A first install killed partway (e.g. by the client's startup timeout)
    // leaves node_modules/ behind. Checking only for the folder skipped the
    // install forever after, and every launch then failed to import the SDK.
    const pluginRoot = join(await tempDir("catryna-plugin-root-"), "plugin root");
    for (const entry of ["package.json", "bun.lock", "src", "scripts"]) {
      cpSync(join(ROOT, entry), join(pluginRoot, entry), { recursive: true });
    }
    mkdirSync(join(pluginRoot, "node_modules"));
    const project = await tempDir("catryna-plugin-launch-");
    const cfg = pluginServer();

    const { replies, stderr } = await mcpSession(
      [cfg.command, ...substituted(cfg, pluginRoot)],
      project,
      INITIALIZE,
      [1],
      90_000,
    );

    expect(stderr).toContain("installing server dependencies");
    expect(replies.get(1)?.result?.serverInfo).toBeDefined();
    expect(existsSync(join(pluginRoot, "node_modules", "@modelcontextprotocol", "sdk", "package.json"))).toBe(true);
  }, 120_000);
});
