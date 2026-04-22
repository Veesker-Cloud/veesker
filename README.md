<div align="center">

<img src="static/veesker-sheep.png" width="96" alt="Veesker mascot — cyberpunk sheep" />

# Veesker

**The Oracle 23ai IDE with a soul.**

A native desktop studio for Oracle Database — schema browser, SQL editor, PL/SQL IDE, query history, and an AI assistant that actually knows your database.

[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8D8?logo=tauri&logoColor=white)](https://tauri.app)
[![Svelte 5](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev)
[![Oracle 23ai](https://img.shields.io/badge/Oracle-23ai-F80000?logo=oracle&logoColor=white)](https://oracle.com)

> Status: **early access** — core IDE is functional, vector search features coming next.

</div>

---

## What it is

Veesker is a desktop Oracle client built for developers who want **speed, keyboard control, and AI help** — not another heavy Java GUI. It runs natively on macOS (Windows/Linux planned), connects directly to Oracle via the Thin driver (no Oracle Client install required), and ships with a cyberpunk sheep mascot named Veesker.

Think *DBeaver's schema browser* + *DataGrip's SQL editor* + *an AI that can query your DB in real time* — focused exclusively on Oracle 23ai.

## What it isn't

- Not a generic multi-database client (use DBeaver for that)
- Not cloud or SaaS — your data never leaves your machine
- Not trying to replace SQL Developer for every use case

---

## Features

### Schema Browser
- Expandable schema tree with live object counts per kind (TABLE, VIEW, SEQUENCE, PROCEDURE, FUNCTION, PACKAGE, TRIGGER, TYPE)
- **⌘K Command Palette** — fuzzy search across all objects in the database instantly
- Object details: columns, indexes, constraints, grants, statistics
- FK graph with arrow-style reference rows — click any related table to navigate to it
- DataFlow graph — visual dependency map for any object
- Navigation history with ← back button
- Resizable panels (drag any divider)

### SQL Editor
- CodeMirror 6 with Oracle syntax highlighting
- **Multi-statement execution** — run all, run cursor statement, or run selection
- Execution log with per-statement results, row counts, and timings
- Inline ORA-XXXXX / PLS-XXXXX error formatting
- Sortable result grid with CSV and JSON export
- File open/save (⌘O / ⌘S / ⌘Shift+S)
- Multiple tabs (⌘W to close, ⌘T for new)
- Commit / Rollback buttons with pending-TX badge
- Query history panel with search (SQLite-backed, persisted across sessions)
- Resizable editor/results split

### PL/SQL IDE
- DDL viewer for procedures, functions, packages, triggers, types
- DBMS_OUTPUT capture
- Compile with inline error markers
- Keyboard shortcuts for all actions

### AI Assistant — Veesker AI 🐑
- Side panel (⌘I) with the cyberpunk sheep persona
- Powered by Claude (API key or local Claude Code install — no key needed)
- **Live database tools**: describe tables, run SELECT queries, fetch DDL, list objects — the AI queries your actual database to answer questions
- Context-aware: knows your current schema, selected object, and active SQL
- Markdown rendering with syntax-highlighted code blocks

---

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) (Rust) |
| Frontend | [SvelteKit](https://kit.svelte.dev) + Svelte 5 runes + TypeScript |
| SQL editor | [CodeMirror 6](https://codemirror.net) |
| Oracle driver | [`node-oracledb`](https://node-oracledb.readthedocs.io) Thin mode via Bun sidecar |
| App state | SQLite (via Tauri plugin) |
| Credentials | OS keychain (Tauri plugin) |
| AI | [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) / Claude API / Claude Code |

The Oracle driver runs in a **Bun sidecar** — a small TypeScript process that communicates with the Rust shell via JSON-RPC over stdin/stdout. This sidesteps the native binding problem for Oracle clients inside Tauri.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- [Rust](https://rustup.rs) (stable)
- Tauri platform prerequisites → [guide](https://tauri.app/start/prerequisites/)
- Oracle Database 23ai (local Docker or remote)

### Run in dev mode

```bash
git clone https://github.com/geeviana/veesker.git
cd veesker

bun install
cd sidecar && bun install && cd ..

bun run tauri dev
```

### Build for production

```bash
# Build the sidecar binary first
cd sidecar && bun run build && cd ..

# Then build the Tauri app
bun run tauri build
```

---

## AI Assistant setup

Veesker AI works out of the box if you have **[Claude Code](https://claude.ai/code) installed** — it uses your existing OAuth session, no API key required.

Alternatively, open the settings gear (⚙) in the chat panel and paste your `sk-ant-...` Anthropic API key. It's stored in browser localStorage, never sent anywhere except directly to the Anthropic API.

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| ⌘K | Command palette — search all objects |
| ⌘I | Toggle AI assistant |
| ⌘J | Toggle SQL drawer |
| ⌘Enter | Run SQL at cursor |
| ⌘Shift+Enter | Run all statements |
| ⌘. | Cancel running query |
| ⌘S / ⌘Shift+S | Save / Save As |
| ⌘O | Open SQL file |
| ⌘W | Close active tab |

---

## Roadmap

The core IDE is functional. Next up:

- [ ] **Vector Search Studio** — the original vision: embed, index, inspect, and query Oracle 23ai `VECTOR` columns
- [ ] **Embedding playground** — connect to Ollama or OpenAI, generate embeddings, store them with one click
- [ ] **HNSW / IVF index manager** — visual index creation and tuning
- [ ] **Similarity search UI** — test vector queries with natural language inputs
- [ ] **RAG pipeline builder** — PDF → chunk → embed → store → retrieve → generate, end-to-end in the UI
- [ ] **OpenAI / Ollama providers** for the AI assistant (currently Claude-only)
- [ ] **Windows and Linux** builds

---

## Project structure

```
veesker/
├── src/                        # SvelteKit frontend
│   ├── routes/workspace/       # Main IDE workspace
│   └── lib/
│       ├── workspace/          # UI components
│       └── stores/             # Svelte 5 state (sql-editor, connections)
├── sidecar/                    # Bun TypeScript sidecar
│   └── src/
│       ├── index.ts            # JSON-RPC handler
│       ├── oracle.ts           # All Oracle queries
│       └── ai.ts               # Claude AI integration
├── src-tauri/                  # Tauri Rust shell
│   └── src/
│       ├── commands.rs         # Tauri commands
│       └── lib.rs              # App setup, sidecar spawn
└── static/
    └── veesker-sheep.png       # The mascot 🐑
```

---

## Contributing

This is early-stage software — issues and pull requests welcome. If you're building on Oracle 23ai and want a better tooling experience, come help.

---

## License

[MIT](LICENSE) — free to use, fork, and build on.

---

<div align="center">
  <sub>Built with care (and a cyberpunk sheep) by <a href="https://github.com/geeviana">@geeviana</a></sub>
</div>
