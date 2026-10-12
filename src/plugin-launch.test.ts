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
 *     else may write there) and writes docs into THAT project's `.docs/`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

interface McpServerConfig {
  command: string;
  args: string[];
}

function pluginServer(): McpServerConfig {
  const plugin = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
  return plugin.mcpServers.catryna;
}

/** plugin.json's args with `${CLAUDE_PLUGIN_ROOT}` substituted, as Claude Code does. */
function substituted(cfg: McpServerConfig): string[] {
  return cfg.args.map((a) => a.replaceAll("${CLAUDE_PLUGIN_ROOT}", ROOT));
}

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
    const project = await mkdtemp(join(tmpdir(), "catryna-plugin-launch-"));
    dirs.push(project);
    const cfg = pluginServer();
    const proc = Bun.spawn([cfg.command, ...substituted(cfg)], {
      cwd: project,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const send = (msg: object) => proc.stdin.write(JSON.stringify(msg) + "\n");
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "plugin-launch-test", version: "0" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({
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
    });

    // Read stdout until the create_doc reply arrives (or 20s pass).
    const replies = new Map<number, any>();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 20_000;
    while (!replies.has(2) && Date.now() < deadline) {
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
    proc.stdin.end();
    proc.kill();
    await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(replies.get(1)?.result?.serverInfo).toBeDefined();
    expect(replies.get(2)?.result?.isError).not.toBe(true);
    expect(stderr).toContain("[Catryna] MCP server started on stdio");
    // cwd contract: the doc lands in the USER's project, not the plugin root.
    expect(existsSync(join(project, ".docs", "launch", "probe.mdx"))).toBe(true);
    expect(existsSync(join(ROOT, ".docs", "launch", "probe.mdx"))).toBe(false);
  }, 30_000);
});
