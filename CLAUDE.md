# Veesker — Claude Code Guide

## Project overview

Veesker is an Oracle 23ai desktop IDE built with Tauri 2 (Rust shell) + SvelteKit 5 (Svelte runes) frontend + a Bun/TypeScript sidecar that owns all Oracle communication over JSON-RPC via stdin/stdout.

**Tech stack:**
- Frontend: SvelteKit 5, Svelte 5 runes (`$state`, `$derived`, `$effect`) — no Svelte stores
- Rust shell: Tauri 2, `src-tauri/src/`
- Sidecar: Bun + TypeScript, `sidecar/src/`, compiled to a native binary
- Database: `node-oracledb` Thin mode (no Oracle Instant Client required)
- Tests: Vitest (frontend), Bun test (sidecar)
- Linter/formatter: Biome

---

## Windows prerequisites

Install all of these before doing anything else.

### 1. Bun

```powershell
winget install Oven-sh.Bun
```

Verify: `bun --version` (need ≥ 1.1)

### 2. Rust stable toolchain

```powershell
winget install Rustlang.Rustup
rustup default stable
rustup target add x86_64-pc-windows-msvc
```

Verify: `rustc --version`

### 3. MSVC Build Tools

Required by the Rust toolchain. Open the Visual Studio Installer and install **"Desktop development with C++"**, or run:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

After install, open a **Developer PowerShell for VS 2022** (or add MSVC to PATH) before running any `cargo` command.

### 4. WebView2 runtime

- **Windows 11**: pre-installed, nothing to do.
- **Windows 10**: download and install the Evergreen Bootstrapper from https://developer.microsoft.com/en-us/microsoft-edge/webview2/

### 5. Node.js (optional, only if Vite tooling complains)

Bun handles everything; Node.js is not required. If a build step fails with a Node error, install Node via `winget install OpenJS.NodeJS.LTS`.

---

## Setup

Run these commands once after cloning.

```powershell
# From the repo root
bun install

# Install sidecar dependencies
cd sidecar
bun install
cd ..
```

---

## Compile the sidecar binary (Windows)

The sidecar must be compiled before `tauri build` (and before `tauri dev` if the binary is missing).

```powershell
cd sidecar
bun build src/index.ts --compile --minify --outfile ../src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe
cd ..
```

The file name **must** match `veesker-sidecar-<target-triple>.exe`. Tauri reads `externalBin: ["binaries/veesker-sidecar"]` from `tauri.conf.json` and appends the host triple automatically at build/run time.

To confirm your target triple:

```powershell
rustc -vV
# Look for the "host:" line, e.g. host: x86_64-pc-windows-msvc
```

### Zombie sidecar processes (Windows)

If `tauri dev` fails with `PermissionDenied` when copying the sidecar binary, a previous dev session left zombie processes locking the file. Kill them first:

```powershell
Get-Process | Where-Object { $_.Name -like "*veesker*" } | Stop-Process -Force
```

Then retry `bun run tauri dev`.

---

## macOS prerequisites

Install all of these before building on macOS.

### 1. Xcode Command Line Tools

```bash
xcode-select --install
```

### 2. Bun

```bash
brew install oven-sh/bun/bun
```

Verify: `bun --version` (need ≥ 1.1)

### 3. Rust stable toolchain

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
```

Add the correct target for your Mac:

```bash
# Apple Silicon (M1/M2/M3)
rustup target add aarch64-apple-darwin

# Intel Mac
rustup target add x86_64-apple-darwin
```

Verify: `rustc -vV` — look for the `host:` line.

---

## Compile the sidecar binary (macOS)

**Intel Mac (`x86_64-apple-darwin`):** the pre-compiled binary is committed to the repo at `src-tauri/binaries/veesker-sidecar-x86_64-apple-darwin`. You only need to recompile it if you change files under `sidecar/src/`.

**Apple Silicon (`aarch64-apple-darwin`):** no pre-compiled binary is committed. You **must** compile before running `tauri dev` or `tauri build`.

```bash
cd sidecar

# Apple Silicon — required before every first run and after sidecar changes
bun build src/index.ts --compile --minify --outfile ../src-tauri/binaries/veesker-sidecar-aarch64-apple-darwin

# Intel Mac — only needed after sidecar source changes
bun build src/index.ts --compile --minify --outfile ../src-tauri/binaries/veesker-sidecar-x86_64-apple-darwin

cd ..
```

The binary has no `.exe` extension on macOS. Tauri appends the target triple automatically.

**Note:** `sidecar/package.json` has a `build` script that targets `x86_64-apple-darwin`. On Apple Silicon, run the command above directly — do not use `bun run build` inside the sidecar directory without editing the script first.

After compiling, run normally:

```bash
bun run tauri dev        # development
bun run tauri build      # production (.dmg / .app in src-tauri/target/release/bundle/)
```

### macOS-specific behavior

**Code signing:** `tauri.conf.json` uses `signingIdentity: "-"` (ad-hoc signing). No Apple Developer account or certificate is required for local builds. The `.dmg`/`.app` produced by `tauri build` will show a Gatekeeper warning on other machines — this is expected for pre-release builds.

**Keychain:** The `keyring` crate uses macOS Keychain (`apple-native` feature) to store Oracle connection passwords. Entries appear under the Keychain app as items prefixed with `veesker:`. This is automatic — no configuration needed.

**App data directory:** Tauri stores all persistent data (SQLite DB, wallet files, audit logs) at:
```
~/Library/Application Support/dev.veesker.app/
```
Key paths:
- `veesker.db` — connection metadata and query history
- `wallets/` — Oracle wallet zip files
- `audit/` — SQL execution audit logs (`YYYY-MM-DD.jsonl`)

**Zombie sidecar processes (macOS):** If `tauri dev` fails because the sidecar binary is locked, kill lingering processes:
```bash
pkill -f veesker-sidecar
```

---

## Development mode

```powershell
bun run tauri dev
```

This starts Vite (port 1420) + the Tauri shell + the sidecar as a live Bun process (`bun run sidecar/src/index.ts`). Hot module replacement is active for the frontend. Sidecar source changes require restarting the dev session.

---

## Production build

```powershell
# 1. Compile the sidecar binary first (see above)
# 2. Build the app
bun run tauri build
```

The installer is written to `src-tauri/target/release/bundle/`.

---

## Running tests

```powershell
# Frontend unit tests (Vitest)
bun run test

# Sidecar tests
cd sidecar
bun test
cd ..
```

Tests must pass before committing. `sql-splitter.test.ts` has pre-existing import errors (`node:fs`, `node:url`, `node:path`) that are not blocking — they exist because the file is outside the app bundle context. All other tests must be green.

---

## Linting

```powershell
bun run lint         # Biome — frontend + sidecar TypeScript/Svelte
cargo fmt            # Rust formatting (run inside src-tauri/ or from root)
cargo clippy -- -D warnings   # Rust linting
```

Fix all Biome and clippy warnings before committing.

---

## Code conventions

- **Svelte 5 runes only.** Use `$state`, `$derived`, `$effect`. Do not introduce `writable` or `readable` stores.
- **No comments describing what the code does.** Comments only for non-obvious constraints or workarounds.
- **No decorative blank lines in Svelte templates.**
- **SQL safety.** Every Oracle object name interpolated into SQL must pass through `quoteIdent()` in `sidecar/src/oracle.ts`. Never pass user strings directly to SQL.
- **English only.** No Portuguese in code, comments, variable names, or commit messages.
- **Conventional Commits.** Prefix: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- **Thin Tauri commands.** `src-tauri/src/commands.rs` commands marshal args and delegate to helpers — no business logic in command handlers.
- **CSS theming.** Never hardcode background colors in components. Always use CSS variables from `src/app.css`: `--bg-surface` (main panel), `--bg-surface-alt` (secondary/detail panels), `--bg-page` (page root), `--text-primary`, `--text-muted`, `--border`. Components that don't declare `background` inherit white in dark mode.

---

## Windows-specific notes

### Credential storage
The `keyring` crate uses **Windows Credential Manager** on Windows. Stored connection passwords appear under "Windows Credentials" → "Generic Credentials" prefixed with `veesker:`. This is automatic — no configuration needed.

### Line endings
The repo uses LF. Git should handle this, but if you see diff noise:

```powershell
git config core.autocrlf false
```

Set this before checking out or the Biome formatter will flag CRLF files.

### Path separators
The sidecar is invoked by Tauri with an absolute path — no path issues at runtime. If you write tests that reference file paths, use `path.join()` or `import.meta.url`-relative paths, not hardcoded slashes.

### Port conflicts
Dev mode uses port 1420. If something else holds that port, Vite will error. Find and kill the process:

```powershell
netstat -aon | findstr :1420
taskkill /PID <PID> /F
```

---

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `error[E0463]: can't find crate for...` | MSVC tools not on PATH | Open Developer PowerShell for VS 2022 |
| `NAPI: dlopen failed` | Wrong sidecar binary arch | Recompile with `x86_64-pc-windows-msvc` target |
| `WebView2 not found` | Missing runtime on Win 10 | Install WebView2 Evergreen Bootstrapper |
| `bun: command not found` | Bun not in PATH after install | Restart terminal or add `%USERPROFILE%\.bun\bin` to PATH |
| `Cannot find module 'node:fs'` in tests | Pre-existing issue in `sql-splitter.test.ts` | Not blocking — ignore this specific file |
| Blank app window, no content | Vite not running or CSP block | Check `bun run dev` output; ensure port 1420 is free |
| `-32601 Method not found: <rpc.method>` | Old sidecar binary running — new RPC handlers not compiled in | Recompile sidecar binary (see above), restart `tauri dev` |
| `PermissionDenied` in `tauri-build lib.rs` | Zombie sidecar processes locking the binary | Kill with `Get-Process \| Where-Object { $_.Name -like "*veesker*" } \| Stop-Process -Force` |
| `ORA-01780 string literal required` in EXPLAIN PLAN | `EXPLAIN PLAN SET STATEMENT_ID = :bind` — Oracle requires a literal, not a bind variable | Use `'${sid}'` string interpolation for STATEMENT_ID; sid is machine-generated so this is safe |

---

## Project structure (key paths)

```
src/                        SvelteKit frontend
  lib/
    workspace/              Main UI components (SqlDrawer, SheepChat, VectorScatter, ...)
    stores/                 Svelte 5 rune-based state
    oracle.ts               Tauri invoke wrappers
sidecar/
  src/
    index.ts                JSON-RPC entry point
    oracle.ts               node-oracledb Thin mode, all DB operations
    ai.ts                   Claude API integration
src-tauri/
  src/
    commands.rs             Tauri command handlers
    main.rs                 App bootstrap
  binaries/                 Compiled sidecar binaries (committed for macOS, build locally for Windows)
  tauri.conf.json           Tauri config, externalBin, CSP
docs/
  screenshots/              App screenshots for README
```
