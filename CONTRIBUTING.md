# Contributing to Veesker

Issues, bug reports, and pull requests are welcome. This document covers how to set up the development environment, the code conventions to follow, and the process for submitting a PR.

## Before you start

All contributors must sign the Contributor License Agreement (CLA). The CLA Assistant bot will prompt you automatically when you open a pull request. It is a one-time step per GitHub account.

Read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing.

## Development environment

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- [Rust](https://rustup.rs) stable toolchain
- Tauri platform prerequisites — [guide](https://tauri.app/start/prerequisites/)
- Oracle Database 23ai for full testing (local Docker image `container-registry.oracle.com/database/free` works)

### Setup

```bash
git clone https://github.com/geeviana/veesker.git
cd veesker

# Install frontend dependencies
bun install

# Install sidecar dependencies
cd sidecar && bun install && cd ..

# Start dev mode (Vite + Tauri shell + sidecar)
bun run tauri dev
```

In dev mode, the sidecar runs as a TypeScript process (`bun run sidecar/src/index.ts`), not as a compiled binary. Hot module replacement is active for the frontend. Sidecar changes require restarting the dev session.

### Running tests

```bash
# Frontend unit tests (Vitest)
bun run test

# Sidecar tests
cd sidecar && bun test
```

Tests must pass before a PR is merged. New functionality should include tests.

### Building the sidecar binary

The sidecar must be compiled before `bun run tauri build` can package the app:

```bash
cd sidecar
bun build src/index.ts --compile --minify \
  --outfile ../src-tauri/binaries/veesker-sidecar-$(rustc -vV | sed -n 's|host: ||p')
```

Commit the compiled binary for macOS targets. Do not commit binaries for platforms you cannot test.

## Code conventions

**TypeScript / Svelte:**
- The project uses Biome for formatting and linting. Run `bun run lint` before committing.
- Svelte 5 runes (`$state`, `$derived`, `$effect`) are the standard — do not introduce new `writable` or `readable` stores.
- No comments that describe what the code does. Comments are for non-obvious constraints, workarounds, and invariants.
- No decorative blank lines in Svelte templates.

**Rust:**
- Run `cargo fmt` and `cargo clippy -- -D warnings` before committing Rust changes.
- Tauri commands in `commands.rs` should be thin: marshal arguments, delegate to a helper, return.

**SQL (sidecar):**
- Every object name interpolated into a SQL string must pass through `quoteIdent()` in `oracle.ts`.
- Never pass user-supplied strings directly into SQL without validation.

**General:**
- The project language is English. No Portuguese in code, comments, variable names, or commit messages.
- Commit messages follow Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- Keep commits focused. One logical change per commit.

## Pull request process

1. Fork the repository and create a feature branch from `main`.
2. Make your changes, write tests, run `bun run test` and `bun run lint`.
3. Open a pull request against `main` with a clear description of what changed and why.
4. The CLA Assistant will prompt you to sign the CLA if you have not done so.
5. A maintainer will review and may request changes. Address feedback in new commits (do not force-push during review).
6. Once approved, the maintainer will merge.

## Reporting bugs

Open a GitHub issue with:
- Veesker version (visible in the app window title or `tauri.conf.json`)
- macOS version
- Oracle version
- Steps to reproduce
- Expected vs. actual behavior
- Relevant error messages or console output

## Feature requests

Open a GitHub issue with the `enhancement` label. Describe the use case — what problem it solves and who has it — rather than just the feature itself.
