# Security Features Design — Veesker

**Date:** 2026-04-24  
**Status:** Approved  
**Scope:** Three security hardening features for corporate environment readiness

---

## Context

Veesker v0.0.1 is pre-release software without a formal security audit. Before connecting to
corporate client databases (even dev environments), three features are needed: a governance
disclaimer, DML/DDL execution safeguards, and a persistent audit trail.

---

## Feature 1 — Audit Trail

### Goal
Persist a tamper-evident record of every SQL execution for compliance review.

### SQLite enrichment
Add `username TEXT` and `host TEXT` columns to the `query_history` table via a SQLite migration.
`HistorySaveInput` gains these two fields. The **frontend** is the source of truth — it already
holds both values from the active session and passes them in the payload. The Rust `history_save`
command writes them as received, with no re-resolution needed.

### File on disk
Path: `{app_data_dir}/audit/YYYY-MM-DD.jsonl`  
Format: JSON Lines — one JSON object appended per execution.

```json
{"ts":"2026-04-24T10:30:00.123Z","connection":"GIMBIA DEV","host":"oradesenv.example.com.br","username":"gimbias","sql":"DELETE FROM orders WHERE id = 1","success":true,"rowCount":1,"elapsedMs":45}
```

- File rotates by calendar day (new file each UTC day).
- Append-only: open → append → close per entry (no file handle held open).
- Retention: indefinite — user manages files manually.
- The `audit/` directory is created on first write if absent.
- Frontend passes `username` and `host` in `HistorySaveInput`; it already has both from the active
  session context.

### Failure handling
Audit file write failure is non-fatal and logged to console — it must never block SQL execution.
SQLite write failure is also non-fatal (existing behaviour).

---

## Feature 2 — Pre-release Security Disclaimer Modal

### Goal
Ensure any operator connecting to a corporate environment has explicitly acknowledged the
software's pre-release status and AI data-egress risk.

### Trigger
`ConnectionForm.svelte` — when the user clicks **Save**, open `SecurityDisclaimerModal.svelte`
before persisting the connection. The modal intercepts the save action; the connection is only
written to storage after the user accepts.

### Modal content
- **Title:** "Security Notice — Pre-release Software"
- **Body:**
  - Veesker v0.0.1 has not undergone a formal security audit.
  - Use in corporate environments is at the operator's sole responsibility.
  - The AI assistant (SheepChat) sends schema names, column names, and SQL context to
    `api.anthropic.com`. Do not use with sensitive or regulated data.
- **Checkbox:** "I understand and accept responsibility for use in corporate environments"
  (must be checked to enable the accept button)
- **Buttons:** Cancel (closes modal, does not save) | **Accept & Save** (enabled only when
  checkbox is checked)

### Persistence
On acceptance, the Save command runs and returns the `connectionId` (new connections) or it is
already known (edit mode). After the save completes successfully, write key
`veesker.security.accepted.<connectionId>` to `localStorage`.
Subsequent edits to the same connection skip the modal. New connections always show it.

---

## Feature 3 — DML/DDL Destructive Operation Confirmation

### Goal
Force the operator to consciously acknowledge destructive SQL before it reaches the database.

### Detection
New file: `src/lib/sql-safety.ts`  
Exported function: `detectDestructive(sql: string): DestructiveOp[]`

```ts
type Severity = "critical" | "destructive" | "warning";
type DestructiveOp = { keyword: string; severity: Severity; description: string };
```

Detection table (case-insensitive, strips `--` and `/* */` comments before matching):

| Keyword pattern | Severity | Description |
|---|---|---|
| `DELETE` | destructive | Removes rows permanently |
| `UPDATE` | destructive | Modifies existing data |
| `DROP` | critical | Removes object permanently |
| `TRUNCATE` | critical | Removes all rows; not rollbackable in Oracle |
| `ALTER` | warning | Modifies object structure |
| `MERGE` | destructive | May update or delete rows |
| `CREATE OR REPLACE` | warning | Overwrites existing object |

`COMMIT` and `ROLLBACK` are **not intercepted** — they are intentional when written explicitly
in a script and must never be applied automatically.

### Interception points in `sql-editor.svelte.ts`

**`runActive()`** — single-statement path:
1. Call `detectDestructive(sql)`.
2. If result is non-empty, open `DmlConfirmModal.svelte` and `await` user decision.
3. If user cancels, abort execution (no RPC call made). If user confirms, proceed normally.

**`runActiveAll()`** — multi-statement path:
1. After the splitter runs successfully, call `detectDestructive` on each statement.
2. Collect all results. If any statement is destructive, open one consolidated modal listing all
   detected operations before executing any statement.
3. If user cancels, abort the entire run. If user confirms, execute all statements as usual.

### Modal `DmlConfirmModal.svelte`

- **Header:** warning icon + most severe level detected (Critical / Destructive / Warning)
- **Operations list:** each detected op with its keyword, severity badge, and description
- **SQL preview:** full SQL text in a scrollable monospace block (max-height 300px)
- **Footer note:** "COMMIT and ROLLBACK are never applied automatically — only via explicit
  button or script command."
- **Buttons:** Cancel | **Execute Anyway**
- No "don't show again" option — confirmation is mandatory every time.

---

## Files Changed / Created

| File | Change |
|---|---|
| `src/lib/sql-safety.ts` | New — destructive operation detector |
| `src/lib/workspace/DmlConfirmModal.svelte` | New — confirmation modal component |
| `src/lib/workspace/SecurityDisclaimerModal.svelte` | New — pre-release disclaimer modal |
| `src/lib/stores/sql-editor.svelte.ts` | Intercept `runActive` and `runActiveAll` |
| `src/lib/ConnectionForm.svelte` | Trigger disclaimer modal on Save |
| `src/lib/query-history.ts` | Add `username`, `host` to `HistorySaveInput` |
| `src-tauri/src/persistence/history.rs` | Migration: add columns; write audit JSONL file |
| `src-tauri/src/commands.rs` | Pass new fields through `history_save` command |

---

## Out of Scope

- Export UI for audit logs (manual file access is sufficient for now)
- Read-only mode (separate future feature)
- Row-level DML diff / preview
- Network-level audit (firewall/proxy logging)
