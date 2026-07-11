/**
 * Round-trip fidelity tests for the MDX parser (parseMdx) ↔ serializer
 * (blocksToMdx/blockToMdx).
 *
 * A metadata-only `updateDoc` (no `updates.blocks`) preserves existing content
 * by `readFile` → `parseMdx` → re-serialize. If the parse doesn't reconstruct
 * blocks such that the serializer re-emits byte-identical body text, a title-only
 * update CHURNS the .mdx — historically it exploded wrapped paragraphs into one
 * block per line and split multi-line `<Callout>`s into open/content/close
 * fragments, injecting blank lines throughout. These tests fail (by mutation) if
 * that fidelity regresses.
 *
 * Storage resolves paths from `process.cwd()` captured at module load, so each
 * scenario runs in a subprocess whose cwd is a fresh temp project (mirrors
 * storage.test.ts).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const STORAGE_PATH = fileURLToPath(new URL("./storage.ts", import.meta.url));

/** Run `code` in a subprocess with cwd = a fresh temp project; return its dir. */
async function runInProject(code: string): Promise<{ dir: string; code: number; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), "catryna-roundtrip-"));
  const fixture = join(dir, "fixture.ts");
  await writeFile(
    fixture,
    `import { createDoc, updateDoc, getDoc } from ${JSON.stringify(STORAGE_PATH)};\n${code}\n`,
  );
  const proc = Bun.spawn(["bun", "run", fixture], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { dir, code: exit, stderr };
}

/** Read a doc's .mdx body (frontmatter stripped). */
async function readBody(dir: string, docPath: string): Promise<string> {
  const raw = await readFile(join(dir, ".docs", `${docPath}.mdx`), "utf-8");
  return raw.replace(/^---\n[\s\S]*?\n---\n\n/, "");
}

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe("metadata-only updateDoc preserves multi-line content", () => {
  test("title-only update leaves a multi-line callout + wrapped paragraph byte-identical, and is idempotent", async () => {
    // A doc containing exactly the two constructs the bug mangled.
    const body = [
      "This is a wrapped paragraph that",
      "spans several physical lines and",
      "must stay a single block.",
      "",
      '<Callout type="warning">',
      "Be careful with this operation.",
      "It cannot be undone easily.",
      "</Callout>",
    ].join("\n");

    const { dir, code, stderr } = await runInProject(`
      await createDoc("demo", "Original", [{ type: "markdown", data: { content: ${JSON.stringify(body)} } }]);
      await updateDoc("demo", { title: "Updated Once" });
      await updateDoc("demo", { title: "Updated Twice" });
    `);
    dirs.push(dir);
    expect(code, stderr).toBe(0);
    // The 'Unknown block type: "raw"' warning must NOT appear — raw now has a case.
    expect(stderr).not.toContain("Unknown block type");

    const after = await readBody(dir, "demo");
    // The callout stayed a single, intact <Callout>…</Callout> with its body
    // between the tags, and the paragraph did not gain blank lines.
    expect(after).toBe(
      [
        "This is a wrapped paragraph that",
        "spans several physical lines and",
        "must stay a single block.",
        "",
        '<Callout type="warning">',
        "Be careful with this operation.",
        "It cannot be undone easily.",
        "</Callout>",
      ].join("\n"),
    );
    // No blank line was injected inside the paragraph or around the callout tags.
    expect(after).not.toContain("wrapped paragraph that\n\nspans");
    expect(after).not.toContain('type="warning">\n\n');
  });

  test("getDoc returns a single callout block + a single multi-line text block", async () => {
    const body = [
      "Line one of prose",
      "line two of prose",
      "",
      '<Callout type="info">',
      "note line a",
      "note line b",
      "</Callout>",
    ].join("\n");

    const { dir, code, stderr } = await runInProject(`
      await createDoc("g", "T", [{ type: "markdown", data: { content: ${JSON.stringify(body)} } }]);
      await updateDoc("g", { title: "T2" });
      const doc = await getDoc("g");
      await Bun.write("blocks.json", JSON.stringify(doc.blocks));
    `);
    dirs.push(dir);
    expect(code, stderr).toBe(0);

    const blocks = JSON.parse(await readFile(join(dir, "blocks.json"), "utf-8"));
    expect(blocks).toEqual([
      { type: "text", data: { content: "Line one of prose\nline two of prose" } },
      { type: "callout", data: { type: "info", content: "note line a\nnote line b" } },
    ]);
  });
});

describe("all block types round-trip through updateDoc", () => {
  test("heading, multi-line text, code, mermaid, divider, callout, and single-line components survive a title-only update unchanged", async () => {
    // Build via component blocks so the created .mdx exercises every blockToMdx
    // branch, then a metadata-only update must reproduce the body verbatim.
    const { dir, code, stderr } = await runInProject(`
      await createDoc("full", "Full", [
        { type: "heading", data: { level: 2, content: "Section" } },
        { type: "text", data: { content: "para line 1\\npara line 2\\npara line 3" } },
        { type: "code", data: { language: "typescript", content: "const x = 1;\\nconst y = 2;" } },
        { type: "mermaid", data: { content: "flowchart TD\\n  A --> B" } },
        { type: "divider", data: {} },
        { type: "callout", data: { type: "error", content: "danger\\nmore danger" } },
        { type: "react-flow", data: { nodes: [{ id: "n1" }], edges: [] } },
        { type: "table", data: { headers: ["a", "b"], rows: [["1", "2"]] } },
        { type: "whiteboard", data: { snapshot: { shapes: [] } } },
        { type: "code-embed", data: { file: "src/x.ts", startLine: 3, endLine: 9 } },
      ]);
      const before = await Bun.file(".docs/full.mdx").text();
      await Bun.write("before.txt", before);
      await updateDoc("full", { title: "Full v2" });
      const after1 = await Bun.file(".docs/full.mdx").text();
      await Bun.write("after1.txt", after1);
      await updateDoc("full", { title: "Full v3" });
      const after2 = await Bun.file(".docs/full.mdx").text();
      await Bun.write("after2.txt", after2);
    `);
    dirs.push(dir);
    expect(code, stderr).toBe(0);
    expect(stderr).not.toContain("Unknown block type");

    const strip = (s: string) => s.replace(/^---\n[\s\S]*?\n---\n\n/, "");
    const before = strip(await readFile(join(dir, "before.txt"), "utf-8"));
    const after1 = strip(await readFile(join(dir, "after1.txt"), "utf-8"));
    const after2 = strip(await readFile(join(dir, "after2.txt"), "utf-8"));

    // First title-only update reproduces the body exactly (no churn)…
    expect(after1).toBe(before);
    // …and it is idempotent (a second update changes nothing further).
    expect(after2).toBe(after1);

    // Spot-check the fragile constructs survived intact.
    expect(before).toContain('<Callout type="error">\ndanger\nmore danger\n</Callout>');
    expect(before).toContain("```typescript\nconst x = 1;\nconst y = 2;\n```");
    expect(before).toContain("```mermaid\nflowchart TD\n  A --> B\n```");
    expect(before).toContain("<ReactFlow data={");
    expect(before).toContain("<Table data={");
    expect(before).toContain("<Whiteboard data={");
    expect(before).toContain("<CodeEmbed ");
  });
});
