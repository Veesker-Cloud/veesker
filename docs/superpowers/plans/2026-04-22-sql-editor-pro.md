# SQL Editor Pro (Phase 4b) Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` (Option B — implementer subagent only, controller reviews diffs inline). Tasks are designed to dispatch sequentially.

**Goal:** Upgrade Phase 4a SQL Editor MVP into a production-grade SQL workbench with multi-statement execution, cancel, query history, file I/O, export, sortable/resizable grid columns.

**Architecture:** Extend existing JSON-RPC sidecar protocol with `query.cancel` + multi-result responses. Frontend store evolves from `tab.result: QueryResult | null` to `tab.results: TabResult[]`. New PL/SQL-aware splitter in sidecar. New SQLite table for history. New left panel in SqlDrawer for history. New ExecutionLog above grid.

**Tech Stack:** Bun sidecar (NDJSON over stdio), Tauri 2 commands, Svelte 5 runes, rusqlite, CodeMirror 6, tauri-plugin-fs, tauri-plugin-dialog.

**Branch:** main (direct, no feature branches per user workflow).

---

## Architectural Decisions (locked)

1. **Multi-statement results:** hybrid log + selectable grid (Q2 choice D). Log shows compact one-line-per-statement summary; clicking a row loads its result into the grid.
2. **Cancel:** triggered by overlay button on grid pane during running + `Cmd+.` shortcut. Aborts whole script (subsequent statements skipped). Server-side `connection.break()` + `cancel()`.
3. **Splitter rules:** PL/SQL aware. Respects string literals (`'...'`, `q'[...]'` etc.), quoted identifiers (`"..."`), line comments (`--`), block comments (`/* */`), PL/SQL block boundaries (DECLARE/BEGIN/CREATE [OR REPLACE] {FUNCTION|PROCEDURE|TRIGGER|PACKAGE|TYPE} ... terminated by `/` on own line). Forgiving EOF (treats end-of-input as terminator if `/` missing).
4. **History storage:** SQLite (`query_history` table, FK to connections). Per-connection panel always-visible (collapsible) on left side of drawer.
5. **History entries:** every execution counted (no dedup).
6. **File I/O:** Cmd+S/Cmd+Shift+S/Cmd+O. `●` dirty indicator. `tauri-plugin-fs` with scope `$HOME/**`.
7. **Run shortcuts:** Cmd+Enter = run-statement-at-cursor (or run-selection if selection exists). Cmd+Shift+Enter = run all. F5 = alias of run all.
8. **Export:** "Export ▼" button in grid footer. CSV (RFC 4180, comma) / JSON (array of objects). Native save dialog. UTF-8.
9. **Sort:** click header asc → desc → unsort. Single column. Client-side. Nulls last.
10. **Resize:** drag right border of header (4px, `col-resize`). Min 60 / max 800. Double-click = auto-fit. Not persisted.

## Type contracts (locked)

```ts
export type TabResult = {
  id: string;                           // local uuid
  statementIndex: number;               // 1-based
  sqlPreview: string;                   // first 80 chars
  status: "running" | "ok" | "error" | "cancelled";
  result: QueryResult | null;           // null for DDL/DML/error/running
  error: { code: number; message: string } | null;
  elapsedMs: number | null;
  startedAt: number;                    // Date.now()
};

export type SqlTab = {
  id: string;
  title: string;
  sql: string;
  filePath: string | null;
  isDirty: boolean;
  savedContent: string | null;
  results: TabResult[];
  activeResultId: string | null;
  runningRequestIds: string[];
};

export type HistoryEntry = {
  id: number;
  connectionId: string;
  sql: string;
  executedAt: number;
  success: boolean;
  rowCount: number | null;
  elapsedMs: number;
  errorCode: number | null;
  errorMessage: string | null;
};
```

## JSON-RPC protocol additions

```jsonc
// REQUEST query.execute (extended): adds splitMulti
{ "method": "query.execute", "params": { "sql": "<full script>", "splitMulti": true }, "id": "req-abc" }
// RESPONSE: array of statement results
{ "result": { "results": [
    { "statementIndex": 1, "status": "ok", "rowCount": 1, "elapsedMs": 12, "data": null },
    { "statementIndex": 2, "status": "ok", "rowCount": 0, "elapsedMs": 8, "data": { "columns": [...], "rows": [...] } },
    { "statementIndex": 3, "status": "error", "code": 942, "message": "ORA-00942: ..." }
  ] }, "id": "req-abc" }

// REQUEST query.cancel
{ "method": "query.cancel", "params": { "requestId": "req-abc" }, "id": "cancel-1" }
// RESPONSE
{ "result": { "cancelled": true, "killedStatement": 2 }, "id": "cancel-1" }
```

When `splitMulti: false` (default for backward compat), behavior matches Phase 4a (single statement, single result wrapped in `results: [...]` of length 1).

## SQLite schema (Task 5 migration)

```sql
CREATE TABLE query_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  sql TEXT NOT NULL,
  executed_at INTEGER NOT NULL,
  success INTEGER NOT NULL,
  row_count INTEGER,
  elapsed_ms INTEGER NOT NULL,
  error_code INTEGER,
  error_message TEXT
);
CREATE INDEX idx_history_conn_time ON query_history(connection_id, executed_at DESC);
CREATE INDEX idx_history_search ON query_history(connection_id, sql);
```

---

## Tasks

### Task 1 — SQL Splitter (PL/SQL aware)

**Files:**
- Create: `sidecar/src/sql-splitter.ts`
- Create: `sidecar/src/sql-splitter.test.ts`

**Acceptance:**
- Exports `splitSql(input: string): { statements: string[]; errors: { line: number; message: string }[] }`
- Each returned statement is trimmed, no trailing `;` or `/`
- ~30 tests covering: empty input, single statement no terminator, single statement with `;`, comments (`--` and `/* */`), string literals (`'...'`, `'it''s'`), Oracle q-quoted (`q'[...]'`, `q'<...>'`, `q'(...)'`, `q'{...}'`), quoted identifiers (`"weird;name"`), nested PL/SQL block (DECLARE/BEGIN/END terminated by `/` on own line), CREATE PROCEDURE/FUNCTION/TRIGGER/PACKAGE blocks, `;` inside block-string-comment combos, unterminated string error, missing `/` for PL/SQL block at EOF (forgiving — accept), whitespace-only input, multiple PL/SQL blocks back-to-back, mix of regular SQL + PL/SQL block.

**Done when:**
- `cd sidecar && bun test src/sql-splitter.test.ts` → all pass
- Module is pure (no I/O, no globals); easy to unit test
- Self-review confirms no regex naïveté (shouldn't crash on adversarial input)

**Commit message format:** `feat(sidecar): PL/SQL aware SQL splitter`

---

### Task 2 — Cancel query (protocol + frontend)

**Files:**
- Modify: `sidecar/src/handlers/query.ts` (track running connections, add `query.cancel` handler)
- Modify: `sidecar/src/handlers/query.test.ts` (+5 tests for cancel)
- Modify: `sidecar/src/dispatcher.ts` (route `query.cancel`)
- Modify: `src-tauri/src/commands.rs` (new `query_cancel` Tauri command)
- Modify: `src/lib/sql-query.ts` (return `requestId` from `queryExecute`; new `queryCancel(requestId)`)
- Modify: `src/lib/stores/sql-editor.svelte.ts` (track `runningRequestIds`, add `cancelActive()`)
- Create: `src/lib/workspace/CancelOverlay.svelte` (overlay button on grid pane during running)
- Modify: `src/lib/workspace/ResultGrid.svelte` (mount CancelOverlay during running)
- Modify: `src/routes/workspace/[id]/+page.svelte` (Cmd+. global shortcut → cancelActive)

**Acceptance:**
- Sidecar maintains `Map<requestId, { connection: oracledb.Connection; statementIndex: number }>` for in-flight queries
- `query.cancel` looks up the connection, calls `connection.break()` then `connection.cancel()`, returns `{ cancelled: true, killedStatement: N }` (or `{ cancelled: false }` if requestId not found)
- The original `query.execute` rejects with `{ code: -2, message: "Cancelled by user" }` when broken
- Frontend `queryExecute` is changed to return `{ ok: true, data, requestId }` instead of bare `data` (TabResult uses requestId for cancel routing)
- Cancel overlay shows centered button "Cancel (⌘.)" on top of the running placeholder
- Cmd+. anywhere on the page triggers cancel of active tab if any running
- After cancel: tab shows the cancelled statement in log with ⏸ icon, subsequent statements not run

**Tests:**
- Sidecar: cancel inflight query returns success, cancelling unknown id returns `cancelled: false`, cancelled query rejects original promise with code -2
- Frontend store: `cancelActive` invokes Tauri command, clears running state on response

**Done when:**
- `cd sidecar && bun test` all pass
- `cd /Users/geraldoviana/Documents/veesker && bun run test` all pass
- `cd /Users/geraldoviana/Documents/veesker && bun run check` 0 errors
- `cd /Users/geraldoviana/Documents/veesker/src-tauri && cargo check` 0 errors

**Commit message format:** `feat(sql-editor): cancel running query via connection.break + Cmd+.`

---

### Task 3 — Multi-statement runner

**Files:**
- Modify: `sidecar/src/handlers/query.ts` (add `splitMulti` branch, loop statements, accumulate results)
- Modify: `sidecar/src/handlers/query.test.ts` (+8 tests for multi-statement scenarios)
- Modify: `src/lib/sql-query.ts` (response shape now `{ results: TabResult[] }`)
- Modify: `src/lib/stores/sql-editor.svelte.ts` (replace `result/error` with `results: TabResult[]`, `activeResultId`; add `runActiveAll()`, `runStatementAtCursor()`, `runSelection()`)
- Modify: `src/lib/stores/sql-editor.test.ts` (+12 tests for new actions)
- Modify: `src/lib/workspace/SqlEditor.svelte` (new keymap: Cmd+Enter dispatches cursor-or-selection; Cmd+Shift+Enter dispatches run-all; F5 alias)

**Acceptance:**
- When `splitMulti: true`, sidecar splits via `splitSql` then iterates: for each statement, executes via existing oracledb pipeline, pushes a result entry, stops on first error or cancel (does NOT continue)
- Each result entry has full TabResult shape (statementIndex, sqlPreview, status, result, error, elapsedMs)
- Cmd+Enter without selection: SqlEditor finds the statement bounding the cursor (using splitter line ranges or whitespace heuristic), runs it as single
- Cmd+Enter with selection: runs the selected text only
- Cmd+Shift+Enter / F5: runs entire tab content with splitMulti
- Default `activeResultId` after run = id of last successful SELECT (with rows), fallback to last result
- Splitter errors → log shows banner (no statements executed); doesn't run anything

**Done when:**
- All sidecar + frontend tests pass; check 0 errors

**Commit message format:** `feat(sql-editor): multi-statement run with splitter + cursor/selection shortcuts`

---

### Task 4 — ExecutionLog + result selector UI

**Files:**
- Create: `src/lib/workspace/ExecutionLog.svelte` (compact one-line-per-statement log; clickable rows)
- Modify: `src/lib/workspace/ResultGrid.svelte` (consume `tab.activeResultId`; render the selected TabResult)
- Modify: `src/lib/workspace/SqlDrawer.svelte` (mount ExecutionLog above ResultGrid; persist log-collapsed state in localStorage)
- Modify: `src/lib/stores/sql-editor.svelte.ts` (add `setActiveResult(tabId, resultId)`)

**Acceptance:**
- ExecutionLog renders a compact list: status icon + "Statement N" + sqlPreview (truncated to ~60 chars) + result summary (e.g. "1 row · 12ms" or "ORA-00942" or "Cancelled")
- Status icons: `⟳` running, `✓` ok, `✗` error, `⏸` cancelled
- Clicking a row sets it as active → ResultGrid re-renders
- Active row highlighted (`background: rgba(179, 62, 31, 0.08)`)
- Log is collapsible (▼/▲ toggle in its header bar); persisted in localStorage `veesker.sql.logCollapsed`
- When tab has only 1 result, log auto-collapses (no need to navigate)
- ResultGrid for cancelled status: shows ⏸ banner "Cancelled by user"

**Done when:**
- Manual smoke: paste 3-statement script, run all, see 3 log rows, click each, see different grids
- Test additions in sql-editor.test.ts pass

**Commit message format:** `feat(sql-editor): execution log with selectable results`

---

### Task 5 — Query history backend (SQLite + Tauri commands)

**Files:**
- Create: `src-tauri/src/persistence/migrations/005_query_history.sql` (table + 2 indexes)
- Modify: `src-tauri/src/persistence/mod.rs` (register migration)
- Create: `src-tauri/src/persistence/history.rs` (CRUD: insert, list_by_connection, search, clear)
- Create: `src-tauri/src/persistence/history_test.rs` (Rust tests via tempfile)
- Modify: `src-tauri/src/commands.rs` (new commands `history_list`, `history_save`, `history_clear`)
- Modify: `src-tauri/src/lib.rs` (register new commands in `invoke_handler!`)
- Create: `src/lib/query-history.ts` (frontend wrappers + types)
- Modify: `src/lib/stores/sql-editor.svelte.ts` (after each run, call `historySave` per statement)

**Acceptance:**
- Migration runs cleanly on existing DBs (additive only)
- `history_list(connection_id, limit, offset, search)` returns most recent first; if `search` provided, uses `LIKE %search% ESCAPE '\'` on `sql` column
- `history_save({ connectionId, sql, success, rowCount, elapsedMs, errorCode, errorMessage })` returns inserted id
- `history_clear(connection_id)` deletes all rows for connection
- Each statement in a multi-statement run becomes one history row
- Rust tests with `tempfile::NamedTempFile` for SQLite path
- Frontend types match Rust serialization (camelCase via `#[serde(rename_all = "camelCase")]`)

**Done when:**
- `cd src-tauri && cargo test` all pass
- New commands callable from frontend without errors

**Commit message format:** `feat(workspace): query history SQLite store + Tauri commands`

---

### Task 6 — Query history UI panel

**Files:**
- Create: `src/lib/workspace/QueryHistory.svelte` (left panel)
- Modify: `src/lib/workspace/SqlDrawer.svelte` (3-pane layout: history (collapsible) | editor+log+grid)
- Modify: `src/lib/stores/sql-editor.svelte.ts` (add `historyPanelOpen` getter/setter persisted in localStorage `veesker.sql.historyPanelOpen`; add `loadHistoryEntry(entry)` action that opens new tab with the SQL)

**Acceptance:**
- Panel renders on the left of editor area, 220px wide, collapsible via toggle button (`◀`/`▶`)
- Header: "History" label + search input (filters via `history_list` search param, debounce 200ms) + clear button (with confirm)
- List items: status icon + truncated SQL (first line, max 60 chars) + relative time ("2m ago", "3h ago", "yesterday") + row count if success
- Click item → opens new SQL tab with the entry's SQL as content
- Hover item shows full SQL in tooltip
- Empty state: "No queries yet. Execute a query to see history."
- Loading state: skeleton rows
- Pagination: load 50 at a time, infinite scroll triggers next batch
- Connection-scoped: workspace `+page.svelte` passes `connectionId`; reset state on workspace unmount
- Persisted collapsed state across sessions

**Done when:**
- Manual smoke: run 5 queries, see them appear in history; refresh app, history persists; search filters correctly
- 0 type/check errors

**Commit message format:** `feat(workspace): query history left panel with search`

---

### Task 7 — Save/Load .sql + dirty indicator + Tauri fs plugin

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `tauri-plugin-fs = "2"`)
- Modify: `src-tauri/src/lib.rs` (register fs plugin)
- Modify: `src-tauri/capabilities/default.json` (add fs permissions: `fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:scope` with `$HOME/**`)
- Create: `src/lib/sql-files.ts` (wrappers: `saveAs(sql) -> path | null`, `saveExisting(path, sql)`, `openFile() -> { path, content } | null`)
- Modify: `src/lib/stores/sql-editor.svelte.ts` (add `filePath`, `isDirty`, `savedContent` to SqlTab; add `saveActive()`, `saveAsActive()`, `openFromFile()`; auto-update `isDirty` via $effect when `sql !== savedContent`)
- Modify: `src/lib/workspace/SqlEditor.svelte` (Cmd+S, Cmd+Shift+S keymap; let main page handle Cmd+O globally)
- Modify: `src/lib/workspace/SqlDrawer.svelte` (tab title shows `●` prefix when dirty; show filename instead of "Query N" when saved)
- Modify: `src/routes/workspace/[id]/+page.svelte` (Cmd+O global → openFromFile)

**Acceptance:**
- Cmd+S on never-saved tab → opens "Save As" dialog (defaults to `~/queries/<tab-title>.sql`); on save success, tab.filePath = chosen path, tab.title = basename without ext, savedContent = current sql, isDirty = false
- Cmd+S on saved tab → writes to existing path silently
- Cmd+Shift+S → always opens dialog
- Cmd+O → opens dialog, creates new tab with file content
- Editing after save flips isDirty to true; UI shows `●` prefix
- File > 1MB → confirm dialog before opening
- Save errors → alert with the error message
- Permission scope `$HOME/**` works on macOS (test by saving to `~/Desktop/foo.sql`)

**Done when:**
- Manual smoke: Cmd+S → file appears on disk; quit + reopen app + Cmd+O the file → tab opens with content; edit → ● appears; Cmd+S → ● clears
- All checks pass

**Commit message format:** `feat(sql-editor): save/load .sql files with dirty indicator`

---

### Task 8 — Export CSV/JSON + column sort + column resize

**Files:**
- Create: `src/lib/csv-export.ts` (RFC 4180 escaper)
- Create: `src/lib/csv-export.test.ts` (~10 tests)
- Modify: `src/lib/workspace/ResultGrid.svelte`:
  - Add "Export ▼" dropdown button in footer (left side of row count)
  - Add per-column sort state (clicked column + direction); apply in $derived
  - Add per-column width state with drag handle on header right border
  - Header gets sort indicator (▲ ▼)
  - Double-click resize handle = auto-fit (compute max content width via measureText, cap at 400px)
- Modify: `src/lib/sql-files.ts` (add `saveBlob(name, blob, defaultExt)` — uses save dialog + fs write)

**Acceptance:**
- CSV: RFC 4180 — quote field if contains `,`, `"`, `\n`, or `\r`. Escape internal `"` by doubling. Trailing CRLF between rows. UTF-8 BOM optional (omit by default for cleanest interop). First row = column names.
- JSON: array of objects (one per row) where keys are column names. Pretty-printed with 2-space indent. Numbers stay as numbers, dates as ISO strings, nulls as null.
- Export uses Tauri save dialog with default name `<tab-title>.csv` / `.json`
- Sort: click cycles asc → desc → none. Indicator visible. Sort applied to row order before render. Nulls always at the end regardless of direction. Numeric/date columns sort by value, string columns lexicographically.
- Resize: 4px drag handle on right border of each header cell. Cursor `col-resize` on hover. Live drag updates width. Min 60, max 800. Double-click = auto-fit to content. Widths reset when result changes (not persisted).

**Done when:**
- csv-export tests pass
- Manual smoke: run SELECT, sort by column, resize column, export CSV, open in Numbers/Excel — looks right
- All checks pass

**Commit message format:** `feat(sql-editor): export CSV/JSON + column sort + column resize`

---

## Final acceptance (after Task 8)

- All 8 commits on main
- `bun run test` all pass (frontend)
- `cd sidecar && bun test` all pass
- `cargo test` all pass
- `bun run check` 0 errors
- Manual end-to-end smoke covering each feature

## Memory tracking

Project memory file: `/Users/geraldoviana/.claude/projects/-Users-geraldoviana-Documents-qubitrek/memory/project_sql-editor-pro-progress.md`. Update after each task with commit SHA + status.
