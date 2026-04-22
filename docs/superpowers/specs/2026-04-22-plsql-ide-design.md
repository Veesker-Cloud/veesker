# Phase 4c — PL/SQL IDE Design

**Date:** 2026-04-22
**Status:** Approved

## Overview

Extends the SQL Editor (Phase 4b) with three PL/SQL-focused capabilities:

1. **DBMS_OUTPUT capture** — lines printed via `DBMS_OUTPUT.PUT_LINE` appear in the ExecutionLog below the statement that produced them.
2. **Compile objects + inline errors** — `CREATE OR REPLACE` DDL triggers automatic `USER_ERRORS` lookup; errors surface as CodeMirror gutter markers, underlines, and a collapsible error panel.
3. **Schema browser PL/SQL objects** — PROCEDURE, FUNCTION, PACKAGE, TRIGGER, TYPE nodes in the tree; clicking opens the DDL in a new editor tab via `DBMS_METADATA.GET_DDL`.

---

## Architecture

| Area | Layer | What changes |
|------|-------|-------------|
| DBMS_OUTPUT | Sidecar (Bun) | `ENABLE` before + `GET_LINES` after each statement |
| Compile errors | Tauri command | New query on `USER_ERRORS`, called by frontend post-execution |
| Gutter + error panel | Frontend | `@codemirror/lint` diagnostics + new `CompileErrors.svelte` |
| Schema browser | Tauri command + Frontend | New object kinds + `DBMS_METADATA.GET_DDL` command |

The sidecar JSON-RPC protocol gets one optional field (`output`) on each statement result. All other features are new Tauri commands — no sidecar changes beyond the output capture.

---

## Type contracts

```ts
// Extends existing TabResult (elapsedMs is number, no startedAt in current impl)
export type TabResult = {
  id: string;
  statementIndex: number;
  sqlPreview: string;
  status: "running" | "ok" | "error" | "cancelled";
  result: QueryResult | null;
  error: { code: number; message: string } | null;
  elapsedMs: number;
  // New in 4c:
  dbmsOutput: string[] | null;        // null = not captured; [] = enabled but nothing printed
  compileErrors: CompileError[] | null; // null = not a compilable object; [] = compiled clean
};

export type CompileError = {
  line: number;
  position: number;
  text: string;
};

export type PlsqlObjectKind =
  | "PROCEDURE" | "FUNCTION" | "PACKAGE" | "PACKAGE BODY"
  | "TRIGGER" | "TYPE" | "TYPE BODY";
```

---

## Feature 1: DBMS_OUTPUT

### Sidecar changes (`sidecar/src/handlers/query.ts`)

Before executing any statement (both single and multi), call:
```sql
BEGIN DBMS_OUTPUT.ENABLE(1000000); END;
```
on the active connection. After each statement executes (success or error), drain the buffer using `GET_LINE` in a loop:
```ts
const lines: string[] = [];
while (true) {
  const { outBinds } = await connection.execute<{ line: string; status: number }>(
    `BEGIN DBMS_OUTPUT.GET_LINE(:line, :status); END;`,
    {
      line:   { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 32767 },
      status: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    }
  );
  if (outBinds.status !== 0) break; // 1 = no more lines
  lines.push(outBinds.line ?? "");
}
// output = lines (empty array if nothing was printed)
```
Append `output: lines` to the statement result. If the loop throws, swallow the error and set `output: null`.

### Protocol addition

```jsonc
// Each statement result gains:
{ "statementIndex": 1, "status": "ok", ..., "output": ["Hello, World", "Loop: 3"] }
// or null if nothing was printed:
{ "statementIndex": 2, "status": "ok", ..., "output": null }
```

### ExecutionLog display

Each log row that has `output` with at least one line renders the lines below the row summary, indented, in monospace. If more than 5 lines, collapse behind a "show N more" toggle. Icon for statements with output: `⊞` (instead of `✓`).

```
⊞  Statement 2  BEGIN dbms_output...  ok · 45ms
     Hello, World
     Loop iteration 3
```

---

## Feature 2: Compile objects + inline errors

### Frontend compile detection

After any successful execution (`status === "ok"`), the frontend checks the original SQL with:
```ts
/^\s*CREATE\s+(OR\s+REPLACE\s+)?(PROCEDURE|FUNCTION|TRIGGER|PACKAGE(\s+BODY)?|TYPE(\s+BODY)?)\s+("?\w+"?\.)?("?\w+"?)/i
```
If it matches, extracts `objectType` (normalized, e.g. `"PROCEDURE"`) and `objectName` (unquoted). Then calls the Tauri command `compile_errors_get`.

### New Tauri command: `compile_errors_get`

**Signature:** `compile_errors_get(owner: string, objectType: string, objectName: string) -> CompileError[]`

**SQL:**
```sql
SELECT line, position, text
FROM user_errors
WHERE name = UPPER(:name)
  AND type = UPPER(:type)
ORDER BY sequence
```

`owner` param is reserved for future cross-schema use; for now always queries `user_errors`. Returns empty array if no errors (clean compile).

### TabResult update

The frontend sets `tab.compileErrors` after calling `compile_errors_get`:
- `null` — statement was not a compilable object
- `[]` — compiled successfully, no errors
- `[...]` — one or more errors

### CodeMirror inline errors (`SqlEditor.svelte`)

Uses `@codemirror/lint`. A new prop `compileErrors: CompileError[] | null` is added. When the prop changes, a `StateEffect` updates a `Compartment`-wrapped linting extension that injects `Diagnostic[]`:

```ts
{
  from: lineStart,   // start of the error line in the document
  to: lineEnd,       // end of the line
  severity: "error",
  message: error.text,
}
```

This produces:
- Red underline on the error line
- `✕` icon in the gutter
- Tooltip with error text on hover

### `CompileErrors.svelte` panel

New component, mounted in `SqlDrawer` below the editor pane (above the mid-handle), only rendered when `tab.compileErrors` is a non-empty array.

- Header: "Compilation errors (N)" with a collapse toggle
- Each row: `line:col — error text` in monospace, clickable — moves CodeMirror cursor to that line
- Collapsed by default if > 3 errors
- Disappears when tab changes or new execution starts

### "Compile" button

Added to the file-actions toolbar in `SqlDrawer`. Visible only when the active tab's SQL matches the compile regex. Clicking calls `sqlEditor.runActiveAll()`. Label: "Compile" with a small ▶ icon.

---

## Feature 3: Schema browser PL/SQL objects

### New object kinds

`SchemaNode.kinds` is extended to include:
```ts
PROCEDURE, FUNCTION, PACKAGE, TRIGGER, TYPE
```
Each appears as a collapsible group in the tree, same expand/load pattern as `TABLE`/`VIEW`/`SEQUENCE`.

**Icons (text badges):**

| Kind | Badge |
|------|-------|
| PROCEDURE | `proc` |
| FUNCTION | `fn` |
| PACKAGE | `pkg` |
| TRIGGER | `trg` |
| TYPE | `type` |

### Object status badge

Each object item displays a colored dot next to its name based on `ALL_OBJECTS.status`:
- `VALID` → green dot
- `INVALID` → red dot

The `objects_list` command (or a new variant) must include `status` in its response.

### New Tauri command: `object_ddl_get`

**Signature:** `object_ddl_get(owner: string, objectType: string, objectName: string) -> string`

**SQL:**
```sql
SELECT DBMS_METADATA.GET_DDL(UPPER(:type), UPPER(:name), UPPER(:owner)) FROM dual
```

Returns the DDL as a string. On error (missing privilege, invalid type), returns `RpcError`.

### Opening DDL in editor

A new store action `sqlEditor.openWithDdl(title, ddl)` is added. It creates a new tab with the DDL as content, `filePath: null`, `savedContent: null`, `isDirty: false`, pushes it and sets it active. The `+page.svelte` `onSelect` handler detects PL/SQL kinds and calls this action instead of `loadDetails`.

Tab title: `OWNER.OBJECTNAME`. No dirty indicator until the user saves to disk.

---

## New Tauri commands summary

| Command | Input | Output |
|---------|-------|--------|
| `compile_errors_get` | `owner: string, objectType: string, objectName: string` | `CompileError[]` |
| `object_ddl_get` | `owner: string, objectType: string, objectName: string` | `string` (DDL) |

`objects_list` is extended to return `status: "VALID" | "INVALID"` per object.

---

## Files to create/modify

### Sidecar
- `sidecar/src/handlers/query.ts` — add DBMS_OUTPUT enable/get_lines around each statement

### Rust / Tauri
- `src-tauri/src/commands.rs` — add `compile_errors_get`, `object_ddl_get`; extend `objects_list` response
- `src-tauri/src/lib.rs` — register new commands

### Frontend
- `src/lib/workspace/SqlEditor.svelte` — add `compileErrors` prop + `@codemirror/lint` integration
- `src/lib/workspace/ExecutionLog.svelte` — render `dbmsOutput` lines below each log row
- `src/lib/workspace/CompileErrors.svelte` — new error panel component
- `src/lib/workspace/SqlDrawer.svelte` — mount `CompileErrors`, add "Compile" button
- `src/lib/workspace/SchemaTree.svelte` — new PL/SQL object kinds + status badge
- `src/routes/workspace/[id]/+page.svelte` — `onSelect` distinguishes PL/SQL kinds → calls `object_ddl_get` + `sqlEditor.openWithDdl`
- `src/lib/stores/sql-editor.svelte.ts` — extend `TabResult` + post-execution compile error lookup
- `src/lib/workspace.ts` — extend `ObjectKind` type + `objects_list` response type

---

## Done criteria

- DBMS_OUTPUT lines appear in ExecutionLog after running an anonymous block with `PUT_LINE`
- `CREATE OR REPLACE PROCEDURE` with a syntax error shows red underline + gutter icon + error panel
- Clean compile shows `compileErrors: []` and no markers
- PROCEDURE/FUNCTION/PACKAGE appear in schema tree with VALID/INVALID dot
- Clicking a PACKAGE opens its DDL in a new editor tab
- `bun run check` 0 errors, `bun run test` all pass, `cargo check` 0 errors
