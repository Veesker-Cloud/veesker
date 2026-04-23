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
