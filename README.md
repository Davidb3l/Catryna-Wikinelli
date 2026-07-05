<div align="center">

# 🐱 Catryna Wikinelli

**Meow! Your local-first, AI-powered documentation companion**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-fbf0df?logo=bun)](https://bun.sh)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)](https://www.typescriptlang.org)

*Living documentation that purrs along with your codebase* 🐾

[Features](#-features) • [Quick Start](#-quick-start) • [How It Works](#-how-it-works) • [MCP Tools](#-mcp-tools) • [Contributing](#-contributing)

</div>

---

## ✨ Features

### 🤖 Built for AI + Humans
Catryna bridges the gap between AI coding agents and human developers:
- **Claude reads docs directly** from `.docs/` folder (no MCP needed)
- **Claude writes docs** via MCP tools (`create_doc`, `update_doc`)
- **Humans view docs** in a beautiful React viewer at `localhost:6969`
- **Git-versioned** - docs travel with your codebase

### 📚 Smart Documentation Viewer
- **Block-based editor** with rich content types (text, code, diagrams, whiteboards)
- **Full-text search** with fuzzy matching (Ctrl+K)
- **Version history** with diff viewer and one-click revert
- **Code embeds** that link directly to your editor (VS Code, Cursor, IntelliJ)

### 🎨 Interactive Visuals
- **React Flow** diagrams for system architecture
- **tldraw** whiteboards for sketching ideas
- **Mermaid** support for code-defined diagrams
- Clean or sketchy whiteboard styles

### 🏠 Local-First & Simple
- **File-based storage** - docs are `.mdx` files in `.docs/` folder
- **No database required** - just files and a JSON index
- **No cloud dependencies** - works offline
- **Git-friendly** - docs are versioned with your code

---

## 🚀 Quick Start

### Prerequisites
- [Bun](https://bun.sh) v1.0+
- Git

### ⚡ One-command install (Claude Code plugin — recommended)

Inside Claude Code:

```
/plugin marketplace add Davidb3l/Catryna-Wikinelli
/plugin install catryna@catryna-wikinelli
```

That's it. The plugin ships:
- **The Catryna MCP server** — auto-registered, self-installs its deps on
  first run, and stores docs in the `.docs/` folder of **whatever project
  you're working in** (per-project docs, one install).
- **The `catryna` Agent Skill** — teaches Claude to search `.docs/` before
  coding and update docs after changing the code they describe.
- **`/catryna:viewer`** — slash command that starts the human docs viewer on
  `localhost:6969`.

Works in any repo, for any Claude Code session, with zero per-project config.

### Manual installation (non-Claude agents / development)

```bash
# Clone the repository
git clone https://github.com/Davidb3l/Catryna-Wikinelli.git
cd Catryna-Wikinelli

# Install dependencies
bun install

# Install frontend dependencies
cd frontend && bun install && cd ..
```

### Running

**Terminal 1 - MCP Server (for Claude Code):**
```bash
bun run start
```

**Terminal 2 - Frontend Viewer (for humans):**
```bash
cd frontend && bun run dev
# Opens http://localhost:6969
```

### Add to Claude Code

Create `.mcp.json` in your project root (or add to `~/.claude.json` for global):

```json
{
  "mcpServers": {
    "catryna": {
      "command": "bun",
      "args": ["run", "/path/to/Catryna-Wikinelli/src/index.ts"],
      "cwd": "/path/to/Catryna-Wikinelli"
    }
  }
}
```

> ⚠️ **Note:** `.claude/settings.json` is ignored! Use `.mcp.json` or `~/.claude.json`.

Restart Claude Code, then use `/mcp` to verify the server is connected.

---

## 🔄 How It Works

```
┌─────────────────┐         ┌─────────────────┐
│   Claude Code   │         │  Human Viewer   │
│                 │         │  localhost:6969 │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │ MCP: create_doc           │ HTTP: /api/docs
         │ MCP: update_doc           │
         │ Read: .docs/*.mdx         │
         │                           │
         ▼                           ▼
┌─────────────────────────────────────────────┐
│              .docs/ folder                  │
│  ├── _index.json      (doc index)          │
│  ├── getting-started.mdx                   │
│  ├── modules/                              │
│  │   └── auth.mdx                          │
│  └── architecture/                         │
│      └── database.mdx                      │
└─────────────────────────────────────────────┘
```

**Key insight:** Docs are stored as files, so Claude can read them directly. MCP tools are only needed for creating/updating docs.

---

## 🔧 MCP Tools

| Tool | Description |
|------|-------------|
| `create_doc` | Create a new doc → `.docs/{path}.mdx` |
| `get_doc` | Retrieve a document by path |
| `list_docs` | List all docs with optional filtering |
| `update_doc` | Update an existing document |
| `delete_doc` | Delete a document |
| `search_docs` | Full-text search across docs |
| `create_diagram` | Create a React Flow diagram |
| `create_whiteboard` | Create a tldraw whiteboard |
| `get_undocumented_modules` | List source files without docs |
| `get_doc_coverage` | Get documentation coverage report |

### Example Usage in Claude Code

```
# List existing docs
> list_docs

# Read a doc directly (no MCP needed!)
> Read .docs/modules/auth.mdx

# Create a new doc
> create_doc path="modules/auth" title="Authentication" content=[...]

# Search for docs
> search_docs query="authentication"
```

---

## 🏗 Architecture

```
catryna-wikinelli/
├── .docs/                    # Documentation files (git-tracked)
│   ├── _index.json           # Index of all docs
│   └── *.mdx                 # Individual doc files
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── storage.ts            # File-based storage layer
│   └── tools/
│       ├── docs.ts           # Document CRUD tools
│       ├── search.ts         # Full-text search
│       ├── diagrams.ts       # React Flow & tldraw
│       └── coverage.ts       # Documentation coverage
├── frontend/                 # Vite + React viewer
│   ├── App.tsx               # Main app component
│   ├── hooks/useDocs.ts      # Data fetching hooks
│   └── vite.config.ts        # Vite config with API plugin
├── package.json
└── .mcp.json                 # Claude Code MCP config
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Bun |
| MCP SDK | @modelcontextprotocol/sdk |
| Storage | File-based (.docs/*.mdx) |
| Frontend | React 19, Vite |
| Diagrams | React Flow, tldraw |
| Styling | Tailwind CSS |

---

## 📖 Block Types

Docs are stored as MDX files with these block types:

| Type | Description |
|------|-------------|
| `heading` | H1-H6 headings |
| `text` | Rich text paragraphs |
| `code` | Syntax-highlighted code blocks |
| `callout` | Info, warning, error boxes |
| `react-flow` | Interactive architecture diagrams |
| `whiteboard` | Freeform tldraw canvas |
| `mermaid` | Code-defined diagrams |
| `table` | Data tables |
| `divider` | Horizontal separator |

---

## 🤝 Contributing

Contributions are welcome!

```bash
# Fork and clone
git clone https://github.com/yourusername/catryna-wikinelli.git

# Create a feature branch
git checkout -b feature/amazing-feature

# Make your changes and commit
git commit -m "Add amazing feature"

# Push and create a PR
git push origin feature/amazing-feature
```

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">

**Meow 🐱**

Made with ❤️ by the Catryna Wikinelli contributors

*Purrfect documentation, every time*

</div>
