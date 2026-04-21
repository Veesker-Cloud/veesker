# Connection Manager MVP1 — Spec

> Subset of the Veesker MVP. Covers Roadmap Saturday 02/Mai task: "Connection form + node-oracledb sidecar JSON-RPC".

## Goal

Let a user enter Oracle Database 23ai connection credentials in the Veesker app and verify the connection works. No persistence, no Wallet, no schema browsing yet.

## In scope

- A Bun sidecar process spawned by Tauri that exposes a JSON-RPC 2.0 protocol over stdin/stdout
- One sidecar method: `connection.test` — opens a connection, runs `SELECT 1 FROM DUAL`, closes, reports outcome
- A Tauri command `connection_test` that proxies to the sidecar
- A Svelte connection form with: host, port, service name, username, password (basic auth only)
- A "Test connection" button that invokes the command and shows success/error feedback

## Out of scope (later tasks)

- Wallet support (Saturday 09/Mai)
- Persistence to SQLite + OS keychain (deferred)
- Schema browser (Saturday 16/Mai)
- SQL editor, query execution, vector inspector, etc.

## Architecture

```
┌─────────────────┐       ┌──────────────┐       ┌─────────────┐
│  Svelte form    │  IPC  │ Tauri (Rust) │ stdio │ Bun sidecar │
│  +page.svelte   │ ────▶ │   commands   │ ────▶ │  (JSON-RPC) │
└─────────────────┘       └──────────────┘       └──────┬──────┘
                                                        │ node-oracledb (Thin)
                                                        ▼
                                                  Oracle 23ai
```

- Tauri spawns the sidecar binary at app startup as a long-running child process
- Communication: JSON-RPC 2.0 framed by newline (one JSON object per line)
- Sidecar uses `node-oracledb` v6+ in **Thin mode** (pure JS, no Instant Client required)
- Each connection test opens a fresh Oracle connection — no pooling yet
- All credentials live only in memory during the request; not persisted

## Tech decisions

- **Sidecar build:** `bun build --compile` to produce a self-contained native binary in `src-tauri/binaries/veesker-sidecar-<target-triple>` so Tauri's sidecar mechanism can bundle it
- **JSON-RPC framing:** newline-delimited JSON (NDJSON) — simple, no MIME headers, easy to debug with `cat`
- **Error model:** sidecar returns `{ error: { code, message, data } }`; Tauri command surfaces a typed `Result<TestOk, TestErr>` to the frontend

## Success criteria

1. User runs `bun run tauri dev`, app opens
2. Form is visible (replaces bootstrap landing)
3. User enters credentials of an Oracle 23ai Free Tier and clicks "Test connection"
4. Within 5s, UI shows green check + Oracle version string, OR red error + message
5. Killing the app process also kills the sidecar process (no zombies)

## Manual test target

Oracle 23ai Always Free Autonomous Database (basic auth disabled by default — for this MVP1 we test against a local Oracle 23ai Free container or any 23ai instance with basic auth enabled).
