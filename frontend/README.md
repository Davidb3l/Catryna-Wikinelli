# Catryna Wikinelli — Viewer

The human-facing half of Catryna: a local React app that renders the `.docs/`
folder Claude Code writes through MCP. Claude reads those `.mdx` files
directly; this is how people read them.

## Run locally

**Prerequisites:** [Bun](https://bun.sh)

1. Install dependencies:
   `bun install`
2. Run the viewer:
   `bun run dev`

Opens on <http://localhost:1307>. Override with `CATRYNA_VIEWER_PORT` — the
port is `strictPort`, so it fails loudly rather than drifting off the address
`catryna doctor` advertises.

By default the viewer serves the `.docs/` folder of the repo above it. Point it
at another project with `DOCS_ROOT`, or switch projects from the in-app picker.

## Notes

There is no backend to configure and no API key to set: the viewer is a
read-only window onto files on disk, served by a dev-only Vite plugin
(`docsApiPlugin` in [vite.config.ts](vite.config.ts)). Docs are created and
updated by Claude Code through the MCP server, not from this UI.
