/**
 * Cross-platform portability of a `.docs/` corpus.
 *
 * `.docs/` is git-versioned and travels between machines, so a corpus authored
 * on Windows must work on macOS/Linux and vice versa. Two things broke that in
 * practice (both found by running `catryna drift` on Catryna's own Windows-
 * authored docs from a Mac):
 *
 *   1. Anchors recorded with backslashes (`src\index.ts`) resolve to nothing on
 *      POSIX, so every anchored doc reported `broken`.
 *   2. A CRLF checkout defeated the frontmatter regex entirely, silently losing
 *      all metadata and parsing the YAML block as body content.
 */
import { describe, expect, test } from "bun:test";

import {
  effectiveAnchors,
  normalizeAnchor,
  normalizeAnchorPath,
  parseMdx,
} from "./storage";

describe("anchor path normalization (Windows ↔ POSIX)", () => {
  test("backslash separators become forward slashes", () => {
    expect(normalizeAnchorPath("src\\index.ts")).toBe("src/index.ts");
    expect(normalizeAnchorPath("src\\tools\\docs.ts")).toBe("src/tools/docs.ts");
    // Already-POSIX paths are untouched.
    expect(normalizeAnchorPath("src/tools/docs.ts")).toBe("src/tools/docs.ts");
  });

  test("duplicate separators collapse and a leading ./ is stripped", () => {
    // git never emits either form, so an anchor carrying them would never match.
    expect(normalizeAnchorPath("src//tools///docs.ts")).toBe("src/tools/docs.ts");
    expect(normalizeAnchorPath("./src/index.ts")).toBe("src/index.ts");
    expect(normalizeAnchorPath(".\\src\\index.ts")).toBe("src/index.ts");
  });

  test("structured anchors are normalized, keeping symbol/lines intact", () => {
    const a = normalizeAnchor({ file: "src\\drift.ts", symbol: "computeDrift", lines: [10, 20] });
    expect(a).toEqual({ file: "src/drift.ts", symbol: "computeDrift", lines: [10, 20] });
  });

  test("effectiveAnchors normalizes legacy relatedFiles too", () => {
    // The real failure: Catryna's own docs stored Windows relatedFiles, so on a
    // Mac every one of them was reported as a broken anchor.
    const anchors = effectiveAnchors({
      anchors: [],
      relatedFiles: ["src\\index.ts", "frontend\\App.tsx"],
    });
    expect(anchors.map((a) => a.file)).toEqual(["src/index.ts", "frontend/App.tsx"]);
  });

  test("a Windows and a POSIX spelling of the same file dedupe to one anchor", () => {
    // Without normalization these are two distinct anchors, so the doc would be
    // diffed against a path that cannot exist on this platform.
    const anchors = effectiveAnchors({
      anchors: [{ file: "src\\storage.ts" }],
      relatedFiles: ["src/storage.ts"],
    });
    expect(anchors).toHaveLength(1);
    expect(anchors[0].file).toBe("src/storage.ts");
  });
});

describe("CRLF checkout tolerance", () => {
  const doc = [
    "---",
    "id: abc",
    'title: "Windows Authored"',
    'path: "backend/storage"',
    'tags: ["a"]',
    'relatedFiles: ["src\\\\storage.ts"]',
    "createdAt: 1",
    "updatedAt: 2",
    'createdBy: "claude-code"',
    "---",
    "",
    "# Heading",
    "",
    "Body text.",
    "",
  ].join("\n");

  test("LF and CRLF parse to the same metadata and blocks", () => {
    const lf = parseMdx(doc);
    const crlf = parseMdx(doc.replace(/\n/g, "\r\n"));

    // The regression: with CRLF the frontmatter regex failed, so title/path were
    // undefined and the YAML leaked into the body as text blocks.
    expect(crlf.metadata.title).toBe("Windows Authored");
    expect(crlf.metadata.path).toBe("backend/storage");
    expect(crlf.metadata).toEqual(lf.metadata);
    expect(crlf.blocks).toEqual(lf.blocks);
  });

  test("no stray carriage returns survive into block content", () => {
    const { blocks } = parseMdx(doc.replace(/\n/g, "\r\n"));
    for (const b of blocks) {
      const c = b.data.content;
      if (typeof c === "string") expect(c.includes("\r")).toBe(false);
    }
  });
});
