---
description: Start the Catryna docs viewer (local React app on :6969) for the human-readable view of this project's .docs/ folder
---

Start the Catryna Wikinelli documentation viewer so the user can browse this
project's `.docs/` folder in the browser.

Steps:

1. The viewer lives inside the installed Catryna plugin at
   `${CLAUDE_PLUGIN_ROOT}/frontend`. If `${CLAUDE_PLUGIN_ROOT}/frontend/node_modules`
   does not exist, run `bun install` in that directory first.
2. Start it in the background: `cd "${CLAUDE_PLUGIN_ROOT}/frontend" && bun run dev`
   (serves on http://localhost:6969).
3. Tell the user the viewer is up at http://localhost:6969 and which project's
   `.docs/` it is showing (the viewer's project selector can switch between
   sibling projects' `.docs/` folders).

If port 6969 is already in use, a viewer is likely already running — just give
the user the URL.
