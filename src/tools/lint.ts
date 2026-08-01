/**
 * Doc LINT surface — the structural question, exposed to an in-session agent.
 *
 * Deliberately its own module rather than folded into tools/drift.ts: drift asks
 * "has the code outgrown this doc?", lint asks "is this doc well-formed?". They
 * are different questions with different answers and different gates, and the
 * drift module has a contract test asserting exactly which tools it registers.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildLintJson, lintDocs } from "../lint";

export function registerLintTools(server: McpServer): void {
  server.tool(
    "lint_docs",
    {},
    async () => {
      try {
        const report = await lintDocs(process.cwd());
        return {
          content: [{ type: "text", text: JSON.stringify({
            success: !report.error,
            ...buildLintJson(report),
            hint: report.errors > 0
              ? "Fix these before verifying — `catryna verify` refuses to baseline a structurally malformed doc."
              : "Docs are well-formed. Separate from drift: run check_drift for whether the code moved.",
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
