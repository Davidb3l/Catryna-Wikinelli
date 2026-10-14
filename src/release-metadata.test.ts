/**
 * Release metadata must agree, because Claude Code's plugin updater is
 * VERSION-KEYED: a fix that ships under an unchanged version (1.3.0 kept the
 * Windows launcher fix after installed 1.3.0 copies had the broken `bash`
 * launcher) is never delivered. These tests pin that the manifests move
 * together and that the CLI/server report the same version.
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

setDefaultTimeout(30_000);

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const json = (rel: string) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

describe("version is pinned consistently", () => {
  const pkg = json("package.json");

  test("package.json, plugin.json and marketplace.json agree", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json(".claude-plugin/plugin.json").version).toBe(pkg.version);
    const entries = json(".claude-plugin/marketplace.json").plugins;
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.version).toBe(pkg.version);
  });

  test("the latest dated CHANGELOG section is this version", () => {
    const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    const dated = [...changelog.matchAll(/^## (\d+\.\d+\.\d+) — \d{4}-\d{2}-\d{2}$/gm)].map((m) => m[1]);
    expect(dated[0]).toBe(pkg.version);
  });

  test("the launcher is bun itself, never a shell (the bug that 1.3.1 ships the fix for)", () => {
    const server = json(".claude-plugin/plugin.json").mcpServers.catryna;
    expect(server.command).toBe("bun");
  });

  test("engines.bun states the floor the README documents", () => {
    expect(pkg.engines.bun).toBe(">=1.2.0");
    expect(readFileSync(join(ROOT, "README.md"), "utf8")).toContain("v1.2+");
  });
});

describe("catryna --version", () => {
  async function cli(args: string[]) {
    const proc = Bun.spawn([process.execPath, join(ROOT, "src", "cli.ts"), ...args], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  }
  const version = json("package.json").version;

  for (const args of [["--version"], ["-V"], ["version"]]) {
    test(`catryna ${args.join(" ")} prints "catryna <version>" and exits 0`, async () => {
      const r = await cli(args);
      expect(r.code).toBe(0);
      expect(r.stdout).toBe(`catryna ${version}\n`);
      expect(r.stderr).toBe("");
    });
  }

  test("an unknown command is still a usage error", async () => {
    const r = await cli(["frobnicate"]);
    expect(r.code).toBe(2);
  });

  test("the MCP server reports the same version it reads from package.json", async () => {
    const proc = Bun.spawn([process.execPath, "run", join(ROOT, "src", "index.ts")], {
      cwd: ROOT,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    try {
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
        }) + "\n",
      );
      proc.stdin.flush();
      const reader = proc.stdout.getReader();
      let buf = "";
      const deadline = Date.now() + 20_000;
      while (!buf.includes("\n") && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
      }
      const reply = JSON.parse(buf.split("\n")[0]);
      expect(reply.result.serverInfo.version).toBe(version);
    } finally {
      proc.kill();
    }
  });
});
