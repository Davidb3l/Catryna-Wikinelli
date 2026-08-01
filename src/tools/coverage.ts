/**
 * Coverage MCP tools. The computation lives in src/coverage.ts so the viewer's
 * dev API answers with the same numbers — see that file for the design rules.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadIndex } from "../storage";
import { computeCoverage } from "../coverage";

export function registerCoverageTools(server: McpServer): void {
  // GET UNDOCUMENTED MODULES
  server.tool(
    "get_undocumented_modules",
    {
      rootDir: z.string().optional().describe("Root directory to scan (defaults to current directory)"),
    },
    async ({ rootDir }) => {
      const scanDir = rootDir || process.cwd();

      try {
        const index = await loadIndex();
        const report = await computeCoverage({ rootDir: scanDir, docs: index.docs });

        return {
          content: [{ type: "text", text: JSON.stringify({
            success: true,
            modules: report.undocumented.map(m => ({ ...m, hasDocumentation: false })),
            totalUndocumented: report.totalUndocumented,
            totalSourceFiles: report.totalModules,
            listed: report.undocumented.length,
            hint: "Use create_doc with relatedFiles (or precise `anchors`) to document these modules",
          }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        };
      }
    }
  );

  // GET DOC COVERAGE
  server.tool(
    "get_doc_coverage",
    {
      rootDir: z.string().optional().describe("Root directory to analyze"),
    },
    async ({ rootDir }) => {
      const scanDir = rootDir || process.cwd();

      try {
        const index = await loadIndex();
        const report = await computeCoverage({ rootDir: scanDir, docs: index.docs, limit: 20 });

        // Recency, kept from the original tool. `updatedAt` is edit time, not
        // verification time — a recently edited doc is not a verified one, which
        // is what `freshness` / `catryna drift` are for.
        const sorted = [...index.docs].sort((a, b) => b.updatedAt - a.updatedAt);
        const recentlyUpdated = sorted.slice(0, 5).map(d => ({
          path: d.path, title: d.title, file: `.docs/${d.path}.mdx`, updatedAt: d.updatedAt,
        }));
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const staleDocs = index.docs
          .filter(d => d.updatedAt < thirtyDaysAgo)
          .slice(0, 10)
          .map(d => ({
            path: d.path, title: d.title, file: `.docs/${d.path}.mdx`, updatedAt: d.updatedAt,
          }));

        return {
          content: [{ type: "text", text: JSON.stringify({
            success: true,
            report: {
              totalModules: report.totalModules,
              documentedModules: report.documentedModules,
              coveragePercent: report.coveragePercent,
              totalDocs: report.totalDocs,
              anchoringDocs: report.anchoringDocs,
              brokenAnchors: report.brokenAnchors,
              undocumentedFiles: report.undocumented.map(m => m.filePath),
              totalUndocumented: report.totalUndocumented,
              recentlyUpdated,
              staleDocs,
              docsFolder: ".docs/",
            },
          }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        };
      }
    }
  );
}
