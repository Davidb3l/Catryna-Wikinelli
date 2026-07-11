/**
 * Tests for the suite-URI frontmatter fields `evidence` / `refs`
 * (SUITE_CONTRACTS §1, §6 Catryna checklist).
 *
 * A Catryna doc can carry suite URIs — `sirius:receipt/89` as evidence, the
 * `amt:decision/7` that governs it, etc. The contract (§1 rule 2) is that
 * FOREIGN URIs are stored OPAQUELY: accepted, persisted, and returned verbatim,
 * never validated or resolved. Broken links degrade to plain text, never errors.
 *
 * Storage resolves `.docs/` from `process.cwd()` captured at module load, so —
 * like storage.test.ts / events.test.ts — each scenario runs in a subprocess
 * whose cwd is a fresh temp project. Each assertion is mutation-checkable: it
 * fails if the corresponding wiring (serialize / parse / thread-through) is
 * removed.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseMdx } from "./storage";

const STORAGE_PATH = fileURLToPath(new URL("./storage.ts", import.meta.url));

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/**
 * Run `code` in a subprocess whose cwd is a fresh temp project. `code` runs
 * after an `import { createDoc, updateDoc, getDoc } from <storage>` prelude and
 * may `console.log(JSON.stringify(...))` a single result line, which is parsed
 * and returned as `out`. Returns the project dir for on-disk assertions.
 */
async function run(code: string): Promise<{ dir: string; exit: number; stderr: string; out: any }> {
  const dir = await mkdtemp(join(tmpdir(), "catryna-fm-"));
  dirs.push(dir);
  const fixture = join(dir, "fixture.ts");
  await writeFile(
    fixture,
    `import { createDoc, updateDoc, getDoc } from ${JSON.stringify(STORAGE_PATH)};\n${code}\n`,
  );
  const proc = Bun.spawn(["bun", "run", fixture], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  const line = stdout.split("\n").filter(Boolean).pop();
  return { dir, exit, stderr, out: line ? JSON.parse(line) : undefined };
}

async function readMdx(dir: string, path: string): Promise<string> {
  return readFile(join(dir, ".docs", `${path}.mdx`), "utf-8");
}

describe("evidence/refs round-trip through storage", () => {
  test("createDoc persists suite URIs to frontmatter AND getDoc returns them", async () => {
    const { dir, exit, stderr, out } = await run(`
      await createDoc(
        "modules/auth", "Auth",
        [{ type: "text", data: { content: "hi" } }],
        ["auth"], ["src/auth/index.ts"],
        ["sirius:receipt/89"], ["amt:decision/7"]
      );
      const doc = await getDoc("modules/auth");
      console.log(JSON.stringify({ evidence: doc.metadata.evidence, refs: doc.metadata.refs }));
    `);
    expect(exit, stderr).toBe(0);

    // getDoc surfaces the fields (fails if createDoc doesn't store them or
    // loadIndex/getDoc drops them).
    expect(out.evidence).toEqual(["sirius:receipt/89"]);
    expect(out.refs).toEqual(["amt:decision/7"]);

    // The .mdx frontmatter carries them (fails if blocksToMdx doesn't serialize).
    const mdx = await readMdx(dir, "modules/auth");
    expect(mdx).toContain(`evidence: ["sirius:receipt/89"]`);
    expect(mdx).toContain(`refs: ["amt:decision/7"]`);
  });

  test("foreign URIs with fragments and slashes are stored OPAQUELY, verbatim", async () => {
    // A cross-scheme URI with a `#fragment` and multiple slashes in the id.
    // Nothing may reject, rewrite, or strip it (§1 rule 2 — foreign = opaque).
    const foreignEvidence = ["sirius:receipt/89", "hayven:node/a/b/c#frag"];
    const foreignRefs = ["amt:decision/7", "catryna:doc/architecture/auth-flow#claim-2"];
    const { dir, exit, stderr, out } = await run(`
      await createDoc(
        "x", "X", [{ type: "text", data: { content: "z" } }],
        [], [],
        ${JSON.stringify(foreignEvidence)}, ${JSON.stringify(foreignRefs)}
      );
      const doc = await getDoc("x");
      console.log(JSON.stringify({ evidence: doc.metadata.evidence, refs: doc.metadata.refs }));
    `);
    expect(exit, stderr).toBe(0);

    // Verbatim on the way out — the `#frag`, the `/a/b/c`, the foreign schemes
    // all survive parse round-trip and reach the caller unchanged.
    expect(out.evidence).toEqual(foreignEvidence);
    expect(out.refs).toEqual(foreignRefs);

    const mdx = await readMdx(dir, "x");
    expect(mdx).toContain(`"hayven:node/a/b/c#frag"`);
    expect(mdx).toContain(`"catryna:doc/architecture/auth-flow#claim-2"`);
  });
});

describe("adversarial values round-trip losslessly (§1 opaque storage)", () => {
  // Comma, double-quote, backslash, closing bracket, and a newline — every char
  // the naive `"${v}"` / split-on-comma serializer corrupts. Opaque suite URIs
  // and free-text tags/title must survive verbatim AND leave valid JSON on disk
  // so the frontend's `JSON.parse` reader round-trips too.
  const advEvidence = [
    "sirius:receipt/a,b", // comma
    'hayven:node/x"y', // double-quote
    "amt:decision/back\\slash", // backslash
    "catryna:doc/close]bracket", // closing bracket
    "sirius:receipt/line1\nline2", // newline
  ];
  const advRefs = ['amt:decision/has"quote,and,commas', "hayven:claim/plain"];
  const advTags = ["tag,with,commas", 'tag"with"quotes'];
  const advTitle = 'A "tricky", title\nwith a newline and \\ backslash';

  test("createDoc → getDoc returns adversarial evidence/refs/tags/title verbatim", async () => {
    const { dir, exit, stderr, out } = await run(`
      await createDoc(
        "adv", ${JSON.stringify(advTitle)},
        [{ type: "text", data: { content: "z" } }],
        ${JSON.stringify(advTags)}, [],
        ${JSON.stringify(advEvidence)}, ${JSON.stringify(advRefs)}
      );
      const doc = await getDoc("adv");
      console.log(JSON.stringify({
        title: doc.metadata.title,
        tags: doc.metadata.tags,
        evidence: doc.metadata.evidence,
        refs: doc.metadata.refs,
      }));
    `);
    expect(exit, stderr).toBe(0);
    expect(out.title).toBe(advTitle);
    expect(out.tags).toEqual(advTags);
    expect(out.evidence).toEqual(advEvidence);
    expect(out.refs).toEqual(advRefs);

    // The on-disk frontmatter must be VALID JSON (each field on ONE physical
    // line) so the frontend parser round-trips it. Fails if serialization stops
    // JSON-encoding (naive interpolation → invalid JSON / broken lines).
    const mdx = await readMdx(dir, "adv");
    const evLine = mdx.match(/^evidence: (.*)$/m);
    const refLine = mdx.match(/^refs: (.*)$/m);
    const tagLine = mdx.match(/^tags: (.*)$/m);
    const titleLine = mdx.match(/^title: (.*)$/m);
    expect(evLine).not.toBeNull();
    expect(JSON.parse(evLine![1])).toEqual(advEvidence);
    expect(JSON.parse(refLine![1])).toEqual(advRefs);
    expect(JSON.parse(tagLine![1])).toEqual(advTags);
    expect(JSON.parse(titleLine![1])).toBe(advTitle);

    // And this module's own parser decodes the same file back losslessly. Fails
    // if parseMdx reverts to split-on-comma / bare quote-strip.
    const parsed = parseMdx(mdx);
    expect(parsed.metadata.evidence).toEqual(advEvidence);
    expect(parsed.metadata.refs).toEqual(advRefs);
    expect(parsed.metadata.tags).toEqual(advTags);
    expect(parsed.metadata.title).toBe(advTitle);
  });
});

describe("backward-compat: absent fields default to []", () => {
  test("createDoc without evidence/refs yields empty arrays, never undefined", async () => {
    const { exit, stderr, out } = await run(`
      await createDoc("d", "D", [{ type: "text", data: { content: "q" } }]);
      const doc = await getDoc("d");
      console.log(JSON.stringify({ evidence: doc.metadata.evidence, refs: doc.metadata.refs }));
    `);
    expect(exit, stderr).toBe(0);
    expect(out.evidence).toEqual([]);
    expect(out.refs).toEqual([]);
  });

  test("a pre-existing index + mdx lacking the fields loads as [] (no throw)", async () => {
    // Hand-write a legacy store: neither _index.json nor the .mdx mention
    // evidence/refs (as every doc written before this feature does). getDoc must
    // normalize them to [] on read, not surface undefined or throw.
    const dir = await mkdtemp(join(tmpdir(), "catryna-fm-legacy-"));
    dirs.push(dir);
    const docsDir = join(dir, ".docs");
    await mkdir(docsDir, { recursive: true });
    const now = 1704067200000;
    const legacyMeta = {
      id: "legacy-1", path: "old/doc", title: "Old",
      tags: ["t"], relatedFiles: ["src/old.ts"],
      createdAt: now, updatedAt: now, createdBy: "claude-code",
    };
    await writeFile(
      join(docsDir, "_index.json"),
      JSON.stringify({ version: 1, docs: [legacyMeta], lastUpdated: now }, null, 2),
    );
    await mkdir(join(docsDir, "old"), { recursive: true });
    await writeFile(
      join(docsDir, "old", "doc.mdx"),
      `---\nid: legacy-1\ntitle: "Old"\npath: "old/doc"\ntags: ["t"]\nrelatedFiles: ["src/old.ts"]\ncreatedAt: ${now}\nupdatedAt: ${now}\ncreatedBy: "claude-code"\n---\n\n# Old\n`,
    );

    const fixture = join(dir, "fixture.ts");
    await writeFile(
      fixture,
      `import { getDoc } from ${JSON.stringify(STORAGE_PATH)};\n` +
        `const doc = await getDoc("old/doc");\n` +
        `console.log(JSON.stringify({ evidence: doc.metadata.evidence, refs: doc.metadata.refs, title: doc.metadata.title }));\n`,
    );
    const proc = Bun.spawn(["bun", "run", fixture], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exit = await proc.exited;
    expect(exit, stderr).toBe(0);
    const out = JSON.parse(stdout.split("\n").filter(Boolean).pop()!);
    expect(out.title).toBe("Old"); // proves the legacy doc actually loaded
    expect(out.evidence).toEqual([]);
    expect(out.refs).toEqual([]);
  });
});

describe("updateDoc evidence/refs semantics", () => {
  test("replaces when provided, preserves when omitted", async () => {
    const { dir, exit, stderr, out } = await run(`
      await createDoc(
        "u", "U", [{ type: "text", data: { content: "a" } }],
        [], [],
        ["sirius:receipt/1"], ["amt:decision/1"]
      );
      // Update only evidence + title; refs is OMITTED and must be preserved.
      await updateDoc("u", { title: "U2", evidence: ["sirius:receipt/2", "hayven:claim/abc"] });
      const doc = await getDoc("u");
      console.log(JSON.stringify({
        title: doc.metadata.title,
        evidence: doc.metadata.evidence,
        refs: doc.metadata.refs,
      }));
    `);
    expect(exit, stderr).toBe(0);

    // Provided → replaced.
    expect(out.evidence).toEqual(["sirius:receipt/2", "hayven:claim/abc"]);
    // Omitted → preserved (fails if updateDoc clobbers refs on omission).
    expect(out.refs).toEqual(["amt:decision/1"]);
    expect(out.title).toBe("U2");

    // The rewritten .mdx reflects the replacement too.
    const mdx = await readMdx(dir, "u");
    expect(mdx).toContain(`evidence: ["sirius:receipt/2", "hayven:claim/abc"]`);
    expect(mdx).toContain(`refs: ["amt:decision/1"]`);
  });
});
