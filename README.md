<div align="center">

<img src="static/ce-logo.png" width="220" alt="Veesker Community Edition" />

# Veesker Community Edition

**Native Oracle IDE built for safety, auditability, and AI.**

A native desktop IDE with a multi-statement SQL editor, AI assistant (BYOK), PL/SQL debugger, vector search studio, and no-code REST API builder — all in one app, no Oracle client required. Works with Oracle 9i through 26ai. 100% open-source under Apache 2.0.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-E85D3C.svg)](LICENSE) [![Community Edition](https://img.shields.io/badge/edition-Community-E85D3C.svg)](https://veesker.cloud) [![Built with Tauri 2](https://img.shields.io/badge/built%20with-Tauri%202-24C8D8?logo=tauri&logoColor=white)](https://tauri.app) [![Svelte 5](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev) [![Oracle 9i–26ai](https://img.shields.io/badge/Oracle-9i%E2%80%9326ai-F80000?logo=oracle&logoColor=white)](https://oracle.com)

[veesker.cloud](https://veesker.cloud) · [Install](#install) · [CE vs Cloud](#community-edition-vs-cloud) · [Build from source](#build-from-source) · [License](#license--disclaimer)

</div>

---

## Open-core model

Veesker is **source-open under Apache 2.0 — every line of application code is public.** A paid subscription unlocks premium features at runtime via a feature flag served by `api.veesker.cloud`. The flag gate is in the open-source code; the source for every feature is in this repo. Nothing is hidden.

This is the Docker model: Docker Engine and Docker Desktop are open source; Docker's paid plans give you commercial-use rights plus hosted services. Veesker works the same way. Free forever for individuals and open-source projects; subscription for commercial deployments that want premium capabilities and the right to use Veesker for revenue-generating work.

> **On the CL repo (Veesker Cloud Edition):** The private `veesker-cloud-edition` repository previously held the Cloud-exclusive code. That repo is being archived as part of this consolidation — all its code migrates here. If you had a reference to it, use this repo going forward.

<div align="center">

| Feature | Free | Subscription |
|---|:---:|:---:|
| SQL Editor (multi-statement) | ✅ | ✅ |
| PL/SQL Editor + Compile + Debug | ✅ | ✅ |
| Schema Browser (18 object kinds) | ✅ | ✅ |
| Table Inspector (columns, indexes, FKs, DDL) | ✅ | ✅ |
| EXPLAIN PLAN | ✅ | ✅ |
| Transaction management (commit/rollback) | ✅ | ✅ |
| Terminal (PTY) | ✅ | ✅ |
| ORDS / REST API Studio | ✅ | ✅ |
| Object Versioning | ✅ | ✅ |
| Visual Flow / DataFlow | ✅ | ✅ |
| Local query history + audit log | ✅ | ✅ |
| Auto-update | ✅ | ✅ |
| HMAC-SHA256 tamper-evident audit chain | ✅ | ✅ |
| **AI — Explain SQL / Generate SQL (BYOK)** | ✅ | ✅ |
| **AI — Schema-aware (knows your DB)** | — | ✅ |
| **AI — Query execution via AI** | — | ✅ |
| **AI — Query optimization + performance** | — | ✅ |
| **AI — Charts via natural language** | — | ✅ |
| **AI — Debugger analysis + suggestions** | — | ✅ |
| **Vector Search Studio** | ✅ | ✅ |
| **Veesker Vision — force-directed schema graph** | — | ✅ |
| **Team features + shared queries** | — | ✅ |
| **VeeskerDB Sandbox — encrypted production data slices** | — | ✅ |
| **VeeskerDB engine — `.vsk` format library** | ✅ embedded | ✅ embedded |

</div>

> Premium features are **in this repo** — the source is public. The subscription gives you the runtime entitlement to use them, not access to hidden code. You can read, audit, and compile every premium feature from this repository.

**[→ See plans at veesker.cloud/pricing](https://veesker.cloud/pricing)**

---

## ⚠️ Important — Read before using

Veesker is **open-source software** distributed AS IS. There are no guarantees about correctness, security, availability, or fitness for any purpose. **Do not use Veesker against production databases without first validating it in a non-production environment.** See [TERMS_OF_USE.md](TERMS_OF_USE.md) and [LICENSE](LICENSE) for the full disclaimer.

If you need warranty, SLA, or commercial support, that requires a separate signed agreement — the open-source build never has one.

---

## Screenshots

<div align="center">
<img src="docs/screenshots/workspace-overview.png" width="100%" alt="Veesker workspace — schema tree, DataFlow graph, AI assistant, SQL editor with results" />
<sub>Full workspace — schema browser, DataFlow graph, Veesker AI with chart, SQL editor, query history, results grid</sub>
</div>

<br/>

<div align="center">
<table>
  <tr>
    <td align="center">
      <img src="docs/screenshots/connection-list.png" width="460" alt="Connection home" /><br/>
      <sub>Connections home — manage Oracle 23ai connections</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/workspace-schema-tree.png" width="460" alt="Workspace and schema tree" /><br/>
      <sub>Workspace — schema tree with all object kinds</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/table-columns.png" width="460" alt="Table columns" /><br/>
      <sub>Table inspector — columns, types, nullability</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/table-graph.png" width="460" alt="DataFlow graph" /><br/>
      <sub>DataFlow — upstream/downstream dependencies via FK & code refs</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/sql-drawer-results.png" width="460" alt="SQL editor with results" /><br/>
      <sub>Multi-statement SQL editor with results grid</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/sql-editor-ai-explain.png" width="460" alt="AI explain query" /><br/>
      <sub>Veesker AI — explain queries, suggest fixes, generate SQL</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/ai-chart-select.png" width="460" alt="Veesker AI chart — column selection" /><br/>
      <sub>Veesker AI — select columns and chart type in natural language</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/ai-chart-preview.png" width="460" alt="Veesker AI chart — preview" /><br/>
      <sub>AI generates the chart and offers to pin it to the Dashboard</sub>
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <img src="docs/screenshots/ai-dashboard.png" width="940" alt="Dashboard with AI-generated chart" /><br/>
      <sub>Dashboard — AI-generated charts pinned and ready to export as PDF</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/plsql-procedure-editor.png" width="460" alt="PL/SQL procedure editor" /><br/>
      <sub>PL/SQL editor — compile, save, view DDL</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/plsql-debugger.png" width="460" alt="PL/SQL debugger" /><br/>
      <sub>PL/SQL Debugger — breakpoints, step-in/over/out, watch variables</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/vras-builder.png" width="460" alt="VRAS API builder" /><br/>
      <sub>VRAS — visual REST endpoint builder for Oracle ORDS</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/vras-sheep-ai.png" width="460" alt="VRAS Sheep AI" /><br/>
      <sub>VRAS — describe an endpoint in natural language, AI fills the form</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/sql-history.png" width="460" alt="Query history" /><br/>
      <sub>Per-connection query history with timing & row counts</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/help-onboarding.png" width="460" alt="Onboarding & help" /><br/>
      <sub>In-app guided onboarding & help center</sub>
    </td>
  </tr>
</table>
</div>

---

## What it is / What it isn't

**What it is:**
- A native desktop Oracle 23ai studio combining SQL editing, schema browsing, vector search, AI assistance, PL/SQL debugging, and REST API generation in a single app
- Zero Oracle client install — connects directly via the Thin driver (pure TypeScript, no native libraries, no JDBC jar)
- An AI assistant with live database access — Sheep can run SELECT queries against your schema to answer questions, not just autocomplete based on training data
- A platform with the open `.vsk` format and `@veesker/engine` library — encrypted, portable Oracle data slices that can be sealed for specific recipients
- An open-core project — every line of source code is Apache 2.0 in this repo; premium features are runtime-unlocked via a feature flag served by veesker-api

**What it isn't:**
- Not a generic multi-database client — DBeaver handles that better
- Not cloud or SaaS — credentials, query history, and database content stay on your machine
- Works with Oracle 9i through 26ai — legacy databases are fully supported via Thick mode auto-discovery (no manual Instant Client setup)
- Not a production-grade tool with warranty — see [terms & disclaimers](#license--disclaimer)

---

## Current State & Roadmap

> **Beta.** Veesker is under active development. Core features are stable and production-tested
> by the author on real Oracle databases, but this is not yet a drop-in replacement for Toad or
> PL/SQL Developer in feature breadth. Recommended: validate in a non-production environment
> before use on critical databases.

| Release | Status | What ships |
|---|---|---|
| **v0.5.0-beta.1** | ✅ Launched May 2026 | Phase 1: schema browser (18 object kinds), DDL/DCL safety gate, Sessions monitor + KILL, HMAC-SHA256 tamper-evident audit chain, Verify Chain UI |
| **v0.5.x** | 🔜 patch | Bug B1 fix (directory detail panel), Dependabot cleanup, UX/UI improvements; repo unification (CL→CE migration) |
| **v0.6.0** | 📋 planned | APEX Studio: read-only APEX Explorer, version-aware dictionary detection, and SQL/PLSQL extraction into the editor |
| **v0.7.0** | 📋 planned | Phase 3: Item #4 Phase D TX close hooks, .vsk portable Oracle sandbox |
| **v1.0.0** | 🎯 target | Stable release with Windows code signing, macOS notarization, Linux packaging, subscription feature flags live |

---

## Created by

**[Geraldo Ferreira Viana Júnior](https://github.com/gevianajr)** — Senior Oracle Engineer with 14 years of experience building mission-critical PL/SQL, ERP, and APEX systems.

I started designing Veesker in 2022 — sketching the architecture, the feature set, and the developer experience based on years of real-world Oracle pain points. The bottleneck was never the vision; it was solo implementation velocity. In 2026, with Claude Code mature enough to act as a serious engineering collaborator, I turned four years of design into a working product.

- **GitHub:** [@gevianajr](https://github.com/gevianajr)
- **LinkedIn:** [Geraldo Viana Jr](https://www.linkedin.com/in/geraldovianajr/)
- **Website:** [veesker.cloud](https://veesker.cloud)
- **Email:** [geraldovianajr@veesker.cloud](mailto:geraldovianajr@veesker.cloud)

For commercial inquiries, partnerships, or trademark permission, reach out via email.

---

## Features

### Connections & Authentication

- **Basic auth** — host / port / service name + username / password
- **Oracle Wallet (mTLS)** — ZIP upload with automatic connect-alias detection and wallet password support; full Autonomous Database compatibility
- **OS keychain integration** — passwords stored via Windows Credential Manager / macOS Keychain / Linux Secret Service via the Rust `keyring` crate
- **Connection switcher** — fast jump between connections without re-authenticating
- **Multi-PDB support** — switch service names per connection

### Schema browser

- **18 object kinds** — Tables, Views, Sequences, Procedures, Functions, Packages, Triggers, Types, REST Modules, **Materialized Views, Synonyms, DB Links, Directories, Advanced Queues, Scheduler Jobs, Legacy DBMS_JOB, DB Users, Privileges & Grants**
- **Per-schema vector indicator** — schemas containing tables with VECTOR columns are flagged
- **Smart filtering** — toggle visibility per kind, hide system schemas, full-text search across all objects
- **Object kind counts** — at a glance, see how much is in each schema
- **System schema toggle** — show/hide ANONYMOUS, SYS, MDSYS, etc.
- **DBA → ALL → USER_* fallback** — every object kind degrades gracefully when DBA privileges are unavailable

### Table inspector

- **Columns tab** — name, type, nullability, default, comments, primary-key flag, vector indicator
- **Indexes tab** — name, unique flag, columns covered
- **Related tab** — outgoing & incoming foreign keys, dependent objects, constraints, grants
- **DataFlow graph** — visual dependency map showing upstream sources, downstream consumers, FK relationships, and triggers (PL/SQL bodies are scanned for table refs)
- **Quick actions** — preview data (SELECT * with PK ordering, FETCH FIRST 200), exact COUNT, view DDL, navigate to any related object

### SQL editor

- **Multi-statement execution** — full PL/SQL-aware splitter handles strings, comments, q-quoted literals, and `BEGIN..END;` blocks separated by `/`
- **Per-statement results** — each statement gets its own result tab with status (ok/error/cancelled), elapsed time, and row count
- **Cancel running queries** — `Cmd/Ctrl + .` aborts the in-flight statement (server-side `connection.break()`)
- **Run-at-cursor / Run-selection / Run-all** — three execution modes with sensible defaults
- **Sortable & resizable result grid** — virtual-scrolling for large result sets (no UI freeze on millions of rows)
- **Query history** — per-connection SQLite-backed history with elapsed time, row count, error code; click to reload into the editor
- **File I/O** — Save / Save As / Open `.sql` files with file-modified indicator on the tab
- **Multiple tabs** — keep separate working contexts open simultaneously
- **DML safety** — destructive operations (DELETE, UPDATE, DROP, TRUNCATE) trigger a confirmation modal showing impact
- **EXPLAIN PLAN** — visualization of execution plan tree with cost & cardinality
- **Compile errors inline** — for `CREATE PROCEDURE/FUNCTION/PACKAGE`, errors appear in the gutter at the failing line
- **CodeMirror 6** — syntax highlighting, minimap, autocomplete with the schema's actual table/view names

### AI Assistant — Sheep 🐑

- **Live database access** — Sheep runs SELECT queries against your real schema to answer questions, then explains the results
- **Context-aware** — the assistant knows the current schema, currently selected object, and can use the live connection
- **Explain & analyze** — highlight any SQL → "Explain with AI" → Sheep walks through it line by line
- **Generate SQL** — describe what you want in natural language, get a SQL draft to review and run
- **Markdown rendering** — code blocks, inline code, bold, syntax-highlighted
- **API key in OS keychain** — Anthropic API key stored locally via `keyring`; falls back to `ANTHROPIC_API_KEY` env var

### Vector search studio

- **Embedding providers** — Ollama (local), OpenAI, Voyage, custom OpenAI-compatible endpoints
- **HNSW & IVF indexes** — create, drop, parameterize accuracy/distance metric (Cosine, Euclidean, Dot)
- **Similarity search UI** — text input → embeddings → live similarity results sorted by distance
- **2D scatter plot** — PCA-projected vector space, color-coded by similarity score, hover to inspect source rows
- **Embed batch operations** — bulk-embed pending rows in your tables with progress tracking

### VeeskerDB engine — `.vsk` format

A pure-TypeScript library for reading and writing `.vsk` files — Veesker's open encrypted artifact format for portable Oracle data slices. Powers the VeeskerDB Sandbox feature in Cloud Edition; embedded as `@veesker/engine` and reusable in any Bun/Node project.

- **Open format** — magic-bytes + version header, libsodium-sealed recipient envelopes, ChaCha20-Poly1305 encrypted DuckDB blob payload.
- **Crypto primitives** — X25519 ECDH for key exchange, ChaCha20-Poly1305 AEAD for content, BLAKE2b for derivation. All from `libsodium-wrappers`.
- **Per-recipient sealing** — `sealForRecipients(contentKey, recipients[], senderKp)` produces N envelopes (one per pubkey); each member decrypts only their envelope with their private key. The content blob itself is encrypted once.
- **DuckDB host** — embedded DuckDB instance for staging tabular payloads with full SQL access. Cross-platform native bindings auto-resolved at runtime.
- **No network** — engine is local-only. Distribution / publish / pull is the integrator's responsibility (Cloud Edition uses Cloudflare R2 + Veesker API).

The full sandbox workflow — owner build pipeline, hosted publish, recipient management, member open/query UX — is a Cloud Edition feature that consumes this engine.

### Safety Layer

Veesker treats your production database as a high-value asset, not just a connection target.

- **4-layer PROD hard-lock** — PSDPM (production safety decision point) → server-side env guard → `validateOracleIdentifier` input validation → fail-closed defaults. Each layer is independent; all four must pass for any write-path action to execute in production
- **DDL/DCL confirmation gate** — DDL statements (CREATE, ALTER, DROP, etc.) require explicit user confirmation with a 5-minute per-connection window. Dev and local environments are allowlisted; production is always gated
- **Env-calibrated DML safety** — DEV: single confirm; STAGING: double confirm + type table name; PROD: block + explicit unlock with 15-min decay. Configured from the connection's declared environment
- **`validateOracleIdentifier` defense-in-depth** — all Oracle identifiers entering any write-path action are validated against `/^[A-Z][A-Z0-9_$#]{0,127}$/`. SQL injection via identifier paths is structurally impossible
- **Zero string interpolation in SQL** — owner/name pairs are always composed server-side as `:owner||'.'||:name`; no user input reaches SQL string context
- **Sessions monitor** — view all active sessions; `KILL SESSION` requires prod-confirm (waived on dev/local)
- **T1A.8 action pattern** — all 5 write-path action buttons (mview.refresh, job.run, job.disable, session.kill, DDL gate) follow the same env-guard + confirm architecture

### PL/SQL features

- **PL/SQL editor** — full CRUD on procedures, functions, packages, triggers, and types with syntax highlighting
- **Compile** — explicit compile button with inline error display
- **Procedure execution modal** — auto-generated form for IN/OUT params, including REF CURSOR results displayed as a result grid
- **PL/SQL Debugger** — Test Window-style debugger:
  - Breakpoints (gutter click or Ctrl+B)
  - Step Into / Step Over / Step Out / Continue
  - Watch variables panel
  - Call stack with current line highlight
  - Output capture (DBMS_OUTPUT)
  - SYS_REFCURSOR result extraction

### VRAS — Veesker REST API Studio

A no-code REST API builder using Oracle ORDS:

- **Auto-CRUD on tables/views** — 1-click `ORDS.ENABLE_OBJECT` with operation selection (GET/POST/PUT/DELETE/GET-by-id)
- **Custom SQL endpoints** — write a parameterized SELECT/DML, define route + method, deploy as ORDS handler
- **Procedure endpoints** — pick any PL/SQL procedure or function, params auto-introspected, JSON serialization via APEX_JSON (handles SYS_REFCURSOR natively)
- **Veesker AI integration** — describe the endpoint in natural language, AI fills the form
- **OAuth 2.0 client management** — create OAuth clients with `client_credentials` grant, role assignment, revoke; secret shown once for safe-keeping
- **Inline HTTP test panel** — send GET/POST/PUT/DELETE requests with auto-injected Bearer tokens, JSON pretty-printed response, status code coloring
- **Module browser** — read existing ORDS modules from `USER_ORDS_*` views, view templates, handlers, and source code
- **Export as SQL** — reverse-engineer any deployed module into a recreatable PL/SQL block (great for promoting between environments)
- **Bootstrap detection** — auto-detects whether ORDS is installed, schema is enabled, user has admin privilege, and base URL is configured; guided modal with one-click "Habilitar agora" when applicable

### Workspace UX

- **Dark / light mode** with smooth transitions
- **Customizable panels** — resize schema tree and AI panel, persisted
- **System tray integration** — minimize to tray, status badges per connection state
- **Command palette** — Ctrl+K for fast navigation
- **Help center & onboarding** — in-app guided tour for new users
- **Auto-update** — Tauri-native updater with Ed25519-signed releases via GitHub Releases
- **Audit trail** — every SQL execution logged to `audit/<date>.jsonl` for compliance

### Cross-platform

- **Windows** — NSIS installer + MSI, runs on Windows 10 (with WebView2) and Windows 11 native
- **macOS** — `.dmg` and `.app`, Apple Silicon and Intel; ad-hoc signing for local builds
- **Linux** — supported via Tauri build (not yet packaged for releases)

---

## Security

- **No auto-commit** — every transaction requires an explicit COMMIT or ROLLBACK.
- **User-initiated execution** — Veesker never runs SQL in the background or automatically.
- **OS keychain credentials** — passwords are stored in Windows Credential Manager / macOS Keychain / Linux libsecret, never in plain files. 4 independent keychain keys: `db-master`, `audit-cipher`, `command-history`, `audit-hmac`.
- **AES-256-GCM encrypted audit log** — every executed statement is encrypted at rest before being appended to `<app_data>/audit/YYYY-MM-DD.jsonl`.
- **HMAC-SHA256 tamper-evident chain** — each audit entry links to the previous via `prevHash` + `hmac` fields. Any modification to a historical entry is detectable via "Verify Chain" in the Activity tab. Sub-chain restarts are tracked; the chain never produces false positives on app restart.
- **AI never executes** — Sheep (AI assistant) only suggests SQL. Execution always requires your explicit approval.
- **DDL/DCL safety gate** — DDL requires confirmation in production; dev/local environments are allowlisted.

See [SECURITY.md](SECURITY.md) for the full security policy, vulnerability disclosure, AI data boundaries, and audit trail internals.

---

## Install

### Windows

Download the latest installer from the [Releases page](https://github.com/veesker-cloud/veesker/releases) and run `Veesker_<version>_x64-setup.exe`.

> The installer is currently unsigned. Windows SmartScreen will show "Windows protected your PC" — click **More info** → **Run anyway**. Code signing via Azure Trusted Signing is in progress.

### macOS

Download the `.dmg` from the [Releases page](https://github.com/veesker-cloud/veesker/releases) and drag Veesker into Applications.

> Apple Silicon and Intel are both supported. The app is ad-hoc signed; on first launch you may need to **Right-click → Open** to bypass Gatekeeper.

### Linux

Build from source — see below. Packaged Linux releases are not yet available.

---

## Build from source

See [CLAUDE.md](CLAUDE.md) for the full development setup. Quick version:

```bash
# Prerequisites: Bun ≥ 1.1, Rust stable, MSVC (Win) or Xcode CLT (macOS)

# Clone & install
git clone https://github.com/veesker-cloud/veesker.git
cd veesker
bun install
cd sidecar && bun install && cd ..

# Compile sidecar binary (path differs by OS)
cd sidecar
bun build src/index.ts --compile --target=bun-windows-x64 \
  --outfile ../src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe
cd ..

# Run dev mode (Vite + Tauri shell + sidecar live reload)
bun run tauri dev

# Or build a production installer
bun run tauri build
```

Outputs land in `src-tauri/target/release/bundle/`.

For auto-update setup, see [docs/AUTO_UPDATE.md](docs/AUTO_UPDATE.md).
For Windows code signing, see [docs/CODE_SIGNING.md](docs/CODE_SIGNING.md).

---

## Architecture

<div align="center">
<img src="docs/architecture/datamap-hero.png" width="100%" alt="Veesker system datamap — Desktop Client → Veesker Cloud API → Oracle Database, with Anthropic AI, Cloudflare R2, and Postgres" />
<sub>System datamap — Desktop client (Tauri 2 + SvelteKit 5 + Bun sidecar) talks to Oracle directly; premium features route through <code>api.veesker.cloud</code>. Diagram will be updated as the CL→CE migration completes.</sub>
</div>

### Component map

```mermaid
flowchart TB
    classDef ceStyle fill:#FFF1ED,stroke:#E85D3C,stroke-width:2px,color:#7C2D12
    classDef clStyle fill:#E0EFFF,stroke:#0A84FF,stroke-width:2px,color:#0C4A6E
    classDef apiStyle fill:#F3E8FF,stroke:#7C3AED,stroke-width:2px,color:#581C87
    classDef extStyle fill:#F1F5F9,stroke:#475569,stroke-width:1.5px,color:#0F172A
    classDef engineStyle fill:#FEF3C7,stroke:#D97706,stroke-width:2px,color:#78350F

    subgraph DESKTOP["🖥️  Desktop Client · Tauri 2 + SvelteKit 5 + Bun sidecar"]
        direction TB

        subgraph CE["📦  Community Edition · Apache 2.0 · Free forever"]
            direction LR
            CE_CORE["<b>Core IDE</b><br/>SQL Editor · multi-statement<br/>PL/SQL · compile · debugger<br/>Schema Browser · all object kinds<br/>Table Inspector · DDL · FKs<br/>EXPLAIN PLAN · DML safety"]
            CE_AI["<b>AI &amp; Vector</b><br/>Sheep AI 🐑 · BYOK Anthropic<br/>Explain SQL · Generate SQL<br/>Vector Search Studio<br/>HNSW · IVF · 2D scatter"]
            CE_TOOLS["<b>Power tools</b><br/>VRAS · no-code REST on ORDS<br/>DataFlow Graph · upstream/down<br/>Query history · audit log<br/>Auto-update · OS keychain"]
        end

        subgraph CL["☁️  Cloud Edition · Proprietary · Subscription"]
            direction LR
            CL_VISION["<b>Veesker Vision</b><br/>Force-directed schema graph<br/>Transitive deps · PL/SQL refs"]
            CL_AI["<b>Schema-aware AI</b><br/>Live DB context · runs SELECTs<br/>Query exec · charts NL"]
            CL_SANDBOX["<b>VeeskerDB Sandbox</b><br/>Owner publish · Member pull<br/>PII masks · TTL · envelopes<br/>Cloud Audit · Team workspaces"]
        end

        ENGINE["🧬  <b>@veesker/engine</b> · Open <b>.vsk</b> format<br/>libsodium · X25519 · ChaCha20-Poly1305 · DuckDB host"]
        SIDECAR["⚡  <b>Bun sidecar</b> · JSON-RPC over stdio<br/>node-oracledb Thin → Thick auto-discovery"]
    end

    subgraph CLOUD["🌐  Veesker Cloud API · api.veesker.cloud · Hono + Bun + Postgres"]
        direction LR
        AUTH["🔑  /v1/auth<br/>JWT · pubkey registry"]
        SANDBOX_API["📦  /v1/sandbox<br/>publish · pull · envelopes"]
        AUDIT_API["📊  /v1/audit<br/>SQL log ingest"]
        ORG["👥  /v1/orgs<br/>tenants · billing"]
    end

    subgraph EXT["🗄️  External services"]
        direction LR
        ORACLE["🛢️  <b>Oracle</b><br/>9i → 26ai<br/>Thin / Thick · Wallet · mTLS"]
        R2["☁️  <b>Cloudflare R2</b><br/>encrypted .vsk blobs"]
        PG["🐘  <b>Postgres</b><br/>tenant metadata"]
        ANTHROPIC["🤖  <b>Anthropic</b><br/>Sheep AI brain"]
        EMBED["🧠  <b>Embeddings</b><br/>Ollama · OpenAI · Voyage"]
    end

    CE_CORE -.-> ENGINE
    CL_SANDBOX -.->|imports via bun link| ENGINE
    CE_CORE --> SIDECAR
    CE_AI --> SIDECAR
    CE_TOOLS --> SIDECAR
    CL_VISION --> SIDECAR
    CL_AI --> SIDECAR
    CL_SANDBOX --> SIDECAR

    SIDECAR ==>|"SQL · PL/SQL · vector"| ORACLE
    SIDECAR -->|"chat"| ANTHROPIC
    SIDECAR -->|"embed"| EMBED

    CL_AI -.->|"managed AI"| AUTH
    CL_SANDBOX ==>|"publish · pull"| SANDBOX_API
    CL_SANDBOX -.->|"audit ingest"| AUDIT_API
    CL_VISION -.->|"team queries"| ORG

    AUTH --> PG
    SANDBOX_API --> PG
    SANDBOX_API ==>|"presigned URLs"| R2
    AUDIT_API --> PG
    ORG --> PG

    class CE,CE_CORE,CE_AI,CE_TOOLS ceStyle
    class CL,CL_VISION,CL_AI,CL_SANDBOX clStyle
    class CLOUD,AUTH,SANDBOX_API,AUDIT_API,ORG apiStyle
    class ORACLE,R2,PG,ANTHROPIC,EMBED extStyle
    class ENGINE,SIDECAR engineStyle
```

### Stack notes

- **Frontend:** Svelte 5 with runes (`$state`, `$derived`, `$effect`), CodeMirror 6 for SQL editing, Chart.js for the dashboard, Tauri 2 for native APIs
- **Sidecar:** Bun-compiled TypeScript binary handles all Oracle communication via JSON-RPC over stdin/stdout
- **Rust shell:** thin Tauri command layer delegating everything to the sidecar; persistence (SQLite for connections + history) and OS keychain integration live in Rust
- **No CGO, no JNI, no Oracle Instant Client required for modern Oracle:** node-oracledb Thin mode is pure JavaScript; legacy 9i–11g auto-falls back to Thick mode via Instant Client auto-discovery
- **Open core:** the `.vsk` format and `@veesker/engine` are Apache 2.0 in this repo. Premium features (Veesker Vision, VeeskerDB Sandbox, schema-aware AI) are also in this repo; a subscription entitlement served by veesker-api gates their runtime activation. The backend SaaS (`veesker-api`) remains a private service.

---

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — full development setup, Windows + macOS, troubleshooting
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — contribution guidelines, code conventions, PR workflow
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** — Contributor Covenant 2.1
- **[SECURITY.md](SECURITY.md)** — security disclosure policy
- **[TERMS_OF_USE.md](TERMS_OF_USE.md)** — terms of use, warranty disclaimer, liability limitation
- **[COMMERCIAL_USE.md](COMMERCIAL_USE.md)** — commercial use policy (Docker-style)
- **[docs/PRICING.md](docs/PRICING.md)** — subscription tiers, add-ons, FAQ
- **[docs/AUTO_UPDATE.md](docs/AUTO_UPDATE.md)** — Tauri updater configuration & release process
- **[docs/CODE_SIGNING.md](docs/CODE_SIGNING.md)** — Azure Trusted Signing setup for Windows
- **[docs/apex/README.md](docs/apex/README.md)** — Veesker APEX Studio scope, detection, version support, and extraction contract

---

## Pricing & commercial use

Veesker is fully open source under [Apache 2.0](LICENSE). **All source code is in this repository — no code is withheld behind a paid tier.** A subscription unlocks premium features at runtime via a feature flag from `api.veesker.cloud`. You can read and compile every premium feature from this codebase today.

Free forever for individuals, open-source projects, and evaluation. Paid plans give commercial-use rights, premium feature entitlements, and support.

**Until billing is active, Veesker is free for all uses**, including commercial.

If your organization wants to be among the first commercial customers when subscriptions launch, or you need early support arrangements, contact: [geraldovianajr@veesker.cloud](mailto:geraldovianajr@veesker.cloud).

**No telemetry. No license server. No kill-switch.** Subscription compliance is honor-based + EULA — same model as Docker Desktop.

See [COMMERCIAL_USE.md](COMMERCIAL_USE.md) for the full commercial framework.

---

## License & disclaimer

Veesker is released under the [Apache License 2.0](LICENSE).

**No warranty.** Veesker is provided "AS IS" and "AS AVAILABLE", without warranty of any kind. The maintainer is not liable for damages arising from the use of the software, including but not limited to data loss, security incidents, downtime, or regulatory non-compliance. See [TERMS_OF_USE.md](TERMS_OF_USE.md) for the full terms.

**User responsibility.** You are responsible for:
- Validating Veesker's behavior in non-production before any production use
- Backing up your data before connecting Veesker to a database
- Reviewing any AI-generated SQL/PL/SQL/REST configuration before applying it
- Ensuring your use complies with applicable laws and your organization's policies

**No telemetry.** The open-source build collects no usage data. Connections, credentials, and query history stay on your machine.

---

## Trademark policy

**"Veesker"** (the name) and the **Veesker sheep mascot** (the logo) are trademarks of Geraldo Ferreira Viana Júnior. They are **not** covered by the Apache 2.0 license.

Forks and derivative works:
- **Must** be renamed — they may not use "Veesker" as the product name or in marketing materials.
- **Must not** use the Veesker sheep mascot in any form.
- **Must** preserve the `NOTICE` file as required by the Apache License, Version 2.0 (§ 4d).

Permission to use the Veesker name or mascot in any commercial or promotional context requires a separate written agreement. Contact: [geraldovianajr@veesker.cloud](mailto:geraldovianajr@veesker.cloud)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributors must agree to the Apache 2.0 license terms. We use Conventional Commits and require tests for non-trivial changes.

For security issues, please report privately via [SECURITY.md](SECURITY.md).

---

## Acknowledgments

- [Tauri](https://tauri.app) — for making native desktop apps with web tech actually work
- [Svelte 5](https://svelte.dev) — runes are a joy to write
- [node-oracledb Thin mode](https://oracle.github.io/node-oracledb/) — Oracle without the Instant Client tax
- [Anthropic Claude](https://anthropic.com) — for Sheep's brain
- [Oracle 23ai](https://oracle.com/database/free) — for being the first Oracle that takes vectors seriously

---

<div align="center">

**Veesker** is created and maintained by [Geraldo Ferreira Viana Júnior](https://github.com/gevianajr).

Designed in 2022 · Shipped in 2026 · Made in São Paulo, Brazil.

[veesker.cloud](https://veesker.cloud) · [GitHub](https://github.com/veesker-cloud/veesker) · [LinkedIn](https://www.linkedin.com/in/geraldovianajr/) · [Issues](https://github.com/veesker-cloud/veesker/issues)

</div>
