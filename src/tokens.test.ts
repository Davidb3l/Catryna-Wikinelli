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
  retokenize,
  retokenizeBlocks,
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
    // Assert the BEHAVIOR (refused, no value) rather than the wording — the
    // message is UI, the containment is the contract.
    expect(r.ok).toBe(false);
    expect(r.value).toBeUndefined();
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

/**
 * REGRESSIONS from the adversarial review. Every one of these was a real,
 * reproduced defect — the security pair especially: a doc is untrusted data,
 * `.docs/` is git-shared, and the viewer binds 0.0.0.0.
 */
describe("evaluateToken — review regressions", () => {
  test("a SYMLINK cannot walk out of the project root", async () => {
    // `path.resolve` does not resolve symlinks, so a textual containment check
    // passed and `stat`/`readFile` followed the link — `{{version: …}}` leaked
    // file CONTENT from outside the root, over the network.
    const root = await project({ "src/a.ts": "x\n" });
    const outside = await project({ "secret.toml": 'version = "9.9.9-LEAKED"\n', "s.txt": "a\nb\n" });
    const { symlink } = await import("node:fs/promises");
    await symlink(outside, join(root, "escape"));

    expect((await evaluateToken("count", "escape", root)).ok).toBe(false);
    expect((await evaluateToken("loc", "escape", root)).ok).toBe(false);
    const v = await evaluateToken("version", "escape/secret.toml", root);
    expect(v.ok).toBe(false);
    expect(v.value).toBeUndefined();
  });

  test("a symlinked FILE at the top level is refused too", async () => {
    const root = await project({ "src/a.ts": "x\n" });
    const outside = await project({ "secret.json": JSON.stringify({ version: "LEAKED" }) });
    const { symlink } = await import("node:fs/promises");
    await symlink(join(outside, "secret.json"), join(root, "sneak.json"));
    expect((await evaluateToken("version", "sneak.json", root)).ok).toBe(false);
  });

  test("a ReDoS glob is refused fast, not matched slowly", async () => {
    // `**/`×n compiled to nested `(?:.*/)?` and backtracked exponentially:
    // n=14 took ~6s, n=24 never finished — wedging the event loop for every
    // other request. Runs are collapsed and the arg is bounded.
    const root = await project({ "src/a.ts": "x\n" });
    const bomb = "d/" + "**/".repeat(24) + "zzz";
    const t0 = Date.now();
    await evaluateToken("count", bomb, root);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test("an over-long or wildcard-heavy argument is refused", async () => {
    const root = await project({ "src/a.ts": "x\n" });
    expect((await evaluateToken("count", "a".repeat(300), root)).ok).toBe(false);
    expect((await evaluateToken("count", "*".repeat(40), root)).ok).toBe(false);
  });

  test("hitting the file cap FAILS rather than reporting a truncated count", async () => {
    // Returning the truncated 5000 was strictly worse than the literal it
    // replaced: a confident repo-wide number that never changes as the repo grows.
    const files: Record<string, string> = {};
    for (let i = 0; i < 5200; i++) files[`src/f${i}.ts`] = "x\n";
    const root = await project(files);
    const c = await evaluateToken("count", "src/*.ts", root);
    expect(c.ok).toBe(false);
    expect(c.value).toBeUndefined();
  }, 60_000);

  test("'.' and './' both mean the root — './' used to render a silent 0", async () => {
    const root = await project({ "a.ts": "l1\nl2\n", "b.ts": "l1\n" });
    expect((await evaluateToken("loc", ".", root)).value).toBe("3");
    expect((await evaluateToken("loc", "./", root)).value).toBe("3");
  });

  test("'/' is absolute and refused, not normalized into the root", async () => {
    const root = await project({ "a.ts": "l1\n" });
    for (const a of ["/", "//", "///"]) {
      expect((await evaluateToken("loc", a, root)).ok).toBe(false);
      expect((await evaluateToken("count", a, root)).ok).toBe(false);
    }
  });

  test("version reads the [package] table, not a dependency's", async () => {
    const root = await project({
      "Cargo.toml": `[dependencies.serde]\nversion = "1.0.200"\n\n[package]\nname = "x"\nversion = "0.3.1"\n`,
    });
    expect((await evaluateToken("version", "Cargo.toml", root)).value).toBe("0.3.1");
  });

  test("a numeric JSON version is stringified, not failed", async () => {
    const root = await project({ "schema.json": JSON.stringify({ version: 3 }) });
    expect((await evaluateToken("version", "schema.json", root)).value).toBe("3");
  });

  test("a nonexistent PLAIN path fails (typo), while a glob matching nothing is 0", async () => {
    const root = await project({ "src/a.ts": "x\n" });
    // `{{count: …}}` (a literal ellipsis in a doc) used to render a cheerful 0.
    expect((await evaluateToken("count", "…", root)).ok).toBe(false);
    expect((await evaluateToken("count", "nope/", root)).ok).toBe(false);
    expect((await evaluateToken("count", "src/*.py", root)).value).toBe("0");
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

/**
 * The corruption the review caught in the wild: the evaluator had no notion of
 * code, so it rewrote the syntax table in this feature's OWN documentation
 * ("| 28 | how many files match the glob |") and turned the sentence about raw
 * tokens into "sees the raw `0` form". Lint already read code spans as text, so
 * the two halves of the feature disagreed about what a code span means.
 */
describe("renderComputedTokens — code is left alone", () => {
  test("a token inside an inline code span is a literal, not a value", async () => {
    const root = await project({ "src/a.ts": "x\n" });
    const out = await renderComputedTokens(
      "Write `{{count: src/*.ts}}` to get **{{count: src/*.ts}}** files.",
      root,
    );
    expect(out).toBe("Write `{{count: src/*.ts}}` to get **1** files.");
  });

  test("multi-backtick spans protect too", async () => {
    const root = await project({ "src/a.ts": "x\n" });
    expect(await renderComputedTokens("``{{count: src/*.ts}}``", root)).toBe(
      "``{{count: src/*.ts}}``",
    );
  });

  test("a token inside a fenced block is untouched", async () => {
    const root = await project({ "src/a.ts": "x\n" });
    const doc = "Before {{count: src/*.ts}}\n\n```md\n{{count: src/*.ts}}\n```\n\nAfter.";
    const out = await renderComputedTokens(doc, root);
    expect(out).toContain("Before 1");
    expect(out).toContain("```md\n{{count: src/*.ts}}\n```");
  });

  test("~~~ fences protect as well", async () => {
    const root = await project({ "src/a.ts": "x\n" });
    const out = await renderComputedTokens("~~~\n{{count: src/*.ts}}\n~~~", root);
    expect(out).toContain("{{count: src/*.ts}}");
  });
});

describe("renderTokensInBlocks", () => {
  test("code-ish blocks are skipped; prose blocks render", async () => {
    const root = await project({ "src/a.ts": "x\n" });
    const out = await renderTokensInBlocks(
      [
        { type: "code", data: { content: "Write {{count: src/*.ts}}" } },
        { type: "mermaid", data: { content: "%% {{count: src/*.ts}}" } },
        { type: "text", data: { content: "Has {{count: src/*.ts}} files" } },
      ],
      root,
    );
    expect(out[0].data?.content).toBe("Write {{count: src/*.ts}}");
    expect(out[1].data?.content).toBe("%% {{count: src/*.ts}}");
    expect(out[2].data?.content).toBe("Has 1 files");
  });

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

/**
 * The round-trip: `get_doc` renders, an agent edits, `update_doc` writes back.
 * Without restoring the query, that path silently converts a live token into the
 * frozen literal it was created to replace. The non-firing cases matter as much
 * as the firing ones — a wrong restore corrupts prose, which is worse than the
 * stale number it prevents.
 */
describe("retokenize — putting the query back", () => {
  test("an UNTOUCHED block round-trips to the original raw, byte for byte", async () => {
    const root = await project({ "src/a.ts": "x\n", "src/b.ts": "y\n" });
    const raw = "This repo has {{count: src/*.ts}} files and {{loc: src/}} lines.";
    const rendered = await renderComputedTokens(raw, root);
    expect(rendered).toBe("This repo has 2 files and 2 lines.");
    expect(await retokenize(rendered, raw, root)).toBe(raw);
  });

  test("an edit ELSEWHERE keeps the edit and restores the token", async () => {
    const root = await project({ "src/a.ts": "x\n", "src/b.ts": "y\n" });
    const raw = "This repo has {{count: src/*.ts}} files. Old sentence.";
    const rendered = await renderComputedTokens(raw, root);
    const edited = rendered.replace("Old sentence.", "A brand new sentence here.");
    expect(await retokenize(edited, raw, root)).toBe(
      "This repo has {{count: src/*.ts}} files. A brand new sentence here.",
    );
  });

  test("a value the agent DELIBERATELY rewrote is left as their literal", async () => {
    const root = await project({ "src/a.ts": "x\n", "src/b.ts": "y\n" });
    const raw = "This repo has {{count: src/*.ts}} files.";
    const edited = "This repo has 99 files.";
    // No silent revert to a token that would render something else.
    expect(await retokenize(edited, raw, root)).toBe("This repo has 99 files.");
  });

  test("a number the agent TYPED is never turned into a query", async () => {
    const root = await project({ "src/a.ts": "x\n", "src/b.ts": "y\n" });
    const raw = "Repo has {{count: src/*.ts}} files.";
    const rendered = await renderComputedTokens(raw, root); // "Repo has 2 files."
    const edited = rendered + " We also support 2 other things.";
    const out = await retokenize(edited, raw, root);
    expect(out).toBe("Repo has {{count: src/*.ts}} files. We also support 2 other things.");
    // Exactly one token restored — the trailing "2" stayed a plain number.
    expect(out.match(/\{\{/g)).toHaveLength(1);
  });

  test("repeated identical values restore in document order, not out of sequence", async () => {
    const root = await project({ "src/a.ts": "x\n", "src/b.ts": "y\n" });
    const raw = "First {{count: src/*.ts}} here. Second {{count: src/*.ts}} there.";
    const rendered = await renderComputedTokens(raw, root);
    expect(rendered).toBe("First 2 here. Second 2 there.");
    expect(await retokenize(rendered, raw, root)).toBe(raw);
  });

  test("a failed token was never rendered, so nothing is restored over it", async () => {
    const root = await project({ "src/a.ts": "x\n" });
    const raw = "Escapes {{loc: ../../etc}} stays raw.";
    const rendered = await renderComputedTokens(raw, root);
    expect(rendered).toBe(raw);
    expect(await retokenize(rendered, raw, root)).toBe(raw);
  });

  test("text with no prior tokens is returned untouched", async () => {
    const root = await project({ "src/a.ts": "x\n" });
    expect(await retokenize("plain new prose", "plain old prose", root)).toBe("plain new prose");
  });

  test("retokenizeBlocks pairs by index and skips code blocks", async () => {
    const root = await project({ "src/a.ts": "x\n", "src/b.ts": "y\n" });
    const oldBlocks = [
      { type: "code", data: { content: "literal {{count: src/*.ts}}" } },
      { type: "text", data: { content: "Has {{count: src/*.ts}} files" } },
    ];
    const newBlocks = [
      { type: "code", data: { content: "literal {{count: src/*.ts}}" } },
      { type: "text", data: { content: "Has 2 files" } },
    ];
    const out = await retokenizeBlocks(newBlocks, oldBlocks, root);
    expect(out[0].data?.content).toBe("literal {{count: src/*.ts}}"); // untouched
    expect(out[1].data?.content).toBe("Has {{count: src/*.ts}} files"); // restored
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
