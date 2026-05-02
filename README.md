<div align="center">

<img src="static/ce-logo.png" width="220" alt="Veesker Community Edition" />

# Veesker Community Edition

**The Oracle desktop IDE — free forever. Works with Oracle 9i through 26ai.**

A native desktop IDE with a multi-statement SQL editor, AI assistant (BYOK), PL/SQL debugger, vector search studio, and no-code REST API builder — all in one app, no Oracle client required. 100% open-source under Apache 2.0.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-E85D3C.svg)](LICENSE) [![Community Edition](https://img.shields.io/badge/edition-Community-E85D3C.svg)](https://veesker.cloud) [![Built with Tauri 2](https://img.shields.io/badge/built%20with-Tauri%202-24C8D8?logo=tauri&logoColor=white)](https://tauri.app) [![Svelte 5](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev) [![Oracle 9i–26ai](https://img.shields.io/badge/Oracle-9i%E2%80%9326ai-F80000?logo=oracle&logoColor=white)](https://oracle.com)

[veesker.cloud](https://veesker.cloud) · [Install](#install) · [CE vs Cloud](#community-edition-vs-cloud) · [Build from source](#build-from-source) · [License](#license--disclaimer)

</div>

---

## Community Edition vs Cloud

Veesker follows the **DBeaver model**: the Community Edition is a fully functional standalone IDE, free forever. Veesker Cloud adds managed AI with deep database context — no API key required, schema-aware, with usage controls and billing.

<div align="center">

| Feature | Community Edition | Cloud |
|---|:---:|:---:|
| SQL Editor (multi-statement) | ✅ | ✅ |
| PL/SQL Editor + Compile + Debug | ✅ | ✅ |
| Schema Browser (tables, views, packages…) | ✅ | ✅ |
| Table Inspector (columns, indexes, FKs, DDL) | ✅ | ✅ |
| EXPLAIN PLAN | ✅ | ✅ |
| Transaction management (commit/rollback) | ✅ | ✅ |
| Terminal (PTY) | ✅ | ✅ |
| ORDS / REST API Studio | ✅ | ✅ |
| Object Versioning | ✅ | ✅ |
| Visual Flow / DataFlow | ✅ | ✅ |
| Local query history + audit log | ✅ | ✅ |
| Auto-update | ✅ | ✅ |
| **AI — Explain SQL / Generate SQL (BYOK)** | ✅ free | ✅ |
| **AI — Schema-aware (knows your DB)** | — | ✅ Cloud |
| **AI — Query execution via AI** | — | ✅ Cloud |
| **AI — Query optimization + performance** | — | ✅ Cloud |
| **AI — Charts via natural language** | — | ✅ Cloud |
| **AI — Debugger analysis + suggestions** | — | ✅ Cloud |
| **Vector Search Studio** | — | ✅ Cloud |
| **Team features + shared queries** | — | ✅ Cloud |
| **Usage dashboard + billing** | — | ✅ Cloud |
| **VeeskerDB Sandbox — encrypted production data slices** | — | ✅ Cloud |
| **VeeskerDB engine — `.vsk` format library** | ✅ embedded | ✅ embedded |

</div>

> CE AI uses your own Anthropic key (BYOK) and works as a text assistant — SQL explanation and generation without database access. Cloud AI connects directly to your schema for context-aware answers.

**[→ See Cloud plans at veesker.cloud/pricing](https://veesker.cloud/pricing)**

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
- An open-core project — the IDE is Apache 2.0, with the option for separate corporate features under commercial license

**What it isn't:**
- Not a generic multi-database client — DBeaver handles that better
- Not cloud or SaaS — credentials, query history, and database content stay on your machine
- Works with Oracle 9i through 26ai — legacy databases are fully supported via Thick mode auto-discovery (no manual Instant Client setup)
- Not a production-grade tool with warranty — see [terms & disclaimers](#license--disclaimer)

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

- **All object kinds** — Tables, Views, Sequences, Procedures, Functions, Packages, Triggers, Types, REST Modules
- **Per-schema vector indicator** — schemas containing tables with VECTOR columns are flagged
- **Smart filtering** — toggle visibility per kind, hide system schemas, full-text search across all objects
- **Object kind counts** — at a glance, see how much is in each schema
- **System schema toggle** — show/hide ANONYMOUS, SYS, MDSYS, etc.

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

- **Open format** — magic-bytes + version header, libsodium-sealed recipient envelopes, ChaCha20-Poly1305 encrypted DuckDB blob payload. Spec lives in [`docs/superpowers/specs/`](docs/superpowers/specs/).
- **Crypto primitives** — X25519 ECDH for key exchange, ChaCha20-Poly1305 AEAD for content, BLAKE2b for derivation. All from `libsodium-wrappers`.
- **Per-recipient sealing** — `sealForRecipients(contentKey, recipients[], senderKp)` produces N envelopes (one per pubkey); each member decrypts only their envelope with their private key. The content blob itself is encrypted once.
- **DuckDB host** — embedded DuckDB instance for staging tabular payloads with full SQL access. Cross-platform native bindings auto-resolved at runtime.
- **No network** — engine is local-only. Distribution / publish / pull is the integrator's responsibility (Cloud Edition uses Cloudflare R2 + Veesker API).

The full sandbox workflow — owner build pipeline, hosted publish, recipient management, member open/query UX — is a Cloud Edition feature that consumes this engine.

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

```
┌──────────────────────────────────────────────────────────┐
│  Tauri 2 desktop shell (Rust)                            │
│  └── WebView2 / WKWebView                                │
│      └── SvelteKit 5 frontend (Svelte 5 runes)           │
│          └── invoke() → Tauri commands → JSON-RPC stdio  │
├──────────────────────────────────────────────────────────┤
│  Bun sidecar (TypeScript, compiled to native binary)     │
│  └── node-oracledb Thin driver → Oracle 23ai             │
│  └── Anthropic SDK → Claude API                          │
│  └── Embedding providers (Ollama / OpenAI / Voyage)      │
└──────────────────────────────────────────────────────────┘
```

- **Frontend:** Svelte 5 with runes (`$state`, `$derived`, `$effect`), CodeMirror 6 for SQL editing, Chart.js for the dashboard, Tauri 2 for native APIs
- **Sidecar:** Bun-compiled TypeScript binary handles all Oracle communication via JSON-RPC over stdin/stdout
- **Rust shell:** thin Tauri command layer delegating everything to the sidecar; persistence (SQLite for connections + history) and OS keychain integration live in Rust
- **No CGO, no JNI, no Oracle Instant Client:** node-oracledb Thin mode is pure JavaScript

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
- **[docs/superpowers/specs/](docs/superpowers/specs/)** — design specs for major features (debugger, security, VRAS)
- **[docs/superpowers/plans/](docs/superpowers/plans/)** — implementation plans for major features

---

## Pricing & commercial use

Veesker is fully open source under [Apache 2.0](LICENSE). The code is free forever, with no feature gating — every tier uses the exact same codebase.

For larger organizations that eventually want commercial-grade support and the right to use Veesker for revenue-generating work, paid plans are coming. **Until billing is active, Veesker is free for all uses**, including commercial.

If your organization wants to be among the first commercial customers when subscriptions launch, or you need early support arrangements, contact me directly: [geraldovianajr@veesker.cloud](mailto:geraldovianajr@veesker.cloud).

**No telemetry. No license server. No kill-switch.** When commercial plans launch, compliance will be honor-based + EULA — same model as Docker Desktop.

See [COMMERCIAL_USE.md](COMMERCIAL_USE.md) for the long-term commercial framework.

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
