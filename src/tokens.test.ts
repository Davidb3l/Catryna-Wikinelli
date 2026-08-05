/**
 * CAT-2 — computed-fact tokens. A doc stores the QUERY, the reader evaluates it,
 * so the number cannot go stale. These tests pin the three behaviors that matter
 * most: the queries answer correctly, the security containment holds (a doc is
 * untrusted data), and a failure degrades to the raw token — never a wrong
 * number, never a throw.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  evaluateToken,
  renderComputedTokens,
  renderTokensInBlocks,
  COMPUTED_TOKEN_RE,
} from "./tokens";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/** A throwaway project root with `files` written under it. */
async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "catryna-tokens-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }
  return root;
}

describe("evaluateToken — the three queries", () => {
  test("count matches a glob, non-recursively for a single star", async () => {
    const root = await project({
      "src/a.rs": "x", "src/b.rs": "y", "src/c.ts": "z", "src/sub/d.rs": "w",
    });
    expect((await evaluateToken("count", "src/*.rs", root)).value).toBe("2");
  });

  test("count with ** recurses", async () => {
    const root = await project({ "src/a.rs": "x", "src/sub/d.rs": "w", "src/sub/e.rs": "v" });
    expect((await evaluateToken("count", "src/**/*.rs", root)).value).toBe("3");
  });

  test("loc sums line counts across matched files", async () => {
    const root = await project({
      "src/a.rs": "l1\nl2\nl3\n", // 3
      "src/b.rs": "one\ntwo",     // 2 (no trailing newline)
    });
    expect((await evaluateToken("loc", "src/*.rs", root)).value).toBe("5");
  });

  test("a bare directory means everything under it, recursively", async () => {
    const root = await project({ "src/a.rs": "l1\n", "src/sub/b.rs": "l1\nl2\n" });
    expect((await evaluateToken("loc", "src/", root)).value).toBe("3");
  });

  test("version parses package.json", async () => {
    const root = await project({ "package.json": JSON.stringify({ version: "4.2.0" }) });
    expect((await evaluateToken("version", "package.json", root)).value).toBe("4.2.0");
  });

  test("version parses a Cargo.toml [package] version", async () => {
    const root = await project({
      "Cargo.toml": `[package]\nname = "x"\nversion = "0.3.1"\nedition = "2021"\n`,
    });
    expect((await evaluateToken("version", "Cargo.toml", root)).value).toBe("0.3.1");
  });

  test("a plain file path counts as one file", async () => {
    const root = await project({ "README.md": "a\nb\nc\n" });
    expect((await evaluateToken("count", "README.md", root)).value).toBe("1");
    expect((await evaluateToken("loc", "README.md", root)).value).toBe("3");
  });

  test("heavy dirs are skipped so a repo-wide query stays bounded", async () => {
    const root = await project({
      "src/a.rs": "x",
      "node_modules/pkg/index.js": "junk",
      "target/debug/thing": "junk",
      ".git/objects/ab": "junk",
    });
    // Only src/a.rs counts — the skip list keeps deps/build/VCS out.
    expect((await evaluateToken("count", "**/*", root)).value).toBe("1");
  });
});

describe("evaluateToken — security containment (a doc is untrusted data)", () => {
  test("a traversal argument is refused, not read", async () => {
    const root = await project({ "src/a.rs": "x" });
    const r = await evaluateToken("loc", "../../../etc/passwd", root);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("escapes");
  });

  test("an absolute path is refused", async () => {
    const root = await project({ "src/a.rs": "x" });
    expect((await evaluateToken("count", "/etc/*", root)).ok).toBe(false);
    expect((await evaluateToken("version", "/etc/hosts", root)).ok).toBe(false);
  });

  test("a glob whose base escapes root is refused", async () => {
    const root = await project({ "src/a.rs": "x" });
    expect((await evaluateToken("count", "../*", root)).ok).toBe(false);
  });
});

describe("evaluateToken — graceful failure", () => {
  test("a missing file is a failure result, never a throw", async () => {
    const root = await project({ "src/a.rs": "x" });
    expect((await evaluateToken("version", "nope.json", root)).ok).toBe(false);
  });

  test("a glob matching nothing is a legit count of 0", async () => {
    const root = await project({ "src/a.rs": "x" });
    expect((await evaluateToken("count", "src/*.py", root)).value).toBe("0");
  });

  test("a manifest with no version field fails cleanly", async () => {
    const root = await project({ "package.json": JSON.stringify({ name: "x" }) });
    expect((await evaluateToken("version", "package.json", root)).ok).toBe(false);
  });
});

describe("renderComputedTokens", () => {
  test("replaces every token with its live value", async () => {
    const root = await project({
      "src/a.rs": "l1\nl2\n", "src/b.rs": "l1\n",
      "Cargo.toml": `version = "0.9.0"\n`,
    });
    const out = await renderComputedTokens(
      "Sirius is {{loc: src/}} lines across {{count: src/*.rs}} modules, v{{version: Cargo.toml}}.",
      root,
    );
    expect(out).toBe("Sirius is 3 lines across 2 modules, v0.9.0.");
  });

  test("a FAILED token is left raw and self-describing, never a stale number", async () => {
    const root = await project({ "src/a.rs": "x" });
    const out = await renderComputedTokens(
      "Escapes: {{loc: ../../etc}}; missing: {{version: none.json}}.",
      root,
    );
    // Raw tokens survive verbatim — a plain-file read still shows intent.
    expect(out).toBe("Escapes: {{loc: ../../etc}}; missing: {{version: none.json}}.");
  });

  test("text with no tokens is returned untouched (fast path)", async () => {
    const root = await project({ "src/a.rs": "x" });
    expect(await renderComputedTokens("plain prose, no tokens", root)).toBe(
      "plain prose, no tokens",
    );
  });

  test("identical tokens evaluate once and render the same value", async () => {
    const root = await project({ "src/a.rs": "x", "src/b.rs": "y" });
    const out = await renderComputedTokens("{{count: src/*.rs}} and {{count: src/*.rs}}", root);
    expect(out).toBe("2 and 2");
  });

  test("whitespace inside the token braces is tolerated", async () => {
    const root = await project({ "src/a.rs": "x" });
    expect(await renderComputedTokens("{{  count :  src/*.rs  }}", root)).toBe("1");
  });
});

describe("renderTokensInBlocks", () => {
  test("renders string content fields, leaves structure intact", async () => {
    const root = await project({ "src/a.rs": "x", "src/b.rs": "y" });
    const blocks = [
      { type: "heading", data: { level: 1, content: "Title" } },
      { type: "markdown", data: { content: "It has {{count: src/*.rs}} modules." } },
      { type: "divider", data: {} },
    ];
    const out = await renderTokensInBlocks(blocks, root);
    expect(out[1].data?.content).toBe("It has 2 modules.");
    // Untouched blocks pass through unchanged.
    expect(out[0]).toEqual(blocks[0]);
    expect(out[2]).toEqual(blocks[2]);
  });
});

describe("COMPUTED_TOKEN_RE — the shared grammar", () => {
  test("matches the three kinds and captures kind + arg", () => {
    COMPUTED_TOKEN_RE.lastIndex = 0;
    const m = COMPUTED_TOKEN_RE.exec("x {{count: src/*.rs}} y");
    expect(m?.[1]).toBe("count");
    expect(m?.[2].trim()).toBe("src/*.rs");
  });

  test("does not match an unknown kind (allowlist)", () => {
    COMPUTED_TOKEN_RE.lastIndex = 0;
    expect(COMPUTED_TOKEN_RE.test("{{exec: rm -rf /}}")).toBe(false);
  });
});
