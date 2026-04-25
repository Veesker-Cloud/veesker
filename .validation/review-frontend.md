# Veesker Frontend Code Review (Phase 4)

**Reviewer:** Senior Code Reviewer (Claude Opus 4.7)
**Date:** 2026-04-25
**Scope:** SvelteKit 5 + Svelte 5 runes frontend (read-only review, no code modified)
**Repo:** `gevianajr/veesker` @ main

---

## BLOCKER

**None confirmed.** The svelte-check items previously flagged as runtime crashes are either (a) false positives in current source, or (b) low-blast-radius type-narrowing issues that don't actually crash. Detail below.

### B1. ~~OrdsBootstrapModal: `state` shadowing $state rune (svelte-check)~~ **NOT A RUNTIME BUG**
- File: `src/lib/workspace/OrdsBootstrapModal.svelte:11-14`
- Re-read the source: `state` on line 11 is a **prop name** received from the parent (`OrdsDetectResult`), not a shadowed rune. Lines 13-14 (`baseUrlInput`, `enabling`) are *correctly* declared with `$state(...)`.
- The svelte-check warning is about the prop name colliding with the rune namespace inside this component. Svelte 5 props are themselves reactive proxies, so `state.installed` reads in `$derived.by` (line 16) work fine.
- **Verdict:** Cosmetic / lint warning. Renaming the prop to `ordsState` would silence the warning and is best practice, but this does **not** prevent the modal from reacting. Demote from blocker to POLISH.

### B2. ~~RestModuleDetails: `detail` possibly null on lines 50-51~~ **TYPE-SAFETY ONLY, NOT A CRASH**
- File: `src/lib/workspace/RestModuleDetails.svelte:50-51`
- The `<button onclick={() => onTest(detail.module.basePath, "", "GET")}>` is rendered inside `{#if detail}` (line 45) where `detail` is non-null. TypeScript narrowing is lost across the arrow-function callback, hence the warning.
- At runtime, the buttons only exist while the if-block is mounted; clicks always see non-null `detail`. **No crash possible.**
- Recommended fix (POLISH): `onclick={() => detail && onTest(detail.module.basePath, "", "GET")}` or a narrowed local `const d = detail`.

### XSS / Open Redirects / Sensitive Data Leakage — **all clean**

| Risk | Status | Evidence |
|---|---|---|
| `{@html}` from user input | Clean | Two usages: `SheepChat.svelte:438` (escaped via `escapeHtml` first; markdown regex only adds known tags around already-escaped text) and `HelpModal.svelte:174` (renders `MODULES[...].demo` — bundled developer-authored constants from `src/lib/help-modules.ts`, not user data). |
| `innerHTML` writes | None in `src/` |
| `openUrl(...)` with user URL | Clean — only one dynamic call (`workspace/[id]/+page.svelte:628`), and the components of that URL come from user-supplied/server-supplied trusted values (their own ORDS deployment). The Rust shell `ords_test_http` even enforces a `allowedBaseUrl` allow-list at the IPC boundary. |
| Secrets in `console.*` | Clean — searched all `console.{log,warn,error,info}` for `password\|apiKey\|secret\|token`: no matches. The four console calls are non-sensitive debug warnings (history save fail, plugin double-register, missing tab, updater check fail). |
| API key in localStorage | License key (informational, not secret) is in localStorage. Anthropic API key uses `aiKeySave/Get` which goes through Tauri/keyring. |
| OAuth token in DOM | `RestTestPanel.svelte` adds `Bearer <token>` only into in-memory `headers` state, then displays it in an editable input — that's the user's own token in their own UI. Acceptable. |

### Incorrect state updates → wrong tab gets results — **clean**

`sql-editor.svelte.ts` carefully captures `tabId` and `resultId` before async calls and re-resolves them on completion (e.g. lines 398-407, 533-543, 672-681). After-the-fact compile-error fetches use `_tabs.find((x) => x.id === tabId)` — if the tab was closed during the round trip, it's a no-op, not a wrong-tab attribution. Cancellation uses per-request UUIDs. **No data corruption found.**

---

## IMPORTANT

### I1. Race condition: rapid object selection mutates shared `details` state
- File: `src/routes/workspace/[id]/+page.svelte:241-294` (`loadDetails`, `selectObject`)
- If the user clicks Table A then Table B before A's `tableDescribe`/`tableRelated` returns, A's response can arrive *after* B's and overwrite the visible details. UX bug, not data corruption.
- Fix: capture a request token before each call; on resolution, ignore if `selected` no longer matches the originating object.

### I2. Race condition: dataflow loader has same problem
- File: `src/routes/workspace/[id]/+page.svelte:228-239` (`loadDataflow`)
- Same pattern as I1. A late `objectDataflowGet` resolution overwrites the current selection's dataflow.

### I3. SqlEditor `$effect` doesn't guard against `view` deletion mid-update
- File: `src/lib/workspace/SqlEditor.svelte:131-148`
- Inside the diagnostics effect, `view!` is non-null-asserted twice (lines 138-139) inside a `.map` callback. If `onDestroy` runs while the effect is in flight (race during navigation), `view` is set to `null` (line 120) — the `view!.state.doc.line(...)` calls would throw.
- Practical impact: low (effects don't currently yield), but still a defensive-programming gap.

### I4. `compileErrors` `$effect` only re-runs on `compileErrors` reference change
- File: `src/lib/workspace/SqlEditor.svelte:131-148`
- The effect reads `compileErrors` (a prop). If the parent mutates the same array in place (push/splice) instead of reassigning, the effect won't fire. Reviewing `sql-editor.svelte.ts`, the store always replaces with a new array (`r.compileErrors = ceRes.ok ? ceRes.data : []`), so this works. Document the contract or switch to deep tracking — currently fragile.

### I5. UpdateNotification leaks setTimeout if unmounted before fire
- File: `src/lib/workspace/UpdateNotification.svelte:11-13`
- `setTimeout(() => void checkForUpdate(), 2000)` has no cleanup. If the user navigates away within 2s, the timeout still fires and tries to set `$state` on a destroyed component (Svelte 5 typically tolerates this, but it's a leak).
- Fix: store the handle, clear in cleanup return.

### I6. Type-safety holes (`as any`)
- `SheepChat.svelte:151,219,309` — chart type/aggregation casts, error message cast. The casts at 151 and 219 stem from string-keyed maps; could be tightened with `as ChartType`/`as ChartAggregation`. The `(res.error as any)?.message` at 309 would be eliminated by a proper `WorkspaceError` typed catch.
- `routes/workspace/[id]/+page.svelte:302,659` — `as unknown as Record<string, unknown>` and `kind as any` casts.
- These are not bugs but reduce future refactor safety.

### I7. `selectObject` opens DDL tab on every PL/SQL click
- File: `src/routes/workspace/[id]/+page.svelte:267-282`
- Clicking the same procedure twice opens it twice (since `openWithDdl` checks by `title`, but Object Details refresh causes `objectDdlGet` to re-run unnecessarily). Minor UX issue.

### I8. Test-fixture / type drift (already documented in `findings.md`)
- `ExecutionLog.test.ts:12`, `ResultGrid.test.ts:10`, `QueryHistory.test.ts:38` — fixtures use optional-undefined where types expect `T | null`. **Not a runtime bug**, but blocks `svelte-check` from going green. Confirmed real.

### I9. `RestApiBuilder` — `initialKind`/`initialObject` only captured at mount
- File: `src/lib/workspace/RestApiBuilder.svelte:37-63`
- The 10 svelte-check warnings here flag that `endpointType`, `sourceObject`, `selectedObjectKey`, etc. are initialized once from props. If the parent changes `initialKind` while the modal is open, the form won't update.
- In practice the parent always closes/reopens this modal (see `apiBuilderInitial` flow in `+page.svelte:331-334`), so the bug is unreachable. Confirm and add a comment, or wrap initial values in `$derived`.

### I10. `RestTestPanel` Basic-auth `btoa` will throw on non-ASCII secrets
- File: `src/lib/workspace/RestTestPanel.svelte:80`
- `btoa(\`${oauthClientId.trim()}:${oauthClientSecret.trim()}\`)` throws `InvalidCharacterError` if the secret contains non-Latin-1 characters. ORDS-generated client_secrets are alphanumeric so this rarely bites, but a user could paste a UTF-8 secret.
- Fix: `btoa(unescape(encodeURIComponent(...)))` or use `Buffer.from(..., 'utf-8').toString('base64')` polyfill / `TextEncoder`.

### I11. ExplainPlan `nodes` reference only captures initial value (svelte-check)
- File: `src/lib/workspace/ExplainPlan.svelte:11`
- Confirmed against svelte-check output. If the parent passes a new `nodes` array, the local copy doesn't refresh. Currently `SqlDrawer` re-mounts ExplainPlan via `{#if activeTabResult?.status === "explain"}`, masking the bug. Wrap as `$derived` for safety.

### I12. Unused or dead error states in license/ords
- `OrdsStore.error` (`ords.svelte.ts:27`) is set on failure but never displayed in any UI we found. The user gets silent failure. Either surface the error or drop the field.

### I13. Parent passes `apiKey: null` to `aiSuggestEndpoint`, sidecar handles
- File: `src/lib/workspace/RestApiBuilder.svelte:78`
- Acceptable design (sidecar falls back to `ANTHROPIC_API_KEY` env), but parent should display a clearer error if the env var is also missing.

---

## POLISH

### P1. CLAUDE.md violations — hardcoded backgrounds (DARK MODE BREAKS)
The project mandate (CLAUDE.md): "Never hardcode background colors in components. Always use CSS variables (`--bg-surface`, `--bg-surface-alt`, `--bg-page`, ...)."

Confirmed violations:
- **`SqlDrawer.svelte:422`** — `background: #fff` for `.drawer` (light-only)
- **`SqlDrawer.svelte:437,461`** — `background: #1e1a16`, hardcoded dark in `.tabbar`, `.tab.active`
- **`SqlDrawer.svelte:589`** — `color: rgba(26,22,18,0.5)` on `.empty`
- **`SheepChat.svelte:516,532,781,894`** — `background: #1c1710`, `#100e0b` hardcoded
- These render correctly in current dark theme but ignore the theme system entirely. If a light theme is added later, this drawer + chat panel will look broken.

### P2. `state` shadowing in OrdsBootstrapModal
- See B1. Rename the prop from `state` to `ordsState` to silence svelte-check + reduce reader confusion.

### P3. RestModuleDetails: tighten the type narrowing
- See B2. `{#if detail}` should hoist a non-null local: `{#if detail}{@const d = detail} ... onclick={() => onTest(d.module.basePath, "", "GET")}`.

### P4. Accessibility (svelte-check warnings)
- `SqlDrawer.svelte:118,333` — `tabindex="0"` on `<div role="separator">`. Separators are typically not focusable; consider tabindex="-1" or remove keyboard handlers.
- `routes/+page.svelte:118` — non-interactive `<li role="button">`. Convert to `<button>` or wrap content properly.
- `SheepChat.svelte:393` — `<label>` without `for`/control association.
- `DmlConfirmModal`, `CompileErrors`, `SecurityDisclaimerModal`, `ProcExecModal` — non-interactive elements with mouse handlers.
- All non-blocking for a desktop-only app, but they hurt screen-reader users.

### P5. `DataFlow.svelte:44` `centerEl` not `$state`
- A non-reactive ref is updated, won't trigger reactivity. Currently masked by render order. Wrap in `$state(...)` or `$bindable`.

### P6. `PluginManagerPanel.svelte:240` unused CSS selector
- Dead style. Remove.

### P7. Bilingual UI (Portuguese mixed with English)
- The UI string `"VRAS — Configuração ORDS"`, `"Habilitar agora"`, etc., are PT-BR. CLAUDE.md mandates "English only … No Portuguese in code, comments, variable names, or commit messages." This applies to user-facing strings in components destined for an open-source international audience.
- Affected files: `OrdsBootstrapModal.svelte`, `RestApiBuilder.svelte`, `RestApiPreview.svelte`, `RestModuleDetails.svelte`, `RestTestPanel.svelte`, `UpdateNotification.svelte` (most strings PT), `routes/workspace/[id]/+page.svelte:625,637,650`.
- Defer to product decision (could be intentional during a Brazil-first beta), but flag for v1.0 i18n.

### P8. `console.warn` for plugin double-register
- `plugins.ts:34` — silent override on duplicate `id`. If any future user-installed plugin double-registers, the second wins without surfacing. Consider throwing in dev or returning a Result.

### P9. Inconsistent commit/rollback alert styling
- `SqlDrawer.svelte:247,260` use `window.alert("Commit failed: ...")`. Other components use a banner/error UI. Consolidate to a single pattern (toast or banner).

### P10. `SheepChat.svelte:309` error message cast
- Use `WorkspaceError` type rather than `(res.error as any)?.message`.

### P11. `dashboard.svelte.ts` ROW_CAP silently truncates
- `dashboard.svelte.ts:14,22` — caps rows at 500 silently when adding to dashboard. The store records `totalRows` but UI consumers must remember to surface "showing X of Y rows" warnings. Consider exporting a `truncated: boolean` flag explicitly.

---

## Files Reviewed

| Path | Status |
|---|---|
| `C:\Users\geefa\Documents\veesker\src\lib\stores\sql-editor.svelte.ts` | Read in full (905 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\stores\dashboard.svelte.ts` | Read in full (35 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\stores\license.svelte.ts` | Read in full (85 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\stores\ords.svelte.ts` | Read in full (63 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\workspace.ts` | Read in full — IPC boundary OK (570 LOC). NB: there is no `src/lib/oracle.ts`; the IPC wrappers live in `workspace.ts`, `connection.ts`, `connections.ts`, `sql-query.ts`, `query-history.ts` |
| `C:\Users\geefa\Documents\veesker\src\lib\sql-safety.ts` | Read in full (39 LOC) — clean DML detection regex, strips comments |
| `C:\Users\geefa\Documents\veesker\src\lib\sql-query.ts` | Read in full (49 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\connection.ts` | Read in full |
| `C:\Users\geefa\Documents\veesker\src\lib\workspace\SqlDrawer.svelte` | Read in full (628 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\workspace\SqlEditor.svelte` | Read in full (179 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\workspace\SheepChat.svelte` | Read in full (934 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\workspace\SchemaTree.svelte` | Read in full (655 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\workspace\RestApiBuilder.svelte` | Read in full (536 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\workspace\RestApiPreview.svelte` | Read in full (141 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\workspace\RestTestPanel.svelte` | Read in full (338 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\workspace\OrdsBootstrapModal.svelte` | Read in full (162 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\workspace\RestModuleDetails.svelte` | Read in full (262 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\workspace\CommercialUseModal.svelte` | Read in full (152 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\workspace\PluginManagerPanel.svelte` | Read in full (254 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\workspace\UpdateNotification.svelte` | Read in full (236 LOC) |
| `C:\Users\geefa\Documents\veesker\src\lib\workspace\HelpModal.svelte` | Header read (200 LOC of ~700) — `{@html}` source confirmed safe |
| `C:\Users\geefa\Documents\veesker\src\lib\plugins.ts` | Read in full (147 LOC) |
| `C:\Users\geefa\Documents\veesker\src\routes\+layout.svelte` | Read in full |
| `C:\Users\geefa\Documents\veesker\src\routes\workspace\[id]\+page.svelte` | Reviewed key sections (lines 1-200, 200-500, 500-720) |
| `C:\Users\geefa\Documents\veesker\src\routes\connections\[id]\edit\+page.svelte` | Read in full |
| `C:\Users\geefa\Documents\veesker\src\routes\+page.svelte` | Spot-checked (line 100-140 around card click) |

### Search audits performed
- `{@html}` / `innerHTML` across `src/` — 2 hits, both safe (see BLOCKER section)
- `openUrl(...)` across `src/` — 7 hits, all hardcoded URLs except one which uses user-controlled ORDS base URL
- `console.{log,warn,error,info}` matching `password\|apiKey\|secret\|token` (case-insensitive) — 0 matches
- `cancelActive` / `Mod-.` — Cmd/Ctrl+. cancellation confirmed wired in `routes/workspace/[id]/+page.svelte:514-524`
- CSP audit — `tauri.conf.json` allows Google Fonts (`fonts.googleapis.com` + `fonts.gstatic.com`), Anthropic API, IPC, and `localhost:1420`. `style-src 'unsafe-inline'` is needed for Svelte scoped styles. No `unsafe-eval`.

### Specific feature checks performed
- **Cmd/Ctrl+. cancels in-flight query:** Confirmed at `routes/workspace/[id]/+page.svelte:514-524` (window-level keydown handler) → `sqlEditor.cancelActive()` → `queryCancel(requestId)` invoke. Per-request UUID prevents cancelling the wrong query. Works across SQL drawer/editor.
- **SheepChat does NOT auto-submit user messages:** Confirmed. `pendingMessage` only sets `input` (line 45-47); user must press Enter or click Send. Suggestion-button click (line 426) IS user-initiated. Quick-action buttons (line 447) are user-initiated. Auto-`startAnalyze` (line 51) only seeds the assistant's first guidance prompt — doesn't send anything to Claude.
- **API key handling:** Anthropic key flows through Tauri `ai_key_save`/`ai_key_get` (OS keychain). License key in localStorage (informational only, not a credential).
- **Multi-statement query results never get attributed to wrong tab:** Confirmed via tabId/resultId capture pattern.

---

## Verdict

**SAFE TO RELEASE** with the following caveats:

1. **No BLOCKERs found.** The two svelte-check items previously flagged as runtime crashes (`OrdsBootstrapModal` state shadowing; `RestModuleDetails` null `detail`) are real warnings but neither prevents the modal from working at runtime.
2. **13 IMPORTANT items** should be fixed in the v1.0 polish pass before public launch but are not security-critical:
   - Race conditions I1, I2 (UX-only — late responses overwriting current selection)
   - Memory leak I5 (UpdateNotification setTimeout)
   - Defensive coding I3, I4 (SqlEditor)
   - Type safety I6, I8 (any-casts, fixture/type drift)
   - Edge-case bugs I10 (btoa on non-ASCII OAuth secret)
   - Polish-tier I7, I9, I11, I12, I13
3. **11 POLISH items**, mostly: (a) CLAUDE.md CSS-variable mandate violations in the SqlDrawer + SheepChat (pre-existing technical debt); (b) PT-BR strings in user-facing UI; (c) a11y warnings; (d) test-fixture type drift.

**Recommended pre-release work (~half a day):**
- Fix I5 (timeout cleanup)
- Fix I10 (btoa)
- Fix B1/P2 (rename `state` prop → `ordsState`)
- Fix B2/P3 (narrow `detail` once with `{@const d = detail}`)
- Fix I8 fixtures (set `explainNodes: null` explicitly, type `username` consistently)
- Fix P1 selectively for SqlDrawer's `.drawer` `background: #fff` so dark mode looks correct (highest visual impact)

**BLOCKERS FOUND: 0**
