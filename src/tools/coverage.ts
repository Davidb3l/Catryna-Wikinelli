import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadIndex } from "../storage";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

// Default patterns for source files
const SOURCE_PATTERNS = [
  /\.tsx?$/,
  /\.jsx?$/,
  /\.py$/,
  /\.go$/,
  /\.rs$/,
];

const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.test\./,
  /\.spec\./,
  /dist\//,
  /build\//,
  /__pycache__/,
  /\.docs\//,
];

async function findSourceFiles(dir: string, rootDir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(rootDir, fullPath);

      // Skip excluded paths
      if (EXCLUDE_PATTERNS.some(p => p.test(relativePath))) {
        continue;
      }

      if (entry.isDirectory()) {
        const subFiles = await findSourceFiles(fullPath, rootDir);
        files.push(...subFiles);
      } else if (SOURCE_PATTERNS.some(p => p.test(entry.name))) {
        files.push(relativePath);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files;
}

export function registerCoverageTools(server: McpServer): void {
  // GET UNDOCUMENTED MODULES
  server.tool(
    "get_undocumented_modules",
    {
      rootDir: z.string().optional().describe("Root directory to scan (defaults to current directory)"),
      patterns: z.array(z.string()).optional().describe("Glob patterns to include"),
    },
    async ({ rootDir }) => {
      const scanDir = rootDir || process.cwd();

      try {
        // Find all source files
        const sourceFiles = await findSourceFiles(scanDir, scanDir);

        // Get all documented files from index
        const index = await loadIndex();
        const documentedFiles = new Set<string>();

        for (const doc of index.docs) {
          for (const file of doc.relatedFiles) {
            documentedFiles.add(file);
          }
        }

        // Find undocumented files
        const undocumented = sourceFiles.filter(f => !documentedFiles.has(f));

        // Get file info
        const modules = await Promise.all(
          undocumented.slice(0, 50).map(async (filePath) => {
            try {
              const fullPath = join(scanDir, filePath);
              const stats = await stat(fullPath);
              return {
                filePath,
                name: filePath.split("/").pop() || filePath,
                lastModified: stats.mtime.getTime(),
                hasDocumentation: false,
              };
            } catch {
              return {
                filePath,
                name: filePath.split("/").pop() || filePath,
                lastModified: 0,
                hasDocumentation: false,
              };
            }
          })
        );

        return {
          content: [{ type: "text", text: JSON.stringify({
            success: true,
            modules,
            totalUndocumented: undocumented.length,
            totalSourceFiles: sourceFiles.length,
            hint: "Use create_doc with relatedFiles to document these modules",
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
        // Find all source files
        const sourceFiles = await findSourceFiles(scanDir, scanDir);

        // Get all docs from index
        const index = await loadIndex();
        const docs = index.docs;

        // Get documented files
        const documentedFiles = new Set<string>();
        for (const doc of docs) {
          for (const file of doc.relatedFiles) {
            documentedFiles.add(file);
          }
        }

        const totalModules = sourceFiles.length;
        const documentedModules = sourceFiles.filter(f => documentedFiles.has(f)).length;
        const coveragePercent = totalModules > 0
          ? Math.round((documentedModules / totalModules) * 100)
          : 0;

        // Find recently updated docs
        const sortedDocs = [...docs].sort((a, b) => b.updatedAt - a.updatedAt);
        const recentlyUpdated = sortedDocs.slice(0, 5).map(d => ({
          path: d.path,
          title: d.title,
          file: `.docs/${d.path}.mdx`,
          updatedAt: d.updatedAt,
        }));

        // Find stale docs (not updated in 30 days)
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const staleDocs = docs
          .filter(d => d.updatedAt < thirtyDaysAgo)
          .slice(0, 10)
          .map(d => ({
            path: d.path,
            title: d.title,
            file: `.docs/${d.path}.mdx`,
            updatedAt: d.updatedAt,
          }));

        // Find undocumented files
        const undocumentedFiles = sourceFiles
          .filter(f => !documentedFiles.has(f))
          .slice(0, 20);

        return {
          content: [{ type: "text", text: JSON.stringify({
            success: true,
            report: {
              totalModules,
              documentedModules,
              coveragePercent,
              totalDocs: docs.length,
              undocumentedFiles,
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
