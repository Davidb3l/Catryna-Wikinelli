<div align="center">

# 🐱 Catryna Wikinelli

**Meow! Your local-first, AI-powered documentation companion**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-fbf0df?logo=bun)](https://bun.sh)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript)](https://www.typescriptlang.org)

<img src="https://github.com/user-attachments/assets/placeholder-banner.png" alt="Catryna Wikinelli Banner" width="800" />

*Living documentation that purrs along with your codebase* 🐾

[Features](#-features) • [Quick Start](#-quick-start) • [MCP Tools](#-mcp-tools) • [Architecture](#-architecture) • [Contributing](#-contributing)

</div>

---

## ✨ Features

### 📚 Smart Documentation Viewer
- **Block-based editor** with rich content types (text, code, diagrams, whiteboards)
- **Full-text search** with fuzzy matching (Ctrl+K)
- **Version history** with diff viewer and one-click revert
- **Code embeds** that link directly to your editor (VS Code, Cursor, IntelliJ)

### 🤖 AI-Native with MCP Integration
Catryna speaks fluent AI! Built-in **Model Context Protocol (MCP)** tools let Claude Code and other AI agents:
- Create and update documentation automatically
- Generate architecture diagrams from code analysis
- Track documentation coverage across your codebase
- Trigger regeneration when source files change

### 🔄 Auto-Regeneration
- **File watcher** detects code changes in real-time
- **Git hooks** trigger doc updates on commit/push
- **Stale detection** flags outdated documentation
- **Coverage reports** show what needs documenting

### 🎨 Interactive Visuals
- **React Flow** diagrams for system architecture
- **tldraw** whiteboards for sketching ideas
- **Mermaid** support for code-defined diagrams
- Clean or sketchy whiteboard styles

### 🏠 Local-First Philosophy
- All data stored locally (SQLite/PostgreSQL)
- No cloud dependencies required
- Optional DragonflyDB caching for performance
- Works offline, syncs when connected

---

## 🚀 Quick Start

### Prerequisites
- [Bun](https://bun.sh) v1.0+ (or Node.js 20+)
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/catryna-wikinelli.git
cd catryna-wikinelli

# Install dependencies
bun install

# Start development servers
bun run dev
```

The app will be available at:
- **Frontend**: http://localhost:8080
- **GraphQL API**: http://localhost:4567/graphql

### Configuration

Create a `catryna.config.yaml` in your project root:

```yaml
# catryna.config.yaml
project:
  name: "My Project"
  root: "."

watch:
  include:
    - "src/**/*.ts"
    - "src/**/*.tsx"
  exclude:
    - "node_modules"
    - "dist"

database:
  type: "sqlite"  # or "postgres"
  path: ".catryna/docs.db"

ai:
  provider: "anthropic"
  model: "claude-sonnet-4-20250514"
```

---

## 🔧 MCP Tools

Catryna exposes these tools for AI agents via the Model Context Protocol:

| Tool | Description |
|------|-------------|
| `catryna_create_doc` | Create a new documentation page |
| `catryna_update_doc` | Update existing documentation |
| `catryna_search` | Full-text search across all docs |
| `catryna_get_doc` | Retrieve a specific document |
| `catryna_list_docs` | List all documentation pages |
| `catryna_delete_doc` | Remove a documentation page |
| `catryna_add_diagram` | Add a React Flow diagram |
| `catryna_add_whiteboard` | Add a tldraw whiteboard |
| `catryna_get_coverage` | Get documentation coverage report |
| `catryna_trigger_regen` | Manually trigger regeneration |

### Claude Code Integration

Add to your `claude_code_config.json`:

```json
{
  "mcpServers": {
    "catryna": {
      "command": "bun",
      "args": ["run", "mcp"],
      "cwd": "/path/to/catryna-wikinelli"
    }
  }
}
```

---

## 🏗 Architecture

```
catryna-wikinelli/
├── apps/
│   ├── server/          # Bun backend with GraphQL Yoga
│   │   ├── src/
│   │   │   ├── db/      # Drizzle ORM schemas
│   │   │   ├── graphql/ # GraphQL resolvers
│   │   │   ├── mcp/     # MCP tool handlers
│   │   │   └── watcher/ # File change detection
│   │   └── ...
│   └── web/             # Vite + React frontend
│       ├── src/
│       │   ├── components/
│       │   ├── routes/  # TanStack Router pages
│       │   └── lib/     # GraphQL client, hooks
│       └── ...
├── packages/
│   ├── shared/          # Shared types and utilities
│   └── mcp-client/      # MCP client for external use
└── catryna.config.yaml
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Bun |
| Frontend | React 19, Vite, TanStack Router/Query |
| Backend | GraphQL Yoga, Drizzle ORM |
| Database | SQLite / PostgreSQL |
| Cache | DragonflyDB (optional) |
| Diagrams | React Flow, tldraw, Mermaid |
| Editor | TipTap |
| Styling | Tailwind CSS |

---

## 📖 Block Types

Catryna supports these content block types:

| Type | Description |
|------|-------------|
| `text` | Rich text with markdown support |
| `heading` | H1-H6 headings |
| `code` | Syntax-highlighted code blocks |
| `code-embed` | Live code from your files with editor links |
| `callout` | Info, warning, error, success callouts |
| `react-flow` | Interactive architecture diagrams |
| `whiteboard` | Freeform tldraw canvas |
| `mermaid` | Code-defined diagrams |
| `table` | Data tables with headers |
| `divider` | Horizontal separator |

---

## 🎯 Roadmap

### MVP (v1.0) ✅
- [x] Documentation viewer with block editor
- [x] MCP tool integration
- [x] Full-text search
- [x] Version history
- [x] Code linking
- [x] User preferences

### v1.5 (Current)
- [x] Git hook integration
- [x] Coverage reporting
- [x] Diff viewer
- [x] DragonflyDB caching

### v2.0 (Planned)
- [ ] Real-time collaboration
- [ ] Custom block plugins
- [ ] Documentation templates
- [ ] Export to static site (Docusaurus, VitePress)
- [ ] GitHub/GitLab integration

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) first.

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
