# SQL Editor MVP — Spec

> Phase 4a of Veesker. Builds on Phase 3 (Schema Browser). Introduces the first interactive SQL surface: a collapsible bottom drawer with a CodeMirror editor, multi-tab management, single-statement execution, and a read-only result grid. "Preview data" on a table opens a tab with `SELECT * FROM ... FETCH FIRST 100`.
>
> This is the first slice of Phase 4 (SQL editor + data preview). Phases **4b** (snippets + history), **4c** (multi-statement + smart autocomplete), **4d** (grid pro: edit/load-more/export), and **4e** (vector UX) follow in sequence.

## Goal

Let the user open a SQL drawer at the bottom of the workspace, write a single SQL statement, run it with **Cmd+Enter**, and see the result in a read-only grid. Tabs are ephemeral (lost on app restart / connection close). A new "Preview data" button on `ObjectDetails` opens the drawer with a pre-populated `SELECT *` tab and runs it.

## In scope

- Bottom drawer in `/workspace/[id]` route, collapsible (28px collapsed / 40vh expanded), with its own tab bar
- CodeMirror 6 editor with Oracle SQL syntax highlighting + dark theme; **Cmd+Enter** runs active tab
- Multi-tab management (open blank, close, switch, `+`); titles auto-generated as `Query 1`, `Query 2`, … or `OWNER.NAME` for previews
- Single-statement execution — multi-statement and PL/SQL block parsing is Phase 4c
- Result grid: read-only HTML table, sticky header, **fixed limit of 100 rows**, footer shows `N rows · NNNms`
- DDL/DML execution allowed (no destructive-confirmation in 4a) — surfaces as `✓ Statement executed · N rows affected`
- "Preview data" button added to `ObjectDetails` header → opens drawer + new tab + auto-runs
- Tab state lives entirely in a Svelte 5 module store (`src/lib/stores/sql-editor.ts`); cleared on workspace close
- New sidecar JSON-RPC method `query.execute` and new Tauri command `query_execute`
- Status bar gets a small **SQL** toggle button (and `Cmd+J` shortcut) to open/close drawer

## Out of scope (later phases)

- Persistence of any kind: snippets, history, last-open tabs (Phase 4b)
- Multi-statement scripts or PL/SQL block execution (Phase 4c)
- Smart autocomplete with table/column/cross-schema awareness (Phase 4c — 4a only ships keyword + built-in completion that ships with `@codemirror/lang-sql`)
- Result grid editing, sort/filter, export, "load more" pagination (Phase 4d)
- VECTOR column visualization, similarity score detection (Phase 4e)
- Query cancellation / timeout (Phase 4d)
- Configurable row limit (Phase 4d — fixed `100` in 4a, no settings UI)
- LOB/BLOB streaming or smart truncation (4a does naive `JSON.stringify` truncated to 60 chars per cell)
- Status bar "session lost" indicator updates (out of scope for 4a; error surfaces in grid)
- Workspace-level keyboard shortcut customization
- Saving result grid to clipboard (Cmd+C copy of selected cells comes in 4d)

## Architecture

```
Svelte (/workspace/[id])              Tauri (Rust)                  Bun sidecar
─────────────────────────             ────────────                  ───────────
  StatusBar  ─ SQL toggle             commands.rs                    handlers.ts dispatch
  SchemaTree                          - query_execute(sql)             ↓
  ObjectDetails ─ Preview data btn         │                         oracle.ts
  SqlDrawer                                ▼                          - queryExecute({ sql })
    ├ tab bar                         JSON-RPC                            uses currentSession
    ├ SqlEditor (CodeMirror 6)              │                             from state.ts (Phase 3)
    └ ResultGrid                            ▼                              ↓
                                                                      oracledb.execute(sql, [], {
  sqlEditor store                                                        maxRows: 100,
  (Svelte 5 module, $state runes)                                         outFormat: OUT_FORMAT_ARRAY
                                                                       })
       Tauri invoke
       ─────────────────────────────────▶
```

- **No new SQLite tables, no new keychain entries.** All tab state is in-memory in the Svelte module store. Lost on app close, on workspace close, on connection switch.
- **Sidecar session reuse:** `query.execute` reads `currentSession` from `state.ts` (created in Phase 3 by `workspace.open`). No new session lifecycle. If `currentSession === null`, errors `-32010 NO_ACTIVE_SESSION`.
- **Single global session caveat:** because Phase 3 ships one connection per sidecar, all tabs share the same Oracle session. Two tabs cannot run queries truly concurrently; the second `runActive` call queues on the JS event loop. Acceptable for 4a — multi-session is a much later phase.
- **Drawer state is global per app session, not per workspace.** The same `sqlEditor` store instance is reused; `reset()` is called on workspace close to clear it. If the user opens connection A → writes a tab → closes → opens connection B, B starts with empty drawer.

### Files added / modified

| File | Action | Purpose |
|---|---|---|
| `sidecar/src/oracle.ts` | modify | add `queryExecute({ sql })` reusing `currentSession` from `state.ts` |
| `sidecar/src/index.ts` | modify | register `query.execute` handler in `handlers` map |
| `src-tauri/src/commands.rs` | modify | add `query_execute` Tauri command + `QueryColumn`/`QueryResult` types |
| `src-tauri/src/lib.rs` | modify | register `query_execute` in `invoke_handler!` |
| `src/lib/sql-query.ts` | create | TS API surface: `QueryResult`/`QueryColumn` types + `queryExecute(sql)` |
| `src/lib/stores/sql-editor.ts` | create | Svelte 5 module store: tabs, activeId, drawerOpen + actions |
| `src/lib/workspace/SqlDrawer.svelte` | create | bottom drawer container with tab bar + editor + grid |
| `src/lib/workspace/SqlEditor.svelte` | create | CodeMirror 6 wrapper (Svelte action), Cmd+Enter binding |
| `src/lib/workspace/ResultGrid.svelte` | create | read-only HTML table with sticky header + footer |
| `src/lib/workspace/StatusBar.svelte` | modify | add **SQL** toggle button (current state from store) |
| `src/lib/workspace/ObjectDetails.svelte` | modify | add **Preview data** button in header |
| `src/routes/workspace/[id]/+page.svelte` | modify | mount `<SqlDrawer />` fixed at bottom; call `sqlEditor.reset()` on workspace close; bind `Cmd+J` |
| `package.json` | modify | add deps: `codemirror`, `@codemirror/lang-sql`, `@codemirror/theme-one-dark` |

## Data model

### Sidecar wire format (JSON-RPC)

**Request `query.execute`:**
```json
{ "sql": "SELECT name, owner FROM all_tables WHERE rownum < 10" }
```

**Response (SELECT with rows):**
```json
{
  "columns": [
    { "name": "NAME", "dataType": "VARCHAR2" },
    { "name": "OWNER", "dataType": "VARCHAR2" }
  ],
  "rows": [
    ["DUAL", "SYS"],
    ["HELP", "SYSTEM"]
  ],
  "rowCount": 2,
  "elapsedMs": 23
}
```

**Response (DDL / DML — no result set):**
```json
{
  "columns": [],
  "rows": [],
  "rowCount": 3,
  "elapsedMs": 45
}
```

`rowCount` semantics:
- For SELECT: `rows.length`
- For DDL/DML: `r.rowsAffected ?? 0`

`columns[].dataType` is the Oracle type name string (`VARCHAR2`, `NUMBER`, `DATE`, `TIMESTAMP(6)`, `CLOB`, `RAW`, `VECTOR`, `OBJECT`, etc.). Sidecar derives it from `r.metaData[i]` (`dbType` mapped via `oracledb.DB_TYPE_*` reverse lookup, with precision/scale appended where meaningful).

### Frontend tab state

```ts
type SqlTab = {
  id: string;                              // crypto.randomUUID()
  title: string;                           // "Query 1" | "SYSTEM.HELP" | future snippet name
  sql: string;
  result: QueryResult | null;
  running: boolean;
  error: { code: number; message: string } | null;
};

type QueryResult = {
  columns: { name: string; dataType: string }[];
  rows: unknown[][];
  rowCount: number;
  elapsedMs: number;
};
```

The store exposes:
```ts
// reactive getters (backed by $state)
get tabs(): SqlTab[]
get activeId(): string | null
get drawerOpen(): boolean
get active(): SqlTab | null     // computed from tabs + activeId

// actions
openBlank(): void                          // creates "Query N", opens drawer, sets active, focuses editor
openPreview(owner: string, name: string): Promise<void>
                                           // creates tab with SELECT * FROM owner.name FETCH FIRST 100,
                                           // opens drawer, sets active, calls runActive() automatically
closeTab(id: string): void                 // if active and not last, picks left neighbor; if last, activeId = null
setActive(id: string): void
updateSql(id: string, sql: string): void   // debounced caller responsibility
toggleDrawer(): void
async runActive(): Promise<void>           // sets running, calls invoke, sets result or error
reset(): void                              // tabs = [], activeId = null, drawerOpen = false
```

`openPreview` SQL template (with quoted identifiers to handle case-sensitive owners/names):
```ts
`SELECT * FROM "${owner}"."${name}" FETCH FIRST 100 ROWS ONLY`
```

`runActive` strips a single trailing `;` (and surrounding whitespace) before sending to Oracle, since `connection.execute()` rejects trailing semicolons. Multiple statements separated by `;` are not parsed in 4a — Oracle returns a syntax error which surfaces normally.

## Data flow

### Flow 1 — Open SQL drawer manually

```
User clicks SQL toggle in StatusBar (or Cmd+J)
  → sqlEditor.toggleDrawer() → drawerOpen = true
  → if tabs.length === 0, sqlEditor.openBlank()
       ↳ tabs.push({ id, title: 'Query 1', sql: '', result: null, running: false, error: null })
       ↳ activeId = newTab.id
  → SqlDrawer renders; SqlEditor focuses
```

### Flow 2 — Preview data of a table

```
User has SYSTEM.HELP open in ObjectDetails (Phase 3)
  → ObjectDetails header shows "Preview data" button
  → click → sqlEditor.openPreview('SYSTEM', 'HELP')
       ↳ sql = `SELECT * FROM "SYSTEM"."HELP" FETCH FIRST 100 ROWS ONLY`
       ↳ tabs.push({ id, title: 'SYSTEM.HELP', sql, … })
       ↳ activeId = newTab.id, drawerOpen = true
       ↳ await runActive()
  → SqlDrawer renders editor + spinner in grid area
  → on response: grid populates with up to 100 rows
```

### Flow 3 — Run query (Cmd+Enter)

```
User types SQL in active tab editor
  → CodeMirror onChange fires (debounced 50ms in wrapper)
  → sqlEditor.updateSql(id, sql)
User presses Cmd+Enter
  → keymap binding calls onRun prop
  → SqlDrawer (parent) calls sqlEditor.runActive()
       ↳ tab.running = true, tab.error = null
       ↳ const sql = stripTrailingSemicolon(tab.sql.trim())
       ↳ if sql === '' → tab.running = false; return       (silent no-op)
       ↳ try { result = await invoke('query_execute', { sql }) }
            success → tab.result = result, tab.error = null
            failure → tab.error = { code, message }, tab.result = null
       ↳ tab.running = false
  → ResultGrid re-renders (success / error / DDL / empty branch)
```

### Flow 4 — Switch connection / close workspace

```
User clicks Disconnect in StatusBar (Phase 3 flow)
  → workspace_close (existing)
  → +page.svelte onDestroy → sqlEditor.reset()
       ↳ tabs = [], activeId = null, drawerOpen = false
  → next workspace_open starts with empty drawer
```

### Flow 5 — Close tab

```
User clicks × on a tab
  → sqlEditor.closeTab(id)
       ↳ idx = tabs.findIndex(...)
       ↳ tabs.splice(idx, 1)
       ↳ if activeId === id:
            if tabs.length === 0 → activeId = null
            else                 → activeId = tabs[Math.max(0, idx - 1)].id
  → if activeId === null and drawerOpen, drawer stays open with empty state ("+ to open new query")
```

## Error handling

| Scenario | Sidecar code | UX |
|---|---|---|
| Oracle returns ORA-error | `-32013 ORACLE_ERR` with `Oracle: ORA-XXXXX: …` | Grid shows red banner with error text; editor remains editable; `running = false` |
| No active session (`currentSession === null`) | `-32010 NO_ACTIVE_SESSION` | Grid shows red banner: "No active session — disconnect detected"; in practice rare because workspace close calls `sqlEditor.reset()` |
| Session dropped mid-query (network / Oracle restart) | `-32011 SESSION_LOST` | Grid shows red banner; status bar update for session loss is out of scope for 4a |
| SQL is empty / whitespace only | (no RPC call) | `runActive` early returns silently; no error UX |
| SQL is DDL/DML (no rows returned) | success | Grid shows green confirmation: `✓ Statement executed · N rows affected · NNNms`; columns header hidden |
| SQL returns 0 rows | success | Grid shows column headers + footer `0 rows · NNNms`; no special "empty" art |
| Trailing `;` in SQL | (stripped before send) | Single trailing `;` accepted silently; multiple `;` separators surface as ORA syntax errors |
| Long-running query (>30s) | n/a | No timeout, no cancel button in 4a; user closes workspace as workaround. Cancel UX is Phase 4d |
| Result with CLOB/BLOB/VECTOR/OBJECT | success | Cell value passed to `JSON.stringify(value)` and truncated to 60 chars with `…` suffix; full hover tooltip in 4d |
| Drawer collapsed during query | n/a | Query continues running; small spinner badge appears on the SQL toggle in StatusBar to indicate in-flight work |

## Testing strategy

### Sidecar (Bun test, mocked driver)

- `query.execute returns columns + rows for SELECT` — mock `connection.execute` with `{ metaData: [...], rows: [...] }`
- `query.execute maps DDL response to rowCount` — mock with `{ rowsAffected: 3, rows: undefined }` → assert `{ columns: [], rows: [], rowCount: 3 }`
- `query.execute throws -32013 on Oracle error` — mock rejecting with `{ message: 'ORA-00942: …' }`
- `query.execute throws -32010 when currentSession is null`
- `query.execute respects maxRows: 100` — assert options passed to driver
- `query.execute maps dbType numbers to type name strings` — covers `VARCHAR2`, `NUMBER(10,2)`, `DATE`, `TIMESTAMP(6)`, `CLOB`, `RAW`, `VECTOR`

### Sidecar live (opt-in, `--ignored` style — runs against local Oracle container)

- `live: SELECT 1 FROM DUAL returns one row`
- `live: invalid SQL surfaces ORA error with code -32013`
- Not required to run in CI for 4a; run manually once before tagging.

### Rust (Tauri command)

Existing pattern from `workspace_open` / `schema_list`:
- `query_execute proxies to sidecar and decodes QueryResult` — via mock sidecar
- `query_execute propagates -32013 as ConnectionTestErr`

### Frontend store (Vitest, `invoke` mocked)

- `sqlEditor.openBlank creates tab named "Query 1" and opens drawer`
- `sqlEditor.openBlank increments title number when tabs exist`
- `sqlEditor.openPreview builds quoted SELECT * SQL and runs it`
- `sqlEditor.runActive sets running, then sets result on success`
- `sqlEditor.runActive sets error on failure and clears result`
- `sqlEditor.runActive early-returns on empty SQL`
- `sqlEditor.runActive strips single trailing semicolon before invoke`
- `sqlEditor.closeTab picks left neighbor when active tab closed`
- `sqlEditor.closeTab sets activeId null when last tab closed`
- `sqlEditor.reset clears all state`

### Frontend components (Vitest + @testing-library/svelte)

- `SqlDrawer renders tab bar and switches active on click`
- `SqlDrawer collapse/expand toggles container height`
- `SqlEditor mounts CodeMirror with sql() extension`
- `SqlEditor Cmd+Enter triggers onRun prop` — synthetic `keydown`
- `ResultGrid renders columns header + row cells`
- `ResultGrid shows red error banner when tab.error set`
- `ResultGrid shows DDL success message when columns array is empty (regardless of rowCount)`
- `ResultGrid shows empty state for 0 rows`
- `ResultGrid shows spinner when tab.running`
- `ObjectDetails shows Preview data button and dispatches openPreview`
- `StatusBar SQL toggle reflects drawerOpen state`

### Smoke test (manual, before tagging `v0.0.6-sql-editor-mvp`)

1. Open workspace → click **SQL** toggle in status bar → drawer opens, "Query 1" empty
2. Type `SELECT 1 FROM DUAL` → Cmd+Enter → grid shows 1 row, footer `1 rows · NNms`
3. Type `SELECT * FROM nonexistent` → Cmd+Enter → red banner with ORA-00942
4. In ObjectDetails for SYSTEM.HELP → click **Preview data** → drawer opens, new tab `SYSTEM.HELP`, grid populates with 100 rows
5. Type `CREATE TABLE veesker_smoke (id NUMBER)` → Cmd+Enter → green confirmation
6. Type `DROP TABLE veesker_smoke` → Cmd+Enter → green confirmation
7. Open 3 tabs (`+ + +`), close the middle one → active jumps to left neighbor
8. Close all tabs → drawer stays open with empty state
9. Click **Disconnect** → drawer collapses and clears; reconnect → drawer is empty
10. Run `SELECT * FROM dba_objects` → grid shows exactly 100 rows
11. Hit Cmd+J → drawer toggles closed; Cmd+J again → opens with last state intact

### Coverage targets for 4a

- 100% line coverage on new files
- ≥80% line coverage on modified files
- All Bun + Rust + Vitest tests pass
- Manual smoke test 1–11 all green before tag

## Acceptance criteria

A user with a working Phase 3 workspace must be able to:

1. Open and close the bottom drawer with a button or keyboard shortcut
2. Open multiple tabs, switch between them, close them, with no state leak between tabs
3. Type and edit Oracle SQL with syntax highlighting and a familiar dark editor
4. Run any single statement (SELECT, DDL, DML) with Cmd+Enter and see results or errors immediately
5. Click "Preview data" on any table or view in `ObjectDetails` and land in a populated tab without typing anything
6. Be sure that closing the workspace or switching connections fully resets the drawer
7. See errors in plain text (Oracle's own message) without crashing the app or the sidecar
