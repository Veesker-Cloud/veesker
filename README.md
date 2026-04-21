# veesker

**The studio for Oracle 23ai vector search.**

A desktop app to connect, embed, index, search and build RAG on Oracle Database 23ai vectors — locally, with privacy by default.

> Status: `v0.0.1-bootstrap` — foundation only, no features yet. MVP target: **August 8, 2026**.

---

## What it is

Think *DBeaver focused on vectors* + *Postman for vector search*, dedicated exclusively to Oracle Database 23ai AI Vector Search.

## What it isn't

- Not a generic Oracle client (use DBeaver / SQL Developer for that)
- Not cloud, not SaaS — desktop only
- Not multi-database (Oracle 23ai only — that's the moat)

## MVP scope

1. Connection manager (Wallet support for Autonomous)
2. Schema browser focused on `VECTOR` columns
3. SQL editor (CodeMirror 6, Oracle syntax)
4. Vector inspector
5. Embedding playground (Ollama, local-first)
6. HNSW / IVF index manager
7. Similarity search UI
8. End-to-end RAG pipeline (PDF → chunk → embed → store → retrieve → generate)

## Stack

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (Rust) |
| Frontend | Svelte 5 + Vite + TypeScript |
| Editor | CodeMirror 6 |
| Oracle driver | `node-oracledb` Thin mode via Bun sidecar |
| App state | SQLite |
| Credentials | OS keychain |
| LLM | Ollama (default), multi-provider in v1.1 |

## Develop

Requires: [Bun](https://bun.sh), [Rust](https://rustup.rs), platform Tauri prereqs ([guide](https://tauri.app/start/prerequisites/)).

```bash
bun install
bun run tauri dev
```

## License

[MIT](LICENSE)
