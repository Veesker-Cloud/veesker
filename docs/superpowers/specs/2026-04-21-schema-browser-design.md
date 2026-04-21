# Schema Browser — Spec

> Phase 3 of Veesker. Builds on Phase 1 (Connection Manager MVP1), Phase 2a (Connection Persistence MVP2) and Phase 2b (Wallet Support). Introduces the first "active connection" experience: open a saved connection, navigate its schemas / tables / views / sequences, and inspect a table's columns + indexes + row count.

## Goal

Let the user click **Open** on a saved connection and land in a workspace with a schema tree on the left and an object-details pane on the right. Browsing is read-only metadata only — no data preview, no SQL editor, no DDL generation.

## In scope

- A new route `/workspace/[id]` mounted from the landing list **Open** button
- Top status bar: connection name · `USER @ SERVICE/SCHEMA` · server version · **Disconnect** action
- Schema tree (lazy expand-on-demand): all schemas the logged-in user can see, grouped per-schema into folders **Tables / Views / Sequences**
- Object details pane (single-scroll layout): header (`OWNER.NAME` + estimated row count) → columns table → indexes section
- Sidecar holds **one** live `oracledb.Connection` (the "active session"); replaces it on a new open, releases on close
- 5 new sidecar JSON-RPC methods + 5 new Tauri commands wiring them
- Tauri-side config assembly (Basic / Wallet) reuses the discriminated `ConnectionInput` from Phase 2

## Out of scope (later phases)

- Data preview / `SELECT * LIMIT 100` (Phase 4 — SQL editor)
- DDL generation, schema diff, ER diagram
- Object types beyond Tables / Views / Sequences (no Indexes-as-root, no Packages, Procedures, Triggers, Types)
- Multi-tab workspace / multiple concurrent sessions
- Persisting workspace state across app restarts (cold start always lands on `/`)
- A connection pool inside the sidecar (single global session is enough for one active workspace)
- Any caching of metadata (every expand re-queries; lists are small)

## Architecture

```
Svelte (/workspace/[id])           Tauri (Rust)                        Bun sidecar (1 process)
─────────────────────────          ────────────                        ──────────────────────
  StatusBar                        commands.rs                          handlers.ts dispatch
  SchemaTree                       - workspace_open(connection_id)        ↓
  ObjectDetails                    - workspace_close()                  oracle.ts
                                   - schema_list()                       - openSession(params) → currentSchema
       Tauri invoke                - objects_list(owner, kind)           - closeSession()
       ─────────────▶              - table_describe(owner, name)         - schemaList() / objectsList() / tableDescribe()
                                                                        state.ts (module-local mutable)
                                                                         - currentSession: oracledb.Connection | null
                                                                         - currentSchema: string | null
```

- **No new SQLite tables, no new keychain entries.** Phase 3 adds zero persistence — the active session lives only in sidecar memory and Svelte component state.
- **Sidecar lifecycle:** existing pattern — spawned on first command, stays alive forever. The new session state piggybacks on the existing process; if sidecar dies, session dies, the next RPC reports `NO_ACTIVE_SESSION` and the UI offers **Reconnect**.
- **Re-entry semantics:** if the user navigates back to `/` and re-opens the same connection (or a different one), `workspace_open` closes any prior session before creating the new one. Idempotent for the same id; replacing for a different id.

### Files added / modified

| File | Action | Purpose |
|---|---|---|
| `sidecar/src/oracle.ts` | modify | add `openSession`, `closeSession`, `schemaList`, `objectsList`, `tableDescribe` |
| `sidecar/src/state.ts` | create | module-local `currentSession`, `currentSchema` getters/setters |
| `sidecar/src/index.ts` | modify | register the 5 new handlers in `handlers` map |
| `src-tauri/src/commands.rs` | modify | add the 5 new Tauri commands proxying to sidecar |
| `src-tauri/src/lib.rs` | modify | register the 5 commands in `invoke_handler!` |
| `src/lib/workspace.ts` | create | TS API surface (types + `workspaceOpen` / `workspaceClose` / `schemaList` / `objectsList` / `tableDescribe`) |
| `src/lib/workspace/StatusBar.svelte` | create | top dark strip with connection metadata + Disconnect |
| `src/lib/workspace/SchemaTree.svelte` | create | lazy-expand tree |
| `src/lib/workspace/ObjectDetails.svelte` | create | columns + indexes + row count pane |
| `src/routes/workspace/[id]/+page.svelte` | create | orchestrator route |
| `src/routes/+page.svelte` | modify | add **Open** primary button per row |

## Data flow

### `workspace_open` (Open click)

```
Svelte component mount
  → invoke("workspace_open", { connectionId: id })
       → Rust: ConnectionService.get(id) → ConnectionFull
       → Rust: assemble sidecar params (Basic or Wallet branch — reuse Phase 2 mapping)
       → sidecar workspace.open
            → if currentSession != null → currentSession.close()
            → oracledb.getConnection(params)
            → SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS s, BANNER_FULL FROM V$VERSION WHERE ROWNUM=1
            → state.setSession(conn, currentSchema)
            → return { serverVersion, currentSchema }
       → Rust returns { connectionName, serverVersion, currentSchema }
  → component sets `info`, then awaits schemaList()
```

### `schema_list` (after open)

```
SELECT username AS NAME
FROM all_users
ORDER BY (CASE WHEN username = SYS_CONTEXT('USERENV','CURRENT_SCHEMA') THEN 0 ELSE 1 END), username
```
Result: `[{ name, isCurrent }]`. Current schema renders auto-expanded; others collapsed.

### `objects_list({ owner, kind })` (expand chevron)

```
SELECT object_name AS NAME
FROM all_objects
WHERE owner = :owner AND object_type = :type
ORDER BY object_name
```
`type` is `TABLE`, `VIEW`, or `SEQUENCE`. The component fires the 3 type queries in parallel via `Promise.all` when a schema is expanded.

### `table_describe({ owner, name })` (table click)

Sidecar issues 3 queries serially (single round trip from frontend's perspective):

```sql
-- columns + nullability + default + comments + PK flag
SELECT c.column_name, c.data_type, c.data_length, c.data_precision, c.data_scale,
       c.nullable, c.data_default, cc.comments,
       (CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END) AS is_pk
FROM all_tab_columns c
LEFT JOIN all_col_comments cc
  ON cc.owner = c.owner AND cc.table_name = c.table_name AND cc.column_name = c.column_name
LEFT JOIN (
  SELECT acc.owner, acc.table_name, acc.column_name
  FROM all_constraints ac
  JOIN all_cons_columns acc
    ON acc.owner = ac.owner AND acc.constraint_name = ac.constraint_name
  WHERE ac.constraint_type = 'P'
) pk
  ON pk.owner = c.owner AND pk.table_name = c.table_name AND pk.column_name = c.column_name
WHERE c.owner = :owner AND c.table_name = :name
ORDER BY c.column_id

-- indexes
SELECT i.index_name, i.uniqueness,
       LISTAGG(ic.column_name, ',') WITHIN GROUP (ORDER BY ic.column_position) AS columns
FROM all_indexes i
JOIN all_ind_columns ic
  ON ic.index_owner = i.owner AND ic.index_name = i.index_name
WHERE i.table_owner = :owner AND i.table_name = :name
GROUP BY i.index_name, i.uniqueness
ORDER BY i.index_name

-- row count estimate (NEVER COUNT(*))
SELECT num_rows FROM all_tables WHERE owner = :owner AND table_name = :name
```

`num_rows` may be `NULL` if stats are stale or never gathered — the UI shows `~ unknown` in that case.

The render formats column type as `VARCHAR2(255)`, `NUMBER(8,2)`, `DATE`, etc. Format helper lives in `ObjectDetails.svelte`.

## Sidecar JSON-RPC contract

All errors use JSON-RPC 2.0 error objects with these custom codes:

| Code | Name | When |
|---|---|---|
| -32010 | NO_ACTIVE_SESSION | metadata RPC called without a prior `workspace.open` |
| -32011 | SESSION_LOST | sidecar held a session but `oracledb` reports it's dead (e.g. `NJS-003`) — UI offers Reconnect |
| -32012 | OBJECT_NOT_FOUND | `table.describe` returned 0 rows for the columns query (table dropped between expand and click) |
| -32013 | ORACLE_ERR | any other Oracle error — message bubbles up verbatim |

```ts
// workspace.open — replaces any prior session (idempotent for same connection_id semantics handled in Rust)
params: { authType: "basic", host, port, serviceName, username, password }
      | { authType: "wallet", walletDir, walletPassword, connectAlias, username, password }
result: { serverVersion: string, currentSchema: string }

// workspace.close — idempotent, no error if no session
params: {}
result: { closed: true }

// schema.list
params: {}
result: { schemas: [{ name: string, isCurrent: boolean }] }

// objects.list
params: { owner: string, type: "TABLE" | "VIEW" | "SEQUENCE" }
result: { objects: [{ name: string }] }

// table.describe
params: { owner: string, name: string }
result: {
  columns: [{ name, dataType, nullable: bool, isPk: bool, dataDefault: string|null, comments: string|null }],
  indexes: [{ name, isUnique: bool, columns: string[] }],
  rowCount: number | null
}
```

`dataType` is the formatted display string (`VARCHAR2(255)`, `NUMBER(8,2)`, `DATE`, `TIMESTAMP(6)`), assembled in the sidecar from `data_type` + `data_length`/`data_precision`/`data_scale`. Scope: cover the types we expect on the user's existing `Ora23Ai` instance — if an exotic type slips through, render it as the raw `data_type` string and ship.

## Tauri commands

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub connection_name: String,
    pub server_version: String,
    pub current_schema: String,
}

#[tauri::command] pub async fn workspace_open(app: AppHandle, connection_id: String) -> Result<WorkspaceInfo, RpcErr>
#[tauri::command] pub async fn workspace_close(app: AppHandle) -> Result<(), RpcErr>
#[tauri::command] pub async fn schema_list(app: AppHandle) -> Result<Vec<Schema>, RpcErr>
#[tauri::command] pub async fn objects_list(app: AppHandle, owner: String, kind: String) -> Result<Vec<ObjectRef>, RpcErr>
#[tauri::command] pub async fn table_describe(app: AppHandle, owner: String, name: String) -> Result<TableDetails, RpcErr>
```

`workspace_open` is the only command with non-trivial Rust logic: it resolves `connection_id` → `ConnectionFull` via `ConnectionService.get()`, then assembles the discriminated sidecar payload (basic / wallet) — the same mapping `commands::ConnectionConfig::config_to_params` does today for `connection.test`. **Refactor opportunity:** extract that mapping into `connection_config.rs` so both `connection_test` and `workspace_open` share it instead of duplicating the discriminated match.

`RpcErr` is the existing `ConnectionTestErr { code: i32, message: String }` shape from MVP1.

## Frontend module

```ts
// src/lib/workspace.ts (new)
export type WorkspaceInfo  = { connectionName: string; serverVersion: string; currentSchema: string };
export type Schema         = { name: string; isCurrent: boolean };
export type ObjectKind     = "TABLE" | "VIEW" | "SEQUENCE";
export type ObjectRef      = { name: string };
export type Column         = { name: string; dataType: string; nullable: boolean; isPk: boolean; dataDefault: string | null; comments: string | null };
export type Index          = { name: string; isUnique: boolean; columns: string[] };
export type TableDetails   = { columns: Column[]; indexes: Index[]; rowCount: number | null };

export const workspaceOpen  = (connectionId: string) => call<WorkspaceInfo>("workspace_open", { connectionId });
export const workspaceClose = ()                     => call<void>("workspace_close");
export const schemaList     = ()                     => call<Schema[]>("schema_list");
export const objectsList    = (owner: string, kind: ObjectKind) => call<ObjectRef[]>("objects_list", { owner, kind });
export const tableDescribe  = (owner: string, name: string)     => call<TableDetails>("table_describe", { owner, name });
```

`call<T>` is the same `Result<T, ConnectionError>` helper pattern as `connections.ts` — copy the helper rather than cross-import, to keep `workspace.ts` self-contained.

## UI specifics

### Landing list (`/`)

Each `<li>` gets a primary **Open** button (left of the existing Edit/Delete ghost buttons). The Edit/Delete styling stays as-is. Clicking Open navigates to `/workspace/${c.id}`.

### Workspace shell (`/workspace/[id]/+page.svelte`)

```
┌─────────────────────────────────────────────────────────────────────┐
│ ●  Ora23Ai · PDBADMIN @ FREEPDB1 · Oracle 23.4         [Disconnect] │   ← StatusBar (dark, ~36px)
├─────────────────────┬───────────────────────────────────────────────┤
│ PDBADMIN ▾          │ PDBADMIN.EMPLOYEES                            │
│   Tables ▾          │ ~ 107 rows                                    │
│     EMPLOYEES ←sel  │                                               │
│     DEPARTMENTS     │ Columns                                       │
│     JOBS            │ ─────────────────────────────────────────     │
│   Views ▸           │ EMPLOYEE_ID  NUMBER(6)        NOT NULL · PK   │
│   Sequences ▸       │ FIRST_NAME   VARCHAR2(20)                     │
│ HR ▸                │ LAST_NAME    VARCHAR2(25)     NOT NULL        │
│ SH ▸                │ ...                                           │
│ MDSYS ▸             │                                               │
│ ...                 │ Indexes                                       │
│                     │ ─────────────────────────────────────────     │
│                     │ EMP_PK         UNIQUE  EMPLOYEE_ID            │
│                     │ EMP_DEPT_IX            DEPARTMENT_ID          │
└─────────────────────┴───────────────────────────────────────────────┘
   ↑ SchemaTree              ↑ ObjectDetails
   (~280px, scrollable)      (flex: 1, scrollable)
```

Color/typography reuse the existing `#f6f1e8` cream background, `#1a1612` ink, `#b33e1f` rust accent, Space Grotesk for headings, Inter for body, JetBrains Mono for monospaced metadata.

### State model in `+page.svelte`

```ts
let meta     = $state<ConnectionMeta | null>(null);   // from getConnection(id) — provides username + host/service or alias
let info     = $state<WorkspaceInfo | null>(null);    // from workspaceOpen(id) — provides serverVersion + currentSchema
let schemas  = $state<SchemaNode[]>([]);
let selected = $state<{ owner: string; name: string } | null>(null);
let details  = $state<Loadable<TableDetails>>({ kind: "idle" });
let error    = $state<{ scope: "fatal" | "rpc"; message: string } | null>(null);

type SchemaNode = {
  name: string;
  isCurrent: boolean;
  expanded: boolean;
  kinds: { TABLE: Loadable<ObjectRef[]>; VIEW: Loadable<ObjectRef[]>; SEQUENCE: Loadable<ObjectRef[]> };
};
type Loadable<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; value: T }
  | { kind: "err"; message: string };
```

### Lifecycle

| Event | Action |
|---|---|
| Mount | `getConnection(id)` → `meta`, then `workspaceOpen(id)` → `info`, then `schemaList()` → tree. Any failure sets `error = { scope: "fatal", … }` and skips the rest. StatusBar derives its `USER @ SERVICE` label from `meta.username` + (`meta.host:port/serviceName` for basic, or `meta.connectAlias` for wallet); SCHEMA from `info.currentSchema`; version from `info.serverVersion` |
| Click schema chevron | toggle `expanded`; if expanding and any `kinds.*` is `idle`, fire all 3 `objectsList` in parallel |
| Click object | If TABLE or VIEW: `selected = …`, `details = loading`, fire `tableDescribe`. If SEQUENCE: `selected = …`, render stub "Sequences expose only metadata in this view." |
| Disconnect button | `workspaceClose()` (best-effort); `goto("/")` |
| Component unmount (route change) | `workspaceClose()` (best-effort) |
| RPC returns `SESSION_LOST` (-32011) | `error = { scope: "rpc", … }`; details panel renders banner with **Reconnect** button → calls `workspaceOpen(id)` and replays the failed RPC |

## Error handling

- **`workspace_open` failure (fatal):** full-pane error card with the message and a **Back to connections** button. No tree, no details. The user can also click the `←` browser back gesture.
- **`schemaList` failure (fatal):** treated the same as a fatal open failure — there's nothing to show without schemas.
- **`objectsList` per-folder failure (per-node):** the folder shows a small inline error with **Retry**. Other folders unaffected.
- **`tableDescribe` failure (per-pane):** details pane shows the error inline with **Retry**. Tree state preserved.
- **`SESSION_LOST` (-32011) during any metadata RPC:** show banner over the details pane: "Connection dropped. Reconnect?" Single button. Reconnect re-runs `workspaceOpen(id)` + the failing RPC.
- **Browser refresh on `/workspace/[id]`:** route remounts, runs the open flow fresh. Any prior sidecar session is closed by `workspace_open`'s replace semantic.

## Testing

### Rust unit tests (`cargo test --lib`)
- One test for the new `connection_config::to_sidecar_params` helper (extracted in this phase): basic branch returns expected JSON shape; wallet branch returns expected JSON shape with `walletDir`/`connectAlias`. This is the only Rust logic worth testing — the rest is thin proxying.

### Sidecar tests
- None. `oracle.ts` queries a live Oracle DB; we already lean on smoke for it. Adding a fake-DB test layer is out of scope for this phase.

### Manual smoke (mirrors Phase 2 Task 14 pattern)
1. `./scripts/build-sidecar.sh && cd src-tauri && cargo test --lib` → 24 existing tests + 1 new test all pass
2. `bun run tauri dev`
3. **Basic regression** — Open the existing `Ora23Ai` connection from the landing list. Status bar appears with `Ora23Ai · PDBADMIN @ FREEPDB1 · Oracle 23.x`. No regression in MVP2 routes.
4. **Tree** — `PDBADMIN` schema is expanded; click `Tables` folder → see the user's actual tables (or empty list if none). Other schemas (`SYS`, `HR` if seeded) are collapsed; expand one → spinner → list appears.
5. **Details** — Click a table → right pane shows `OWNER.NAME`, estimated row count, columns table with types and PK markers, indexes section.
6. **Disconnect** — Click Disconnect → return to `/` → connection list still intact.
7. **Re-open** — Click Open again → workspace mounts cleanly; sidecar replaced the prior session without leaks (verify in Activity Monitor: no stacking process).
8. **Refresh** — On `/workspace/[id]`, hit ⌘R → workspace re-mounts, status bar repopulates within a second.
9. **Stub for SEQUENCE** — Click a sequence → details pane shows the metadata-only stub.
10. **Tag** — `git tag v0.0.5-schema-browser` (local only, matches MVP1/MVP2/wallet pattern).

### Wallet path
Cannot smoke without a real wallet. The discriminated `workspace.open` branch reuses MVP2's exact mapping; correctness is verified by the `to_sidecar_params` unit test plus inspection.

## Risks & open questions

- **`ALL_USERS` cardinality on Autonomous DB:** ATP/ADW typically expose hundreds of system schemas. Phase 3 doesn't filter, just paginates by lazy expand. If the schema list itself becomes painful to scroll, Phase 4 can add a search/filter input — not in scope here.
- **`NUM_ROWS` accuracy:** stats may be stale by hours or days. The `~` prefix in the UI signals "estimate"; we explicitly do not call `COUNT(*)`.
- **`LISTAGG` 4000-byte limit:** indexes with very long aggregated column lists could overflow. For Phase 3 we accept the failure (sidecar bubbles `ORA-01489` as `ORACLE_ERR`); a future phase can switch to `JSON_ARRAYAGG` or a sub-query.
- **Sidecar single-session pressure:** if the user clicks "Open" rapidly between two connections, the sidecar serializes the close+open. Acceptable for one human user; not designed for concurrency.

## Verification target

- 24 existing Rust tests still green; 1 new test for `connection_config::to_sidecar_params`
- Manual smoke against the local `oracle23ai` container (basic auth) succeeds end-to-end (steps 1–10 above)
- `git tag v0.0.5-schema-browser` placed on the merge commit
