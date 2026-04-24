# Security Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement audit trail (SQLite + JSONL file), DML/DDL confirmation modal, and pre-release security disclaimer modal.

**Architecture:** DML confirmation uses a Promise-gate in the sql-editor store (`_pendingConfirm`) that SqlDrawer resolves via a modal. The audit trail adds `username`/`host` to `HistorySaveInput` on the TypeScript side; the Rust command handler writes both SQLite and a daily `.jsonl` file in `appDataDir/audit/`. The disclaimer modal intercepts `ConnectionForm` form submission and gates it behind an accepted-checkbox; acceptance is persisted in `localStorage` keyed by `connectionId`.

**Tech Stack:** SvelteKit 5 (Svelte runes), Rust/Tauri 2, rusqlite, serde_json, chrono, Vitest

---

## File Map

| File | Action |
|---|---|
| `src/lib/sql-safety.ts` | **Create** — `detectDestructive()` |
| `src/lib/sql-safety.test.ts` | **Create** — Vitest tests for detectDestructive |
| `src/lib/query-history.ts` | **Modify** — add `username`/`host` to `HistorySaveInput` |
| `src/lib/stores/sql-editor.svelte.ts` | **Modify** — add connection context, `pendingConfirm`, intercept run methods |
| `src/lib/workspace/DmlConfirmModal.svelte` | **Create** — confirmation modal |
| `src/lib/workspace/SecurityDisclaimerModal.svelte` | **Create** — pre-release disclaimer modal |
| `src/lib/workspace/SqlDrawer.svelte` | **Modify** — render `DmlConfirmModal` |
| `src/lib/ConnectionForm.svelte` | **Modify** — disclaimer gate, updated `onSave` prop type |
| `src/routes/connections/new/+page.svelte` | **Modify** — return `id` from `onSave` |
| `src/routes/connections/[id]/edit/+page.svelte` | **Modify** — return `id` from `onSave` |
| `src/routes/workspace/[id]/+page.svelte` | **Modify** — call `setConnectionContext` |
| `src-tauri/src/persistence/history.rs` | **Modify** — new fields, migration, updated insert/list |
| `src-tauri/src/commands.rs` | **Modify** — audit JSONL write in `history_save` |

---

## Task 1: `sql-safety.ts` — destructive operation detector

**Files:**
- Create: `src/lib/sql-safety.test.ts`
- Create: `src/lib/sql-safety.ts`

- [ ] **Step 1.1: Write failing tests**

Create `src/lib/sql-safety.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { detectDestructive } from "./sql-safety";

describe("detectDestructive", () => {
  it("returns empty for SELECT", () => {
    expect(detectDestructive("SELECT * FROM employees")).toHaveLength(0);
  });

  it("returns empty for INSERT", () => {
    expect(detectDestructive("INSERT INTO t (a) VALUES (1)")).toHaveLength(0);
  });

  it("detects DELETE as destructive", () => {
    const ops = detectDestructive("DELETE FROM employees WHERE id = 1");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("DELETE");
    expect(ops[0].severity).toBe("destructive");
  });

  it("detects UPDATE as destructive", () => {
    const ops = detectDestructive("UPDATE employees SET salary = 0");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("UPDATE");
    expect(ops[0].severity).toBe("destructive");
  });

  it("detects DROP as critical", () => {
    const ops = detectDestructive("DROP TABLE employees");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("DROP");
    expect(ops[0].severity).toBe("critical");
  });

  it("detects TRUNCATE as critical", () => {
    const ops = detectDestructive("TRUNCATE TABLE employees");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("TRUNCATE");
    expect(ops[0].severity).toBe("critical");
  });

  it("detects ALTER as warning", () => {
    const ops = detectDestructive("ALTER TABLE employees ADD COLUMN x NUMBER");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("ALTER");
    expect(ops[0].severity).toBe("warning");
  });

  it("detects MERGE as destructive", () => {
    const ops = detectDestructive("MERGE INTO t USING s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET t.x = s.x");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("MERGE");
  });

  it("detects CREATE OR REPLACE as warning", () => {
    const ops = detectDestructive("CREATE OR REPLACE PROCEDURE my_proc AS BEGIN NULL; END;");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("CREATE OR REPLACE");
    expect(ops[0].severity).toBe("warning");
  });

  it("is case-insensitive", () => {
    expect(detectDestructive("delete from t")).toHaveLength(1);
    expect(detectDestructive("Delete From t")).toHaveLength(1);
  });

  it("does NOT flag commented-out DELETE", () => {
    expect(detectDestructive("-- DELETE FROM t\nSELECT 1 FROM dual")).toHaveLength(0);
  });

  it("does NOT flag DELETE inside block comment", () => {
    expect(detectDestructive("/* DELETE FROM t */ SELECT 1 FROM dual")).toHaveLength(0);
  });

  it("does NOT flag COMMIT or ROLLBACK", () => {
    expect(detectDestructive("COMMIT")).toHaveLength(0);
    expect(detectDestructive("ROLLBACK")).toHaveLength(0);
  });

  it("returns one entry per distinct keyword even if keyword appears multiple times", () => {
    const ops = detectDestructive("DELETE FROM a; DELETE FROM b");
    expect(ops).toHaveLength(1);
    expect(ops[0].keyword).toBe("DELETE");
  });

  it("returns multiple entries when multiple distinct keywords are present", () => {
    const ops = detectDestructive("UPDATE t SET x=1; DROP TABLE t");
    expect(ops).toHaveLength(2);
    const keywords = ops.map((o) => o.keyword);
    expect(keywords).toContain("UPDATE");
    expect(keywords).toContain("DROP");
  });
});
```

- [ ] **Step 1.2: Run test to confirm it fails**

```
bun run test src/lib/sql-safety.test.ts
```
Expected: FAIL — `sql-safety` module not found.

- [ ] **Step 1.3: Create `src/lib/sql-safety.ts`**

```typescript
export type Severity = "critical" | "destructive" | "warning";

export type DestructiveOp = {
  keyword: string;
  severity: Severity;
  description: string;
};

type Rule = { pattern: RegExp; keyword: string; severity: Severity; description: string };

const RULES: Rule[] = [
  { pattern: /\bDROP\b/i,              keyword: "DROP",              severity: "critical",    description: "Removes object permanently" },
  { pattern: /\bTRUNCATE\b/i,          keyword: "TRUNCATE",          severity: "critical",    description: "Removes all rows; cannot be rolled back" },
  { pattern: /\bDELETE\b/i,            keyword: "DELETE",            severity: "destructive", description: "Removes rows permanently" },
  { pattern: /\bUPDATE\b/i,            keyword: "UPDATE",            severity: "destructive", description: "Modifies existing data" },
  { pattern: /\bMERGE\b/i,             keyword: "MERGE",             severity: "destructive", description: "May update or delete rows" },
  { pattern: /\bALTER\b/i,             keyword: "ALTER",             severity: "warning",     description: "Modifies object structure" },
  { pattern: /\bCREATE\s+OR\s+REPLACE\b/i, keyword: "CREATE OR REPLACE", severity: "warning", description: "Overwrites existing object" },
];

function stripComments(sql: string): string {
  // Remove block comments /* ... */
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Remove line comments -- ...
  s = s.replace(/--[^\n]*/g, " ");
  return s;
}

export function detectDestructive(sql: string): DestructiveOp[] {
  const stripped = stripComments(sql);
  const seen = new Set<string>();
  const result: DestructiveOp[] = [];
  for (const rule of RULES) {
    if (!seen.has(rule.keyword) && rule.pattern.test(stripped)) {
      seen.add(rule.keyword);
      result.push({ keyword: rule.keyword, severity: rule.severity, description: rule.description });
    }
  }
  return result;
}
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```
bun run test src/lib/sql-safety.test.ts
```
Expected: All tests PASS.

- [ ] **Step 1.5: Commit**

```
git add src/lib/sql-safety.ts src/lib/sql-safety.test.ts
git commit -m "feat: add sql-safety detectDestructive utility with tests"
```

---

## Task 2: Enrich TypeScript `HistorySaveInput` + store connection context

**Files:**
- Modify: `src/lib/query-history.ts`
- Modify: `src/lib/stores/sql-editor.svelte.ts`
- Modify: `src/routes/workspace/[id]/+page.svelte`

- [ ] **Step 2.1: Update `HistorySaveInput` in `src/lib/query-history.ts`**

Replace the `HistorySaveInput` type (lines 16–24):

```typescript
export type HistorySaveInput = {
  connectionId: string;
  sql: string;
  success: boolean;
  rowCount: number | null;
  elapsedMs: number;
  errorCode: number | null;
  errorMessage: string | null;
  username: string | null;
  host: string | null;
};
```

- [ ] **Step 2.2: Add connection context state to `src/lib/stores/sql-editor.svelte.ts`**

After line 73 (`let _connectionId: string | null = null;`), add:

```typescript
let _connectionUsername: string | null = null;
let _connectionHost: string | null = null;
```

- [ ] **Step 2.3: Replace `setConnectionId` with `setConnectionContext` in the store object**

Find and replace the `setConnectionId` method (line ~208):

```typescript
// REMOVE this:
setConnectionId(id: string | null): void { _connectionId = id; },

// ADD this:
setConnectionContext(id: string | null, username: string | null, host: string | null): void {
  _connectionId = id;
  _connectionUsername = username;
  _connectionHost = host;
},
```

- [ ] **Step 2.4: Update `reset()` to clear new context fields**

In the `reset()` method (line ~749), after `_connectionId = null;` add:

```typescript
_connectionUsername = null;
_connectionHost = null;
```

- [ ] **Step 2.5: Update `pushHistory` to pass username and host**

Replace the `pushHistory` function body (lines 186–198):

```typescript
function pushHistory(sql: string, r: TabResult): void {
  if (_connectionId === null) return;
  if (r.status === "cancelled") return;
  void historySave({
    connectionId: _connectionId,
    sql,
    success: r.status === "ok",
    rowCount: r.status === "ok" && r.result !== null ? r.result.rowCount : null,
    elapsedMs: r.elapsedMs,
    errorCode: r.status === "error" && r.error !== null ? r.error.code : null,
    errorMessage: r.status === "error" && r.error !== null ? r.error.message : null,
    username: _connectionUsername,
    host: _connectionHost,
  }).catch((e) => console.warn("history save failed:", e));
}
```

- [ ] **Step 2.6: Update workspace page to call `setConnectionContext`**

In `src/routes/workspace/[id]/+page.svelte`, find line 284 and replace:

```typescript
// REMOVE:
sqlEditor.setConnectionId(meta.id);

// ADD:
const hostOrAlias = meta.authType === "basic" ? meta.host : meta.connectAlias;
sqlEditor.setConnectionContext(meta.id, meta.username, hostOrAlias);
```

- [ ] **Step 2.7: Run frontend tests to ensure no regressions**

```
bun run test
```
Expected: All 144 tests pass (same as baseline).

- [ ] **Step 2.8: Commit**

```
git add src/lib/query-history.ts src/lib/stores/sql-editor.svelte.ts src/routes/workspace/[id]/+page.svelte
git commit -m "feat(audit): add username/host to HistorySaveInput and store connection context"
```

---

## Task 3: Rust — SQLite migration + audit JSONL writer

**Files:**
- Modify: `src-tauri/src/persistence/history.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 3.1: Add `username`/`host` to `HistorySaveInput` struct in `history.rs`**

Replace the `HistorySaveInput` struct (lines 31–41):

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySaveInput {
    pub connection_id: String,
    pub sql: String,
    pub success: bool,
    pub row_count: Option<i64>,
    pub elapsed_ms: i64,
    pub error_code: Option<i32>,
    pub error_message: Option<String>,
    pub username: Option<String>,
    pub host: Option<String>,
}
```

- [ ] **Step 3.2: Add `username`/`host` to `HistoryEntry` struct in `history.rs`**

Replace the `HistoryEntry` struct (lines 17–29):

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub connection_id: String,
    pub sql: String,
    pub success: bool,
    pub row_count: Option<i64>,
    pub elapsed_ms: i64,
    pub error_code: Option<i32>,
    pub error_message: Option<String>,
    pub executed_at: String,
    pub username: Option<String>,
    pub host: Option<String>,
}
```

- [ ] **Step 3.3: Add migration helper and update `init_db_history` in `history.rs`**

Add the helper function before `init_db_history`:

```rust
fn has_column_history(conn: &SqliteConnection, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare("PRAGMA table_info(query_history)")?;
    let names: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(names.iter().any(|n| n == column))
}
```

Replace `init_db_history` to add the migration at the end:

```rust
pub fn init_db_history(conn: &SqliteConnection) -> Result<(), HistoryError> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS query_history (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id TEXT NOT NULL,
            sql           TEXT NOT NULL,
            success       INTEGER NOT NULL,
            row_count     INTEGER,
            elapsed_ms    INTEGER NOT NULL,
            error_code    INTEGER,
            error_message TEXT,
            executed_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS query_history_connection_executed_idx
            ON query_history (connection_id, executed_at DESC);
        CREATE INDEX IF NOT EXISTS query_history_connection_id_idx
            ON query_history (connection_id, id DESC);
        "#,
    )?;
    if !has_column_history(conn, "username")? {
        conn.execute_batch(
            "ALTER TABLE query_history ADD COLUMN username TEXT;
             ALTER TABLE query_history ADD COLUMN host TEXT;",
        )?;
    }
    Ok(())
}
```

- [ ] **Step 3.4: Update `insert()` to write the new fields**

Replace the `insert` function:

```rust
pub fn insert(conn: &SqliteConnection, input: &HistorySaveInput) -> Result<i64, HistoryError> {
    if input.connection_id.is_empty() {
        return Err(HistoryError::InvalidArg("connection_id required".into()));
    }
    if input.sql.is_empty() {
        return Err(HistoryError::InvalidArg("sql required".into()));
    }
    let executed_at = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO query_history
            (connection_id, sql, success, row_count, elapsed_ms, error_code, error_message, executed_at, username, host)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            input.connection_id,
            input.sql,
            input.success as i64,
            input.row_count,
            input.elapsed_ms,
            input.error_code,
            input.error_message,
            executed_at,
            input.username,
            input.host,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}
```

- [ ] **Step 3.5: Update `list()` SELECT and `map_row` to include new columns**

Replace the two SQL strings inside `list()` — both must include `username, host` at the end of the SELECT:

```rust
// First branch (with search):
let mut stmt = conn.prepare(
    "SELECT id, connection_id, sql, success, row_count, elapsed_ms, error_code, error_message, executed_at, username, host
     FROM query_history
     WHERE connection_id = ? AND sql LIKE ? ESCAPE '\\'
     ORDER BY id DESC
     LIMIT ? OFFSET ?",
)?;

// Second branch (no search):
let mut stmt = conn.prepare(
    "SELECT id, connection_id, sql, success, row_count, elapsed_ms, error_code, error_message, executed_at, username, host
     FROM query_history
     WHERE connection_id = ?
     ORDER BY id DESC
     LIMIT ? OFFSET ?",
)?;
```

Replace `map_row`:

```rust
fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryEntry> {
    Ok(HistoryEntry {
        id: row.get(0)?,
        connection_id: row.get(1)?,
        sql: row.get(2)?,
        success: row.get::<_, i64>(3)? != 0,
        row_count: row.get(4)?,
        elapsed_ms: row.get(5)?,
        error_code: row.get(6)?,
        error_message: row.get(7)?,
        executed_at: row.get(8)?,
        username: row.get(9)?,
        host: row.get(10)?,
    })
}
```

- [ ] **Step 3.6: Update test helpers in `history.rs`**

In the `#[cfg(test)]` module, update `ok_input` and `err_input` to include the new fields:

```rust
fn ok_input(conn_id: &str, sql: &str) -> HistorySaveInput {
    HistorySaveInput {
        connection_id: conn_id.into(),
        sql: sql.into(),
        success: true,
        row_count: Some(42),
        elapsed_ms: 100,
        error_code: None,
        error_message: None,
        username: Some("testuser".into()),
        host: Some("localhost".into()),
    }
}

fn err_input(conn_id: &str, sql: &str) -> HistorySaveInput {
    HistorySaveInput {
        connection_id: conn_id.into(),
        sql: sql.into(),
        success: false,
        row_count: None,
        elapsed_ms: 50,
        error_code: Some(-32013),
        error_message: Some("ORA-00942: table or view does not exist".into()),
        username: None,
        host: None,
    }
}
```

- [ ] **Step 3.7: Add `write_audit_entry` + update `history_save` command in `commands.rs`**

At the top of `commands.rs` (after existing `use` statements), add:

```rust
use std::fs::OpenOptions;
use std::io::Write as IoWrite;
```

Add the `write_audit_entry` free function anywhere in `commands.rs`:

```rust
fn write_audit_entry(app_data_dir: &std::path::Path, input: &HistorySaveInput) {
    let audit_dir = app_data_dir.join("audit");
    if std::fs::create_dir_all(&audit_dir).is_err() {
        return;
    }
    let now = chrono::Utc::now();
    let date = now.format("%Y-%m-%d").to_string();
    let path = audit_dir.join(format!("{date}.jsonl"));
    let entry = serde_json::json!({
        "ts":           now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "connectionId": input.connection_id,
        "host":         input.host.as_deref().unwrap_or(""),
        "username":     input.username.as_deref().unwrap_or(""),
        "sql":          input.sql,
        "success":      input.success,
        "rowCount":     input.row_count,
        "elapsedMs":    input.elapsed_ms,
    });
    let mut line = entry.to_string();
    line.push('\n');
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(line.as_bytes());
    }
}
```

Replace the `history_save` command:

```rust
#[tauri::command]
pub async fn history_save(
    app: AppHandle,
    input: HistorySaveInput,
) -> Result<i64, ConnectionError> {
    if let Ok(data_dir) = app.path().app_data_dir() {
        write_audit_entry(&data_dir, &input);
    }
    let svc = app.state::<ConnectionService>();
    svc.history_save(input)
}
```

- [ ] **Step 3.8: Build Rust to verify compilation**

```powershell
cd src-tauri
cargo build 2>&1 | tail -20
cd ..
```
Expected: `Compiling veesker` … `Finished` with no errors.

- [ ] **Step 3.9: Run Rust tests**

```powershell
cd src-tauri
cargo test -- --test-output immediate 2>&1 | tail -30
cd ..
```
Expected: All existing tests pass.

- [ ] **Step 3.10: Commit**

```
git add src-tauri/src/persistence/history.rs src-tauri/src/commands.rs
git commit -m "feat(audit): enrich history with username/host, write daily audit JSONL"
```

---

## Task 4: `DmlConfirmModal.svelte`

**Files:**
- Create: `src/lib/workspace/DmlConfirmModal.svelte`

- [ ] **Step 4.1: Create the component**

Create `src/lib/workspace/DmlConfirmModal.svelte`:

```svelte
<script lang="ts">
  import type { DestructiveOp } from "$lib/sql-safety";

  type Props = {
    sql: string;
    ops: DestructiveOp[];
    onConfirm: () => void;
    onCancel: () => void;
  };
  let { sql, ops, onConfirm, onCancel }: Props = $props();

  const worstSeverity = $derived(
    ops.some((o) => o.severity === "critical")
      ? "critical"
      : ops.some((o) => o.severity === "destructive")
        ? "destructive"
        : "warning"
  );

  const severityLabel: Record<string, string> = {
    critical: "CRITICAL",
    destructive: "DESTRUCTIVE",
    warning: "WARNING",
  };
</script>

<dialog
  class="modal"
  open
  onclick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
>
  <div
    class="modal-box"
    role="document"
    onkeydown={(e) => {
      if (e.key === "Escape") { onCancel(); return; }
      e.stopPropagation();
    }}
    onclick={(e) => e.stopPropagation()}
  >
    <div class="modal-header" class:critical={worstSeverity === "critical"} class:destructive={worstSeverity === "destructive"} class:warning={worstSeverity === "warning"}>
      <span class="severity-icon">{worstSeverity === "critical" ? "⛔" : worstSeverity === "destructive" ? "⚠️" : "⚡"}</span>
      <span class="modal-title">{severityLabel[worstSeverity]} — Confirm Execution</span>
      <button class="modal-close" onclick={onCancel} aria-label="Close">×</button>
    </div>
    <div class="modal-body">
      <div class="ops-list">
        {#each ops as op (op.keyword)}
          <div class="op-row">
            <span class="op-badge" class:badge-critical={op.severity === "critical"} class:badge-destructive={op.severity === "destructive"} class:badge-warning={op.severity === "warning"}>
              {op.keyword}
            </span>
            <span class="op-desc">{op.description}</span>
          </div>
        {/each}
      </div>
      <div class="sql-preview-label">SQL to be executed:</div>
      <pre class="sql-preview">{sql}</pre>
      <p class="commit-note">COMMIT and ROLLBACK are never applied automatically — only via explicit button or script command.</p>
    </div>
    <div class="modal-footer">
      <button class="btn-cancel" onclick={onCancel}>Cancel</button>
      <button class="btn-execute" onclick={onConfirm}>Execute Anyway</button>
    </div>
  </div>
</dialog>

<style>
  .modal {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    border: none; padding: 0; z-index: 300;
  }
  .modal-box {
    background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: 8px; width: 520px; max-width: 94vw; max-height: 82vh;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .modal-header {
    display: flex; align-items: center; gap: 8px;
    padding: 12px 16px; border-bottom: 1px solid var(--border);
  }
  .modal-header.critical  { background: rgba(179,62,31,0.12); }
  .modal-header.destructive { background: rgba(179,120,31,0.10); }
  .modal-header.warning   { background: rgba(200,160,0,0.08); }
  .severity-icon { font-size: 16px; }
  .modal-title { flex: 1; font-size: 12px; font-weight: 700; color: var(--text-primary); letter-spacing: 0.05em; }
  .modal-close { background: none; border: none; font-size: 16px; cursor: pointer; color: var(--text-muted); padding: 0 4px; }
  .modal-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .ops-list { display: flex; flex-direction: column; gap: 6px; }
  .op-row { display: flex; align-items: center; gap: 8px; }
  .op-badge {
    font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
    padding: 2px 6px; border-radius: 3px; white-space: nowrap;
  }
  .badge-critical    { background: rgba(179,62,31,0.15); color: #7a2a14; }
  .badge-destructive { background: rgba(179,120,31,0.15); color: #7a4214; }
  .badge-warning     { background: rgba(200,160,0,0.12); color: #6b5600; }
  .op-desc { font-size: 12px; color: var(--text-muted); }
  .sql-preview-label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .sql-preview {
    background: var(--bg-surface-alt); border: 1px solid var(--border);
    border-radius: 4px; padding: 10px 12px;
    font-family: "JetBrains Mono", "SF Mono", monospace; font-size: 11px;
    color: var(--text-primary); overflow-y: auto; max-height: 300px;
    white-space: pre-wrap; word-break: break-word; margin: 0;
  }
  .commit-note {
    font-size: 11px; color: var(--text-muted); font-style: italic;
    border-top: 1px solid var(--border); padding-top: 10px; margin: 0;
  }
  .modal-footer {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 16px; border-top: 1px solid var(--border);
  }
  .btn-cancel, .btn-execute {
    padding: 6px 18px; border-radius: 5px; font-size: 12px; cursor: pointer; border: none;
  }
  .btn-cancel { background: var(--bg-surface-alt); color: var(--text-primary); border: 1px solid var(--border); }
  .btn-execute { background: #b33e1f; color: #fff; font-weight: 600; }
  .btn-execute:hover { background: #8c2f17; }
</style>
```

- [ ] **Step 4.2: Run type-check**

```
bun run build 2>&1 | grep -i error | head -20
```
Expected: No TypeScript errors related to `DmlConfirmModal`.

- [ ] **Step 4.3: Commit**

```
git add src/lib/workspace/DmlConfirmModal.svelte
git commit -m "feat: add DmlConfirmModal component"
```

---

## Task 5: Add `pendingConfirm` gate to sql-editor store + wire `SqlDrawer`

**Files:**
- Modify: `src/lib/stores/sql-editor.svelte.ts`
- Modify: `src/lib/workspace/SqlDrawer.svelte`

- [ ] **Step 5.1: Add `DestructiveOp` import and `_pendingConfirm` state to `sql-editor.svelte.ts`**

At the top of the file (after existing imports), add:

```typescript
import { detectDestructive, type DestructiveOp } from "$lib/sql-safety";
```

After the `_connectionHost` line (after task 2), add:

```typescript
type PendingConfirm = {
  sql: string;
  ops: DestructiveOp[];
  resolve: (confirmed: boolean) => void;
};
let _pendingConfirm = $state<PendingConfirm | null>(null);
```

- [ ] **Step 5.2: Clear `_pendingConfirm` in `reset()`**

In the `reset()` method, after `_connectionHost = null;` (added in Task 2), add:

```typescript
_pendingConfirm = null;
```

- [ ] **Step 5.3: Add `pendingConfirm` getter and `confirmRun` to the store object**

After the `setConnectionContext` method, add:

```typescript
get pendingConfirm(): PendingConfirm | null { return _pendingConfirm; },
confirmRun(confirmed: boolean): void {
  if (_pendingConfirm) {
    _pendingConfirm.resolve(confirmed);
    _pendingConfirm = null;
  }
},
```

- [ ] **Step 5.4: Add `askConfirm` helper function (outside the store object, near `pushHistory`)**

```typescript
function askConfirm(sql: string): Promise<boolean> {
  const ops = detectDestructive(sql);
  if (ops.length === 0) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    _pendingConfirm = { sql, ops, resolve };
  });
}
```

- [ ] **Step 5.5: Intercept `runActive()` to gate on confirmation**

In the `runActive()` method, after `const sql = stripTrailingSemicolon(tab.sql);` and before `const requestId = ...`, add:

```typescript
if (!(await askConfirm(sql))) return;
```

The full beginning of `runActive` should look like:

```typescript
async runActive(): Promise<void> {
  const tab = this.active;
  if (tab === null) return;
  const sql = stripTrailingSemicolon(tab.sql);
  if (sql === "") return;
  if (!(await askConfirm(sql))) return;
  const requestId = crypto.randomUUID();
  // ... rest unchanged
```

- [ ] **Step 5.6: Intercept `runActiveAll()` to gate on confirmation**

In `runActiveAll()`, after the splitter pre-flight check (after the `if (errors.length > 0)` block), before `const requestId = ...`, add:

```typescript
if (!(await askConfirm(tab.sql))) return;
```

- [ ] **Step 5.7: Intercept `runSelection()` to gate on confirmation**

In `runSelection(selection: string)`, after `const sql = stripTrailingSemicolon(selection);` and `if (sql === "") return;`, add:

```typescript
if (!(await askConfirm(sql))) return;
```

- [ ] **Step 5.8: Intercept `runStatementAtCursor()` to gate on confirmation**

In `runStatementAtCursor()`, after `const sqlToRun = stripTrailingSemicolon(matchedSql);` and before `try {`, add:

```typescript
if (!(await askConfirm(sqlToRun))) return;
```

- [ ] **Step 5.9: Wire `DmlConfirmModal` into `SqlDrawer.svelte`**

In `src/lib/workspace/SqlDrawer.svelte`, add import at the top of the `<script>`:

```typescript
import DmlConfirmModal from "./DmlConfirmModal.svelte";
```

At the end of the template (just before `</svelte:fragment>` or at the end of the root element), add:

```svelte
{#if sqlEditor.pendingConfirm}
  <DmlConfirmModal
    sql={sqlEditor.pendingConfirm.sql}
    ops={sqlEditor.pendingConfirm.ops}
    onConfirm={() => sqlEditor.confirmRun(true)}
    onCancel={() => sqlEditor.confirmRun(false)}
  />
{/if}
```

- [ ] **Step 5.10: Run frontend tests**

```
bun run test
```
Expected: All tests pass. (The `runActive` tests in `sql-editor.test.ts` mock `queryExecute`, so they won't be affected.)

- [ ] **Step 5.11: Commit**

```
git add src/lib/stores/sql-editor.svelte.ts src/lib/workspace/SqlDrawer.svelte
git commit -m "feat: add DML/DDL confirmation gate to SQL execution"
```

---

## Task 6: `SecurityDisclaimerModal.svelte` + `ConnectionForm` wiring

**Files:**
- Create: `src/lib/workspace/SecurityDisclaimerModal.svelte`
- Modify: `src/lib/ConnectionForm.svelte`
- Modify: `src/routes/connections/new/+page.svelte`
- Modify: `src/routes/connections/[id]/edit/+page.svelte`

- [ ] **Step 6.1: Create `SecurityDisclaimerModal.svelte`**

Create `src/lib/workspace/SecurityDisclaimerModal.svelte`:

```svelte
<script lang="ts">
  type Props = {
    onAccept: () => void;
    onCancel: () => void;
  };
  let { onAccept, onCancel }: Props = $props();

  let accepted = $state(false);
</script>

<dialog
  class="modal"
  open
  onclick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
>
  <div
    class="modal-box"
    role="document"
    onkeydown={(e) => {
      if (e.key === "Escape") { onCancel(); return; }
      e.stopPropagation();
    }}
    onclick={(e) => e.stopPropagation()}
  >
    <div class="modal-header">
      <span class="modal-title">⚠ Security Notice — Pre-release Software</span>
    </div>
    <div class="modal-body">
      <ul class="notice-list">
        <li><strong>Veesker v0.0.1</strong> has not undergone a formal security audit. It is pre-release software.</li>
        <li>Use in corporate environments is at the <strong>operator's sole responsibility</strong>. Verify compliance with your organization's policies before connecting.</li>
        <li>The <strong>AI assistant (SheepChat / Analyze)</strong> sends schema names, column names, SQL queries, and result samples to <code>api.anthropic.com</code>. <strong>Do not use with sensitive, classified, or regulated data.</strong></li>
      </ul>
      <label class="accept-row">
        <input type="checkbox" bind:checked={accepted} />
        <span>I understand and accept responsibility for use in corporate environments</span>
      </label>
    </div>
    <div class="modal-footer">
      <button class="btn-cancel" onclick={onCancel}>Cancel</button>
      <button class="btn-accept" onclick={onAccept} disabled={!accepted}>Accept & Save</button>
    </div>
  </div>
</dialog>

<style>
  .modal {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    border: none; padding: 0; z-index: 300;
  }
  .modal-box {
    background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: 8px; width: 500px; max-width: 94vw;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .modal-header {
    padding: 14px 16px; border-bottom: 1px solid var(--border);
    background: rgba(179,62,31,0.08);
  }
  .modal-title { font-size: 13px; font-weight: 700; color: var(--text-primary); }
  .modal-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; }
  .notice-list {
    margin: 0; padding-left: 18px;
    display: flex; flex-direction: column; gap: 10px;
    font-size: 13px; line-height: 1.55; color: var(--text-primary);
  }
  .notice-list li { padding-left: 2px; }
  code {
    font-family: "JetBrains Mono", monospace; font-size: 11px;
    background: var(--bg-surface-alt); padding: 1px 4px; border-radius: 3px;
  }
  .accept-row {
    display: flex; align-items: flex-start; gap: 10px;
    font-size: 13px; color: var(--text-primary); cursor: pointer;
    padding: 10px 12px; border-radius: 6px;
    background: var(--bg-surface-alt); border: 1px solid var(--border);
  }
  .accept-row input { margin-top: 2px; flex-shrink: 0; cursor: pointer; accent-color: #b33e1f; }
  .modal-footer {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 16px; border-top: 1px solid var(--border);
  }
  .btn-cancel, .btn-accept {
    padding: 8px 20px; border-radius: 5px; font-size: 13px; cursor: pointer; border: none;
  }
  .btn-cancel { background: var(--bg-surface-alt); color: var(--text-primary); border: 1px solid var(--border); }
  .btn-accept { background: #b33e1f; color: #fff; font-weight: 600; }
  .btn-accept:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-accept:not(:disabled):hover { background: #8c2f17; }
</style>
```

- [ ] **Step 6.2: Update `onSave` prop type in `ConnectionForm.svelte`**

In `src/lib/ConnectionForm.svelte`, change the `onSave` prop type in the destructured props:

```typescript
// REPLACE:
onSave: (input: ConnectionInput) => Promise<{ ok: true } | { ok: false; message: string }>;

// WITH:
onSave: (input: ConnectionInput) => Promise<{ ok: true; id: string } | { ok: false; message: string }>;
```

- [ ] **Step 6.3: Add disclaimer state + logic to `ConnectionForm.svelte`**

In the `<script>` section, add these imports and state after the existing `$state` declarations (after line ~66):

```typescript
import SecurityDisclaimerModal from "$lib/workspace/SecurityDisclaimerModal.svelte";

let showDisclaimer = $state(false);

function needsDisclaimer(): boolean {
  if (typeof localStorage === "undefined") return false;
  if (id === undefined) return true;
  return !localStorage.getItem(`veesker.security.accepted.${id}`);
}

async function doSave(): Promise<void> {
  saveState = { kind: "running" };
  const res = await onSave(buildInput());
  if (res.ok) {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(`veesker.security.accepted.${res.id}`, "1");
    }
    saveState = { kind: "idle" };
  } else {
    saveState = { kind: "err", message: res.message };
  }
}
```

- [ ] **Step 6.4: Update `onSubmit` to gate on disclaimer**

Replace the `onSubmit` function:

```typescript
async function onSubmit(event: Event) {
  event.preventDefault();
  if (needsDisclaimer()) {
    showDisclaimer = true;
    return;
  }
  await doSave();
}
```

- [ ] **Step 6.5: Render `SecurityDisclaimerModal` in the `ConnectionForm` template**

At the very end of the `<form>` element (before `</form>`), add:

```svelte
{#if showDisclaimer}
  <SecurityDisclaimerModal
    onAccept={() => { showDisclaimer = false; void doSave(); }}
    onCancel={() => { showDisclaimer = false; }}
  />
{/if}
```

- [ ] **Step 6.6: Update `src/routes/connections/new/+page.svelte` to return `id`**

Replace the `onSave` function:

```typescript
async function onSave(input: ConnectionInput) {
  const res = await saveConnection(input);
  if (!res.ok) return { ok: false as const, message: res.error.message };
  const id = res.data.id;
  await goto("/");
  return { ok: true as const, id };
}
```

- [ ] **Step 6.7: Update `src/routes/connections/[id]/edit/+page.svelte` to return `id`**

Replace the `onSave` function:

```typescript
async function onSave(input: ConnectionInput) {
  const res = await saveConnection(input);
  if (!res.ok) return { ok: false as const, message: res.error.message };
  const id = res.data.id;
  await goto("/");
  return { ok: true as const, id };
}
```

- [ ] **Step 6.8: Run frontend tests**

```
bun run test
```
Expected: All tests pass.

- [ ] **Step 6.9: Commit**

```
git add src/lib/workspace/SecurityDisclaimerModal.svelte src/lib/ConnectionForm.svelte src/routes/connections/new/+page.svelte src/routes/connections/[id]/edit/+page.svelte
git commit -m "feat: add pre-release security disclaimer modal on connection save"
```

---

## Verification

- [ ] **Compile sidecar and start dev session**

```powershell
cd sidecar
bun build src/index.ts --compile --minify --outfile ../src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe
cd ..
bun run tauri dev
```

- [ ] **Smoke test: New connection → disclaimer appears, can't save without checkbox**
- [ ] **Smoke test: Edit same connection → disclaimer skipped**
- [ ] **Smoke test: Run `SELECT 1 FROM dual` → no modal**
- [ ] **Smoke test: Run `DELETE FROM x WHERE 1=2` → DML modal appears, Cancel aborts, Execute Anyway runs**
- [ ] **Smoke test: Run All with mixed SELECT + DROP → single consolidated modal**
- [ ] **Smoke test: Check `%APPDATA%\Veesker\audit\` for today's `.jsonl` file after running any SQL**
