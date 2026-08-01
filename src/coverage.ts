/**
 * Coverage core (PRODUCT_ROADMAP Phase 2, item 3 — "coverage report v2").
 *
 * Extracted out of src/tools/coverage.ts so ONE implementation answers the
 * question everywhere it is asked: the MCP tools, and the viewer's dev API. The
 * viewer previously had no answer at all and rendered hardcoded placeholders.
 *
 * Two deliberate design rules, both learned from bugs:
 *
 *  1. **No `process.cwd()`.** Every root is an explicit parameter. The viewer's
 *     dev server runs with `cwd = frontend/`, and its docs root is switchable at
 *     runtime via `POST /api/projects/select` — so anything resolving paths from
 *     the current directory silently reports on the wrong project.
 *  2. **Docs come in as data.** Callers supply the already-loaded index, so this
 *     module never decides where `.docs/` lives. Same reason.
 *
 * Coverage counts EFFECTIVE anchors (`effectiveAnchors`), not bare
 * `relatedFiles`. The old implementation read `relatedFiles` only, so a doc that
 * anchored precisely — `anchors: [{file, symbol}]` — drifted correctly but did
 * not count as documenting anything. Precision made your coverage look worse.
 */

import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { effectiveAnchors, normalizeAnchorPath, type DocMetadata } from "./storage";

/** File extensions treated as documentable source. */
const SOURCE_PATTERNS = [/\.tsx?$/, /\.jsx?$/, /\.py$/, /\.go$/, /\.rs$/];

/**
 * Paths never counted. Tests and build output are not undocumented modules, and
 * counting them makes coverage permanently unreachable.
 */
const EXCLUDE_PATTERNS = [
  /(^|\/)node_modules(\/|$)/,
  /\.test\./,
  /\.spec\./,
  /(^|\/)dist(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)__pycache__(\/|$)/,
  /(^|\/)\.docs(\/|$)/,
  /(^|\/)\.git(\/|$)/,
];

/** One undocumented source file. */
export interface UndocumentedModule {
  filePath: string;
  name: string;
  lastModified: number;
}

/** A doc that anchors code, with how much of it is still verified. */
export interface CoverageReport {
  /** Source files found under `rootDir`, after exclusions. */
  totalModules: number;
  /** Source files anchored by at least one doc. */
  documentedModules: number;
  /** `documentedModules / totalModules`, 0..100. 0 when there is no source. */
  coveragePercent: number;
  /** Docs in the index (all of them, anchored or not). */
  totalDocs: number;
  /** Docs that anchor at least one file — the ones coverage can credit. */
  anchoringDocs: number;
  /**
   * Anchored paths that do not exist on disk. These are the same broken anchors
   * `catryna drift` reports red, surfaced here because they inflate nothing:
   * a doc pointing at a deleted file documents no module.
   */
  brokenAnchors: string[];
  undocumented: UndocumentedModule[];
  totalUndocumented: number;
  generatedAt: number;
}

/** Should this relative path be scanned? */
function isExcluded(relativePath: string): boolean {
  const p = relativePath.split(sep).join("/");
  return EXCLUDE_PATTERNS.some((r) => r.test(p));
}

/**
 * Recursively collect source files under `dir`, returned as paths relative to
 * `rootDir` with forward slashes — the same shape anchors use, so the two sets
 * can be compared directly on every platform.
 */
export async function findSourceFiles(dir: string, rootDir: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files; // unreadable directory is not an error here
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(rootDir, fullPath);
    if (isExcluded(relativePath)) continue;

    if (entry.isDirectory()) {
      files.push(...(await findSourceFiles(fullPath, rootDir)));
    } else if (SOURCE_PATTERNS.some((p) => p.test(entry.name))) {
      files.push(relativePath.split(sep).join("/"));
    }
  }
  return files;
}

/**
 * Every source path anchored by any doc, normalized. Uses `effectiveAnchors`, so
 * both legacy `relatedFiles` and precise `anchors` count.
 */
export function anchoredFiles(docs: DocMetadata[]): Set<string> {
  const out = new Set<string>();
  for (const doc of docs) {
    for (const a of effectiveAnchors(doc)) out.add(normalizeAnchorPath(a.file));
  }
  return out;
}

/**
 * Compute a coverage report.
 *
 * `rootDir` is the source tree to scan; `docs` is the already-loaded index.
 * `limit` caps the returned `undocumented` sample (the COUNT is always exact —
 * only the listing is truncated, so a caller can never mistake a capped list for
 * the whole problem).
 */
export async function computeCoverage(opts: {
  rootDir: string;
  docs: DocMetadata[];
  limit?: number;
}): Promise<CoverageReport> {
  const { rootDir, docs } = opts;
  const limit = opts.limit ?? 50;

  const sourceFiles = await findSourceFiles(rootDir, rootDir);
  const anchored = anchoredFiles(docs);
  const sourceSet = new Set(sourceFiles);

  const documented = sourceFiles.filter((f) => anchored.has(f));
  const undocumentedPaths = sourceFiles.filter((f) => !anchored.has(f));

  // An anchor pointing at a path that isn't on disk. Excluded source (a test
  // file, say) is legitimately anchorable, so only flag paths that are neither
  // present as scanned source nor present on disk at all.
  const brokenAnchors: string[] = [];
  for (const a of anchored) {
    if (sourceSet.has(a)) continue;
    try {
      await stat(join(rootDir, a));
    } catch {
      brokenAnchors.push(a);
    }
  }
  brokenAnchors.sort();

  const undocumented = await Promise.all(
    undocumentedPaths.slice(0, limit).map(async (filePath) => {
      let lastModified = 0;
      try {
        lastModified = (await stat(join(rootDir, filePath))).mtime.getTime();
      } catch {
        // Raced with a delete; report it with an unknown mtime rather than drop it.
      }
      return { filePath, name: filePath.split("/").pop() || filePath, lastModified };
    }),
  );

  return {
    totalModules: sourceFiles.length,
    documentedModules: documented.length,
    coveragePercent:
      sourceFiles.length > 0 ? Math.round((documented.length / sourceFiles.length) * 100) : 0,
    totalDocs: docs.length,
    anchoringDocs: docs.filter((d) => effectiveAnchors(d).length > 0).length,
    brokenAnchors,
    undocumented,
    totalUndocumented: undocumentedPaths.length,
    generatedAt: Date.now(),
  };
}
