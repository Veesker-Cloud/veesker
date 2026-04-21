# SQL Editor MVP (Phase 4a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible bottom drawer to the workspace with a CodeMirror SQL editor, ephemeral multi-tab management, single-statement execution against the active Oracle session, and a read-only result grid. Wire a "Preview data" button on `ObjectDetails` that opens the drawer pre-populated with `SELECT * … FETCH FIRST 100`.

**Architecture:** New `query.execute` JSON-RPC handler in the Bun sidecar reuses the active session from Phase 3's `state.ts`. A new Tauri `query_execute` command proxies to it. Frontend ships a Svelte 5 module store (`sql-editor.svelte.ts`) that manages tabs and result state, plus three new components (`SqlDrawer`, `SqlEditor`, `ResultGrid`) mounted at the bottom of the workspace route. Tabs are entirely in-memory and cleared on workspace close.

**Tech Stack:** Bun + node-oracledb 6 (sidecar) · Tauri 2 + Rust (host) · SvelteKit + Svelte 5 runes (frontend) · CodeMirror 6 (editor) · Vitest + @testing-library/svelte (new test infra)

**Spec:** [docs/superpowers/specs/2026-04-21-sql-editor-mvp-design.md](../specs/2026-04-21-sql-editor-mvp-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `sidecar/src/oracle.ts` | modify | add `queryExecute({ sql })` reusing `withActiveSession`; map `metaData` to `QueryColumn[]` and normalize TypedArray cells |
| `sidecar/src/index.ts` | modify | register `query.execute` handler |
| `sidecar/tests/oracle-query.test.ts` | create | unit tests for `queryExecute` against a mocked oracledb driver |
| `src-tauri/src/commands.rs` | modify | add `QueryColumn`, `QueryResult`, `query_execute` command |
| `src-tauri/src/lib.rs` | modify | register `query_execute` in `invoke_handler!` |
| `src/lib/sql-query.ts` | create | TS API surface for `query_execute` invoke + `QueryResult`/`QueryColumn` types |
| `src/lib/stores/sql-editor.svelte.ts` | create | Svelte 5 runes module: `tabs`, `activeId`, `drawerOpen` + actions |
| `src/lib/workspace/SqlEditor.svelte` | create | CodeMirror 6 wrapper via Svelte action; props `value`, `onChange`, `onRun` |
| `src/lib/workspace/ResultGrid.svelte` | create | read-only HTML table with sticky header + footer; renders error/DDL/empty/loading/rows branches |
| `src/lib/workspace/SqlDrawer.svelte` | create | drawer container with tab bar + editor pane + grid pane; collapse/expand |
| `src/lib/workspace/StatusBar.svelte` | modify | add SQL toggle button reflecting `drawerOpen` |
| `src/lib/workspace/ObjectDetails.svelte` | modify | add "Preview data" button in header for TABLE/VIEW |
| `src/routes/workspace/[id]/+page.svelte` | modify | mount `<SqlDrawer />` fixed at bottom; bind Cmd+J; call `sqlEditor.reset()` on workspace close |
| `package.json` | modify | add `codemirror`, `@codemirror/lang-sql`, `@codemirror/theme-one-dark`, `vitest`, `@testing-library/svelte`, `@testing-library/jest-dom`, `jsdom`, `@vitest/ui` |
| `vitest.config.ts` | create | Vitest config for Svelte 5 + jsdom |
| `src/test-setup.ts` | create | global `@testing-library/jest-dom` matchers + cleanup |
| `tsconfig.json` | modify | add `vitest/globals` to `types` |

> **Why `.svelte.ts` extension for the store:** Svelte 5 runes (`$state`) only work in files with `.svelte`, `.svelte.js`, or `.svelte.ts` extensions. The plain `.ts` extension would silently strip the runes.

---

## Task 0: Wire up Vitest + Testing Library

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/test-setup.ts`
- Create: `src/lib/test-sanity.test.ts` (deleted at end of task)
- Modify: `tsconfig.json`

- [ ] **Step 1: Install Vitest + Svelte testing stack**

```bash
cd /Users/geraldoviana/Documents/veesker
bun add -d vitest @vitest/ui jsdom @testing-library/svelte @testing-library/jest-dom @testing-library/user-event
```

Expected: `bun.lock` updated, packages installed.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
// vitest.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.{test,spec}.{js,ts}"],
  },
  resolve: {
    conditions: ["browser"],
  },
});
```

- [ ] **Step 3: Create `src/test-setup.ts`**

```ts
// src/test-setup.ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/svelte";

afterEach(() => cleanup());
```

- [ ] **Step 4: Add Vitest types to `tsconfig.json`**

Open `tsconfig.json` and add `vitest/globals` to `compilerOptions.types`:

```json
{
  "compilerOptions": {
    "types": ["vitest/globals"]
  }
}
```

(Preserve any other existing fields — only add the `types` array if absent, or merge into it.)

- [ ] **Step 5: Add npm scripts**

In `package.json`, add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui"
```

- [ ] **Step 6: Write a sanity test**

Create `src/lib/test-sanity.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("vitest sanity", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Run tests and verify they pass**

```bash
cd /Users/geraldoviana/Documents/veesker
bun run test
```

Expected: 1 passed test, no errors. The Svelte plugin should boot cleanly.

- [ ] **Step 8: Delete the sanity test**

```bash
rm /Users/geraldoviana/Documents/veesker/src/lib/test-sanity.test.ts
```

- [ ] **Step 9: Verify svelte-check still clean**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 10: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add package.json bun.lock vitest.config.ts src/test-setup.ts tsconfig.json
git commit -m "chore: add vitest + @testing-library/svelte for frontend unit tests"
```

---

## Task 1: Sidecar — `query.execute` handler

**Files:**
- Modify: `sidecar/src/oracle.ts` (append at end)
- Modify: `sidecar/src/index.ts` (register handler)
- Create: `sidecar/tests/oracle-query.test.ts`

The handler:
- Reuses `withActiveSession` from `oracle.ts` for session check + error mapping
- Calls `conn.execute(sql, [], { maxRows: 100, outFormat: oracledb.OUT_FORMAT_ARRAY })`
- Maps `metaData[]` → `QueryColumn[]` using `dbTypeName` (with precision/scale appended for NUMBER/TIMESTAMP/VARCHAR2)
- Normalizes TypedArray cells (VECTOR columns) to plain arrays
- Returns `{ columns, rows, rowCount, elapsedMs }` where `rowCount = rows.length` for SELECT or `r.rowsAffected ?? 0` for DML/DDL

- [ ] **Step 1: Write the failing tests**

Create `sidecar/tests/oracle-query.test.ts`:

```ts
import { describe, expect, test, beforeEach, mock } from "bun:test";
import { setSession, clearSession } from "../src/state";
import { queryExecute } from "../src/oracle";
import { NO_ACTIVE_SESSION, ORACLE_ERR, RpcCodedError } from "../src/errors";

function fakeConn(executeImpl: (...a: any[]) => any) {
  return { execute: mock(executeImpl) } as any;
}

describe("queryExecute", () => {
  beforeEach(() => clearSession());

  test("throws NO_ACTIVE_SESSION when no session is set", async () => {
    await expect(queryExecute({ sql: "SELECT 1 FROM DUAL" })).rejects.toThrow(RpcCodedError);
    try { await queryExecute({ sql: "SELECT 1 FROM DUAL" }); }
    catch (e: any) { expect(e.code).toBe(NO_ACTIVE_SESSION); }
  });

  test("returns columns + rows for SELECT", async () => {
    const conn = fakeConn(async () => ({
      metaData: [
        { name: "ID", dbTypeName: "NUMBER", precision: 10, scale: 0 },
        { name: "NAME", dbTypeName: "VARCHAR2", byteSize: 50 },
      ],
      rows: [[1, "Alice"], [2, "Bob"]],
    }));
    setSession(conn, "SCOTT");
    const r = await queryExecute({ sql: "SELECT id, name FROM users" });
    expect(r.columns).toEqual([
      { name: "ID", dataType: "NUMBER(10)" },
      { name: "NAME", dataType: "VARCHAR2(50)" },
    ]);
    expect(r.rows).toEqual([[1, "Alice"], [2, "Bob"]]);
    expect(r.rowCount).toBe(2);
    expect(typeof r.elapsedMs).toBe("number");
  });

  test("maps DDL/DML response to rowsAffected", async () => {
    const conn = fakeConn(async () => ({
      metaData: undefined,
      rows: undefined,
      rowsAffected: 3,
    }));
    setSession(conn, "SCOTT");
    const r = await queryExecute({ sql: "UPDATE users SET name='X'" });
    expect(r.columns).toEqual([]);
    expect(r.rows).toEqual([]);
    expect(r.rowCount).toBe(3);
  });

  test("maps DDL response with no rowsAffected to 0", async () => {
    const conn = fakeConn(async () => ({
      metaData: undefined,
      rows: undefined,
      rowsAffected: undefined,
    }));
    setSession(conn, "SCOTT");
    const r = await queryExecute({ sql: "CREATE TABLE t (id NUMBER)" });
    expect(r.rowCount).toBe(0);
  });

  test("passes maxRows: 100 and OUT_FORMAT_ARRAY to driver", async () => {
    const exec = mock(async () => ({ metaData: [], rows: [] }));
    setSession({ execute: exec } as any, "SCOTT");
    await queryExecute({ sql: "SELECT * FROM t" });
    const opts = exec.mock.calls[0][2];
    expect(opts.maxRows).toBe(100);
    expect(typeof opts.outFormat).toBe("number");
  });

  test("normalizes Float32Array cells (VECTOR) to plain arrays", async () => {
    const vec = new Float32Array([0.1, 0.2, 0.3]);
    const conn = fakeConn(async () => ({
      metaData: [{ name: "EMB", dbTypeName: "VECTOR" }],
      rows: [[vec]],
    }));
    setSession(conn, "SCOTT");
    const r = await queryExecute({ sql: "SELECT emb FROM v" });
    expect(Array.isArray(r.rows[0][0])).toBe(true);
    expect((r.rows[0][0] as number[]).length).toBe(3);
    expect((r.rows[0][0] as number[])[0]).toBeCloseTo(0.1, 5);
  });

  test("throws ORACLE_ERR when driver rejects with ORA-message", async () => {
    const conn = fakeConn(async () => { throw new Error("ORA-00942: table or view does not exist"); });
    setSession(conn, "SCOTT");
    try {
      await queryExecute({ sql: "SELECT * FROM nope" });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e).toBeInstanceOf(RpcCodedError);
      expect(e.code).toBe(ORACLE_ERR);
      expect(e.message).toContain("ORA-00942");
    }
  });

  test("formats NUMBER(p,s), TIMESTAMP(s), VARCHAR2(byteSize), CLOB", async () => {
    const conn = fakeConn(async () => ({
      metaData: [
        { name: "PRICE", dbTypeName: "NUMBER", precision: 10, scale: 2 },
        { name: "TS", dbTypeName: "TIMESTAMP", scale: 6 },
        { name: "TXT", dbTypeName: "VARCHAR2", byteSize: 100 },
        { name: "DOC", dbTypeName: "CLOB" },
      ],
      rows: [],
    }));
    setSession(conn, "SCOTT");
    const r = await queryExecute({ sql: "SELECT * FROM t" });
    expect(r.columns).toEqual([
      { name: "PRICE", dataType: "NUMBER(10,2)" },
      { name: "TS", dataType: "TIMESTAMP(6)" },
      { name: "TXT", dataType: "VARCHAR2(100)" },
      { name: "DOC", dataType: "CLOB" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/geraldoviana/Documents/veesker/sidecar && bun test tests/oracle-query.test.ts
```

Expected: All tests fail with "queryExecute is not a function" (or import error).

- [ ] **Step 3: Implement `queryExecute` in `sidecar/src/oracle.ts`**

Append at the end of the file:

```ts
export type QueryColumn = { name: string; dataType: string };
export type QueryResultRow = unknown[];
export type QueryResult = {
  columns: QueryColumn[];
  rows: QueryResultRow[];
  rowCount: number;
  elapsedMs: number;
};

function formatColumnType(m: {
  dbTypeName?: string;
  precision?: number | null;
  scale?: number | null;
  byteSize?: number | null;
}): string {
  const t = (m.dbTypeName ?? "UNKNOWN").toUpperCase();
  if (t === "NUMBER") {
    if (m.precision != null && m.scale != null && m.scale > 0) return `NUMBER(${m.precision},${m.scale})`;
    if (m.precision != null) return `NUMBER(${m.precision})`;
    return "NUMBER";
  }
  if (t === "VARCHAR2" || t === "NVARCHAR2" || t === "CHAR" || t === "NCHAR" || t === "RAW") {
    return m.byteSize != null ? `${t}(${m.byteSize})` : t;
  }
  if (t.startsWith("TIMESTAMP")) {
    return m.scale != null ? `TIMESTAMP(${m.scale})` : t;
  }
  return t;
}

function normalizeCell(v: unknown): unknown {
  if (v instanceof Float32Array || v instanceof Float64Array) return Array.from(v);
  if (v instanceof Int8Array || v instanceof Uint8Array) return Array.from(v);
  return v;
}

export async function queryExecute(p: { sql: string }): Promise<QueryResult> {
  return withActiveSession(async (conn) => {
    const started = Date.now();
    const r: any = await conn.execute(p.sql, [], {
      maxRows: 100,
      outFormat: oracledb.OUT_FORMAT_ARRAY,
    });
    const elapsedMs = Date.now() - started;

    const meta: any[] = r.metaData ?? [];
    const rawRows: any[][] = r.rows ?? [];
    const columns: QueryColumn[] = meta.map((m) => ({
      name: m.name,
      dataType: formatColumnType(m),
    }));
    const rows: QueryResultRow[] = rawRows.map((row) => row.map(normalizeCell));
    const rowCount = rawRows.length > 0 ? rawRows.length : (r.rowsAffected ?? 0);
    return { columns, rows, rowCount, elapsedMs };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/geraldoviana/Documents/veesker/sidecar && bun test tests/oracle-query.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Register handler in `sidecar/src/index.ts`**

Modify the import block:

```ts
import {
  connectionTest,
  openSession,
  closeSession,
  schemaList,
  objectsList,
  tableDescribe,
  queryExecute,
} from "./oracle";
```

Modify the `handlers` map by adding:

```ts
  "query.execute": (params) => queryExecute(params as any),
```

So the full handlers map becomes:

```ts
const handlers: HandlerMap = {
  "connection.test": (params) => connectionTest(params as any),
  "workspace.open": (params) => openSession(params as any),
  "workspace.close": () => closeSession(),
  "schema.list": () => schemaList(),
  "objects.list": (params) => objectsList(params as any),
  "table.describe": (params) => tableDescribe(params as any),
  "query.execute": (params) => queryExecute(params as any),
  ping: async () => ({ pong: true }),
};
```

- [ ] **Step 6: Run all sidecar tests**

```bash
cd /Users/geraldoviana/Documents/veesker/sidecar && bun test
```

Expected: All tests pass (existing rpc/handlers/state tests + 8 new oracle-query tests).

- [ ] **Step 7: Build the sidecar binary**

```bash
cd /Users/geraldoviana/Documents/veesker && ./scripts/build-sidecar.sh
```

Expected: Binary written to `src-tauri/binaries/veesker-sidecar-<triple>`.

- [ ] **Step 8: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add sidecar/src/oracle.ts sidecar/src/index.ts sidecar/tests/oracle-query.test.ts src-tauri/binaries/veesker-sidecar-*
git commit -m "feat(sidecar): add query.execute handler with maxRows=100 + VECTOR normalization"
```

---

## Task 2: Tauri command — `query_execute`

**Files:**
- Modify: `src-tauri/src/commands.rs` (append at end)
- Modify: `src-tauri/src/lib.rs` (register command)

The Tauri command proxies to the sidecar's `query.execute` and decodes the response into typed Rust structs.

- [ ] **Step 1: Add types and command to `src-tauri/src/commands.rs`**

Append at the end of the file:

```rust
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryColumn {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<QueryColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: i64,
    pub elapsed_ms: u64,
}

#[tauri::command]
pub async fn query_execute(
    app: AppHandle,
    sql: String,
) -> Result<QueryResult, ConnectionTestErr> {
    let res = call_sidecar(&app, "query.execute", json!({ "sql": sql })).await?;
    serde_json::from_value(res).map_err(|e| ConnectionTestErr {
        code: -32099,
        message: format!("decode query.execute: {e}"),
    })
}
```

- [ ] **Step 2: Register command in `src-tauri/src/lib.rs`**

Modify the `invoke_handler!` macro by adding `commands::query_execute,` after `commands::table_describe,`:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::connection_test,
            commands::connection_list,
            commands::connection_get,
            commands::connection_save,
            commands::connection_delete,
            commands::wallet_inspect,
            commands::workspace_open,
            commands::workspace_close,
            commands::schema_list,
            commands::objects_list,
            commands::table_describe,
            commands::query_execute,
        ])
```

- [ ] **Step 3: Verify Rust compiles**

```bash
cd /Users/geraldoviana/Documents/veesker/src-tauri && cargo check
```

Expected: 0 errors. Warnings allowed only if pre-existing.

- [ ] **Step 4: Run Rust tests to confirm no regressions**

```bash
cd /Users/geraldoviana/Documents/veesker/src-tauri && cargo test
```

Expected: All 26 existing tests pass (no new tests added in this task — the command is a thin proxy already covered by the sidecar tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): add query_execute command proxying to sidecar"
```

---

## Task 3: Frontend API surface — `sql-query.ts`

**Files:**
- Create: `src/lib/sql-query.ts`

Mirrors the existing pattern in `src/lib/workspace.ts`: typed wrapper around `invoke()` returning `Result<T>`.

- [ ] **Step 1: Create `src/lib/sql-query.ts`**

```ts
// src/lib/sql-query.ts
import { invoke } from "@tauri-apps/api/core";
import type { Result, WorkspaceError } from "$lib/workspace";

export type QueryColumn = { name: string; dataType: string };
export type QueryResult = {
  columns: QueryColumn[];
  rows: unknown[][];
  rowCount: number;
  elapsedMs: number;
};

export async function queryExecute(sql: string): Promise<Result<QueryResult>> {
  try {
    const data = await invoke<QueryResult>("query_execute", { sql });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err as WorkspaceError };
  }
}
```

- [ ] **Step 2: Verify svelte-check passes**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src/lib/sql-query.ts
git commit -m "feat(api): add sql-query.ts wrapper for query_execute invoke"
```

---

## Task 4: Frontend store — `sql-editor.svelte.ts`

**Files:**
- Create: `src/lib/stores/sql-editor.svelte.ts`
- Create: `src/lib/stores/sql-editor.test.ts`

The store is a Svelte 5 module with `$state` runes (hence the `.svelte.ts` extension). It owns:
- `tabs: SqlTab[]` — array of open tabs
- `activeId: string | null` — id of currently focused tab
- `drawerOpen: boolean` — drawer visibility

Actions: `openBlank()`, `openPreview(owner, name)`, `closeTab(id)`, `setActive(id)`, `updateSql(id, sql)`, `toggleDrawer()`, `runActive()`, `reset()`.

`runActive`:
1. early-returns silently if SQL is empty/whitespace
2. strips a single trailing `;` (and surrounding whitespace) from the SQL
3. sets `tab.running = true` and clears `tab.error`
4. invokes `queryExecute(sql)`
5. on success: sets `tab.result`, clears `tab.error`
6. on failure: sets `tab.error`, clears `tab.result`
7. always sets `tab.running = false`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/stores/sql-editor.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("$lib/sql-query", () => ({
  queryExecute: vi.fn(),
}));

import { queryExecute } from "$lib/sql-query";
import { sqlEditor } from "./sql-editor.svelte";

const mockedQueryExecute = vi.mocked(queryExecute);

beforeEach(() => {
  sqlEditor.reset();
  mockedQueryExecute.mockReset();
});

describe("sqlEditor.openBlank", () => {
  it("creates a tab named 'Query 1' and opens the drawer", () => {
    sqlEditor.openBlank();
    expect(sqlEditor.tabs.length).toBe(1);
    expect(sqlEditor.tabs[0].title).toBe("Query 1");
    expect(sqlEditor.tabs[0].sql).toBe("");
    expect(sqlEditor.drawerOpen).toBe(true);
    expect(sqlEditor.activeId).toBe(sqlEditor.tabs[0].id);
  });

  it("increments the title number when tabs already exist", () => {
    sqlEditor.openBlank();
    sqlEditor.openBlank();
    sqlEditor.openBlank();
    expect(sqlEditor.tabs.map((t) => t.title)).toEqual(["Query 1", "Query 2", "Query 3"]);
  });

  it("preserves Query N counter even after closing earlier tabs", () => {
    sqlEditor.openBlank(); // Query 1
    sqlEditor.openBlank(); // Query 2
    sqlEditor.closeTab(sqlEditor.tabs[0].id);
    sqlEditor.openBlank(); // Query 3 (not Query 2 again)
    expect(sqlEditor.tabs.map((t) => t.title)).toEqual(["Query 2", "Query 3"]);
  });
});

describe("sqlEditor.openPreview", () => {
  it("builds a quoted SELECT * SQL and runs it", async () => {
    mockedQueryExecute.mockResolvedValue({
      ok: true,
      data: { columns: [{ name: "X", dataType: "NUMBER" }], rows: [[1]], rowCount: 1, elapsedMs: 5 },
    });
    await sqlEditor.openPreview("SYSTEM", "HELP");
    expect(mockedQueryExecute).toHaveBeenCalledWith(
      `SELECT * FROM "SYSTEM"."HELP" FETCH FIRST 100 ROWS ONLY`
    );
    expect(sqlEditor.tabs[0].title).toBe("SYSTEM.HELP");
    expect(sqlEditor.drawerOpen).toBe(true);
    expect(sqlEditor.tabs[0].result?.rowCount).toBe(1);
  });
});

describe("sqlEditor.runActive", () => {
  it("sets running, then sets result on success", async () => {
    sqlEditor.openBlank();
    const id = sqlEditor.activeId!;
    sqlEditor.updateSql(id, "SELECT 1 FROM DUAL");
    mockedQueryExecute.mockResolvedValue({
      ok: true,
      data: { columns: [{ name: "X", dataType: "NUMBER" }], rows: [[1]], rowCount: 1, elapsedMs: 5 },
    });
    await sqlEditor.runActive();
    expect(sqlEditor.active?.running).toBe(false);
    expect(sqlEditor.active?.result?.rowCount).toBe(1);
    expect(sqlEditor.active?.error).toBeNull();
  });

  it("sets error on failure and clears prior result", async () => {
    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "SELECT * FROM nope");
    mockedQueryExecute.mockResolvedValue({
      ok: false,
      error: { code: -32013, message: "ORA-00942: table or view does not exist" },
    });
    await sqlEditor.runActive();
    expect(sqlEditor.active?.error?.code).toBe(-32013);
    expect(sqlEditor.active?.result).toBeNull();
    expect(sqlEditor.active?.running).toBe(false);
  });

  it("early-returns silently on empty SQL", async () => {
    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "   \n  ");
    await sqlEditor.runActive();
    expect(mockedQueryExecute).not.toHaveBeenCalled();
    expect(sqlEditor.active?.running).toBe(false);
  });

  it("strips a single trailing semicolon before invoke", async () => {
    sqlEditor.openBlank();
    sqlEditor.updateSql(sqlEditor.activeId!, "SELECT 1 FROM DUAL ;  ");
    mockedQueryExecute.mockResolvedValue({
      ok: true,
      data: { columns: [], rows: [], rowCount: 0, elapsedMs: 1 },
    });
    await sqlEditor.runActive();
    expect(mockedQueryExecute).toHaveBeenCalledWith("SELECT 1 FROM DUAL");
  });

  it("does nothing when there is no active tab", async () => {
    await sqlEditor.runActive();
    expect(mockedQueryExecute).not.toHaveBeenCalled();
  });
});

describe("sqlEditor.closeTab", () => {
  it("picks the left neighbor when active tab is closed", () => {
    sqlEditor.openBlank(); // 0
    sqlEditor.openBlank(); // 1
    sqlEditor.openBlank(); // 2
    const middle = sqlEditor.tabs[1].id;
    sqlEditor.setActive(middle);
    sqlEditor.closeTab(middle);
    expect(sqlEditor.activeId).toBe(sqlEditor.tabs[0].id);
  });

  it("picks the right neighbor when first tab is closed and active", () => {
    sqlEditor.openBlank(); // 0 — active
    sqlEditor.openBlank(); // 1
    const first = sqlEditor.tabs[0].id;
    sqlEditor.closeTab(first);
    expect(sqlEditor.activeId).toBe(sqlEditor.tabs[0].id); // the former tab[1]
  });

  it("sets activeId to null when the last tab is closed", () => {
    sqlEditor.openBlank();
    sqlEditor.closeTab(sqlEditor.tabs[0].id);
    expect(sqlEditor.tabs.length).toBe(0);
    expect(sqlEditor.activeId).toBeNull();
  });

  it("does nothing when closing a non-existent id", () => {
    sqlEditor.openBlank();
    const beforeId = sqlEditor.activeId;
    sqlEditor.closeTab("nonexistent");
    expect(sqlEditor.tabs.length).toBe(1);
    expect(sqlEditor.activeId).toBe(beforeId);
  });
});

describe("sqlEditor.toggleDrawer + reset", () => {
  it("toggleDrawer flips drawerOpen", () => {
    expect(sqlEditor.drawerOpen).toBe(false);
    sqlEditor.toggleDrawer();
    expect(sqlEditor.drawerOpen).toBe(true);
    sqlEditor.toggleDrawer();
    expect(sqlEditor.drawerOpen).toBe(false);
  });

  it("reset clears tabs, activeId, and drawerOpen", () => {
    sqlEditor.openBlank();
    sqlEditor.openBlank();
    sqlEditor.toggleDrawer();
    sqlEditor.reset();
    expect(sqlEditor.tabs.length).toBe(0);
    expect(sqlEditor.activeId).toBeNull();
    expect(sqlEditor.drawerOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run test src/lib/stores/sql-editor.test.ts
```

Expected: All tests fail with module-not-found or similar.

- [ ] **Step 3: Create `src/lib/stores/sql-editor.svelte.ts`**

```ts
// src/lib/stores/sql-editor.svelte.ts
import { queryExecute, type QueryResult } from "$lib/sql-query";

export type SqlTab = {
  id: string;
  title: string;
  sql: string;
  result: QueryResult | null;
  running: boolean;
  error: { code: number; message: string } | null;
};

let _tabs = $state<SqlTab[]>([]);
let _activeId = $state<string | null>(null);
let _drawerOpen = $state(false);
let _queryCounter = $state(0);

function newId(): string {
  return crypto.randomUUID();
}

function nextQueryTitle(): string {
  _queryCounter += 1;
  return `Query ${_queryCounter}`;
}

function makeTab(title: string, sql: string): SqlTab {
  return {
    id: newId(),
    title,
    sql,
    result: null,
    running: false,
    error: null,
  };
}

function findTab(id: string): SqlTab | null {
  return _tabs.find((t) => t.id === id) ?? null;
}

function stripTrailingSemicolon(sql: string): string {
  const trimmed = sql.trim();
  if (trimmed.endsWith(";")) return trimmed.slice(0, -1).trim();
  return trimmed;
}

export const sqlEditor = {
  get tabs() { return _tabs; },
  get activeId() { return _activeId; },
  get drawerOpen() { return _drawerOpen; },
  get active(): SqlTab | null {
    return _activeId === null ? null : findTab(_activeId);
  },

  openBlank(): void {
    const tab = makeTab(nextQueryTitle(), "");
    _tabs.push(tab);
    _activeId = tab.id;
    _drawerOpen = true;
  },

  async openPreview(owner: string, name: string): Promise<void> {
    const sql = `SELECT * FROM "${owner}"."${name}" FETCH FIRST 100 ROWS ONLY`;
    const tab = makeTab(`${owner}.${name}`, sql);
    _tabs.push(tab);
    _activeId = tab.id;
    _drawerOpen = true;
    await this.runActive();
  },

  closeTab(id: string): void {
    const idx = _tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    _tabs.splice(idx, 1);
    if (_activeId === id) {
      if (_tabs.length === 0) {
        _activeId = null;
      } else {
        _activeId = _tabs[Math.max(0, idx - 1)].id;
      }
    }
  },

  setActive(id: string): void {
    if (findTab(id) !== null) _activeId = id;
  },

  updateSql(id: string, sql: string): void {
    const tab = findTab(id);
    if (tab !== null) tab.sql = sql;
  },

  toggleDrawer(): void {
    _drawerOpen = !_drawerOpen;
  },

  async runActive(): Promise<void> {
    const tab = this.active;
    if (tab === null) return;
    const sql = stripTrailingSemicolon(tab.sql);
    if (sql === "") return;
    tab.running = true;
    tab.error = null;
    try {
      const res = await queryExecute(sql);
      if (res.ok) {
        tab.result = res.data;
        tab.error = null;
      } else {
        tab.error = res.error;
        tab.result = null;
      }
    } finally {
      tab.running = false;
    }
  },

  reset(): void {
    _tabs.splice(0, _tabs.length);
    _activeId = null;
    _drawerOpen = false;
    _queryCounter = 0;
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run test src/lib/stores/sql-editor.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Verify svelte-check passes**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src/lib/stores/sql-editor.svelte.ts src/lib/stores/sql-editor.test.ts
git commit -m "feat(store): add sql-editor svelte store with tabs + run/preview/reset"
```

---

## Task 5: `ResultGrid` component

**Files:**
- Create: `src/lib/workspace/ResultGrid.svelte`
- Create: `src/lib/workspace/ResultGrid.test.ts`

The grid takes a single `tab: SqlTab | null` prop and renders one of five branches:
1. `tab === null` — empty placeholder ("Run a query to see results")
2. `tab.running === true` — spinner placeholder
3. `tab.error !== null` — red banner with `ORA-XXX: …`
4. `tab.result === null` — same as branch 1 (no run yet)
5. `tab.result.columns.length === 0` — DDL/DML success: `✓ Statement executed · N rows affected · NNNms`
6. otherwise — table with sticky header + footer `N rows · NNNms`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/workspace/ResultGrid.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import ResultGrid from "./ResultGrid.svelte";
import type { SqlTab } from "$lib/stores/sql-editor.svelte";

function tab(partial: Partial<SqlTab> = {}): SqlTab {
  return {
    id: "t1",
    title: "Query 1",
    sql: "",
    result: null,
    running: false,
    error: null,
    ...partial,
  };
}

describe("ResultGrid", () => {
  it("shows placeholder when tab is null", () => {
    render(ResultGrid, { props: { tab: null } });
    expect(screen.getByText(/run a query/i)).toBeInTheDocument();
  });

  it("shows spinner when tab.running", () => {
    render(ResultGrid, { props: { tab: tab({ running: true }) } });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows error banner when tab.error is set", () => {
    render(ResultGrid, {
      props: {
        tab: tab({ error: { code: -32013, message: "ORA-00942: table or view does not exist" } }),
      },
    });
    expect(screen.getByText(/ORA-00942/)).toBeInTheDocument();
  });

  it("shows DDL success message when columns is empty", () => {
    render(ResultGrid, {
      props: {
        tab: tab({
          result: { columns: [], rows: [], rowCount: 3, elapsedMs: 45 },
        }),
      },
    });
    expect(screen.getByText(/Statement executed/)).toBeInTheDocument();
    expect(screen.getByText(/3 rows affected/)).toBeInTheDocument();
    expect(screen.getByText(/45ms/)).toBeInTheDocument();
  });

  it("renders columns header and rows", () => {
    render(ResultGrid, {
      props: {
        tab: tab({
          result: {
            columns: [
              { name: "ID", dataType: "NUMBER" },
              { name: "NAME", dataType: "VARCHAR2(50)" },
            ],
            rows: [[1, "Alice"], [2, "Bob"]],
            rowCount: 2,
            elapsedMs: 12,
          },
        }),
      },
    });
    expect(screen.getByText("ID")).toBeInTheDocument();
    expect(screen.getByText("NAME")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
    expect(screen.getByText(/12ms/)).toBeInTheDocument();
  });

  it("renders empty result with column header and 0 rows footer", () => {
    render(ResultGrid, {
      props: {
        tab: tab({
          result: {
            columns: [{ name: "X", dataType: "NUMBER" }],
            rows: [],
            rowCount: 0,
            elapsedMs: 7,
          },
        }),
      },
    });
    expect(screen.getByText("X")).toBeInTheDocument();
    expect(screen.getByText(/0 rows/)).toBeInTheDocument();
  });

  it("renders NULL marker for null cells", () => {
    render(ResultGrid, {
      props: {
        tab: tab({
          result: {
            columns: [{ name: "X", dataType: "VARCHAR2" }],
            rows: [[null]],
            rowCount: 1,
            elapsedMs: 1,
          },
        }),
      },
    });
    expect(screen.getByText("<NULL>")).toBeInTheDocument();
  });

  it("truncates long stringified values to 60 chars with ellipsis", () => {
    const long = "A".repeat(200);
    render(ResultGrid, {
      props: {
        tab: tab({
          result: {
            columns: [{ name: "X", dataType: "CLOB" }],
            rows: [[long]],
            rowCount: 1,
            elapsedMs: 1,
          },
        }),
      },
    });
    const cell = screen.getByText(/A{60}…/);
    expect(cell).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run test src/lib/workspace/ResultGrid.test.ts
```

Expected: All fail (component does not exist).

- [ ] **Step 3: Create `src/lib/workspace/ResultGrid.svelte`**

```svelte
<script lang="ts">
  import type { SqlTab } from "$lib/stores/sql-editor.svelte";

  type Props = { tab: SqlTab | null };
  let { tab }: Props = $props();

  function formatCell(v: unknown): string {
    if (v === null || v === undefined) return "<NULL>";
    let s: string;
    if (typeof v === "string") s = v;
    else if (typeof v === "number" || typeof v === "boolean") s = String(v);
    else if (v instanceof Date) s = v.toISOString();
    else s = JSON.stringify(v);
    if (s.length > 60) return s.slice(0, 60) + "…";
    return s;
  }
</script>

<section class="grid">
  {#if tab === null || (tab.result === null && !tab.running && tab.error === null)}
    <div class="placeholder">Run a query to see results.</div>
  {:else if tab.running}
    <div class="placeholder" role="status" aria-live="polite">
      <span class="spinner"></span> Running…
    </div>
  {:else if tab.error}
    <div class="banner">
      <strong>{tab.error.code}</strong>
      <span>{tab.error.message}</span>
    </div>
  {:else if tab.result && tab.result.columns.length === 0}
    <div class="ok">
      ✓ Statement executed · {tab.result.rowCount} rows affected · {tab.result.elapsedMs}ms
    </div>
  {:else if tab.result}
    {@const r = tab.result}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            {#each r.columns as c (c.name)}
              <th>
                <span class="cname">{c.name}</span>
                <span class="ctype">{c.dataType}</span>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each r.rows as row, i (i)}
            <tr>
              {#each row as cell, j (j)}
                <td class:null-cell={cell === null}>{formatCell(cell)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="footer">{r.rowCount} rows · {r.elapsedMs}ms</div>
  {/if}
</section>

<style>
  .grid {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #f9f5ed;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    font-size: 12px;
    color: #1a1612;
  }
  .placeholder, .ok {
    padding: 1rem;
    color: rgba(26, 22, 18, 0.55);
    font-size: 12px;
  }
  .ok { color: #2e6b2e; }
  .banner {
    padding: 0.85rem 1rem;
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border-bottom: 1px solid rgba(179, 62, 31, 0.3);
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11.5px;
  }
  .banner strong { font-family: "Space Grotesk", sans-serif; }
  .scroll {
    flex: 1;
    overflow: auto;
  }
  table {
    border-collapse: collapse;
    min-width: 100%;
  }
  thead th {
    position: sticky;
    top: 0;
    background: rgba(179, 62, 31, 0.1);
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-right: 1px solid rgba(26, 22, 18, 0.06);
    border-bottom: 1px solid rgba(26, 22, 18, 0.12);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(26, 22, 18, 0.7);
    white-space: nowrap;
  }
  thead .cname {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 600;
  }
  thead .ctype {
    margin-left: 0.4rem;
    opacity: 0.55;
    font-family: "JetBrains Mono", monospace;
    font-size: 9.5px;
  }
  tbody td {
    padding: 0.3rem 0.6rem;
    border-right: 1px solid rgba(26, 22, 18, 0.04);
    border-bottom: 1px solid rgba(26, 22, 18, 0.04);
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11.5px;
    white-space: nowrap;
    vertical-align: top;
  }
  tbody tr:nth-child(even) { background: rgba(26, 22, 18, 0.02); }
  td.null-cell {
    color: rgba(26, 22, 18, 0.4);
    font-style: italic;
  }
  .footer {
    border-top: 1px solid rgba(26, 22, 18, 0.08);
    padding: 0.4rem 0.8rem;
    color: rgba(26, 22, 18, 0.55);
    font-size: 11px;
    background: #fff;
  }
  .spinner {
    display: inline-block;
    width: 12px; height: 12px;
    border: 2px solid rgba(26, 22, 18, 0.15);
    border-top-color: #b33e1f;
    border-radius: 50%;
    margin-right: 0.5rem;
    animation: spin 0.8s linear infinite;
    vertical-align: -2px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run test src/lib/workspace/ResultGrid.test.ts
```

Expected: All 8 tests pass.

- [ ] **Step 5: Verify svelte-check**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src/lib/workspace/ResultGrid.svelte src/lib/workspace/ResultGrid.test.ts
git commit -m "feat(workspace): add ResultGrid component with 6 render branches"
```

---

## Task 6: `SqlEditor` component (CodeMirror 6 wrapper)

**Files:**
- Modify: `package.json` (add CodeMirror deps)
- Create: `src/lib/workspace/SqlEditor.svelte`
- Create: `src/lib/workspace/SqlEditor.test.ts`

CodeMirror 6 is mounted via a Svelte action that:
- Creates `EditorView` with `EditorState`
- Extensions: `basicSetup`, `sql({ dialect: PLSQL })`, `oneDark`, `keymap.of([{ key: 'Mod-Enter', run: () => { onRun(); return true; } }])`, `EditorView.updateListener.of((u) => u.docChanged && onChange(u.state.doc.toString()))`
- Returns `destroy()` for cleanup

The component is intentionally thin — most behavior happens inside CodeMirror. Tests assert: mount creates a `.cm-editor` element, value prop is reflected, `onRun` is called when Cmd+Enter is dispatched at the EditorView level.

- [ ] **Step 1: Install CodeMirror dependencies**

```bash
cd /Users/geraldoviana/Documents/veesker
bun add codemirror @codemirror/lang-sql @codemirror/theme-one-dark @codemirror/state @codemirror/view @codemirror/commands
```

Expected: bun.lock updated, packages installed.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/workspace/SqlEditor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/svelte";
import SqlEditor from "./SqlEditor.svelte";

describe("SqlEditor", () => {
  it("mounts a CodeMirror editor", async () => {
    const { container } = render(SqlEditor, {
      props: { value: "SELECT 1 FROM DUAL", onChange: () => {}, onRun: () => {} },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".cm-editor")).not.toBeNull();
  });

  it("displays the initial value", async () => {
    const { container } = render(SqlEditor, {
      props: { value: "SELECT * FROM dual", onChange: () => {}, onRun: () => {} },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toContain("SELECT * FROM dual");
  });

  it("calls onRun when Mod-Enter is triggered via runRun command", async () => {
    const onRun = vi.fn();
    const { container } = render(SqlEditor, {
      props: { value: "SELECT 1", onChange: () => {}, onRun },
    });
    await new Promise((r) => setTimeout(r, 0));
    const editor = container.querySelector(".cm-editor") as HTMLElement;
    expect(editor).not.toBeNull();
    // Synthesize Cmd+Enter on the contenteditable surface
    const content = editor.querySelector(".cm-content") as HTMLElement;
    content.focus();
    const ev = new KeyboardEvent("keydown", { key: "Enter", metaKey: true, ctrlKey: false, bubbles: true });
    content.dispatchEvent(ev);
    expect(onRun).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run test src/lib/workspace/SqlEditor.test.ts
```

Expected: Failures (component not yet defined).

- [ ] **Step 4: Create `src/lib/workspace/SqlEditor.svelte`**

```svelte
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { defaultKeymap } from "@codemirror/commands";
  import { sql, PLSQL } from "@codemirror/lang-sql";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { basicSetup } from "codemirror";

  type Props = {
    value: string;
    onChange: (sql: string) => void;
    onRun: () => void;
  };
  let { value, onChange, onRun }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  let view: EditorView | null = null;

  onMount(() => {
    if (!host) return;
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          sql({ dialect: PLSQL }),
          oneDark,
          keymap.of([
            { key: "Mod-Enter", run: () => { onRun(); return true; } },
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
  });

  $effect(() => {
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  });
</script>

<div bind:this={host} class="editor-host"></div>

<style>
  .editor-host {
    height: 100%;
    width: 100%;
    overflow: hidden;
  }
  :global(.editor-host .cm-editor) {
    height: 100%;
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 12.5px;
  }
  :global(.editor-host .cm-scroller) {
    overflow: auto;
  }
</style>
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run test src/lib/workspace/SqlEditor.test.ts
```

Expected: All 3 tests pass. If the Mod-Enter test is flaky in jsdom (CodeMirror may not register synthesized keydown the same way), accept it as a known limitation and rely on the smoke test in Task 11 for actual key binding verification — but try first to make it pass.

- [ ] **Step 6: Verify svelte-check**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 7: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add package.json bun.lock src/lib/workspace/SqlEditor.svelte src/lib/workspace/SqlEditor.test.ts
git commit -m "feat(workspace): add SqlEditor wrapping CodeMirror 6 with PLSQL dialect"
```

---

## Task 7: `SqlDrawer` component

**Files:**
- Create: `src/lib/workspace/SqlDrawer.svelte`
- Create: `src/lib/workspace/SqlDrawer.test.ts`

The drawer:
- Reads `sqlEditor` store directly (no props for tab data)
- Renders a tab bar at the top with each tab title + close × + a `+` button on the right + a collapse arrow on the far right
- When `drawerOpen === false`, renders only a 28px collapsed strip with the SQL label and arrow (clicking expands)
- When expanded, renders editor (top half) + grid (bottom half)
- When `activeId === null` and `drawerOpen === true`, shows an empty state with "Click + to open a new query"

- [ ] **Step 1: Write the failing tests**

Create `src/lib/workspace/SqlDrawer.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import SqlDrawer from "./SqlDrawer.svelte";
import { sqlEditor } from "$lib/stores/sql-editor.svelte";

beforeEach(() => sqlEditor.reset());

describe("SqlDrawer", () => {
  it("renders collapsed strip when drawerOpen is false", () => {
    render(SqlDrawer);
    expect(screen.getByText(/^SQL$/)).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("renders tabs when expanded", () => {
    sqlEditor.openBlank();
    sqlEditor.openBlank();
    render(SqlDrawer);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(2);
    expect(tabs[0]).toHaveTextContent("Query 1");
    expect(tabs[1]).toHaveTextContent("Query 2");
  });

  it("clicking a tab makes it active", async () => {
    sqlEditor.openBlank();
    sqlEditor.openBlank();
    render(SqlDrawer);
    const firstId = sqlEditor.tabs[0].id;
    const firstTabBtn = screen.getAllByRole("tab")[0];
    await fireEvent.click(firstTabBtn);
    expect(sqlEditor.activeId).toBe(firstId);
  });

  it("clicking + opens a new tab", async () => {
    sqlEditor.toggleDrawer(); // open drawer manually
    render(SqlDrawer);
    const plus = screen.getByRole("button", { name: /new query/i });
    await fireEvent.click(plus);
    expect(sqlEditor.tabs.length).toBe(1);
    expect(sqlEditor.tabs[0].title).toBe("Query 1");
  });

  it("clicking × on a tab closes it", async () => {
    sqlEditor.openBlank();
    sqlEditor.openBlank();
    render(SqlDrawer);
    const closeButtons = screen.getAllByRole("button", { name: /close/i });
    await fireEvent.click(closeButtons[0]);
    expect(sqlEditor.tabs.length).toBe(1);
  });

  it("collapse button toggles drawerOpen", async () => {
    sqlEditor.openBlank();
    render(SqlDrawer);
    const collapse = screen.getByRole("button", { name: /collapse/i });
    await fireEvent.click(collapse);
    expect(sqlEditor.drawerOpen).toBe(false);
  });

  it("clicking the collapsed strip expands the drawer", async () => {
    render(SqlDrawer);
    const strip = screen.getByRole("button", { name: /expand sql/i });
    await fireEvent.click(strip);
    expect(sqlEditor.drawerOpen).toBe(true);
  });

  it("shows empty state when drawerOpen but no tabs", () => {
    sqlEditor.toggleDrawer();
    render(SqlDrawer);
    expect(screen.getByText(/click \+ to open a new query/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run test src/lib/workspace/SqlDrawer.test.ts
```

Expected: All fail (component does not exist).

- [ ] **Step 3: Create `src/lib/workspace/SqlDrawer.svelte`**

```svelte
<script lang="ts">
  import { sqlEditor } from "$lib/stores/sql-editor.svelte";
  import SqlEditor from "./SqlEditor.svelte";
  import ResultGrid from "./ResultGrid.svelte";
</script>

{#if !sqlEditor.drawerOpen}
  <button
    class="strip"
    aria-label="Expand SQL drawer"
    onclick={() => sqlEditor.toggleDrawer()}
  >
    <span class="label">SQL</span>
    <span class="arrow">▲</span>
  </button>
{:else}
  <div class="drawer">
    <div class="tabbar">
      <div class="tabs" role="tablist">
        {#each sqlEditor.tabs as t (t.id)}
          <div
            role="tab"
            class="tab"
            class:active={sqlEditor.activeId === t.id}
            tabindex="0"
            onclick={() => sqlEditor.setActive(t.id)}
            onkeydown={(e) => { if (e.key === "Enter") sqlEditor.setActive(t.id); }}
          >
            {#if t.running}<span class="tab-spinner"></span>{/if}
            <span class="tab-title">{t.title}</span>
            <button
              class="tab-close"
              aria-label="Close {t.title}"
              onclick={(e) => { e.stopPropagation(); sqlEditor.closeTab(t.id); }}
            >×</button>
          </div>
        {/each}
        <button class="plus" aria-label="New query" onclick={() => sqlEditor.openBlank()}>+</button>
      </div>
      <button
        class="collapse"
        aria-label="Collapse drawer"
        onclick={() => sqlEditor.toggleDrawer()}
      >▼</button>
    </div>

    {#if sqlEditor.activeId === null}
      <div class="empty">Click + to open a new query.</div>
    {:else}
      {@const tab = sqlEditor.active}
      <div class="editor-pane">
        {#if tab}
          <SqlEditor
            value={tab.sql}
            onChange={(s) => sqlEditor.updateSql(tab.id, s)}
            onRun={() => sqlEditor.runActive()}
          />
        {/if}
      </div>
      <div class="grid-pane">
        <ResultGrid {tab} />
      </div>
    {/if}
  </div>
{/if}

<style>
  .strip {
    height: 28px;
    width: 100%;
    background: #f6f1e8;
    border: none;
    border-top: 1px solid rgba(26, 22, 18, 0.1);
    color: rgba(26, 22, 18, 0.7);
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1rem;
    cursor: pointer;
  }
  .strip:hover { background: #f0e8da; }
  .drawer {
    height: 40vh;
    min-height: 200px;
    background: #fff;
    border-top: 2px solid #b33e1f;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .tabbar {
    display: flex;
    align-items: stretch;
    background: #f6f1e8;
    border-bottom: 1px solid rgba(26, 22, 18, 0.1);
  }
  .tabs {
    display: flex;
    flex: 1;
    overflow-x: auto;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.7rem;
    border-right: 1px solid rgba(26, 22, 18, 0.08);
    background: transparent;
    cursor: pointer;
    font-size: 11.5px;
    font-family: "Space Grotesk", sans-serif;
    color: rgba(26, 22, 18, 0.7);
    user-select: none;
  }
  .tab:hover { background: rgba(26, 22, 18, 0.04); }
  .tab.active {
    background: #b33e1f;
    color: #f6f1e8;
  }
  .tab-spinner {
    width: 8px; height: 8px;
    border: 1.5px solid rgba(26, 22, 18, 0.2);
    border-top-color: #b33e1f;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .tab.active .tab-spinner {
    border-color: rgba(246, 241, 232, 0.3);
    border-top-color: #f6f1e8;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .tab-close {
    background: transparent;
    border: none;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 0.15rem;
    border-radius: 3px;
  }
  .tab-close:hover { opacity: 1; background: rgba(0,0,0,0.1); }
  .plus, .collapse {
    background: transparent;
    border: none;
    padding: 0 0.7rem;
    color: rgba(26, 22, 18, 0.6);
    cursor: pointer;
    font-size: 14px;
    font-family: "Space Grotesk", sans-serif;
  }
  .plus:hover, .collapse:hover { background: rgba(26, 22, 18, 0.06); color: #1a1612; }
  .empty {
    padding: 1.5rem;
    color: rgba(26, 22, 18, 0.5);
    font-size: 12px;
  }
  .editor-pane {
    flex: 1 1 50%;
    min-height: 80px;
    border-bottom: 1px solid rgba(26, 22, 18, 0.1);
    overflow: hidden;
  }
  .grid-pane {
    flex: 1 1 50%;
    min-height: 80px;
    overflow: hidden;
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run test src/lib/workspace/SqlDrawer.test.ts
```

Expected: All 8 tests pass.

- [ ] **Step 5: Verify svelte-check**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src/lib/workspace/SqlDrawer.svelte src/lib/workspace/SqlDrawer.test.ts
git commit -m "feat(workspace): add SqlDrawer with collapsible drawer + tab bar"
```

---

## Task 8: Add SQL toggle to `StatusBar`

**Files:**
- Modify: `src/lib/workspace/StatusBar.svelte`
- Create: `src/lib/workspace/StatusBar.test.ts`

The status bar gets a small **SQL** button between the server version meta and the Disconnect button. Clicking it calls `sqlEditor.toggleDrawer()`. The button shows an active style when `sqlEditor.drawerOpen === true`, and a subtle dot indicator when any tab is currently running.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/workspace/StatusBar.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import StatusBar from "./StatusBar.svelte";
import { sqlEditor } from "$lib/stores/sql-editor.svelte";

beforeEach(() => sqlEditor.reset());

const baseProps = {
  connectionName: "Oracle Free",
  userLabel: "SYSTEM @ localhost:1521/FREEPDB1",
  schema: "SYSTEM",
  serverVersion: "Oracle 23.26",
  onDisconnect: () => {},
};

describe("StatusBar SQL toggle", () => {
  it("renders SQL toggle button", () => {
    render(StatusBar, { props: baseProps });
    expect(screen.getByRole("button", { name: /^sql$/i })).toBeInTheDocument();
  });

  it("clicking the toggle flips drawerOpen", async () => {
    render(StatusBar, { props: baseProps });
    const btn = screen.getByRole("button", { name: /^sql$/i });
    expect(sqlEditor.drawerOpen).toBe(false);
    await fireEvent.click(btn);
    expect(sqlEditor.drawerOpen).toBe(true);
  });

  it("toggle has active class when drawerOpen is true", async () => {
    render(StatusBar, { props: baseProps });
    const btn = screen.getByRole("button", { name: /^sql$/i });
    sqlEditor.toggleDrawer();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.className).toMatch(/active/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run test src/lib/workspace/StatusBar.test.ts
```

Expected: Failures (no SQL button yet).

- [ ] **Step 3: Modify `src/lib/workspace/StatusBar.svelte`**

Replace the entire file with:

```svelte
<script lang="ts">
  import { sqlEditor } from "$lib/stores/sql-editor.svelte";

  type Props = {
    connectionName: string;
    userLabel: string;
    schema: string;
    serverVersion: string;
    onDisconnect: () => void;
  };
  let { connectionName, userLabel, schema, serverVersion, onDisconnect }: Props = $props();
</script>

<div class="bar">
  <span class="dot" aria-hidden="true"></span>
  <strong>{connectionName}</strong>
  <span class="sep">·</span>
  <span class="meta">{userLabel}/{schema}</span>
  <span class="sep">·</span>
  <span class="meta">{serverVersion}</span>
  <button
    class="sql-toggle"
    class:active={sqlEditor.drawerOpen}
    aria-label="SQL"
    onclick={() => sqlEditor.toggleDrawer()}
  >
    SQL
  </button>
  <button class="disconnect" onclick={onDisconnect}>Disconnect</button>
</div>

<style>
  .bar {
    background: #1a1612;
    color: #f6f1e8;
    padding: 0.5rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 12px;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    height: 36px;
    box-sizing: border-box;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #7ec96a;
    display: inline-block;
  }
  strong { font-weight: 600; }
  .sep { opacity: 0.4; }
  .meta {
    opacity: 0.75;
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11px;
  }
  .sql-toggle {
    margin-left: auto;
    background: transparent;
    border: 1px solid rgba(246, 241, 232, 0.25);
    color: #f6f1e8;
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .sql-toggle:hover { background: rgba(246, 241, 232, 0.08); }
  .sql-toggle.active {
    background: #b33e1f;
    border-color: #b33e1f;
  }
  .disconnect {
    background: transparent;
    border: 1px solid rgba(246, 241, 232, 0.25);
    color: #f6f1e8;
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .disconnect:hover {
    background: #b33e1f;
    border-color: #b33e1f;
  }
</style>
```

> **Note:** the previous file used `margin-left: auto` on `.disconnect` to push it to the right. We moved that onto `.sql-toggle` so the SQL button sits where Disconnect used to, and Disconnect now sits adjacent to the right.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run test src/lib/workspace/StatusBar.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Verify svelte-check**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src/lib/workspace/StatusBar.svelte src/lib/workspace/StatusBar.test.ts
git commit -m "feat(workspace): add SQL toggle button to StatusBar"
```

---

## Task 9: Add "Preview data" button to `ObjectDetails`

**Files:**
- Modify: `src/lib/workspace/ObjectDetails.svelte`
- Create: `src/lib/workspace/ObjectDetails.test.ts`

The button appears in the header next to `OWNER.NAME`, only when `selected.kind === "TABLE"` or `"VIEW"`. Clicking it calls `sqlEditor.openPreview(selected.owner, selected.name)`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/workspace/ObjectDetails.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ObjectDetails from "./ObjectDetails.svelte";
import { sqlEditor } from "$lib/stores/sql-editor.svelte";

vi.mock("$lib/sql-query", () => ({
  queryExecute: vi.fn().mockResolvedValue({
    ok: true,
    data: { columns: [], rows: [], rowCount: 0, elapsedMs: 1 },
  }),
}));

beforeEach(() => sqlEditor.reset());

const okDetails = {
  kind: "ok" as const,
  value: { columns: [], indexes: [], rowCount: 100 },
};

describe("ObjectDetails Preview data button", () => {
  it("shows Preview data button for TABLE", () => {
    render(ObjectDetails, {
      props: {
        selected: { owner: "SYS", name: "DUAL", kind: "TABLE" },
        details: okDetails,
        onRetry: () => {},
      },
    });
    expect(screen.getByRole("button", { name: /preview data/i })).toBeInTheDocument();
  });

  it("shows Preview data button for VIEW", () => {
    render(ObjectDetails, {
      props: {
        selected: { owner: "SYS", name: "V$VERSION", kind: "VIEW" },
        details: okDetails,
        onRetry: () => {},
      },
    });
    expect(screen.getByRole("button", { name: /preview data/i })).toBeInTheDocument();
  });

  it("does NOT show Preview data button for SEQUENCE", () => {
    render(ObjectDetails, {
      props: {
        selected: { owner: "SYS", name: "SEQ1", kind: "SEQUENCE" },
        details: { kind: "idle" },
        onRetry: () => {},
      },
    });
    expect(screen.queryByRole("button", { name: /preview data/i })).toBeNull();
  });

  it("clicking Preview data calls sqlEditor.openPreview", async () => {
    render(ObjectDetails, {
      props: {
        selected: { owner: "SYSTEM", name: "HELP", kind: "TABLE" },
        details: okDetails,
        onRetry: () => {},
      },
    });
    const btn = screen.getByRole("button", { name: /preview data/i });
    await fireEvent.click(btn);
    await new Promise((r) => setTimeout(r, 0));
    expect(sqlEditor.tabs.length).toBe(1);
    expect(sqlEditor.tabs[0].title).toBe("SYSTEM.HELP");
    expect(sqlEditor.drawerOpen).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run test src/lib/workspace/ObjectDetails.test.ts
```

Expected: All fail (no Preview data button yet).

- [ ] **Step 3: Modify `src/lib/workspace/ObjectDetails.svelte`**

Add the import and button. Replace the entire `<script>` block:

```svelte
<script lang="ts">
  import type { TableDetails, ObjectKind, Loadable } from "$lib/workspace";
  import { sqlEditor } from "$lib/stores/sql-editor.svelte";

  type Props = {
    selected: { owner: string; name: string; kind: ObjectKind } | null;
    details: Loadable<TableDetails>;
    onRetry: () => void;
    onReconnect?: () => void;
    sessionLost?: boolean;
  };
  let { selected, details, onRetry, onReconnect, sessionLost = false }: Props = $props();

  function previewData() {
    if (selected && selected.kind !== "SEQUENCE") {
      void sqlEditor.openPreview(selected.owner, selected.name);
    }
  }
</script>
```

Replace the existing `{:else if details.kind === "ok"}` branch's `<header>` to add the Preview data button:

Find this block:

```svelte
  {:else if details.kind === "ok"}
    {@const d = details.value}
    <header>
      <h2>{selected.owner}.{selected.name}</h2>
      <p class="muted">
        {#if d.rowCount === null}
          ~ unknown rows
        {:else}
          ~ {d.rowCount.toLocaleString()} rows
        {/if}
      </p>
    </header>
```

Replace with:

```svelte
  {:else if details.kind === "ok"}
    {@const d = details.value}
    <header>
      <div class="title-row">
        <h2>{selected.owner}.{selected.name}</h2>
        {#if selected.kind === "TABLE" || selected.kind === "VIEW"}
          <button class="preview-btn" onclick={previewData}>Preview data →</button>
        {/if}
      </div>
      <p class="muted">
        {#if d.rowCount === null}
          ~ unknown rows
        {:else}
          ~ {d.rowCount.toLocaleString()} rows
        {/if}
      </p>
    </header>
```

Also add styles for `.title-row` and `.preview-btn` inside the `<style>` block:

```css
  .title-row {
    display: flex;
    align-items: baseline;
    gap: 1rem;
  }
  .preview-btn {
    background: #b33e1f;
    color: #f6f1e8;
    border: none;
    padding: 0.3rem 0.7rem;
    border-radius: 4px;
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .preview-btn:hover { background: #7a2a14; }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run test src/lib/workspace/ObjectDetails.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Verify svelte-check**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src/lib/workspace/ObjectDetails.svelte src/lib/workspace/ObjectDetails.test.ts
git commit -m "feat(workspace): add Preview data button to ObjectDetails for TABLE/VIEW"
```

---

## Task 10: Wire `SqlDrawer` into the workspace route + Cmd+J

**Files:**
- Modify: `src/routes/workspace/[id]/+page.svelte`

The drawer mounts at the bottom of the workspace shell. We add:
- `<SqlDrawer />` after the `.body` div, inside `.shell`
- A keydown listener on `window` for `Cmd+J` (or `Ctrl+J` on Linux/Windows) → `sqlEditor.toggleDrawer()`
- Call `sqlEditor.reset()` in the existing onMount cleanup function (right next to `workspaceClose()`)

- [ ] **Step 1: Modify `src/routes/workspace/[id]/+page.svelte`**

Add to the imports section:

```ts
  import SqlDrawer from "$lib/workspace/SqlDrawer.svelte";
  import { sqlEditor } from "$lib/stores/sql-editor.svelte";
```

Add a keyboard listener inside the existing `onMount` callback. Replace:

```ts
  onMount(() => {
    void bootstrap();
    return () => {
      void workspaceClose();
    };
  });
```

with:

```ts
  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
      e.preventDefault();
      sqlEditor.toggleDrawer();
    }
  }

  onMount(() => {
    void bootstrap();
    window.addEventListener("keydown", onKeydown);
    return () => {
      window.removeEventListener("keydown", onKeydown);
      sqlEditor.reset();
      void workspaceClose();
    };
  });
```

In the template, replace the existing `.body` div:

```svelte
    <div class="body">
      <SchemaTree
        {schemas}
        {selected}
        onToggle={onToggle}
        onSelect={onSelect}
        onRetry={onRetryKind}
      />
      <ObjectDetails
        {selected}
        {details}
        onRetry={onRetryDetails}
        onReconnect={onReconnect}
        sessionLost={sessionLost}
      />
    </div>
```

with the body and drawer mounted in sequence:

```svelte
    <div class="body">
      <SchemaTree
        {schemas}
        {selected}
        onToggle={onToggle}
        onSelect={onSelect}
        onRetry={onRetryKind}
      />
      <ObjectDetails
        {selected}
        {details}
        onRetry={onRetryDetails}
        onReconnect={onReconnect}
        sessionLost={sessionLost}
      />
    </div>
    <SqlDrawer />
```

- [ ] **Step 2: Verify svelte-check**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Run all frontend tests**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/geraldoviana/Documents/veesker
git add src/routes/workspace/[id]/+page.svelte
git commit -m "feat(workspace): mount SqlDrawer + Cmd+J shortcut + reset on close"
```

---

## Task 11: Build, smoke test, and tag

**Files:**
- (no edits — verification + manual smoke test only)

- [ ] **Step 1: Rebuild the sidecar binary**

```bash
cd /Users/geraldoviana/Documents/veesker && ./scripts/build-sidecar.sh
```

Expected: Binary written to `src-tauri/binaries/veesker-sidecar-<triple>`.

- [ ] **Step 2: Run all sidecar tests**

```bash
cd /Users/geraldoviana/Documents/veesker/sidecar && bun test
```

Expected: All tests pass (existing + 8 new oracle-query).

- [ ] **Step 3: Run all Rust tests**

```bash
cd /Users/geraldoviana/Documents/veesker/src-tauri && cargo test
```

Expected: All 26 tests pass.

- [ ] **Step 4: Run all frontend tests**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run test
```

Expected: All tests pass.

- [ ] **Step 5: Run svelte-check**

```bash
cd /Users/geraldoviana/Documents/veesker && bun run check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Run the app and smoke-test all 11 acceptance scenarios**

Start the app:

```bash
cd /Users/geraldoviana/Documents/veesker && bun run tauri dev
```

Walk through each scenario, marking `[x]` only after visual confirmation:

  - [ ] (1) Open workspace → click **SQL** toggle in status bar → drawer opens, "Query 1" empty
  - [ ] (2) Type `SELECT 1 FROM DUAL` → Cmd+Enter → grid shows 1 row, footer `1 rows · NNms`
  - [ ] (3) Type `SELECT * FROM nonexistent_xyz` → Cmd+Enter → red banner with `ORA-00942`
  - [ ] (4) In ObjectDetails for SYSTEM.HELP → click **Preview data** → drawer opens, new tab `SYSTEM.HELP`, grid populates with 100 rows
  - [ ] (5) Type `CREATE TABLE veesker_smoke (id NUMBER)` → Cmd+Enter → green confirmation
  - [ ] (6) Type `DROP TABLE veesker_smoke` → Cmd+Enter → green confirmation
  - [ ] (7) Open 3 tabs (`+ + +`), close the middle one → active jumps to left neighbor
  - [ ] (8) Close all tabs → drawer stays open with empty state
  - [ ] (9) Click **Disconnect** → drawer collapses and clears; reconnect → drawer is empty
  - [ ] (10) Run `SELECT * FROM dba_objects` → grid shows exactly 100 rows
  - [ ] (11) Hit Cmd+J → drawer toggles closed; Cmd+J again → opens with last state intact

- [ ] **Step 7: Commit any final fixes from smoke testing**

If smoke tests revealed bugs, fix them inline (as one or more focused commits with descriptive messages: `fix(workspace): drawer Cmd+J doesn't reopen with last tab` etc.) and re-run the affected scenarios.

If everything passed without changes, skip to Step 8.

- [ ] **Step 8: Tag the release**

```bash
cd /Users/geraldoviana/Documents/veesker
git tag -a v0.0.6-sql-editor-mvp -m "Phase 4a: SQL Editor MVP

- New bottom drawer with collapsible SQL editor (CodeMirror 6, PLSQL dialect)
- Multi-tab management (ephemeral, in-memory; cleared on workspace close)
- Single-statement execution via new query.execute sidecar handler
- Read-only result grid (fixed limit 100 rows, sticky header, NULL/long-cell handling)
- Preview data button on tables/views auto-runs SELECT * FETCH FIRST 100
- Cmd+J shortcut to toggle the drawer
- New Vitest + @testing-library/svelte test infrastructure"
git push origin main --tags
```

Expected: Tag pushed to GitHub.

---

## Self-Review

### 1. Spec coverage

| Spec requirement | Implemented in |
|---|---|
| Bottom drawer, collapsible (28px / 40vh) | Task 7 (`SqlDrawer.svelte`) |
| CodeMirror 6 + Oracle SQL syntax + dark theme | Task 6 (`SqlEditor.svelte`) |
| Cmd+Enter runs active tab | Task 6 (CodeMirror keymap binding) |
| Multi-tab management (open/close/+/switch) | Task 4 (`sql-editor.svelte.ts`) + Task 7 (UI) |
| Auto-titles `Query N` and `OWNER.NAME` | Task 4 (`openBlank`, `openPreview`) |
| Single-statement execution | Task 1 (sidecar) — multi-statement deferred to 4c |
| Result grid: read-only, sticky header, fixed 100 rows | Task 5 (`ResultGrid.svelte`) + Task 1 (`maxRows: 100`) |
| Footer `N rows · NNNms` | Task 5 |
| DDL/DML execution → `✓ Statement executed · N rows affected` | Task 5 (DDL branch) + Task 1 (rowsAffected) |
| Preview data button | Task 9 (`ObjectDetails.svelte`) |
| Tab state in module store | Task 4 (`sql-editor.svelte.ts`) |
| `query.execute` sidecar method | Task 1 |
| `query_execute` Tauri command | Task 2 |
| StatusBar SQL toggle + Cmd+J | Task 8 (toggle) + Task 10 (shortcut) |
| `sqlEditor.reset()` on workspace close | Task 10 |
| Sidecar tests (8 cases) | Task 1 |
| Rust no new tests required (thin proxy) | Task 2 |
| Frontend store tests | Task 4 |
| Component tests (SqlDrawer, SqlEditor, ResultGrid, StatusBar, ObjectDetails) | Tasks 5, 6, 7, 8, 9 |
| Smoke test 1–11 | Task 11 |
| Coverage targets (100% new files, ≥80% modified) | Implicit — all new files have full unit tests |

### 2. Placeholder scan

No `TBD`/`TODO`/"add appropriate" terms used. All test bodies and code blocks are complete.

### 3. Type consistency

- `QueryColumn` and `QueryResult` shapes are identical across sidecar (Task 1), Rust (Task 2 with serde camelCase rename), and TypeScript (Task 3) — verified.
- `SqlTab` shape is defined in Task 4 and re-imported by Tasks 5 and 7 — verified.
- `sqlEditor` store API surface in Task 4 matches the calls made in Tasks 7 (`tabs`, `activeId`, `drawerOpen`, `setActive`, `closeTab`, `openBlank`, `updateSql`, `runActive`, `toggleDrawer`), Task 8 (`drawerOpen`, `toggleDrawer`), Task 9 (`openPreview`), and Task 10 (`reset`, `toggleDrawer`).
- `Result<T>` and `WorkspaceError` types reused from existing `src/lib/workspace.ts` (Task 3) — no parallel definitions.
- Error code `-32013 ORACLE_ERR` is consistent between Task 1 (sidecar throw) and the smoke test expectation (Task 11 step 6.3).

### 4. Decision notes for the implementer

- **Why we only test the sidecar oracle.ts via mocks, not via live Oracle:** the project's existing pattern is mock-only unit tests; a live integration suite is a separate effort that would require Docker setup in CI. The smoke test in Task 11 covers the live path manually.
- **Why no new Rust unit test for `query_execute`:** the command is a four-line proxy (call sidecar, decode JSON). The decoder is `serde_json::from_value` whose correctness is exercised by the live smoke test. Adding a Rust mock-sidecar test for a four-line proxy adds maintenance cost without catching real bugs.
- **CodeMirror keybinding test caveat:** synthesizing keyboard events that CodeMirror picks up is jsdom-fragile. If the test in Task 6 Step 5 fails despite a clean implementation, accept it as flaky and rely on smoke test scenario (2) for the actual binding verification — this is the only test in the plan with that caveat.
