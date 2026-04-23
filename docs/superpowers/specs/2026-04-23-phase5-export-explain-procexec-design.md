# Phase 5 — Export (INSERT), Explain Plan, Procedure Execution Design Spec

## Goal

Three independent UI enhancements to Veesker's query/result workflow:
1. **INSERT export** — third option in the existing ResultGrid export menu
2. **Explain Plan visual** — interactive tree + details panel, F6 / toolbar button, AI-assisted interpretation
3. **Procedure Execution UI** — modal form launched from SchemaTree to execute procedures and functions with parameters

All features are frontend + sidecar only. No Rust/Tauri changes required.

---

## Architecture Overview

### New files
- `src/lib/workspace/ExplainPlan.svelte` — Explain Plan tree + details panel component
- `src/lib/workspace/ProcExecModal.svelte` — procedure/function execution modal
- `src/lib/stores/explain-plan.svelte.ts` — Explain Plan state (tree nodes, selected node)

### Modified files
- `sidecar/src/oracle.ts` — two new functions: `explainPlan()`, `procDescribe()`, `procExecute()`
- `sidecar/src/index.ts` — register three new RPC handlers
- `src/lib/oracle.ts` — three new Tauri `invoke` wrappers
- `src/lib/csv-export.ts` — add `toInsertSql()` function
- `src/lib/workspace/ResultGrid.svelte` — add INSERT option to Export menu
- `src/lib/workspace/SqlEditor.svelte` — add Explain button + F6 keybinding
- `src/lib/workspace/SchemaTree.svelte` — add "Execute" action on PROCEDURE/FUNCTION nodes
- `src/routes/workspace/[id]/+page.svelte` — mount `ExplainPlan` and `ProcExecModal`

The three features are fully independent and can be implemented and committed in any order.

---

## Feature 1 — INSERT Export

### Scope

Adds a third export option ("INSERT SQL") to the existing Export dropdown in `ResultGrid.svelte`. No new files — purely an addition to `csv-export.ts` and `ResultGrid.svelte`.

### `toInsertSql(tableName, columns, rows)` in `csv-export.ts`

```ts
export function toInsertSql(tableName: string, columns: string[], rows: unknown[][]): string
```

Generates one INSERT statement per row:
```sql
INSERT INTO "EMPLOYEES" ("ID","NAME","SALARY","HIRE_DATE")
VALUES (1,'John',5000,TO_DATE('2024-01-15','YYYY-MM-DD'));
```

**Value formatting rules:**
- `null` / `undefined` → `NULL`
- `number` / `boolean` → literal (no quotes)
- `Date` → `TO_DATE('YYYY-MM-DD','YYYY-MM-DD')` for date-only, `TIMESTAMP 'YYYY-MM-DD HH24:MI:SS'` for datetime
- `string` → `'...'` with single-quote escaping (`'` → `''`)

**Table name:** extracted from `tab.title` by parsing the first `FROM <name>` in the SQL. If not detectable, falls back to `"EXPORT"`.

**Limitation:** generates INSERT only for rows currently loaded in the result (same behavior as CSV/JSON export — does not re-execute the query).

### ResultGrid changes

Add `exportInsert()` function alongside `exportCsv()` and `exportJson()`. Add "INSERT SQL" button to the export dropdown menu. File saved with `.sql` extension via `saveBlob(tabTitle, content, "sql")`.

---

## Feature 2 — Explain Plan

### Sidecar — `explainPlan(p: { sql: string })`

**Return type:**
```ts
export type ExplainNode = {
  id: number;
  parentId: number | null;
  operation: string;       // e.g. "TABLE ACCESS"
  options: string | null;  // e.g. "FULL", "BY INDEX ROWID"
  objectName: string | null;
  objectOwner: string | null;
  cost: number | null;
  cardinality: number | null;
  bytes: number | null;
  accessPredicates: string | null;
  filterPredicates: string | null;
};

export type ExplainPlanResult = { nodes: ExplainNode[] };
```

**Implementation steps:**
1. Generate a unique `statementId` = `'V' + Date.now()`
2. Run `EXPLAIN PLAN SET STATEMENT_ID = :sid FOR <sql>` (no execution of the query)
3. Read `PLAN_TABLE` with hierarchy:
```sql
SELECT id, parent_id, operation, options, object_name, object_owner,
       cost, cardinality, bytes, access_predicates, filter_predicates
  FROM plan_table
 WHERE statement_id = :sid
 START WITH id = 0
 CONNECT BY PRIOR id = parent_id
 ORDER SIBLINGS BY id
```
4. Delete rows: `DELETE FROM plan_table WHERE statement_id = :sid`
5. Return `{ nodes }` array

**Error handling:** if `EXPLAIN PLAN` fails (syntax error in SQL), surface the Oracle error message to the frontend without crashing.

### Store — `src/lib/stores/explain-plan.svelte.ts`

```ts
type ExplainPlanState = {
  nodes: ExplainNode[];
  selectedId: number | null;
  loading: boolean;
  error: string | null;
};

let state = $state<ExplainPlanState>({ nodes: [], selectedId: null, loading: false, error: null });

export function setNodes(nodes: ExplainNode[]) { ... }
export function selectNode(id: number | null) { ... }
export function setLoading(v: boolean) { ... }
export function setError(msg: string | null) { ... }
export { state as explainPlanState };
```

### Frontend — `ExplainPlan.svelte`

**Layout:** two-column panel that replaces the result area when active.

- **Left column (tree):** recursive component rendering indented nodes. Each node shows `operation + options` + object name if present. Color-coded by operation category:
  - `TABLE ACCESS` → green (`#8bc4a8`)
  - `INDEX` → blue (`#7aa8c4`)
  - `JOIN` (HASH, NESTED LOOPS, MERGE) → amber (`#c3a66e`)
  - `SELECT STATEMENT`, `SORT`, `FILTER` → default text color
  - Clicking a node sets `selectedId`

- **Right column (details panel):** shows fields of the selected node:
  - Operation + Options
  - Object: `OWNER.NAME`
  - Cost, Rows (cardinality), Bytes
  - Access Predicates (if present)
  - Filter Predicates (if present)
  - **"Explain with AI" button** — sends the full plan tree + selected node context to SheepChat as a message: `"Explain this Oracle execution plan. Selected node: [OPERATION] on [OBJECT]. Full plan: [JSON]"`

### SqlEditor invocation

- New button "Explain" added to the toolbar between Compile and Run buttons
- F6 keybinding added to the CodeMirror keymap:
  ```ts
  { key: "F6", run: () => { onExplain(); return true; } }
  ```
- `onExplain` prop passed from workspace page — calls `explainPlan({ sql: currentSql })` and updates the store

### Result area integration

When Explain Plan is active for a tab, the result area shows `ExplainPlan` component instead of `ResultGrid`. The tab result type gains an `"explain"` status alongside `"ok"` / `"error"` / `"cancelled"`. A "← Results" button in the `ExplainPlan` header allows the user to switch back to the last query result for that tab without re-running the query.

---

## Feature 3 — Procedure Execution UI

### Sidecar — `procDescribe(p: { owner: string; name: string })`

Queries `ALL_ARGUMENTS` to return parameter metadata:

```ts
export type ProcParam = {
  name: string;
  position: number;
  direction: "IN" | "OUT" | "IN/OUT";
  dataType: string;   // "NUMBER", "VARCHAR2", "DATE", "REF CURSOR", etc.
};

export type ProcDescribeResult = { params: ProcParam[] };
```

Query:
```sql
SELECT argument_name AS NAME,
       position      AS POSITION,
       in_out        AS DIRECTION,
       data_type     AS DATA_TYPE
  FROM all_arguments
 WHERE owner       = :owner
   AND object_name = :name
   AND data_level  = 0
 ORDER BY position
```

Functions include the implicit return value at `position = 0` with `direction = "OUT"`.

### Sidecar — `procExecute(p: { owner, name, params: { name, value: string }[] })`

**Return type:**
```ts
export type ProcExecuteResult = {
  outParams: { name: string; value: string }[];
  refCursors: { name: string; columns: QueryColumn[]; rows: QueryResultRow[] }[];
  dbmsOutput: string[];
};
```

**Implementation:**
1. Call `procDescribe` internally to know param types and directions
2. Build anonymous block:
```sql
DECLARE
  v_p1 NUMBER;       -- OUT NUMBER
  v_rc SYS_REFCURSOR; -- OUT REF CURSOR
BEGIN
  OWNER.PROC_NAME(
    p_in1  => :p_in1,
    p_out1 => v_p1,
    p_rc   => v_rc
  );
  :out_p1 := v_p1;
  :out_rc := v_rc;
END;
```
3. Bind IN params as `BIND_IN`, OUT scalars as `BIND_OUT`, REF CURSOR as `oracledb.CURSOR`
4. Execute, fetch REF CURSOR rows (max 1000 rows per cursor)
5. Drain `DBMS_OUTPUT`
6. Return `{ outParams, refCursors, dbmsOutput }`

**Error handling:** Oracle execution errors returned as `{ error: { code, message } }` — same pattern as `queryExecute`.

### Frontend — `ProcExecModal.svelte`

**Structure:**
- `<dialog>` modal, same styling as existing modals in the app
- Header: `"Execute: OWNER.PROC_NAME (PROCEDURE)"` or `"(FUNCTION)"`
- Body: one row per IN / IN OUT parameter — label `PARAM_NAME (TYPE)` + `<input type="text">` for the value. OUT-only params show as grayed label `"(output — no input needed)"`.
- Footer: Cancel button + Execute button (shows spinner while running)
- On execute success:
  - OUT scalar params → appended to `ExecutionLog` as `"OUT param_name = value"`
  - REF CURSOR results → added to the active tab's result list as regular `QueryResult` entries, shown in `ResultGrid`
  - `DBMS_OUTPUT` lines → appended to `ExecutionLog`
- On error: error message shown inside modal (does not close)

### SchemaTree integration

Procedures and functions in the SchemaTree gain a hover action button (same pattern as existing table actions). Clicking "▶ Execute" on a PROCEDURE or FUNCTION node:
1. Calls `procDescribe({ owner, name })`
2. Opens `ProcExecModal` with the param list
3. Modal is mounted in `+page.svelte` and controlled via a `$state` object: `{ open: boolean; owner: string; name: string; objectType: "PROCEDURE" | "FUNCTION" }`

---

## Testing

**INSERT export:**
- `toInsertSql` unit tests in `csv-export.test.ts`: null values, strings with quotes, dates, numbers
- Manual: export a query result, paste SQL into editor, verify executes without error

**Explain Plan:**
- Sidecar unit test: `explainPlan` on a simple `SELECT 1 FROM DUAL` — returns at least one node with `operation = "SELECT STATEMENT"`
- Manual: run Explain on a join query, verify tree renders, click nodes, verify detail panel updates, verify AI button sends message to SheepChat

**Procedure Execution:**
- Sidecar unit test: `procDescribe` on a known procedure, verify correct param list
- Manual: execute a procedure with IN params, verify OUT values appear in log; execute one with REF CURSOR, verify grid appears in results

---

## Cross-platform notes

All changes are frontend + sidecar (TypeScript). No native dependencies. Works identically on Windows and macOS. The `PLAN_TABLE` is a standard Oracle global table present in all Oracle 11g+ installations — no setup required.
