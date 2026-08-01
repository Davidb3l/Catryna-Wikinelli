---
description: Start the Catryna docs viewer (local React app on :1307) for the human-readable view of this project's .docs/ folder
---

Start the Catryna Wikinelli documentation viewer so the user can browse this
project's `.docs/` folder in the browser.

Steps:

1. The viewer lives inside the installed Catryna plugin at
   `${CLAUDE_PLUGIN_ROOT}/frontend`. If `${CLAUDE_PLUGIN_ROOT}/frontend/node_modules`
   does not exist, run `bun install` in that directory first.
2. Start it in the background: `cd "${CLAUDE_PLUGIN_ROOT}/frontend" && bun run dev`
   (serves on http://localhost:1307, or `CATRYNA_VIEWER_PORT` if set).
3. Tell the user the viewer is up at that URL and which project's `.docs/` it is
   showing (the viewer's project selector can switch between sibling projects'
   `.docs/` folders).

The viewer binds its port strictly (`strictPort: true`) rather than drifting to
the next free one, because `catryna doctor` advertises that exact address to the
suite as its `ui`. So if the port is taken, startup **fails loudly** instead of
moving — that usually means a viewer is already running, so just give the user
the URL. To run on a different port, set `CATRYNA_VIEWER_PORT` (doctor follows
it automatically).
