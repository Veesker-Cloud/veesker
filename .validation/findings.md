# Veesker — Validation Findings (live)

## Phase 2: Static Analysis

### svelte-check (10 errors, 30 warnings, 19 files)

**ERRORS (must fix before public):**

1. **`src/lib/sql-splitter.test.ts:4`** — `Cannot find module 'node:path'`
   - **CLAUDE.md notes this as pre-existing non-blocking issue** (`sql-splitter.test.ts` outside app bundle context). Not a blocker.

2. **`src/lib/workspace/ExecutionLog.test.ts:12`** — TabResult type mismatch — `explainNodes` optional vs non-nullable
   - Tests fixture has `explainNodes?: ... | undefined` but type expects `null`
   - Fix: add explicit `explainNodes: null` to test fixture or relax type to `?| undefined`

3. **`src/lib/workspace/QueryHistory.test.ts:38`** — HistoryEntry: `username?` vs `string | null`
   - Same pattern: optional undefined vs non-nullable null

4. **`src/lib/workspace/ResultGrid.test.ts:10`** — Same TabResult issue as #2

5-6. **`src/lib/workspace/OrdsBootstrapModal.svelte:13,14`** — `$state` rune confused with local `state` binding (creates store subscription instead of state)
   - Fix: rename `state` → `ordsState` in component
   - **THIS IS A REAL RUNTIME BUG** — would cause modal not to react

7-8. **`src/lib/workspace/RestModuleDetails.svelte:50,51`** — `'detail' is possibly 'null'`
   - Missing null guard before access. Could crash UI.

**WARNINGS (a11y + non-reactive):**

- DataFlow.svelte:44 — non-`$state` variable updated, won't trigger reactivity
- DmlConfirmModal, CompileErrors, SqlDrawer, SecurityDisclaimerModal, ProcExecModal — non-interactive elements with mouse/keyboard handlers (a11y)
- ExplainPlan.svelte:11 — `nodes` reference only captures initial value (should be `$derived`)
- SqlDrawer.svelte (2x):118,333 — noninteractive tabIndex value (a11y)
- CommandPalette, HelpModal — dialog role missing tabindex (a11y)
- OrdsBootstrapModal:13,14 — `baseUrlInput`, `enabling` updated but not `$state(...)` (BUG — won't reactive update)
- PluginManagerPanel:240 — unused CSS selector
- RestApiBuilder (10x) — initialKind/initialObject only captures initial value (should be derived)
- SheepChat:393 — form label not associated
- routes/+page.svelte:118 — non-interactive `<li>` with role="button" (a11y)


### Tests passing
- Frontend Vitest: **173 passed / 1 skipped / 0 failed** ✅
- Sidecar Bun test: **114 passed / 0 failed** ✅ (with 1 runtime warning — see F-RT-1)
- Rust cargo test: **40 passed / 0 failed / 2 ignored** ✅

### Cargo clippy (4 warnings to address)
- F-RUST-1: `RpcError.data` field never read (dead_code)
- F-RUST-2: `worst_state` function never used (dead_code)
- F-RUST-3: `delete_api_key` function never used (dead_code)
- F-RUST-4: `assemble_basic_row` has 8 args (clippy::too_many_arguments) — refactor

### Cargo fmt
- F-FMT-1: Multiple files have formatting deviations. Fix: `cargo fmt`.

### Sidecar runtime error during tests (passes but logs error)
- F-RT-1: `oracle.ts:425` `drainDbmsOutput` — `TypeError: undefined is not an object (evaluating 'ob.STATUS')`. Need null guard before access.

### Dependency audits
- Frontend: 1 LOW (cookie <0.7.0 via @sveltejs/kit). Fix: `bun update`.
- Sidecar: 0 vulnerabilities ✅
- Rust (cargo audit): pending install

## Phase 3: Cargo audit (Rust deps)

### Unmaintained warnings (19 — informational, not exploits)
- 11 GTK3 binding crates (atk, gdk, gtk, gdkwayland, etc.) marked unmaintained — **Linux-only**, doesn't affect Windows/macOS targets
- proc-macro-error, unic-* crates — unmaintained, no known security impact
- fxhash — unmaintained

### Actual unsoundness/security (2)
- F-AUDIT-1: **RUSTSEC-2024-0429** `glib::VariantStrIter` — unsoundness in Iterator impl. **Linux only** (gtk path), doesn't affect Windows/macOS.
- F-AUDIT-2: **RUSTSEC-2026-0097** `rand` — unsound with custom logger using `rand::rng()`. Need to verify if Veesker uses custom logger; if not, no impact.

### Verdict
- **No critical CVE blocks public release**
- GTK warnings are tauri-runtime transitively, not directly used; will resolve when tauri upgrades to gtk4 (planned)
- Recommendation: Note in SECURITY.md that we monitor RUSTSEC and Linux build is best-effort pre-release

