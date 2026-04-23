# Veesker — Architecture

## Overview

Veesker is a Tauri 2 desktop application composed of three cooperating processes. The Rust shell — the Tauri binary — owns the window, the OS keychain, the local SQLite database, and the lifecycle of all other processes. Inside the window runs a SvelteKit frontend built with Svelte 5 runes, served either from the Vite dev server (development) or from the bundled `frontendDist` (production). The third process is a Bun sidecar: a standalone TypeScript binary that holds the Oracle connection via `node-oracledb` Thin mode, executes all SQL and metadata queries, and integrates with the Anthropic SDK for AI chat. The Rust shell and the Bun sidecar communicate exclusively via JSON-RPC messages over the sidecar's stdin/stdout — no network ports opened. Every secret (Oracle password, wallet password, Anthropic API key) passes through the OS keychain and is never written to disk in plaintext. Every piece of structured application state — saved connections, query history — lives in a local SQLite database managed by the Rust layer.

---

## Process Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Tauri 2 — Main Process (Rust)                                      │
│                                                                     │
│  ┌────────────────────────────┐   ┌────────────────────────────┐   │
│  │  SvelteKit Frontend        │   │  Rust Commands             │   │
│  │  (WebView / WKWebView)     │   │  (commands.rs)             │   │
│  │                            │   │                            │   │
│  │  Svelte 5 runes            │   │  keychain read/write       │   │
│  │  CodeMirror 6              │   │  SQLite (rusqlite)         │   │
│  │  VectorScatter (PCA)       │   │  connection CRUD           │   │
│  │  SheepChat                 │   │  query history             │   │
│  └────────────┬───────────────┘   └────────────┬───────────────┘   │
│               │  Tauri IPC (invoke)             │                   │
│               └──────────────┬──────────────────┘                   │
│                              │  JSON-RPC over stdin/stdout          │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  Bun Sidecar — Subprocess (TypeScript)                              │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  oracle.ts   │  │  ai.ts       │  │  embedding.ts            │  │
│  │              │  │              │  │                          │  │
│  │  node-       │  │  Anthropic   │  │  Ollama (local)          │  │
│  │  oracledb    │  │  SDK         │  │  OpenAI                  │  │
│  │  Thin mode   │  │  tool calls  │  │  Voyage AI               │  │
│  │              │  │              │  │  Custom endpoint         │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
└─────────┼────────────────┼────────────────────────┼────────────────┘
          │                │                        │
          ▼                ▼                        ▼
  ┌───────────────┐  ┌────────────────┐  ┌──────────────────────┐
  │  Oracle 23ai  │  │  Anthropic API │  │  Embedding providers │
  │  (remote/     │  │  (HTTPS)       │  │  (Ollama local HTTP, │
  │   Docker)     │  │                │  │   OpenAI HTTPS, etc) │
  └───────────────┘  └────────────────┘  └──────────────────────┘
```

---

## Why Tauri 2 (not Electron)

The two obvious alternatives were Electron and a native toolkit (Qt or GTK via Rust bindings). Native was ruled out early: implementing a SQL editor, a scrollable result grid, and a vector scatter plot in a native widget toolkit would take months longer than using the web platform, with minimal user-visible benefit on modern hardware.

Electron was the stronger contender. It is battle-tested, has a large ecosystem, and is used by VS Code, Slack, and many others. The case against it is concrete: Electron ships a full Chromium runtime with every app, adding 150–200MB to the install size and a persistent memory overhead of 100–200MB per instance. It also expands the security surface significantly — every Electron app carries the full Chromium attack surface regardless of what the app itself does. For a tool that holds live Oracle credentials, that trade-off is hard to justify.

Tauri uses the OS-native WebView instead — WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux. The Rust binary is small; total install size for a Tauri app is typically 10–20MB. The security surface is narrower, and the CSP model applies directly to the WebView. Tauri 2 added a cleaner plugin system compared to Tauri 1 and improved the cross-platform build story. The trade-off is real: WKWebView and WebView2 do not behave identically in all CSS and JavaScript edge cases, and the Rust learning curve is genuine for engineers coming from a JavaScript background. For Veesker's scope and security requirements, the Tauri trade-off is the right one.

---

## Why Svelte 5 (not React or Vue)

Svelte is a compiler, not a runtime library. The framework code does not ship to the user — what ships is the compiled output of the component templates, which is lean and fast. For a desktop app where startup time and bundle size matter, this matters more than it does for a server-rendered web app that can lazy-load its framework from a CDN.

Svelte 5 introduced runes: `$state`, `$derived`, and `$effect`. These replace the old reactive store pattern with something closer to signals — a simpler mental model that eliminates most of the subscription boilerplate. A piece of state is just a variable marked with `$state`; derived values compose naturally with `$derived`; side effects are explicit with `$effect`. Compared to React's `useState` + `useEffect` + custom hooks, the cognitive overhead for a component author is lower, and the compiled output is smaller.

The trade-off versus React is the ecosystem: fewer pre-built components, a smaller community, and less Stack Overflow coverage. For Veesker, which builds almost every UI component from scratch (the schema tree, the result grid, the scatter plot, the SQL drawer), this is not a significant constraint. The CodeMirror 6 integration, the most complex third-party UI piece, has first-class TypeScript bindings that work cleanly in any framework.

---

## Why Bun Sidecar — The Core Architectural Decision

This section explains the most important structural choice in the project, and the reasoning behind it.

### The core problem

Tauri is a Rust application. It does not run a Node.js or JavaScript runtime in-process. Rust has no mature Oracle driver — there is no `oracle-rs` equivalent to `node-oracledb` for production use. The Oracle ecosystem for application drivers has two realistic choices: the JDBC driver (Java), and `node-oracledb` (JavaScript/TypeScript).

`node-oracledb` itself has two modes. **Thick mode** requires Oracle Instant Client — a set of native C libraries that must be installed on the end user's machine, typically 100–150MB, with non-trivial configuration and Oracle licensing implications. It is the mode that every existing Oracle IDE (Toad, PL/SQL Developer, SQL Developer) requires, and it is a known friction point for users. **Thin mode** is different: it is a pure JavaScript implementation of the Oracle Net protocol, introduced in `node-oracledb` 6.x. It requires no native libraries whatsoever. It speaks to Oracle directly over TCP, implements the TNS handshake and the session wire protocol in TypeScript. For a desktop tool, this is a genuine gift — zero external dependencies for the end user.

Thin mode only exists in JavaScript. Rewriting the Oracle Net protocol in Rust to avoid a JavaScript runtime would be a multi-year project with no practical payoff.

### The sidecar architecture

The sidecar is an independent process that Tauri spawns and manages. It runs Bun (a JavaScript/TypeScript runtime) and executes the TypeScript that holds the Oracle connection via `node-oracledb` Thin. The Rust shell and the sidecar communicate via JSON-RPC messages written to the sidecar's stdin and read from its stdout, each message terminated by a newline. This is one of the simplest IPC mechanisms available — analogous to a DBMS_PIPE between two database sessions in Oracle: both sides write structured messages to a channel, both sides read from it, and the contract between them is the message format, not a shared library or memory space.

### Why Bun specifically, not Node.js

`bun build --compile` produces a single standalone executable per platform — typically 50–80MB — that bundles the Bun runtime, the TypeScript source (or its compiled form), and all `node_modules` into one binary. The end user installs one file. Node.js has similar tools (`pkg`, `nexe`, Node SEA), but they are either abandoned, poorly maintained, or require more manual configuration.

Startup time matters here. Bun cold-starts in 10–40ms on typical hardware. Node.js with a moderately sized `node_modules` tree takes 100–300ms. Since the sidecar is spawned on connection open and may be restarted on session loss, fast startup directly affects the user experience.

Bun also executes TypeScript natively — no transpile step during development — and its `bun install` is 10–30x faster than `npm install`, which reduces the friction of the dev loop. Memory footprint is measurably lower than Node.js for equivalent workloads. None of these differences are dramatic enough to be the sole reason, but they compound.

### Honest trade-offs

Bun reached v1.0 in late 2023. It is younger than Node.js and has some documented incompatibilities with Node.js APIs. `node-oracledb` thin mode has been tested against Bun and works correctly for Veesker's usage patterns, but edge cases may surface over time and should be documented as they appear.

IPC over stdin/stdout adds 1–5ms per call compared to a hypothetical native Rust binding. For a SQL query that takes tens or hundreds of milliseconds, this is noise. It would matter if Veesker were streaming millions of rows per second, which is not the use case.

Debugging crosses process boundaries. A bug might live in the Rust shell, in the sidecar TypeScript, or in the JSON-RPC contract between them. The error will surface at the boundary as a malformed response or a timeout. Building good error codes and structured error types on both sides of the contract — as Veesker does via `RpcCodedError` — is essential.

Build complexity is real: you must compile the sidecar binary separately per target platform (macOS arm64, macOS x64, Windows x64, Linux x64) before the Tauri build can package it. The sidecar binary adds ~50–80MB to the installer. Compared to the alternative — requiring the user to install Oracle Instant Client and configure `LD_LIBRARY_PATH` before Veesker starts — this is an easy trade.

### Why this still wins

The zero-client install story is the strongest product differentiator Veesker has against every other Oracle IDE in the market. Every existing tool requires Instant Client. Veesker does not. That single fact makes Veesker faster to adopt in enterprise environments where machine configuration is controlled and Oracle client libraries are not pre-installed. The sidecar architecture, and Bun, and `node-oracledb` Thin mode are the chain of decisions that make it possible.

---

## JSON-RPC Contract Between Rust and Bun

When the frontend calls a Tauri command (via `invoke()`), the Rust handler writes a JSON-RPC request to the sidecar's stdin, waits for a response on stdout, and returns the parsed result to the frontend. Each message is a single line terminated by `\n`.

**Request format:**
```json
{"id": "550e8400-e29b-41d4-a716-446655440000", "method": "table.describe", "params": {"owner": "HR", "name": "EMPLOYEES"}}
```

**Response format (success):**
```json
{"id": "550e8400-e29b-41d4-a716-446655440000", "result": {"columns": [...], "indexes": [...], "rowCount": 107, "lastAnalyzed": "2024-11-15T10:23:00.000Z"}}
```

**Response format (error):**
```json
{"id": "550e8400-e29b-41d4-a716-446655440000", "error": {"code": -32013, "message": "ORA-00942: table or view does not exist"}}
```

The full RPC surface — 28 methods — is grouped below.

**Connection & workspace:**
`connection.test`, `workspace.open`, `workspace.close`

**Schema & objects:**
`schema.list`, `objects.list`, `objects.list.plsql`, `objects.search`, `schema.kind_counts`, `table.describe`, `table.related`, `table.count_rows`, `object.ddl`, `object.dataflow`

**Query execution:**
`query.execute`, `query.cancel`, `compile.errors`

**Transactions:**
`connection.commit`, `connection.rollback`

**Vector & embeddings:**
`vector.tables_in_schema`, `vector.index_list`, `vector.search`, `vector.create_index`, `vector.drop_index`, `embed.count_pending`, `embed.batch`

**AI:**
`ai.chat`

**Secrets (proxied through Rust keychain, not directly exposed to sidecar):**
`key.get`, `key.set`

**Error codes:**

| Code | Meaning |
|---|---|
| `-32700` | Parse error |
| `-32601` | Method not found |
| `-32000` | Generic server error |
| `-32003` | Sidecar not available |
| `-32010` | No active Oracle session |
| `-32011` | Session lost (connection dropped) |
| `-32012` | Object not found |
| `-32013` | Oracle error (wrapped from `node-oracledb`) |
| `-32014` | SQL splitter error |

---

## State and Persistence Layers

Veesker uses three distinct persistence mechanisms, each matched to the nature of the data it holds.

**OS keychain (Rust `keyring` crate):**
All Oracle passwords, wallet passwords, and the Anthropic API key live here. The keychain is the OS-managed encrypted store — macOS Keychain, Windows Credential Manager, or Linux Secret Service depending on the platform. Entries are keyed as `connection:{id}`, `connection:{id}:wallet`, and `apikey:{provider}`. Nothing in this layer ever touches disk as plaintext; the OS manages encryption at rest and access control. The sidecar does not have direct keychain access — secrets are read by the Rust shell and passed to the sidecar only when opening a session, in memory, over the IPC channel.

**Local SQLite (`rusqlite`, bundled):**
Saved connection definitions (metadata only — no passwords) and query history per connection. SQLite is the right choice here because this data needs structured queries: list connections ordered by last used, search query history with LIKE, paginate. The Tauri SQL plugin was not used; `rusqlite` is bundled directly into the Rust binary, which eliminates a plugin dependency and gives direct control over schema migrations.

**localStorage (frontend only):**
UI layout state: panel widths (schema tree, chat panel), SQL drawer height, editor-to-results ratio, history panel open/closed, active tab, log collapsed state, open SQL tabs and their dirty state, embedding configuration. This is ephemeral, per-user-profile, and requires no structured queries. localStorage fits naturally; there is no reason to round-trip to SQLite for a panel width.

---

## Security Model

Veesker is built for enterprise Oracle environments where data sensitivity is high and machine configuration is controlled. The security controls are layered.

**Strict CSP on the WebView.** The Content Security Policy blocks inline scripts, disallows framing (`frame-src 'none'`), blocks plugin embeds (`object-src 'none'`), and restricts `connect-src` to the Anthropic API and `localhost:1420`. This matters because the WebView renders markdown from AI responses and can render HTML content from Oracle data — a strict CSP limits what a crafted payload can do if it reaches the renderer.

**Sidecar process isolation.** The Oracle driver runs in a subprocess. If the sidecar crashes, the Tauri shell and the UI remain alive — the user sees a session-lost error and can reconnect without restarting the app. More importantly, the sidecar does not have direct access to the OS keychain; it receives credentials once, at session-open time, over the in-process IPC channel.

**Credentials never on disk.** Every secret passes through the OS keychain via the Rust `keyring` crate. There is no `.env` file, no config file with passwords, no localStorage entry for a database password. The security model is the same as 1Password or Keychain Access: the OS handles encryption at rest and prompts the user when an application requests a stored secret.

**Oracle identifier validation.** Every object owner, table name, column name, or index name that gets interpolated into a SQL string first passes through `quoteIdent()`, which enforces the pattern `[A-Za-z0-9_$#]{1,128}` and double-quotes the result. Oracle metadata queries cannot always use bind parameters for object names (DDL statements do not support them), so this regex is the injection guard at that boundary.

**Embedding URL validation.** The custom embedding provider feature accepts a user-supplied URL. Before making a request, the URL is validated to block cloud metadata addresses — `169.254.x.x` (AWS/Azure instance metadata), GCP's `metadata.google.internal`, and the Azure equivalents. Without this check, a malicious custom URL could trick the sidecar into forwarding embedding requests to an instance metadata service, potentially leaking cloud credentials.

**AI read-only enforcement.** The `run_query` tool that the AI assistant uses first strips SQL comments from the statement, then tests the remaining text against a regex that rejects any statement beginning with or containing INSERT, UPDATE, DELETE, MERGE, CREATE, DROP, ALTER, TRUNCATE, RENAME, GRANT, REVOKE, EXECUTE, EXEC, CALL, BEGIN, DECLARE, COMMIT, or ROLLBACK. The AI cannot mutate data regardless of what the conversation contains.

**Prompt injection mitigation.** When the user's active SQL from the editor is embedded into the system prompt (to give the AI context), any triple-backtick sequences in that SQL are replaced with `~~~` before the string is sent to Claude. This prevents a crafted SQL statement from escaping the fenced code block in the system prompt and injecting instructions.

**Concurrency guard on query execution.** `queryExecute` checks whether `_running` is non-null before proceeding. If a query is already in flight, it throws immediately with error code `-32013`. This prevents two concurrent calls from corrupting the shared Oracle session state — a scenario that could arise if the frontend dispatched two rapid keystrokes or two different UI actions simultaneously.

---

## Frontend Architecture (Svelte 5)

The frontend lives under `src/` and follows the SvelteKit file-system router. The workspace lives at `src/routes/workspace/[id]/+page.svelte`, where `[id]` is the connection ID. The home screen is `src/routes/+page.svelte`. Connection forms are under `src/routes/connections/`.

State management uses Svelte 5 runes throughout. Module-level variables marked with `$state` are reactive; `$derived` computes values from them; `$effect` handles side effects. The primary cross-component store is `src/lib/stores/sql-editor.svelte.ts`, which owns all SQL tab state: open tabs, active tab, execution status, dirty state, drawer height and open/closed state, editor expand mode, pending transaction flag, and query history panel state. A second store manages connection and schema tree state. Both are singleton modules — imported wherever needed, not passed through props.

CodeMirror 6 is integrated directly in `SqlEditor.svelte`. The Oracle SQL grammar (`@codemirror/lang-sql` with the `PLSQL` dialect), One Dark theme, and a custom extension for rendering compile errors as inline diagnostics are composed into a single `EditorView`. The CodeMirror instance is created on mount and destroyed on unmount; updates from the Svelte layer (e.g., loading a history entry) are dispatched as transactions.

All UI components are hand-written Svelte — no component framework like shadcn or Radix. The styling is scoped CSS within each `.svelte` file, using CSS custom properties for the color palette.

---

## Backend Architecture (Rust + Bun)

**Rust (`src-tauri/src/`):**

`lib.rs` sets up the Tauri application: registers all Tauri commands, initializes the SQL plugin, and configures the sidecar spawn via `tauri-plugin-shell`. The sidecar is declared in `tauri.conf.json` as an `externalBin` and managed by Tauri's shell plugin — Tauri handles spawning, I/O piping, and lifecycle. `commands.rs` exposes the Tauri commands that the frontend calls via `invoke()`. Each command marshals arguments, writes a JSON-RPC request to the sidecar, awaits the response, and returns the deserialized result. Keychain access and SQLite queries are handled directly in `commands.rs` via `keyring` and `rusqlite`.

**Bun sidecar (`sidecar/src/`):**

`index.ts` is the entry point. It reads lines from stdin in a loop; each line is a JSON-RPC request. It dispatches to the handler registered for that method in `handlers.ts`, awaits the result, and writes the JSON-RPC response to stdout. One message in, one message out, strictly sequential. There is no parallelism in the sidecar; Oracle's session model does not support concurrent queries on a single connection anyway.

`oracle.ts` contains all Oracle interaction: connection management (`openSession`, `closeSession`), all metadata queries (`schemaList`, `tableDescribe`, `objectDdl`, `objectDataflow`, `tableRelated`, etc.), query execution (`queryExecute` with single-statement and multi-statement paths), vector operations (`vectorSimilaritySearch`, `embedBatch`, `vectorCreateIndex`, `vectorDropIndex`), and transaction control (`connectionCommit`, `connectionRollback`). The session is held in `state.ts` as a module-level variable. `withActiveSession()` is the wrapper used by every operation — it checks that a session exists, handles Oracle error classification, and clears stale session state on lost-connection errors.

`ai.ts` holds the Anthropic SDK integration. It builds the system prompt with live IDE context (current schema, selected object, active SQL), then enters a tool-call loop: the model responds, tool calls are executed against the live database via the functions in `oracle.ts`, results are appended to the message history, and the model is called again until it stops. The AI tools are strictly read-only; every tool result passes through the same security validation layer as a user-typed query.

`embedding.ts` implements provider-specific embedding generation. Each provider (Ollama, OpenAI, Voyage, custom) is a branch in a switch statement that constructs the appropriate HTTP request, parses the response, and returns a `number[]`. The embedding URL validation (metadata endpoint blocking) runs here before any network call.

---

## Build and Packaging

**Development mode:**

```bash
bun run tauri dev
```

This starts three things concurrently: the Vite dev server (SvelteKit frontend on localhost:1420), the Tauri Rust shell (which opens a WebView pointing at the dev server), and the sidecar (run via `bun run sidecar/src/index.ts` — not the compiled binary). Hot module replacement works for the frontend; changes to the sidecar TypeScript require restarting the sidecar process.

**Production build:**

The sidecar is compiled first:

```bash
cd sidecar
bun build src/index.ts --compile --minify \
  --outfile ../src-tauri/binaries/veesker-sidecar-<target-triple>
```

where `<target-triple>` matches Rust's target triple for the platform (e.g., `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-pc-windows-msvc`). The Tauri build then bundles the Rust binary, the WebView assets, and the sidecar binary into a platform-native package: `.app` + `.dmg` on macOS, `.msi` on Windows (pending), `.AppImage` + `.deb` on Linux (pending).

macOS builds are code-signed with an Apple Developer ID and notarized via `xcrun notarytool`. Windows builds will require an EV code signing certificate; this is pending. There is no auto-updater in the current build — planned for v1.0.

**Cross-platform sidecar binaries:**

Each target platform requires its own sidecar binary compiled on (or cross-compiled for) that platform. The Tauri `externalBin` configuration in `tauri.conf.json` names the binary as `veesker-sidecar` and Tauri appends the target triple automatically at bundle time, matching the file it expects to find in `src-tauri/binaries/`.

---

## Known Limitations and Future Work

macOS is the only fully supported platform at this time. Windows and Linux builds are in progress; the primary blockers are platform-specific keychain behavior (Linux Secret Service requires D-Bus, which has additional setup requirements in some environments) and the `bun build --compile` Windows target, which has some known limitations in the current Bun release.

The AI assistant uses Claude exclusively. OpenAI and Ollama providers for the AI chat (as opposed to embeddings, which already support both) are on the roadmap.

Query history search uses SQL `LIKE` matching. This is adequate for most use cases but misses fuzzy matches and tokenized full-text search. Moving to SQLite FTS5 is planned.

There is no SQL formatter integrated in the editor yet. Formatting PL/SQL correctly is non-trivial — most open-source SQL formatters handle standard SQL well but struggle with PL/SQL block structure. A PL/SQL-aware formatter is planned but not yet scoped.

Collaborative features — shared read-only schema views, shared query history, team connections — are not in the current architecture. Veesker is designed as a single-user local tool. Adding collaboration would require a server component that does not currently exist and is not in the near-term roadmap.

---

## Glossary

**Tauri** — a framework for building native desktop apps with a web frontend. Uses the OS-native WebView instead of bundling Chromium, resulting in smaller binaries and a reduced security surface compared to Electron.

**Sidecar** — a secondary process spawned and managed by the main application process. In Veesker, the sidecar runs Bun and handles all Oracle and AI interactions. It communicates with the Rust shell via IPC.

**Bun** — a JavaScript and TypeScript runtime, alternative to Node.js. Notable for fast startup, native TypeScript execution, and `bun build --compile`, which produces standalone single-file executables.

**IPC** — Inter-Process Communication. The mechanism by which two processes exchange data without using a shared memory space or a network connection. Veesker uses JSON messages over stdin/stdout as its IPC channel.

**JSON-RPC** — a lightweight remote procedure call protocol. A caller sends `{"method": "...", "params": {...}, "id": "..."}` and receives back `{"result": {...}, "id": "..."}` or `{"error": {...}, "id": "..."}`. Stateless and easy to implement over any bidirectional channel.

**Thin mode** (Oracle driver) — a pure JavaScript/TypeScript implementation of the Oracle Net wire protocol in `node-oracledb`. It connects to Oracle directly over TCP with no native C libraries and no Oracle Instant Client required. Available since `node-oracledb` 6.x.

**Keychain** — the OS-managed encrypted credential store. macOS Keychain, Windows Credential Manager, and Linux Secret Service are the three implementations. Access is controlled by the OS; the calling application cannot read another application's keychain entries.

**HNSW** — Hierarchical Navigable Small World. A graph-based algorithm for approximate nearest neighbor search in high-dimensional vector spaces. Used by Oracle 23ai as its default vector index type. Offers fast query performance at the cost of more memory.

**IVF** — Inverted File Index. A cluster-based algorithm for approximate nearest neighbor search. Partitions the vector space into clusters (Voronoi cells); queries probe the nearest clusters. Lower memory usage than HNSW but typically slower for high-recall scenarios.

**RAG** — Retrieval-Augmented Generation. A pattern where an LLM answers a question by first retrieving relevant context from a vector store (using semantic similarity search), then generating a response grounded in that context. Oracle 23ai's native VECTOR type and HNSW/IVF indexes make it a natural RAG-capable database.

**Runes** (Svelte 5) — the new reactivity primitives in Svelte 5: `$state` for reactive variables, `$derived` for computed values, `$effect` for side effects. They replace the older `writable`/`readable` store pattern with a signal-like model that is simpler to compose and reason about.
