# Oracle Performance Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-on Oracle performance analyzer that surfaces red flags in the SQL editor as the user types, plus an on-demand "Why slow?" Sheep AI explainer.

**Architecture:** Frontend-orchestrated. Pure rule functions in TypeScript (`src/lib/perf/perf-rules.ts`), debounced analyzer store (`src/lib/stores/perf-analyzer.svelte.ts`), reuses existing `explainPlanGet` RPC, adds one new sidecar RPC `perf.stats` for table dictionary lookups. CodeMirror gutter extension for cost badges; standalone Svelte components for banner and "Why slow?" button.

**Tech Stack:** SvelteKit 5 + Svelte 5 runes, CodeMirror 6, Tauri 2, Bun + node-oracledb (Thin), Vitest, Bun test, Anthropic Claude (existing Sheep integration).

**Spec:** `docs/superpowers/specs/2026-04-26-oracle-perf-helper-design.md`

---

## File map

**New files (frontend):**
- `src/lib/perf/perf-rules.ts` — pure rule functions
- `src/lib/perf/perf-rules.test.ts` — vitest unit tests
- `src/lib/stores/perf-analyzer.svelte.ts` — orchestrator store
- `src/lib/stores/perf-analyzer.test.ts` — vitest store tests
- `src/lib/workspace/CostBadgeGutter.ts` — CodeMirror gutter extension
- `src/lib/workspace/PerfBanner.svelte` — red-flags banner
- `src/lib/workspace/WhySlowButton.svelte` — result-grid button

**New files (sidecar):**
- `sidecar/src/perf-stats.ts` — `tablesStats()` function
- `sidecar/tests/perf-stats.test.ts` — bun test unit + integration

**Modified files:**
- `src-tauri/src/persistence/store.rs` — add `auto_perf_analysis` column
- `src-tauri/src/persistence/connections.rs` — add `auto_perf_analysis` to ConnectionSafety
- `src-tauri/src/persistence/connection_config.rs` — emit `autoPerfAnalysis` in safety params
- `src-tauri/src/commands.rs` — add `perf_stats` Tauri command
- `src-tauri/src/lib.rs` — register `perf_stats` command
- `sidecar/src/oracle.ts` — extend `ConnectionSafety` with `autoPerfAnalysis`
- `sidecar/src/index.ts` — register `perf.stats` RPC handler
- `src/lib/workspace.ts` — `perfStats(sql)` wrapper, `PerfStatsResult` type
- `src/lib/connections.ts` — `autoPerfAnalysis` in `ConnectionSafety` type
- `src/lib/ConnectionForm.svelte` — checkbox for `auto_perf_analysis`
- `src/lib/workspace/SqlEditor.svelte` — register gutter, bind analyzer
- `src/lib/workspace/SqlDrawer.svelte` — render `PerfBanner`
- `src/lib/workspace/ResultGrid.svelte` — render `WhySlowButton`

---

## Task 1: Schema migration — `auto_perf_analysis` column

**Files:**
- Modify: `src-tauri/src/persistence/store.rs`
- Modify: `src-tauri/src/persistence/connections.rs`
- Modify: `src-tauri/src/persistence/connection_config.rs`
- Modify: `sidecar/src/oracle.ts`
- Modify: `src/lib/connections.ts`
- Modify: `src/lib/ConnectionForm.svelte`

- [ ] **Step 1: Write failing migration test**

In `src-tauri/src/persistence/store.rs`, add this test inside the existing `mod tests` block:

```rust
    #[test]
    fn migration_adds_auto_perf_analysis_column() {
        // V3 schema (post-safety-flags) without auto_perf_analysis.
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE connections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                auth_type TEXT NOT NULL DEFAULT 'basic',
                host TEXT, port INTEGER, service_name TEXT, connect_alias TEXT,
                username TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                env TEXT, read_only INTEGER NOT NULL DEFAULT 0,
                statement_timeout_ms INTEGER, warn_unsafe_dml INTEGER NOT NULL DEFAULT 0
            );
            CREATE UNIQUE INDEX connections_name_unique ON connections (LOWER(name));
            INSERT INTO connections
                (id, name, auth_type, host, port, service_name, username, created_at, updated_at)
                VALUES ('v3-1', 'V3', 'basic', 'h', 1521, 'svc', 'u',
                        '2026-04-25T00:00:00Z', '2026-04-25T00:00:00Z');"
        ).unwrap();

        init_db(&c).unwrap();

        let row = get(&c, "v3-1").unwrap().unwrap();
        assert!(row.auto_perf_analysis, "default should be true");
    }
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib persistence::store::tests::migration_adds_auto_perf_analysis_column
```

Expected: FAIL with "no field `auto_perf_analysis` on type `ConnectionRow`".

- [ ] **Step 3: Add field to `ConnectionRow`**

In `src-tauri/src/persistence/store.rs`, find the `ConnectionRow` struct and add the field at the end:

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct ConnectionRow {
    pub id: String,
    pub name: String,
    pub auth_type: AuthType,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub service_name: Option<String>,
    pub connect_alias: Option<String>,
    pub username: String,
    pub created_at: String,
    pub updated_at: String,
    pub env: Option<String>,
    pub read_only: bool,
    pub statement_timeout_ms: Option<u32>,
    pub warn_unsafe_dml: bool,
    pub auto_perf_analysis: bool,
}
```

- [ ] **Step 4: Update CREATE_CURRENT_SCHEMA + MIGRATE_LEGACY_TO_CURRENT**

In `src-tauri/src/persistence/store.rs`, update both schema strings to include the new column:

In `CREATE_CURRENT_SCHEMA`, add this line before the final `)`:
```sql
    auto_perf_analysis   INTEGER NOT NULL DEFAULT 1
                           CHECK (auto_perf_analysis IN (0, 1))
```

In `MIGRATE_LEGACY_TO_CURRENT`, add the same column to `connections_new` and update the INSERT to include `1` (true) as the default for legacy rows. The full updated table definition for `connections_new` should match `CREATE_CURRENT_SCHEMA`.

- [ ] **Step 5: Add idempotent ALTER for the new column**

In `src-tauri/src/persistence/store.rs`, find `add_safety_columns_if_missing` and add a 5th if-block at the end (before `Ok(())`):

```rust
    if !has_column(conn, "connections", "auto_perf_analysis")? {
        conn.execute_batch(
            "ALTER TABLE connections ADD COLUMN auto_perf_analysis INTEGER NOT NULL DEFAULT 1 \
               CHECK (auto_perf_analysis IN (0, 1));",
        )?;
    }
```

- [ ] **Step 6: Update `map_row` to read the new column**

In `src-tauri/src/persistence/store.rs`, find `map_row` and add the field at the end:

```rust
fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConnectionRow> {
    let auth: String = row.get(2)?;
    Ok(ConnectionRow {
        id: row.get(0)?,
        name: row.get(1)?,
        auth_type: AuthType::from_db_str(&auth)?,
        host: row.get(3)?,
        port: row.get::<_, Option<i64>>(4)?.map(|n| n as u16),
        service_name: row.get(5)?,
        connect_alias: row.get(6)?,
        username: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        env: row.get(10)?,
        read_only: row.get::<_, i64>(11)? != 0,
        statement_timeout_ms: row.get::<_, Option<i64>>(12)?.map(|n| n as u32),
        warn_unsafe_dml: row.get::<_, i64>(13)? != 0,
        auto_perf_analysis: row.get::<_, i64>(14)? != 0,
    })
}
```

Update `SELECT_COLS` constant to add the new column at the end:

```rust
const SELECT_COLS: &str =
    "id, name, auth_type, host, port, service_name, connect_alias, username, created_at, updated_at, \
     env, read_only, statement_timeout_ms, warn_unsafe_dml, auto_perf_analysis";
```

- [ ] **Step 7: Update `create()` and `update()` SQL**

In `src-tauri/src/persistence/store.rs`, update `create()` to include the new column:

```rust
pub fn create(conn: &Connection, row: &ConnectionRow) -> Result<(), StoreError> {
    let res = conn.execute(
        "INSERT INTO connections \
         (id, name, auth_type, host, port, service_name, connect_alias, username, created_at, updated_at, \
          env, read_only, statement_timeout_ms, warn_unsafe_dml, auto_perf_analysis) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            row.id, row.name, row.auth_type.as_db_str(),
            row.host, row.port, row.service_name, row.connect_alias, row.username,
            row.created_at, row.updated_at,
            row.env, row.read_only as i32, row.statement_timeout_ms, row.warn_unsafe_dml as i32,
            row.auto_perf_analysis as i32,
        ],
    );
    // ... existing match block stays the same
}
```

Update `update()` similarly to include `auto_perf_analysis = ?` in the SET clause and bind value.

- [ ] **Step 8: Update existing test fixture `sample()`**

In `src-tauri/src/persistence/store.rs`, find `fn sample()` in the test module and add the new field at the end:

```rust
    fn sample(id: &str, name: &str) -> ConnectionRow {
        ConnectionRow {
            id: id.into(),
            name: name.into(),
            auth_type: AuthType::Basic,
            host: Some("localhost".into()),
            port: Some(1521),
            service_name: Some("FREEPDB1".into()),
            connect_alias: None,
            username: "pdbadmin".into(),
            created_at: "2026-04-20T00:00:00Z".into(),
            updated_at: "2026-04-20T00:00:00Z".into(),
            env: None,
            read_only: false,
            statement_timeout_ms: None,
            warn_unsafe_dml: false,
            auto_perf_analysis: true,
        }
    }
```

Also update the wallet row test (`create_wallet_row_then_get`) to add `auto_perf_analysis: true`.

- [ ] **Step 9: Run all rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS — 45 tests (was 44; new test added).

- [ ] **Step 10: Update `ConnectionSafety` Rust struct**

In `src-tauri/src/persistence/connections.rs`, find `ConnectionSafety` and add the field:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSafety {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<String>,
    pub read_only: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub statement_timeout_ms: Option<u32>,
    pub warn_unsafe_dml: bool,
    pub auto_perf_analysis: bool,
}
```

In the `try_from(r: ConnectionRow)` impl, update the `ConnectionSafety` literal:

```rust
        let safety = ConnectionSafety {
            env: r.env.clone(),
            read_only: r.read_only,
            statement_timeout_ms: r.statement_timeout_ms,
            warn_unsafe_dml: r.warn_unsafe_dml,
            auto_perf_analysis: r.auto_perf_analysis,
        };
```

- [ ] **Step 11: Update `ConnectionSafetyInput`**

In `src-tauri/src/persistence/connections.rs`, find `ConnectionSafetyInput` and add the field with a `#[serde(default = ...)]` so it defaults to `true` when omitted by older clients:

```rust
fn default_true() -> bool { true }

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ConnectionSafetyInput {
    pub env: Option<String>,
    pub read_only: bool,
    pub statement_timeout_ms: Option<u32>,
    pub warn_unsafe_dml: bool,
    #[serde(default = "default_true")]
    pub auto_perf_analysis: bool,
}
```

Note: `Default` derive will use `false` for the new field. We override that via `default_true` so JSON omitting the field gets `true` (matching the schema default).

In `assemble_basic_row` and `assemble_wallet_row`, set `auto_perf_analysis: safety.auto_perf_analysis` in both `ConnectionRow` literals (the `None => Ok(...)` and `Some(id) => Ok(...)` branches).

- [ ] **Step 12: Update `connection_config.rs` to emit the flag**

In `src-tauri/src/persistence/connection_config.rs`, find `merge_safety` and add an insertion:

```rust
fn merge_safety(mut base: Value, safety: Option<&ConnectionSafety>) -> Value {
    if let Some(s) = safety {
        let obj = base.as_object_mut().expect("base params object");
        if let Some(env) = &s.env {
            obj.insert("env".into(), Value::String(env.clone()));
        }
        obj.insert("readOnly".into(), Value::Bool(s.read_only));
        if let Some(ms) = s.statement_timeout_ms {
            obj.insert("statementTimeoutMs".into(), Value::Number(ms.into()));
        }
        obj.insert("warnUnsafeDml".into(), Value::Bool(s.warn_unsafe_dml));
        obj.insert("autoPerfAnalysis".into(), Value::Bool(s.auto_perf_analysis));
    }
    base
}
```

- [ ] **Step 13: Run rust build to confirm**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: clean build, no errors.

- [ ] **Step 14: Update sidecar `ConnectionSafety` type**

In `sidecar/src/oracle.ts`, find `ConnectionSafety`:

```ts
export type ConnectionSafety = {
  env?: "dev" | "staging" | "prod";
  readOnly?: boolean;
  statementTimeoutMs?: number;
  warnUnsafeDml?: boolean;
  autoPerfAnalysis?: boolean;
};
```

Find the `ConnectionTestParams` union (both basic and wallet variants) and add `autoPerfAnalysis?: boolean;` next to the existing safety fields.

Find `safetyFromParams` and add the field:

```ts
function safetyFromParams(p: ConnectionTestParams): ConnectionSafety {
  return {
    env: p.env,
    readOnly: p.readOnly === true,
    statementTimeoutMs: p.statementTimeoutMs,
    warnUnsafeDml: p.warnUnsafeDml === true,
    autoPerfAnalysis: p.autoPerfAnalysis !== false, // default true
  };
}
```

- [ ] **Step 15: Update frontend `ConnectionSafety` type**

In `src/lib/connections.ts`, update `ConnectionSafety` and `DEFAULT_SAFETY`:

```ts
export type ConnectionSafety = {
  env?: ConnectionEnv;
  readOnly: boolean;
  statementTimeoutMs?: number;
  warnUnsafeDml: boolean;
  autoPerfAnalysis: boolean;
};

export const DEFAULT_SAFETY: ConnectionSafety = {
  env: undefined,
  readOnly: false,
  statementTimeoutMs: undefined,
  warnUnsafeDml: false,
  autoPerfAnalysis: true,
};
```

- [ ] **Step 16: Add UI checkbox to ConnectionForm**

In `src/lib/ConnectionForm.svelte`, find the existing safety state declarations and add:

```ts
  let autoPerfAnalysis = $state<boolean>(untrack(() => initial.safety?.autoPerfAnalysis ?? true));
```

Update `showSafety` initial computation to include this flag:

```ts
  let showSafety = $state<boolean>(untrack(() => {
    const s = initial.safety;
    return !!(s && (s.env || s.readOnly || s.statementTimeoutMs || s.warnUnsafeDml || s.autoPerfAnalysis === false));
  }));
```

Update `buildSafety()`:

```ts
  function buildSafety() {
    const timeoutSec = Number.parseInt(statementTimeoutSec, 10);
    const statementTimeoutMs =
      Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec * 1000 : undefined;
    return {
      env: env === "" ? undefined : env,
      readOnly,
      statementTimeoutMs,
      warnUnsafeDml,
      autoPerfAnalysis,
    };
  }
```

In the safety panel template, add a new `<label class="safety-check">` AFTER the warn-unsafe-DML checkbox:

```svelte
      <label class="safety-check">
        <input type="checkbox" bind:checked={autoPerfAnalysis} />
        <span>
          <strong>Auto-perf analysis</strong> — background EXPLAIN PLAN + table stats
          to surface red flags as you type. When off, the cost badge / red flags / stats
          freshness disappear, but the "Why slow?" button keeps working on demand.
        </span>
      </label>
```

In the summary badge row at the top of the panel toggle (the `{#if env || readOnly ...}` block), add:

```svelte
        {#if !autoPerfAnalysis}<span class="badge">no auto-perf</span>{/if}
```

- [ ] **Step 17: Update edit-connection page to seed the field**

In `src/routes/connections/[id]/edit/+page.svelte`, find the `safety` literal and add:

```ts
    const safety = {
      env: meta.env,
      readOnly: meta.readOnly ?? false,
      statementTimeoutMs: meta.statementTimeoutMs,
      warnUnsafeDml: meta.warnUnsafeDml ?? false,
      autoPerfAnalysis: meta.autoPerfAnalysis ?? true,
    };
```

- [ ] **Step 18: Run frontend type check**

```bash
bun run check
```

Expected: 0 errors (only pre-existing warnings in unrelated files).

- [ ] **Step 19: Commit**

```bash
git add src-tauri/src/persistence/store.rs \
        src-tauri/src/persistence/connections.rs \
        src-tauri/src/persistence/connection_config.rs \
        sidecar/src/oracle.ts \
        src/lib/connections.ts \
        src/lib/ConnectionForm.svelte \
        src/routes/connections/\[id\]/edit/+page.svelte

git commit -m "feat(safety): add auto_perf_analysis flag — opt-out per connection

Default ON. New checkbox in Safety Guards panel disables the (yet to be
implemented) background perf analyzer for paranoid prod connections.

Schema migration follows the same idempotent ALTER TABLE pattern as the four
existing safety flags (read_only, statement_timeout_ms, warn_unsafe_dml, env)."
```

---

## Task 2: Pure rule functions — Tier 1 (R001-R005)

**Files:**
- Create: `src/lib/perf/perf-rules.ts`
- Create: `src/lib/perf/perf-rules.test.ts`

- [ ] **Step 1: Create the rules file with type definitions only**

Create `src/lib/perf/perf-rules.ts`:

```ts
import type { ExplainNode } from "$lib/workspace";

export type CostClass = "green" | "yellow" | "red" | "unknown";

// Single source of truth for the table-stats shape used by both the analyzer
// and the rule functions. Re-exported from `$lib/workspace` as `PerfTableStats`
// in Task 5 — those are the same type.
export type TableStats = {
  owner: string;
  name: string;
  numRows: number | null;
  lastAnalyzed: string | null;  // ISO date or null
  blocks: number | null;
  indexes: TableIndex[];
};

export type TableIndex = {
  name: string;
  columns: string[];
  unique: boolean;
  status: string; // "VALID", "UNUSABLE", etc
};

export type RedFlag = {
  id: string;
  severity: "critical" | "warn" | "info";
  message: string;
  suggestion?: string;
  line?: number | null;
  context: {
    table?: string;
    column?: string;
    operation?: string;
    cost?: number;
  };
};

export type StaleStat = {
  table: string; // "OWNER.NAME"
  lastAnalyzed: string | null;
  ageDays: number | null; // null when lastAnalyzed is null
};

const BIG_TABLE_THRESHOLD = 100_000;
const HIGH_COST_THRESHOLD = 100_000;
const STALE_STATS_DAYS = 30;
```

- [ ] **Step 2: Write failing test for `classifyCost`**

Create `src/lib/perf/perf-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyCost } from "./perf-rules";

describe("classifyCost", () => {
  it("returns green for low cost (<1000)", () => {
    expect(classifyCost(500)).toBe("green");
    expect(classifyCost(0)).toBe("green");
    expect(classifyCost(999)).toBe("green");
  });
  it("returns yellow for medium cost (1000-100000)", () => {
    expect(classifyCost(1000)).toBe("yellow");
    expect(classifyCost(50_000)).toBe("yellow");
    expect(classifyCost(99_999)).toBe("yellow");
  });
  it("returns red for high cost (>=100000)", () => {
    expect(classifyCost(100_000)).toBe("red");
    expect(classifyCost(1_000_000)).toBe("red");
  });
  it("returns unknown for null", () => {
    expect(classifyCost(null)).toBe("unknown");
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
bun run test src/lib/perf/perf-rules.test.ts
```

Expected: FAIL — "classifyCost is not exported".

- [ ] **Step 4: Implement `classifyCost`**

Append to `src/lib/perf/perf-rules.ts`:

```ts
export function classifyCost(cost: number | null): CostClass {
  if (cost === null) return "unknown";
  if (cost < 1000) return "green";
  if (cost < HIGH_COST_THRESHOLD) return "yellow";
  return "red";
}
```

- [ ] **Step 5: Run test, confirm green**

```bash
bun run test src/lib/perf/perf-rules.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 6: Write failing tests for `detectStaleStats`**

Append to `src/lib/perf/perf-rules.test.ts`:

```ts
import { detectStaleStats } from "./perf-rules";

describe("detectStaleStats", () => {
  // Use a fixed reference date to avoid wall-clock flakiness
  const NOW = new Date("2026-04-26T00:00:00Z");

  it("flags tables with last_analyzed > 30 days ago", () => {
    const stats: TableStats[] = [
      { owner: "HR", name: "EMPLOYEES",
        numRows: 1000, lastAnalyzed: "2026-03-15T00:00:00Z",
        blocks: 10, indexes: [] },
    ];
    const stale = detectStaleStats(stats, NOW);
    expect(stale).toHaveLength(1);
    expect(stale[0].table).toBe("HR.EMPLOYEES");
    expect(stale[0].ageDays).toBeGreaterThan(30);
  });

  it("flags tables with NULL last_analyzed", () => {
    const stats: TableStats[] = [
      { owner: "STG", name: "RAW_DATA",
        numRows: null, lastAnalyzed: null,
        blocks: null, indexes: [] },
    ];
    const stale = detectStaleStats(stats, NOW);
    expect(stale).toHaveLength(1);
    expect(stale[0].lastAnalyzed).toBeNull();
    expect(stale[0].ageDays).toBeNull();
  });

  it("does NOT flag fresh stats (<30 days)", () => {
    const stats: TableStats[] = [
      { owner: "HR", name: "EMPLOYEES",
        numRows: 1000, lastAnalyzed: "2026-04-20T00:00:00Z",
        blocks: 10, indexes: [] },
    ];
    expect(detectStaleStats(stats, NOW)).toHaveLength(0);
  });

  it("returns empty for empty stats array", () => {
    expect(detectStaleStats([], NOW)).toEqual([]);
  });
});
```

(also add `import type { TableStats } from "./perf-rules";` if not already there — actually the `it()` blocks reference TableStats; either add the import or use `as TableStats`.)

- [ ] **Step 7: Run, confirm fail**

```bash
bun run test src/lib/perf/perf-rules.test.ts
```

Expected: FAIL — `detectStaleStats is not a function`.

- [ ] **Step 8: Implement `detectStaleStats`**

Append to `src/lib/perf/perf-rules.ts`:

```ts
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function detectStaleStats(stats: TableStats[], now: Date = new Date()): StaleStat[] {
  const out: StaleStat[] = [];
  for (const s of stats) {
    const fqn = `${s.owner}.${s.name}`;
    if (s.lastAnalyzed === null) {
      out.push({ table: fqn, lastAnalyzed: null, ageDays: null });
      continue;
    }
    const last = new Date(s.lastAnalyzed);
    if (Number.isNaN(last.getTime())) continue;
    const ageDays = Math.floor((now.getTime() - last.getTime()) / MS_PER_DAY);
    if (ageDays > STALE_STATS_DAYS) {
      out.push({ table: fqn, lastAnalyzed: s.lastAnalyzed, ageDays });
    }
  }
  return out;
}
```

- [ ] **Step 9: Run, confirm green**

```bash
bun run test src/lib/perf/perf-rules.test.ts
```

Expected: PASS — 8 tests.

- [ ] **Step 10: Write failing tests for `detectRedFlags` (Tier 1: R001-R005)**

Append to `src/lib/perf/perf-rules.test.ts`:

```ts
import { detectRedFlags } from "./perf-rules";
import type { ExplainNode } from "$lib/workspace";

describe("detectRedFlags Tier 1", () => {
  const NOW = new Date("2026-04-26T00:00:00Z");

  function plan(...nodes: Partial<ExplainNode>[]): ExplainNode[] {
    return nodes.map((n, i) => ({
      id: i, parentId: i === 0 ? null : 0,
      operation: "SELECT STATEMENT", options: null,
      objectName: null, objectOwner: null,
      cost: 100, cardinality: 100, bytes: null,
      accessPredicates: null, filterPredicates: null,
      ...n,
    } as ExplainNode));
  }

  function statsFor(name: string, numRows: number | null, lastAnalyzed: string | null = "2026-04-20T00:00:00Z"): TableStats {
    return { owner: "HR", name, numRows, lastAnalyzed, blocks: 100, indexes: [] };
  }

  it("R001 flags FULL TABLE SCAN on big table", () => {
    const flags = detectRedFlags(
      plan({ id: 0 }, { id: 1, parentId: 0, operation: "TABLE ACCESS", options: "FULL", objectName: "EMPLOYEES" }),
      [statsFor("EMPLOYEES", 1_200_000)],
      "SELECT * FROM EMPLOYEES",
      NOW,
    );
    const r001 = flags.find((f) => f.id === "R001");
    expect(r001).toBeDefined();
    expect(r001?.severity).toBe("critical");
    expect(r001?.context.table).toBe("EMPLOYEES");
  });

  it("R001 does NOT flag FULL TABLE SCAN on small table (<100k)", () => {
    const flags = detectRedFlags(
      plan({}, { id: 1, parentId: 0, operation: "TABLE ACCESS", options: "FULL", objectName: "DEPARTMENTS" }),
      [statsFor("DEPARTMENTS", 27)],
      "SELECT * FROM DEPARTMENTS",
      NOW,
    );
    expect(flags.find((f) => f.id === "R001")).toBeUndefined();
  });

  it("R001 flags conservatively when stats missing (no numRows)", () => {
    // When stats are unavailable we fall back to flagging without size qualifier.
    const flags = detectRedFlags(
      plan({}, { id: 1, parentId: 0, operation: "TABLE ACCESS", options: "FULL", objectName: "UNKNOWN" }),
      [],
      "SELECT * FROM UNKNOWN",
      NOW,
    );
    const r001 = flags.find((f) => f.id === "R001");
    expect(r001).toBeDefined();
    expect(r001?.message).toMatch(/UNKNOWN/);
  });

  it("R002 flags MERGE JOIN CARTESIAN", () => {
    const flags = detectRedFlags(
      plan({}, { id: 1, parentId: 0, operation: "MERGE JOIN", options: "CARTESIAN" }),
      [],
      "SELECT * FROM emp, dept",
      NOW,
    );
    const r002 = flags.find((f) => f.id === "R002");
    expect(r002).toBeDefined();
    expect(r002?.severity).toBe("critical");
  });

  it("R002 flags NESTED LOOPS with no predicates", () => {
    const flags = detectRedFlags(
      plan({},
        { id: 1, parentId: 0, operation: "NESTED LOOPS", options: null,
          accessPredicates: null, filterPredicates: null }),
      [],
      "SELECT * FROM a, b",
      NOW,
    );
    expect(flags.find((f) => f.id === "R002")).toBeDefined();
  });

  it("R002 does NOT flag NESTED LOOPS with access predicate", () => {
    const flags = detectRedFlags(
      plan({},
        { id: 1, parentId: 0, operation: "NESTED LOOPS",
          accessPredicates: "A.ID = B.A_ID" }),
      [],
      "SELECT * FROM a JOIN b ON a.id = b.a_id",
      NOW,
    );
    expect(flags.find((f) => f.id === "R002")).toBeUndefined();
  });

  it("R003 flags high overall cost (>= 100k)", () => {
    const flags = detectRedFlags(
      plan({ id: 0, cost: 250_000 }),
      [],
      "SELECT 1 FROM dual",
      NOW,
    );
    const r003 = flags.find((f) => f.id === "R003");
    expect(r003).toBeDefined();
    expect(r003?.severity).toBe("warn");
    expect(r003?.message).toContain("250");
  });

  it("R003 does NOT flag low cost", () => {
    const flags = detectRedFlags(
      plan({ id: 0, cost: 500 }),
      [],
      "SELECT 1 FROM dual",
      NOW,
    );
    expect(flags.find((f) => f.id === "R003")).toBeUndefined();
  });

  it("R004 flags stale stats (>30d)", () => {
    const flags = detectRedFlags(
      plan({}, { id: 1, parentId: 0, operation: "TABLE ACCESS", options: "FULL", objectName: "ORDERS" }),
      [statsFor("ORDERS", 50_000, "2026-01-01T00:00:00Z")],
      "SELECT * FROM ORDERS",
      NOW,
    );
    expect(flags.find((f) => f.id === "R004")).toBeDefined();
  });

  it("R005 flags missing stats (NULL last_analyzed)", () => {
    const flags = detectRedFlags(
      plan({}, { id: 1, parentId: 0, operation: "TABLE ACCESS", options: "FULL", objectName: "STG" }),
      [statsFor("STG", null, null)],
      "SELECT * FROM STG",
      NOW,
    );
    const r005 = flags.find((f) => f.id === "R005");
    expect(r005).toBeDefined();
    expect(r005?.message).toMatch(/STG/);
  });
});
```

- [ ] **Step 11: Run, confirm fail**

```bash
bun run test src/lib/perf/perf-rules.test.ts
```

Expected: FAIL — `detectRedFlags is not a function`.

- [ ] **Step 12: Implement `detectRedFlags` for Tier 1**

Append to `src/lib/perf/perf-rules.ts`:

```ts
export function detectRedFlags(
  plan: ExplainNode[],
  stats: TableStats[],
  _sql: string,
  now: Date = new Date(),
): RedFlag[] {
  const flags: RedFlag[] = [];
  if (plan.length === 0) return flags;

  const statsByName = new Map(stats.map((s) => [s.name.toUpperCase(), s] as const));

  // R003 — High overall cost (root node cost)
  const rootCost = plan[0].cost;
  if (rootCost !== null && rootCost >= HIGH_COST_THRESHOLD) {
    flags.push({
      id: "R003", severity: "warn",
      message: `Estimated cost: ${rootCost.toLocaleString("en-US")}`,
      suggestion: "Heavy analysis — confirm before running in prod",
      context: { cost: rootCost },
    });
  }

  for (const node of plan) {
    // R001 — FULL TABLE SCAN on big table (or unknown size)
    if (node.operation === "TABLE ACCESS" && node.options === "FULL" && node.objectName) {
      const tableName = node.objectName.toUpperCase();
      const tableStats = statsByName.get(tableName);
      const numRows = tableStats?.numRows ?? null;
      const isBig = numRows === null || numRows > BIG_TABLE_THRESHOLD;
      if (isBig) {
        const sizeNote = numRows !== null
          ? ` (${numRows.toLocaleString("en-US")} rows)`
          : " (size unknown)";
        flags.push({
          id: "R001", severity: "critical",
          message: `FULL TABLE SCAN on \`${tableName}\`${sizeNote}`,
          suggestion: "Consider an index on the WHERE/JOIN columns",
          context: { table: tableName, operation: "TABLE ACCESS FULL" },
        });
      }
    }

    // R002 — Cartesian product
    const isCartesianMerge = node.operation === "MERGE JOIN" && node.options === "CARTESIAN";
    const isCartesianNL =
      node.operation === "NESTED LOOPS" &&
      !node.accessPredicates &&
      !node.filterPredicates;
    if (isCartesianMerge || isCartesianNL) {
      flags.push({
        id: "R002", severity: "critical",
        message: "CARTESIAN PRODUCT detected",
        suggestion: "Add the missing JOIN condition between tables",
        context: { operation: node.operation },
      });
    }
  }

  // R004 / R005 — stats freshness on tables referenced by FULL SCAN nodes
  // (only flag stats issues for tables we actually access — avoid noise)
  const accessedTables = new Set(
    plan
      .filter((n) => n.operation === "TABLE ACCESS" && n.objectName)
      .map((n) => n.objectName!.toUpperCase()),
  );
  for (const tableName of accessedTables) {
    const s = statsByName.get(tableName);
    if (!s) continue;
    if (s.lastAnalyzed === null) {
      flags.push({
        id: "R005", severity: "warn",
        message: `No stats on \`${tableName}\` — optimizer is guessing`,
        suggestion: `DBMS_STATS.GATHER_TABLE_STATS('${s.owner}', '${tableName}')`,
        context: { table: tableName },
      });
    } else {
      const last = new Date(s.lastAnalyzed);
      if (!Number.isNaN(last.getTime())) {
        const ageDays = Math.floor((now.getTime() - last.getTime()) / MS_PER_DAY);
        if (ageDays > STALE_STATS_DAYS) {
          flags.push({
            id: "R004", severity: "warn",
            message: `Stats stale on \`${tableName}\` (${ageDays} days old)`,
            suggestion: `DBMS_STATS.GATHER_TABLE_STATS('${s.owner}', '${tableName}')`,
            context: { table: tableName },
          });
        }
      }
    }
  }

  return flags;
}
```

- [ ] **Step 13: Run, confirm green**

```bash
bun run test src/lib/perf/perf-rules.test.ts
```

Expected: PASS — 18 tests total (4 classifyCost + 4 staleStats + 10 Tier-1 redFlags).

- [ ] **Step 14: Run full frontend test suite to ensure no regressions**

```bash
bun run test
```

Expected: PASS — 184 + 18 = 202 tests, 1 skipped.

- [ ] **Step 15: Commit**

```bash
git add src/lib/perf/perf-rules.ts src/lib/perf/perf-rules.test.ts
git commit -m "feat(perf): pure rule functions — Tier 1 red flags + cost classifier

Adds classifyCost (green/yellow/red/unknown by thresholds 1k/100k),
detectStaleStats (>30d or NULL flagged), and detectRedFlags with rules
R001-R005 (FULL TABLE SCAN big table, CARTESIAN PRODUCT, high cost,
stats stale, stats missing).

All functions are pure — no IO, deterministic with injectable 'now'
for time-dependent rules. Covered by 18 vitest cases."
```

---

## Task 3: Pure rule functions — Tier 2 (R010-R013)

**Files:**
- Modify: `src/lib/perf/perf-rules.ts`
- Modify: `src/lib/perf/perf-rules.test.ts`

- [ ] **Step 1: Write failing test for R010 (NL big outer)**

Append to `src/lib/perf/perf-rules.test.ts`:

```ts
describe("detectRedFlags Tier 2", () => {
  const NOW = new Date("2026-04-26T00:00:00Z");

  function nlPlan(outerCardinality: number): ExplainNode[] {
    return [
      { id: 0, parentId: null, operation: "SELECT STATEMENT", options: null,
        objectName: null, objectOwner: null, cost: 100,
        cardinality: 100, bytes: null,
        accessPredicates: null, filterPredicates: null },
      { id: 1, parentId: 0, operation: "NESTED LOOPS", options: null,
        objectName: null, objectOwner: null, cost: 50,
        cardinality: 100, bytes: null,
        accessPredicates: "A.ID = B.A_ID", filterPredicates: null },
      { id: 2, parentId: 1, operation: "TABLE ACCESS", options: "FULL",
        objectName: "BIG", objectOwner: "HR", cost: 30,
        cardinality: outerCardinality, bytes: null,
        accessPredicates: null, filterPredicates: null },
      { id: 3, parentId: 1, operation: "INDEX", options: "RANGE SCAN",
        objectName: "IDX_B_A", objectOwner: "HR", cost: 1,
        cardinality: 1, bytes: null,
        accessPredicates: "B.A_ID = :A_ID", filterPredicates: null },
    ] as ExplainNode[];
  }

  it("R010 flags NESTED LOOPS with outer cardinality > 10k", () => {
    const flags = detectRedFlags(nlPlan(50_000), [], "...", NOW);
    expect(flags.find((f) => f.id === "R010")).toBeDefined();
  });

  it("R010 does NOT flag NESTED LOOPS with small outer", () => {
    const flags = detectRedFlags(nlPlan(100), [], "...", NOW);
    expect(flags.find((f) => f.id === "R010")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
bun run test src/lib/perf/perf-rules.test.ts
```

Expected: FAIL — R010 not flagged.

- [ ] **Step 3: Implement R010**

In `src/lib/perf/perf-rules.ts`, inside `detectRedFlags`'s `for (const node of plan)` loop, AFTER the R002 block, add:

```ts
    // R010 — NESTED LOOPS with high outer cardinality
    if (node.operation === "NESTED LOOPS") {
      // Find the left (first) child of this NL — that's the outer set
      const leftChild = plan.find((n) => n.parentId === node.id);
      if (leftChild && leftChild.cardinality !== null && leftChild.cardinality > 10_000) {
        flags.push({
          id: "R010", severity: "warn",
          message: `NESTED LOOPS with ${leftChild.cardinality.toLocaleString("en-US")} rows on outer side — consider HASH JOIN`,
          context: { operation: "NESTED LOOPS", cost: node.cost ?? undefined },
        });
      }
    }
```

- [ ] **Step 4: Run, confirm green**

```bash
bun run test src/lib/perf/perf-rules.test.ts
```

Expected: 20 tests pass.

- [ ] **Step 5: Write failing tests for R011 (function on indexed col)**

Append to `src/lib/perf/perf-rules.test.ts`:

```ts
  it("R011 flags TRUNC() on an indexed column", () => {
    const stats: TableStats[] = [{
      owner: "HR", name: "EMPLOYEES",
      numRows: 1000, lastAnalyzed: "2026-04-20T00:00:00Z", blocks: 10,
      indexes: [{
        name: "IDX_EMP_HIRE_DATE", columns: ["HIRE_DATE"],
        unique: false, status: "VALID",
      }],
    }];
    const flags = detectRedFlags(
      [{ id: 0, parentId: null, operation: "SELECT STATEMENT", options: null,
         objectName: null, objectOwner: null, cost: 50, cardinality: 1,
         bytes: null, accessPredicates: null, filterPredicates: null }] as ExplainNode[],
      stats,
      "SELECT * FROM EMPLOYEES WHERE TRUNC(hire_date) = TO_DATE('2024-01-01', 'YYYY-MM-DD')",
      NOW,
    );
    const r011 = flags.find((f) => f.id === "R011");
    expect(r011).toBeDefined();
    expect(r011?.context.column).toBe("HIRE_DATE");
  });

  it("R011 does NOT flag TRUNC() on non-indexed column", () => {
    const stats: TableStats[] = [{
      owner: "HR", name: "EMPLOYEES",
      numRows: 1000, lastAnalyzed: "2026-04-20T00:00:00Z", blocks: 10,
      indexes: [],
    }];
    const flags = detectRedFlags(
      [{ id: 0, parentId: null, operation: "SELECT STATEMENT", options: null,
         objectName: null, objectOwner: null, cost: 50, cardinality: 1,
         bytes: null, accessPredicates: null, filterPredicates: null }] as ExplainNode[],
      stats,
      "SELECT * FROM EMPLOYEES WHERE TRUNC(hire_date) = SYSDATE",
      NOW,
    );
    expect(flags.find((f) => f.id === "R011")).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run, confirm fail**

```bash
bun run test src/lib/perf/perf-rules.test.ts
```

Expected: FAIL.

- [ ] **Step 7: Implement R011**

In `src/lib/perf/perf-rules.ts`, AFTER the existing for-loop and BEFORE the stats-freshness block, add:

```ts
  // R011 — Function on indexed column
  // Build set of indexed columns across all tables in stats
  const indexedCols = new Set<string>();
  for (const s of stats) {
    for (const idx of s.indexes) {
      for (const col of idx.columns) {
        indexedCols.add(col.toUpperCase());
      }
    }
  }
  // Lazy regex: WHERE … TRUNC|UPPER|LOWER|TO_CHAR ( <col>
  const fnPattern = /(?:WHERE|AND|OR)\s+(TRUNC|UPPER|LOWER|TO_CHAR|SUBSTR|NVL)\s*\(\s*(?:[a-zA-Z_]\w*\.)?([a-zA-Z_]\w*)/gi;
  let m: RegExpExecArray | null;
  const sqlUpper = _sql.toUpperCase();
  // eslint-disable-next-line no-cond-assign
  while ((m = fnPattern.exec(sqlUpper)) !== null) {
    const fn = m[1];
    const col = m[2];
    if (indexedCols.has(col)) {
      // Find which index has this column for the suggestion
      const idxName = stats
        .flatMap((s) => s.indexes)
        .find((i) => i.columns.map((c) => c.toUpperCase()).includes(col))?.name;
      flags.push({
        id: "R011", severity: "warn",
        message: `${fn}(${col.toLowerCase()}) prevents use of index${idxName ? ` ${idxName}` : ""}`,
        suggestion: `Rewrite predicate to expose the column directly (e.g. WHERE ${col.toLowerCase()} BETWEEN ... AND ...)`,
        context: { column: col },
      });
      break; // one R011 per query is enough; don't repeat for OR chains
    }
  }
```

- [ ] **Step 8: Run, confirm green**

```bash
bun run test src/lib/perf/perf-rules.test.ts
```

Expected: 22 tests pass.

- [ ] **Step 9: Write failing tests for R012 (db-link)**

Append to `src/lib/perf/perf-rules.test.ts`:

```ts
  it("R012 flags REMOTE operation", () => {
    const flags = detectRedFlags(
      [{ id: 0, parentId: null, operation: "SELECT STATEMENT", options: null,
         objectName: null, objectOwner: null, cost: 100, cardinality: 1,
         bytes: null, accessPredicates: null, filterPredicates: null },
       { id: 1, parentId: 0, operation: "REMOTE", options: null,
         objectName: "EMPLOYEES", objectOwner: "HR", cost: 50, cardinality: 100,
         bytes: null, accessPredicates: null, filterPredicates: null }] as ExplainNode[],
      [],
      "SELECT * FROM emp@remote",
      NOW,
    );
    expect(flags.find((f) => f.id === "R012")).toBeDefined();
  });

  it("R012 flags object_name with @ (db link)", () => {
    const flags = detectRedFlags(
      [{ id: 0, parentId: null, operation: "TABLE ACCESS", options: "FULL",
         objectName: "EMP@PROD_LINK", objectOwner: null, cost: 50,
         cardinality: 100, bytes: null,
         accessPredicates: null, filterPredicates: null }] as ExplainNode[],
      [],
      "SELECT * FROM emp@prod_link",
      NOW,
    );
    expect(flags.find((f) => f.id === "R012")).toBeDefined();
  });
```

- [ ] **Step 10: Run, confirm fail**

```bash
bun run test src/lib/perf/perf-rules.test.ts
```

Expected: FAIL.

- [ ] **Step 11: Implement R012**

In `src/lib/perf/perf-rules.ts`, inside the `for (const node of plan)` loop, AFTER R010, add:

```ts
    // R012 — Remote access via DB link
    if (node.operation.includes("REMOTE") || (node.objectName?.includes("@") ?? false)) {
      const linkName = node.objectName?.split("@")[1];
      flags.push({
        id: "R012", severity: "warn",
        message: `Remote access via DB link${linkName ? ` (${linkName})` : ""}`,
        suggestion: "Confirm network latency and remote PLAN_TABLE",
        context: { table: node.objectName ?? undefined, operation: node.operation },
      });
    }
```

Also add a `seenR012` flag so we only emit once per plan (a chain of REMOTE nodes shouldn't all flag). At the top of `detectRedFlags`:

```ts
  const seenIds = new Set<string>();
```

And modify the R012 block to:

```ts
    if ((node.operation.includes("REMOTE") || (node.objectName?.includes("@") ?? false)) && !seenIds.has("R012")) {
      // ... push flag ...
      seenIds.add("R012");
    }
```

Apply the same pattern to R002 (and any other rule we want to deduplicate). For R002:

```ts
    if ((isCartesianMerge || isCartesianNL) && !seenIds.has("R002")) {
      // ... push flag ...
      seenIds.add("R002");
    }
```

- [ ] **Step 12: Run, confirm green**

```bash
bun run test src/lib/perf/perf-rules.test.ts
```

Expected: 24 tests pass.

- [ ] **Step 13: Write failing tests for R013 (index full scan no pred)**

Append to `src/lib/perf/perf-rules.test.ts`:

```ts
  it("R013 flags INDEX FULL SCAN with no predicate", () => {
    const flags = detectRedFlags(
      [{ id: 0, parentId: null, operation: "SELECT STATEMENT", options: null,
         objectName: null, objectOwner: null, cost: 100, cardinality: 1,
         bytes: null, accessPredicates: null, filterPredicates: null },
       { id: 1, parentId: 0, operation: "INDEX", options: "FULL SCAN",
         objectName: "IDX_FOO", objectOwner: "HR", cost: 50, cardinality: 1000,
         bytes: null, accessPredicates: null, filterPredicates: null }] as ExplainNode[],
      [],
      "SELECT MIN(id) FROM employees",
      NOW,
    );
    expect(flags.find((f) => f.id === "R013")).toBeDefined();
  });

  it("R013 does NOT flag INDEX FULL SCAN with a predicate", () => {
    const flags = detectRedFlags(
      [{ id: 0, parentId: null, operation: "SELECT STATEMENT", options: null,
         objectName: null, objectOwner: null, cost: 100, cardinality: 1,
         bytes: null, accessPredicates: null, filterPredicates: null },
       { id: 1, parentId: 0, operation: "INDEX", options: "FULL SCAN",
         objectName: "IDX_FOO", objectOwner: "HR", cost: 50, cardinality: 1,
         bytes: null, accessPredicates: "A = :A", filterPredicates: null }] as ExplainNode[],
      [],
      "...",
      NOW,
    );
    expect(flags.find((f) => f.id === "R013")).toBeUndefined();
  });
```

- [ ] **Step 14: Run, confirm fail**

```bash
bun run test src/lib/perf/perf-rules.test.ts
```

Expected: FAIL.

- [ ] **Step 15: Implement R013**

Inside the for-loop, AFTER R012, add:

```ts
    // R013 — INDEX FULL SCAN without a predicate
    if (
      node.operation === "INDEX" && node.options === "FULL SCAN" &&
      !node.accessPredicates && !node.filterPredicates
    ) {
      flags.push({
        id: "R013", severity: "info",
        message: `INDEX FULL SCAN on ${node.objectName ?? "(unknown)"} — scans entire index`,
        context: { table: node.objectName ?? undefined, operation: "INDEX FULL SCAN" },
      });
    }
```

- [ ] **Step 16: Run all tests, confirm green**

```bash
bun run test
```

Expected: PASS — frontend total now 204 (184 + 20 perf rule cases).

- [ ] **Step 17: Commit**

```bash
git add src/lib/perf/perf-rules.ts src/lib/perf/perf-rules.test.ts
git commit -m "feat(perf): Tier-2 red flags — R010-R013

Adds rules:
- R010 NESTED LOOPS with outer cardinality > 10k → warn
- R011 function on indexed column (TRUNC/UPPER/LOWER/TO_CHAR) → warn
- R012 remote access via DB link → warn
- R013 INDEX FULL SCAN without predicate → info

Adds dedup: each rule fires at most once per analysis to avoid spam
on chained operations."
```

---

## Task 4: Sidecar `perf-stats.ts` — table dictionary lookup

**Files:**
- Create: `sidecar/src/perf-stats.ts`
- Create: `sidecar/tests/perf-stats.test.ts`
- Modify: `sidecar/src/index.ts`

- [ ] **Step 1: Write failing unit test**

Create `sidecar/tests/perf-stats.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { extractTableNames } from "../src/perf-stats";

describe("extractTableNames", () => {
  test("simple SELECT FROM", () => {
    expect(extractTableNames("SELECT * FROM employees"))
      .toEqual(["EMPLOYEES"]);
  });
  test("schema-qualified", () => {
    expect(extractTableNames("SELECT * FROM hr.employees"))
      .toEqual(["EMPLOYEES"]);
  });
  test("JOIN expands set", () => {
    const names = extractTableNames(
      "SELECT * FROM employees e JOIN departments d ON e.dept_id = d.id"
    );
    expect(names).toContain("EMPLOYEES");
    expect(names).toContain("DEPARTMENTS");
  });
  test("comma-join expands set", () => {
    const names = extractTableNames("SELECT * FROM emp, dept");
    expect(names).toContain("EMP");
    expect(names).toContain("DEPT");
  });
  test("CTE not flagged as table (skip WITH name)", () => {
    const names = extractTableNames(
      "WITH x AS (SELECT 1 FROM dual) SELECT * FROM x"
    );
    // x is the CTE alias — not a real table; we accept it since we have no
    // way to distinguish at parse-time. The dictionary lookup will return
    // empty stats for it, which is fine.
    expect(names).toContain("X");
  });
  test("strips line comments", () => {
    expect(extractTableNames("-- foo\nSELECT * FROM emp"))
      .toEqual(["EMP"]);
  });
  test("returns empty for non-SELECT", () => {
    expect(extractTableNames("BEGIN NULL; END;")).toEqual([]);
  });
  test("dedups duplicates", () => {
    const names = extractTableNames("SELECT * FROM emp, emp e2");
    expect(names.filter((n) => n === "EMP")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd sidecar && bun test tests/perf-stats.test.ts
```

Expected: FAIL — "Cannot find module '../src/perf-stats'".

- [ ] **Step 3: Implement `extractTableNames`**

Create `sidecar/src/perf-stats.ts`:

```ts
import type oracledb from "oracledb";
import { withActiveSession } from "./oracle";

export type PerfTableIndex = {
  name: string;
  columns: string[];
  unique: boolean;
  status: string;
};

export type PerfTableStats = {
  owner: string;
  name: string;
  numRows: number | null;
  lastAnalyzed: string | null;
  blocks: number | null;
  indexes: PerfTableIndex[];
};

export type PerfStatsResult = {
  tables: PerfTableStats[];
};

const FROM_PATTERN =
  /\b(?:FROM|JOIN)\s+(?:[a-zA-Z_]\w*\s*\.\s*)?([a-zA-Z_]\w*)/gi;

const COMMA_FROM_PATTERN =
  /,\s*(?:[a-zA-Z_]\w*\s*\.\s*)?([a-zA-Z_]\w*)(?:\s+[a-zA-Z_]\w*)?(?=\s*[,)\sWHEREROUNINJOLEFTRIGHTFULLCROSS])/gi;

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*\n?/g, " ");
}

export function extractTableNames(sql: string): string[] {
  const cleaned = stripComments(sql).trim();
  if (!/^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE|MERGE)/i.test(cleaned)) {
    return [];
  }
  const found = new Set<string>();
  for (const re of [FROM_PATTERN, COMMA_FROM_PATTERN]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(cleaned)) !== null) {
      found.add(m[1].toUpperCase());
    }
  }
  return [...found];
}
```

- [ ] **Step 4: Run, confirm green**

```bash
cd sidecar && bun test tests/perf-stats.test.ts
```

Expected: PASS — 8 tests.

- [ ] **Step 5: Write failing test for `tablesStats` (mocked Oracle)**

Append to `sidecar/tests/perf-stats.test.ts`:

```ts
import { tablesStats, setTestSession } from "../src/perf-stats";
import type oracledb from "oracledb";

describe("tablesStats with mocked oracle", () => {
  test("returns empty when no tables in SQL", async () => {
    const fakeConn = {
      execute: async () => ({ rows: [] }),
    } as unknown as oracledb.Connection;
    setTestSession(fakeConn);
    const result = await tablesStats({ sql: "BEGIN NULL; END;" });
    expect(result.tables).toEqual([]);
  });

  test("returns tables with stats and indexes", async () => {
    const fakeConn = {
      execute: async (sql: string) => {
        if (sql.includes("ALL_TABLES")) {
          return {
            rows: [
              { OWNER: "HR", TABLE_NAME: "EMPLOYEES",
                NUM_ROWS: 1200000, LAST_ANALYZED: new Date("2026-04-20T00:00:00Z"),
                BLOCKS: 8000 },
            ],
          };
        }
        if (sql.includes("ALL_IND_COLUMNS")) {
          return {
            rows: [
              { TABLE_OWNER: "HR", TABLE_NAME: "EMPLOYEES",
                INDEX_NAME: "IDX_EMP_DEPT", COLUMN_NAME: "DEPARTMENT_ID",
                COLUMN_POSITION: 1, UNIQUENESS: "NONUNIQUE", STATUS: "VALID" },
              { TABLE_OWNER: "HR", TABLE_NAME: "EMPLOYEES",
                INDEX_NAME: "PK_EMPLOYEES", COLUMN_NAME: "EMPLOYEE_ID",
                COLUMN_POSITION: 1, UNIQUENESS: "UNIQUE", STATUS: "VALID" },
            ],
          };
        }
        return { rows: [] };
      },
    } as unknown as oracledb.Connection;
    setTestSession(fakeConn);
    const result = await tablesStats({ sql: "SELECT * FROM hr.employees" });
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].name).toBe("EMPLOYEES");
    expect(result.tables[0].numRows).toBe(1_200_000);
    expect(result.tables[0].indexes).toHaveLength(2);
    const dept = result.tables[0].indexes.find((i) => i.name === "IDX_EMP_DEPT");
    expect(dept?.columns).toEqual(["DEPARTMENT_ID"]);
    expect(dept?.unique).toBe(false);
  });
});
```

- [ ] **Step 6: Run, confirm fail**

```bash
cd sidecar && bun test tests/perf-stats.test.ts
```

Expected: FAIL — `tablesStats is not a function`, `setTestSession is not a function`.

- [ ] **Step 7: Implement `tablesStats` with test seam**

Append to `sidecar/src/perf-stats.ts`:

```ts
import oracledb from "oracledb";

let _testSession: oracledb.Connection | null = null;

/** Test seam — overrides the active session lookup with a stub connection. */
export function setTestSession(conn: oracledb.Connection | null): void {
  _testSession = conn;
}

async function withConn<T>(fn: (c: oracledb.Connection) => Promise<T>): Promise<T> {
  if (_testSession !== null) return fn(_testSession);
  return withActiveSession(fn);
}

export async function tablesStats(p: { sql: string }): Promise<PerfStatsResult> {
  const names = extractTableNames(p.sql);
  if (names.length === 0) return { tables: [] };

  return withConn(async (conn) => {
    // Bind names dynamically — Oracle limits IN clause to ~1000 items, but
    // typical query has <10 tables. We build a placeholder list.
    const binds: Record<string, string> = {};
    const placeholders: string[] = [];
    names.forEach((n, i) => {
      const k = `n${i}`;
      binds[k] = n;
      placeholders.push(`:${k}`);
    });

    const tablesRes = await conn.execute<{
      OWNER: string;
      TABLE_NAME: string;
      NUM_ROWS: number | null;
      LAST_ANALYZED: Date | null;
      BLOCKS: number | null;
    }>(
      `SELECT owner AS "OWNER",
              table_name AS "TABLE_NAME",
              num_rows AS "NUM_ROWS",
              last_analyzed AS "LAST_ANALYZED",
              blocks AS "BLOCKS"
         FROM all_tables
        WHERE table_name IN (${placeholders.join(",")})`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const tableRows = tablesRes.rows ?? [];
    if (tableRows.length === 0) return { tables: [] };

    const indexRes = await conn.execute<{
      TABLE_OWNER: string;
      TABLE_NAME: string;
      INDEX_NAME: string;
      COLUMN_NAME: string;
      COLUMN_POSITION: number;
      UNIQUENESS: string;
      STATUS: string;
    }>(
      `SELECT ic.table_owner AS "TABLE_OWNER",
              ic.table_name  AS "TABLE_NAME",
              ic.index_name  AS "INDEX_NAME",
              ic.column_name AS "COLUMN_NAME",
              ic.column_position AS "COLUMN_POSITION",
              i.uniqueness   AS "UNIQUENESS",
              i.status       AS "STATUS"
         FROM all_ind_columns ic
         JOIN all_indexes i
           ON i.owner = ic.index_owner
          AND i.index_name = ic.index_name
        WHERE ic.table_name IN (${placeholders.join(",")})
        ORDER BY ic.table_owner, ic.table_name, ic.index_name, ic.column_position`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const indexRows = indexRes.rows ?? [];

    // Group indexes by table+index_name to collect their column lists in order.
    type IdxKey = string;
    const indexMap = new Map<IdxKey, { table: string; owner: string; index: PerfTableIndex }>();
    for (const r of indexRows) {
      const key = `${r.TABLE_OWNER}.${r.TABLE_NAME}.${r.INDEX_NAME}`;
      let entry = indexMap.get(key);
      if (!entry) {
        entry = {
          table: r.TABLE_NAME,
          owner: r.TABLE_OWNER,
          index: {
            name: r.INDEX_NAME,
            columns: [],
            unique: r.UNIQUENESS === "UNIQUE",
            status: r.STATUS,
          },
        };
        indexMap.set(key, entry);
      }
      entry.index.columns.push(r.COLUMN_NAME);
    }

    const tables: PerfTableStats[] = tableRows.map((t) => {
      const indexes: PerfTableIndex[] = [];
      for (const v of indexMap.values()) {
        if (v.owner === t.OWNER && v.table === t.TABLE_NAME) {
          indexes.push(v.index);
        }
      }
      return {
        owner: t.OWNER,
        name: t.TABLE_NAME,
        numRows: t.NUM_ROWS,
        lastAnalyzed: t.LAST_ANALYZED ? t.LAST_ANALYZED.toISOString() : null,
        blocks: t.BLOCKS,
        indexes,
      };
    });

    return { tables };
  });
}
```

- [ ] **Step 8: Run, confirm green**

```bash
cd sidecar && bun test tests/perf-stats.test.ts
```

Expected: PASS — 10 tests.

- [ ] **Step 9: Register the RPC handler**

In `sidecar/src/index.ts`, find the imports block and add:

```ts
import { tablesStats } from "./perf-stats";
```

Find the dispatch table and add:

```ts
  "perf.stats": (params) => tablesStats(params as any),
```

- [ ] **Step 10: Run all sidecar tests**

```bash
cd sidecar && bun test
```

Expected: PASS — 161 total (existing 151 + 10 perf-stats).

- [ ] **Step 11: Commit**

```bash
git add sidecar/src/perf-stats.ts sidecar/tests/perf-stats.test.ts sidecar/src/index.ts
git commit -m "feat(sidecar): perf.stats RPC — table dictionary lookup

extractTableNames pulls table names from SQL via FROM/JOIN/comma-join regex.
tablesStats issues two consolidated queries against ALL_TABLES (num_rows,
last_analyzed, blocks) and ALL_IND_COLUMNS+ALL_INDEXES (per-table indexes
with their column order), groups them, and returns a flat shape
(PerfTableStats[]) per table.

Test seam (setTestSession) lets unit tests inject a stub Connection
without an actual Oracle session."
```

---

## Task 5: Tauri command + frontend wrapper

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/workspace.ts`

- [ ] **Step 1: Add Tauri command**

In `src-tauri/src/commands.rs`, add this block at the end (after the existing `chart_*` commands):

```rust
#[tauri::command]
pub async fn perf_stats(app: AppHandle, sql: String) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "perf.stats", json!({ "sql": sql })).await?;
    Ok(res)
}
```

- [ ] **Step 2: Register the command**

In `src-tauri/src/lib.rs`, find the `.invoke_handler(tauri::generate_handler![...])` list and add `commands::perf_stats,` next to the other commands.

- [ ] **Step 3: Build to confirm**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: clean build.

- [ ] **Step 4: Add frontend wrapper + types**

In `src/lib/workspace.ts`, add the wrapper near `explainPlanGet`. To avoid type
duplication with `src/lib/perf/perf-rules.ts` (which already defines `TableStats`
and `TableIndex`), re-export those names with the `Perf*` prefix used by callers
that don't import the rules module directly:

```ts
import type { TableStats, TableIndex } from "$lib/perf/perf-rules";

// Re-export under the `Perf*` names so existing imports of `PerfTableStats`
// from `$lib/workspace` keep working — they resolve to the same shape.
export type PerfTableIndex = TableIndex;
export type PerfTableStats = TableStats;

export type PerfStatsResult = {
  tables: PerfTableStats[];
};

export const perfStats = (sql: string) =>
  call<PerfStatsResult>("perf_stats", { sql });
```

- [ ] **Step 5: Verify type check**

```bash
bun run check
```

Expected: 0 new errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/workspace.ts
git commit -m "feat(rpc): perf_stats Tauri command + frontend wrapper

Wires sidecar perf.stats into the host. Frontend gets perfStats(sql) →
Result<PerfStatsResult>."
```

---

## Task 6: Analyzer store

**Files:**
- Create: `src/lib/stores/perf-analyzer.svelte.ts`
- Create: `src/lib/stores/perf-analyzer.test.ts`

- [ ] **Step 1: Write failing tests for store core (debounce + state)**

Create `src/lib/stores/perf-analyzer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("$lib/workspace", () => ({
  explainPlanGet: vi.fn(),
  perfStats: vi.fn(),
}));

import { explainPlanGet, perfStats } from "$lib/workspace";
import { createPerfAnalyzer } from "./perf-analyzer.svelte";

const mockedExplain = vi.mocked(explainPlanGet);
const mockedStats = vi.mocked(perfStats);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockedExplain.mockResolvedValue({
    ok: true,
    data: { nodes: [{ id: 0, parentId: null, operation: "SELECT STATEMENT", options: null,
                      objectName: null, objectOwner: null, cost: 100, cardinality: 1,
                      bytes: null, accessPredicates: null, filterPredicates: null }] },
  });
  mockedStats.mockResolvedValue({ ok: true, data: { tables: [] } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("perf-analyzer store", () => {
  it("starts in idle state", () => {
    const a = createPerfAnalyzer();
    expect(a.state.kind).toBe("idle");
  });

  it("debounces rapid changes into a single RPC call", async () => {
    const a = createPerfAnalyzer();
    a.scheduleAnalysis("SELECT 1 FROM dual");
    a.scheduleAnalysis("SELECT 2 FROM dual");
    a.scheduleAnalysis("SELECT 3 FROM dual");
    await vi.advanceTimersByTimeAsync(600);
    expect(mockedExplain).toHaveBeenCalledTimes(1);
    expect(mockedExplain).toHaveBeenCalledWith("SELECT 3 FROM dual");
  });

  it("transitions through analyzing → analyzed", async () => {
    const a = createPerfAnalyzer();
    a.scheduleAnalysis("SELECT * FROM dual");
    await vi.advanceTimersByTimeAsync(500);
    // Pending RPC: state should be analyzing
    expect(a.state.kind).toBe("analyzing");
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(a.state.kind).toBe("analyzed");
  });

  it("skips DDL statements (skipped state)", async () => {
    const a = createPerfAnalyzer();
    a.scheduleAnalysis("DROP TABLE employees");
    await vi.advanceTimersByTimeAsync(600);
    expect(a.state.kind).toBe("skipped");
    expect(mockedExplain).not.toHaveBeenCalled();
  });

  it("skips PL/SQL blocks", async () => {
    const a = createPerfAnalyzer();
    a.scheduleAnalysis("BEGIN NULL; END;");
    await vi.advanceTimersByTimeAsync(600);
    expect(a.state.kind).toBe("skipped");
  });

  it("returns to idle on empty SQL", async () => {
    const a = createPerfAnalyzer();
    a.scheduleAnalysis("   ");
    await vi.advanceTimersByTimeAsync(600);
    expect(a.state.kind).toBe("idle");
  });

  it("reset() clears state", () => {
    const a = createPerfAnalyzer();
    a.scheduleAnalysis("SELECT 1 FROM dual");
    a.reset();
    expect(a.state.kind).toBe("idle");
  });

  it("disabled() prevents future analyses", async () => {
    const a = createPerfAnalyzer();
    a.setEnabled(false);
    a.scheduleAnalysis("SELECT 1 FROM dual");
    await vi.advanceTimersByTimeAsync(600);
    expect(mockedExplain).not.toHaveBeenCalled();
    expect(a.state.kind).toBe("skipped");
  });

  it("error from explainPlanGet → state error", async () => {
    mockedExplain.mockResolvedValueOnce({
      ok: false,
      error: { code: -32602, message: "ORA-00942: table or view does not exist" },
    });
    const a = createPerfAnalyzer();
    a.scheduleAnalysis("SELECT * FROM nonexistent");
    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve();
    expect(a.state.kind).toBe("error");
    if (a.state.kind === "error") {
      expect(a.state.message).toContain("ORA-00942");
    }
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
bun run test src/lib/stores/perf-analyzer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/lib/stores/perf-analyzer.svelte.ts`:

```ts
import { explainPlanGet, perfStats, type ExplainNode, type PerfTableStats } from "$lib/workspace";
import {
  classifyCost,
  detectRedFlags,
  detectStaleStats,
  type RedFlag,
  type StaleStat,
  type CostClass,
} from "$lib/perf/perf-rules";

export type AnalysisState =
  | { kind: "idle" }
  | { kind: "analyzing"; reqId: string; sql: string }
  | { kind: "analyzed"; reqId: string; sql: string; plan: ExplainNode[];
      stats: PerfTableStats[]; redFlags: RedFlag[]; costClass: CostClass;
      staleStats: StaleStat[] }
  | { kind: "skipped"; reason: "ddl" | "plsql" | "empty" | "disabled" | "session-busy" }
  | { kind: "error"; message: string; oraCode?: string };

export type PerfAnalyzer = {
  readonly state: AnalysisState;
  scheduleAnalysis(sql: string): void;
  setEnabled(enabled: boolean): void;
  setSessionBusy(busy: boolean): void;
  reset(): void;
};

const DEBOUNCE_MS = 500;
const CACHE_MAX = 64;
const CACHE_TTL_MS = 5 * 60 * 1000;

function isAnalyzableSql(sql: string): { kind: "ok" } | { kind: "skip"; reason: "ddl" | "plsql" | "empty" } {
  const trimmed = sql.trim().replace(/^(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)+/g, "").trimStart();
  if (trimmed === "") return { kind: "skip", reason: "empty" };
  const head = trimmed.toUpperCase();
  if (/^(BEGIN|DECLARE)\b/.test(head)) return { kind: "skip", reason: "plsql" };
  if (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE)\b/.test(head)) {
    return { kind: "skip", reason: "plsql" };
  }
  if (/^(CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|COMMENT)\b/.test(head)) {
    return { kind: "skip", reason: "ddl" };
  }
  if (!/^(SELECT|WITH|INSERT|UPDATE|DELETE|MERGE|EXPLAIN)\b/.test(head)) {
    return { kind: "skip", reason: "ddl" };
  }
  return { kind: "ok" };
}

export function createPerfAnalyzer(): PerfAnalyzer {
  let _state = $state<AnalysisState>({ kind: "idle" });
  let _enabled = $state(true);
  let _sessionBusy = $state(false);
  let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let _abort: AbortController | null = null;
  let _pendingSql: string | null = null;
  const _cache = new Map<string, { ts: number; result: AnalysisState }>();

  function cacheKey(sql: string): string {
    // Hash via simple FNV-1a (32-bit) — collisions fine for a 64-entry LRU
    let h = 0x811c9dc5;
    for (let i = 0; i < sql.length; i++) {
      h ^= sql.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  function evictExpired() {
    const now = Date.now();
    for (const [k, v] of _cache) {
      if (now - v.ts > CACHE_TTL_MS) _cache.delete(k);
    }
    while (_cache.size > CACHE_MAX) {
      const k = _cache.keys().next().value;
      if (k === undefined) break;
      _cache.delete(k);
    }
  }

  async function runAnalysis(sql: string, reqId: string): Promise<void> {
    _state = { kind: "analyzing", reqId, sql };

    const ac = new AbortController();
    _abort?.abort();
    _abort = ac;

    const [planRes, statsRes] = await Promise.all([
      explainPlanGet(sql),
      perfStats(sql),
    ]);

    if (ac.signal.aborted) return;

    if (!planRes.ok) {
      _state = {
        kind: "error",
        message: planRes.error?.message ?? "Unknown error",
        oraCode: extractOraCode(planRes.error?.message),
      };
      return;
    }

    const plan = planRes.data.nodes;
    const stats = statsRes.ok ? statsRes.data.tables : [];

    const redFlags = detectRedFlags(plan, stats, sql);
    const costClass = classifyCost(plan[0]?.cost ?? null);
    const staleStats = detectStaleStats(stats);

    const result: AnalysisState = {
      kind: "analyzed", reqId, sql, plan, stats,
      redFlags, costClass, staleStats,
    };

    _cache.set(cacheKey(sql), { ts: Date.now(), result });
    evictExpired();
    _state = result;
  }

  function extractOraCode(msg?: string): string | undefined {
    if (!msg) return undefined;
    const m = msg.match(/(ORA-\d{5})/);
    return m ? m[1] : undefined;
  }

  function fire(sql: string): void {
    const checked = isAnalyzableSql(sql);
    if (checked.kind === "skip") {
      _state = { kind: "skipped", reason: checked.reason };
      return;
    }
    if (!_enabled) {
      _state = { kind: "skipped", reason: "disabled" };
      return;
    }
    if (_sessionBusy) {
      // Defer until session free; consumer will call scheduleAnalysis again
      // from a $effect on tab.running flipping.
      _state = { kind: "skipped", reason: "session-busy" };
      _pendingSql = sql;
      return;
    }
    const cached = _cache.get(cacheKey(sql));
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      _state = cached.result;
      return;
    }
    const reqId = crypto.randomUUID();
    void runAnalysis(sql, reqId);
  }

  return {
    get state() { return _state; },
    scheduleAnalysis(sql: string) {
      if (_debounceTimer !== null) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        _debounceTimer = null;
        fire(sql);
      }, DEBOUNCE_MS);
    },
    setEnabled(enabled: boolean) {
      _enabled = enabled;
      if (!enabled) {
        if (_debounceTimer !== null) {
          clearTimeout(_debounceTimer);
          _debounceTimer = null;
        }
        _abort?.abort();
        _state = { kind: "skipped", reason: "disabled" };
      }
    },
    setSessionBusy(busy: boolean) {
      _sessionBusy = busy;
      if (!busy && _pendingSql !== null) {
        const sql = _pendingSql;
        _pendingSql = null;
        fire(sql);
      }
    },
    reset() {
      if (_debounceTimer !== null) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
      }
      _abort?.abort();
      _abort = null;
      _pendingSql = null;
      _cache.clear();
      _state = { kind: "idle" };
    },
  };
}
```

- [ ] **Step 4: Run, confirm green**

```bash
bun run test src/lib/stores/perf-analyzer.test.ts
```

Expected: PASS — 9 tests.

- [ ] **Step 5: Run all frontend tests**

```bash
bun run test
```

Expected: 213 tests pass (184 + 20 perf-rules + 9 analyzer).

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/perf-analyzer.svelte.ts src/lib/stores/perf-analyzer.test.ts
git commit -m "feat(perf): analyzer store with debounce + cancellation + cache

createPerfAnalyzer() returns a store-like object with scheduleAnalysis(sql),
setEnabled, setSessionBusy, reset. State machine:
idle → analyzing → analyzed | error | skipped (with reason).

500ms debounce. AbortController cancels in-flight when new event arrives.
Pause-while-running via setSessionBusy. LRU cache (64 entries, 5min TTL).
Skips DDL/PL/SQL/empty SQL early without RPC."
```

---

## Task 7: Cost badge gutter (CodeMirror extension)

**Files:**
- Create: `src/lib/workspace/CostBadgeGutter.ts`

This task is harder to TDD because CodeMirror extensions need a real DOM. We'll implement directly with care, then verify visually in the smoke test (Task 10).

- [ ] **Step 1: Implement the gutter extension**

Create `src/lib/workspace/CostBadgeGutter.ts`:

```ts
import { gutter, GutterMarker } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { CostClass } from "$lib/perf/perf-rules";

export type CostBadgeData = {
  line: number;        // 1-based line number in the document
  cost: number | null;
  costClass: CostClass;
};

export const setCostBadgeEffect = StateEffect.define<CostBadgeData | null>();

class CostBadgeMarker extends GutterMarker {
  constructor(private readonly data: CostBadgeData) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    if (!(other instanceof CostBadgeMarker)) return false;
    return (
      this.data.cost === other.data.cost &&
      this.data.costClass === other.data.costClass
    );
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = `cost-badge cost-${this.data.costClass}`;
    el.textContent = formatCost(this.data.cost);
    el.title = this.data.cost === null
      ? "Cost: unknown"
      : `Estimated cost: ${this.data.cost.toLocaleString("en-US")}`;
    return el;
  }
}

function formatCost(cost: number | null): string {
  if (cost === null) return "?";
  if (cost >= 1_000_000) return `${(cost / 1_000_000).toFixed(1)}M`;
  if (cost >= 1_000) return `${(cost / 1_000).toFixed(0)}k`;
  return String(cost);
}

const costBadgeField = StateField.define<CostBadgeData | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setCostBadgeEffect)) {
        return e.value;
      }
    }
    return value;
  },
});

export function costBadgeGutter(): Extension {
  return [
    costBadgeField,
    gutter({
      class: "cm-cost-badge-gutter",
      lineMarker(view, line) {
        const data = view.state.field(costBadgeField);
        if (data === null) return null;
        // line.from is the doc offset of the line start;
        // line.number is 1-based.
        if (line.number !== data.line) return null;
        return new CostBadgeMarker(data);
      },
      initialSpacer: () => new CostBadgeMarker({ line: 1, cost: 999_999, costClass: "yellow" }),
    }),
  ];
}
```

- [ ] **Step 2: Add CSS**

Add to `src/app.css` (or the SqlEditor's local styles — find the right place via grep for similar gutter styles like `cm-breakpoint-gutter`):

```css
.cm-cost-badge-gutter {
  width: 50px;
  text-align: center;
}
.cost-badge {
  display: inline-block;
  font-family: "Inter", sans-serif;
  font-size: 9.5px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  line-height: 1.3;
  vertical-align: middle;
  margin-top: 2px;
}
.cost-green { background: rgba(126,201,106,0.18); color: #7ec96a; border: 1px solid rgba(126,201,106,0.4); }
.cost-yellow { background: rgba(232,197,71,0.16); color: #e8c547; border: 1px solid rgba(232,197,71,0.4); }
.cost-red { background: rgba(179,62,31,0.22); color: #f5a08a; border: 1px solid rgba(179,62,31,0.55); }
.cost-unknown { background: rgba(120,120,120,0.18); color: #999; border: 1px solid rgba(120,120,120,0.4); }
```

- [ ] **Step 3: Build to confirm no syntax errors**

```bash
bun run check
```

Expected: 0 new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workspace/CostBadgeGutter.ts src/app.css
git commit -m "feat(editor): cost badge gutter — CodeMirror extension

StateField + StateEffect + gutter() following the breakpointGutter.ts
pattern. Pluggable via setCostBadgeEffect dispatch. Color-coded by
CostClass (green <1k, yellow <100k, red >=100k, grey unknown).

Display formats large numbers as 12k / 1.5M to fit the gutter width."
```

---

## Task 8: Perf banner component

**Files:**
- Create: `src/lib/workspace/PerfBanner.svelte`

- [ ] **Step 1: Implement the component**

Create `src/lib/workspace/PerfBanner.svelte`:

```svelte
<script lang="ts">
  import type { RedFlag } from "$lib/perf/perf-rules";
  import { aiChat, type AiContext } from "$lib/workspace";

  type Props = {
    redFlags: RedFlag[];
    sql: string;
    plan: unknown[]; // ExplainNode[] but we treat as opaque
    stats: unknown[]; // PerfTableStats[]
    apiKey: string;
    aiContext: AiContext;
  };
  let { redFlags, sql, plan, stats, apiKey, aiContext }: Props = $props();

  let expanded = $state(false);
  let dismissed = $state(false);
  let tipLoading = $state(false);
  let tipText = $state<string | null>(null);
  let tipError = $state<string | null>(null);

  // Reset when redFlags reference changes (new analysis arrived)
  $effect(() => {
    redFlags;
    sql;
    dismissed = false;
    expanded = false;
    tipText = null;
    tipError = null;
  });

  async function expandTip() {
    expanded = true;
    if (tipText !== null || tipLoading) return;
    tipLoading = true;
    tipError = null;
    const prompt = buildPrompt(sql, plan, stats, redFlags);
    const res = await aiChat(apiKey, [{ role: "user", content: prompt }], aiContext);
    tipLoading = false;
    if (res.ok) {
      tipText = res.data.content;
    } else {
      tipError = (res.error as { message?: string })?.message ?? "Unknown error";
    }
  }

  function buildPrompt(sql: string, plan: unknown[], stats: unknown[], flags: RedFlag[]): string {
    return [
      "You are an Oracle DBA assistant. The user is writing this SQL:",
      "```sql",
      sql,
      "```",
      "",
      "Static analysis flagged these issues:",
      flags.map((f) => `- [${f.severity.toUpperCase()}] ${f.id}: ${f.message}`).join("\n"),
      "",
      "Execution plan (JSON):",
      "```json",
      JSON.stringify(plan, null, 2),
      "```",
      "",
      "Table stats and indexes (JSON):",
      "```json",
      JSON.stringify(stats, null, 2),
      "```",
      "",
      "Give the user 1-3 concrete, actionable suggestions. Keep it under 200 words. " +
      "Use markdown bullets. Suggest CREATE INDEX statements with full DDL when relevant.",
    ].join("\n");
  }

  function severityIcon(s: RedFlag["severity"]): string {
    return s === "critical" ? "🔴" : s === "warn" ? "🟡" : "ℹ️";
  }
</script>

{#if redFlags.length > 0 && !dismissed}
  <div class="perf-banner">
    <div class="banner-flags">
      {#each redFlags as f (f.id)}
        <div class="flag flag-{f.severity}">
          <span class="flag-icon">{severityIcon(f.severity)}</span>
          <span class="flag-id">{f.id}</span>
          <span class="flag-msg">{f.message}</span>
          {#if f.suggestion}
            <span class="flag-sug">— {f.suggestion}</span>
          {/if}
        </div>
      {/each}
    </div>
    <div class="banner-actions">
      {#if !expanded}
        <button class="tip-btn" onclick={expandTip}>💡 Ask Sheep</button>
      {/if}
      <button class="dismiss-btn" onclick={() => dismissed = true} aria-label="Dismiss">×</button>
    </div>
    {#if expanded}
      <div class="tip-content">
        {#if tipLoading}
          <span class="tip-loading">Sheep is thinking…</span>
        {:else if tipError}
          <span class="tip-err">Tip generation failed: {tipError}</span>
          <button class="tip-retry" onclick={expandTip}>Retry</button>
        {:else if tipText}
          <pre class="tip-text">{tipText}</pre>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .perf-banner {
    background: var(--bg-surface-raised);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: "Inter", sans-serif;
    font-size: 11.5px;
    color: var(--text-primary);
  }
  .banner-flags { display: flex; flex-direction: column; gap: 2px; }
  .flag { display: flex; gap: 6px; align-items: baseline; line-height: 1.4; }
  .flag-icon { font-size: 11px; flex-shrink: 0; }
  .flag-id {
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .flag-msg { color: var(--text-primary); }
  .flag-sug { color: var(--text-secondary); font-style: italic; }
  .banner-actions {
    display: flex; gap: 6px; align-items: center;
    margin-top: 2px;
  }
  .tip-btn {
    background: rgba(232,197,71,0.15);
    color: #e8c547;
    border: 1px solid rgba(232,197,71,0.4);
    border-radius: 3px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
  }
  .tip-btn:hover { background: rgba(232,197,71,0.25); }
  .dismiss-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 4px;
    margin-left: auto;
  }
  .dismiss-btn:hover { color: var(--text-primary); }
  .tip-content {
    margin-top: 6px;
    padding: 6px 8px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .tip-loading { color: var(--text-muted); font-style: italic; }
  .tip-err { color: #f5a08a; }
  .tip-retry {
    margin-left: 8px;
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text-primary);
    border-radius: 3px;
    padding: 1px 6px;
    cursor: pointer;
  }
  .tip-text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: "Inter", sans-serif;
    font-size: 12px;
    line-height: 1.5;
  }
</style>
```

- [ ] **Step 2: Build to confirm**

```bash
bun run check
```

Expected: 0 new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace/PerfBanner.svelte
git commit -m "feat(perf): PerfBanner — inline red flags + lazy Sheep tip expander

Renders the redFlags list with severity icon + ID + message + suggestion.
'Ask Sheep' button is lazy: tip is only generated when the user clicks
expand (keeps Anthropic token bill bounded).

Resets internal expand/dismiss state when a new analysis arrives
(redFlags or sql reference changes)."
```

---

## Task 9: WhySlowButton component + ResultGrid integration

**Files:**
- Create: `src/lib/workspace/WhySlowButton.svelte`
- Modify: `src/lib/workspace/ResultGrid.svelte`

- [ ] **Step 1: Implement WhySlowButton**

Create `src/lib/workspace/WhySlowButton.svelte`:

```svelte
<script lang="ts">
  import { explainPlanGet, perfStats } from "$lib/workspace";
  import type { ExplainNode } from "$lib/workspace";

  type Props = {
    sql: string;
    onAsk: (prompt: string) => void;  // pushes to Sheep panel
  };
  let { sql, onAsk }: Props = $props();

  let loading = $state(false);
  let error = $state<string | null>(null);

  async function runWhySlow() {
    loading = true;
    error = null;
    try {
      const [planRes, statsRes] = await Promise.all([
        explainPlanGet(sql),
        perfStats(sql),
      ]);
      if (!planRes.ok) {
        error = `EXPLAIN PLAN failed: ${planRes.error?.message ?? "unknown"}`;
        return;
      }
      const plan = planRes.data.nodes;
      const stats = statsRes.ok ? statsRes.data.tables : [];
      const prompt = buildPrompt(sql, plan, stats);
      onAsk(prompt);
    } finally {
      loading = false;
    }
  }

  function buildPrompt(sql: string, plan: ExplainNode[], stats: unknown[]): string {
    return [
      "Why is this Oracle query slow? Give 1-3 concrete suggestions with full CREATE INDEX or rewritten SQL when applicable.",
      "",
      "SQL:",
      "```sql",
      sql,
      "```",
      "",
      "Execution plan (JSON):",
      "```json",
      JSON.stringify(plan, null, 2),
      "```",
      "",
      "Table stats + indexes (JSON):",
      "```json",
      JSON.stringify(stats, null, 2),
      "```",
    ].join("\n");
  }
</script>

<button class="why-slow-btn" onclick={runWhySlow} disabled={loading} title="Send SQL + plan + stats to Sheep AI for analysis">
  {loading ? "Analyzing…" : "🤔 Why slow?"}
</button>
{#if error}
  <span class="why-slow-err">{error}</span>
{/if}

<style>
  .why-slow-btn {
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid rgba(232,197,71,0.4);
    background: rgba(232,197,71,0.12);
    color: #e8c547;
    cursor: pointer;
  }
  .why-slow-btn:hover:not(:disabled) {
    background: rgba(232,197,71,0.22);
  }
  .why-slow-btn:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  .why-slow-err {
    margin-left: 6px;
    font-size: 10.5px;
    color: #f5a08a;
  }
</style>
```

- [ ] **Step 2: Wire WhySlowButton into ResultGrid**

In `src/lib/workspace/ResultGrid.svelte`, add to the imports near the top:

```ts
import WhySlowButton from "./WhySlowButton.svelte";
```

Add to the `Props` type:

```ts
  type Props = {
    tab: SqlTab | null;
    onCancel: () => void;
    onAnalyze?: () => void;
    onFetchAll?: () => void;
    onWhySlow?: (prompt: string) => void;
  };
  let { tab, onCancel, onAnalyze, onFetchAll, onWhySlow }: Props = $props();
```

In the footer template, add the WhySlowButton next to the Analyze button:

```svelte
        {#if onAnalyze && r.columns.length > 0}
          <button class="analyze-btn" onclick={onAnalyze}>📊 Analyze</button>
        {/if}
        {#if onWhySlow && ar?.sqlOriginal && r.columns.length > 0}
          <WhySlowButton sql={ar.sqlOriginal} onAsk={onWhySlow} />
        {/if}
```

- [ ] **Step 3: Wire onWhySlow at SqlDrawer**

In `src/lib/workspace/SqlDrawer.svelte`, find the existing `Props` type and add:

```ts
  type Props = {
    onCancel: () => void;
    onExplainWithAI: (msg: string) => void;
    onAnalyze?: () => void;
    completionSchema?: Record<string, string[]>;
    onWhySlow?: (prompt: string) => void;
  };
```

Update the destructuring:

```ts
  let { onCancel, onExplainWithAI, onAnalyze, completionSchema, onWhySlow }: Props = $props();
```

Pass it to ResultGrid:

```svelte
              <ResultGrid
                {tab}
                {onCancel}
                {onAnalyze}
                onFetchAll={() => void sqlEditor.fetchAllForActiveResult()}
                {onWhySlow}
              />
```

- [ ] **Step 4: Wire from workspace page to Sheep**

In `src/routes/workspace/[id]/+page.svelte`, find the SqlDrawer rendering and add the `onWhySlow` prop. The intent: a "Why slow?" prompt opens the Sheep panel with the prompt pre-filled.

Find the `<SqlDrawer ...>` line in the template and add:

```svelte
        onWhySlow={(prompt) => {
          chatPendingMessage = prompt;
          showChat = true;
        }}
```

- [ ] **Step 5: Build to confirm**

```bash
bun run check
```

Expected: 0 new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace/WhySlowButton.svelte \
        src/lib/workspace/ResultGrid.svelte \
        src/lib/workspace/SqlDrawer.svelte \
        src/routes/workspace/\[id\]/+page.svelte

git commit -m "feat(perf): 'Why slow?' button in result grid

Click pulls SQL + plan + stats + indexes for the active result,
builds a structured prompt, and pushes it to the Sheep panel.

Wired through ResultGrid → SqlDrawer → workspace page → SheepChat
via the existing chatPendingMessage / showChat plumbing."
```

---

## Task 10: SqlEditor integration — gutter + analyzer wire-up

**Files:**
- Modify: `src/lib/workspace/SqlEditor.svelte`
- Modify: `src/lib/workspace/SqlDrawer.svelte`

- [ ] **Step 1: Register the cost badge gutter in SqlEditor**

In `src/lib/workspace/SqlEditor.svelte`, find the imports block and add:

```ts
import { costBadgeGutter } from "./CostBadgeGutter.ts";
```

Find the EditorView extensions array (look for `basicSetup` and existing gutters) and add `costBadgeGutter()` to the list.

- [ ] **Step 2: Add cursor-aware statement detection helper**

In `src/lib/workspace/SqlEditor.svelte` script, add a helper function:

```ts
function statementAtCursor(buffer: string, cursorPos: number): { sql: string; line: number } | null {
  // Reuse the splitter from the existing runStatementAtCursor in sql-editor store.
  // For perf-analyzer purposes we only need the statement text + its starting line.
  // We don't import the heavy store — replicate light logic.
  if (buffer.trim() === "") return null;
  // Find statement boundaries by ;
  // (Simplified — does NOT handle PL/SQL blocks, but those are skipped by isAnalyzableSql anyway.)
  const slice = buffer.slice(0, cursorPos);
  const before = slice.lastIndexOf(";");
  const after = buffer.indexOf(";", cursorPos);
  const start = before === -1 ? 0 : before + 1;
  const end = after === -1 ? buffer.length : after;
  const sql = buffer.slice(start, end).trim();
  if (sql === "") return null;
  // 1-based line of statement start
  const linesBefore = buffer.slice(0, start).split("\n").length;
  return { sql, line: linesBefore };
}
```

- [ ] **Step 3: Bind perf-analyzer in SqlEditor**

In `src/lib/workspace/SqlEditor.svelte` script, near the existing state declarations, add:

```ts
import { createPerfAnalyzer } from "$lib/stores/perf-analyzer.svelte";
import { setCostBadgeEffect } from "./CostBadgeGutter";

const analyzer = createPerfAnalyzer();

// Expose state and the schedule trigger
export const perfAnalyzer = analyzer;

let lastStatementLine = $state(1);
```

Add a CodeMirror update listener that fires `analyzer.scheduleAnalysis(...)` on document or selection changes. Find where the EditorView is constructed; add to the extensions:

```ts
EditorView.updateListener.of((update) => {
  if (update.docChanged || update.selectionSet) {
    const buf = update.state.doc.toString();
    const pos = update.state.selection.main.head;
    const stmt = statementAtCursor(buf, pos);
    if (stmt === null) {
      analyzer.scheduleAnalysis("");
      return;
    }
    lastStatementLine = stmt.line;
    analyzer.scheduleAnalysis(stmt.sql);
  }
}),
```

- [ ] **Step 4: Push cost badge effect on analysis state change**

Add a `$effect`:

```ts
$effect(() => {
  if (!view) return;
  const s = analyzer.state;
  if (s.kind !== "analyzed") {
    view.dispatch({ effects: setCostBadgeEffect.of(null) });
    return;
  }
  view.dispatch({
    effects: setCostBadgeEffect.of({
      line: lastStatementLine,
      cost: s.plan[0]?.cost ?? null,
      costClass: s.costClass,
    }),
  });
});
```

- [ ] **Step 5: Render PerfBanner in SqlDrawer below the editor**

In `src/lib/workspace/SqlDrawer.svelte`, add to imports:

```ts
import PerfBanner from "./PerfBanner.svelte";
import { aiKeyGet, type AiContext } from "$lib/workspace";
```

Add a derived to grab the analyzer state from SqlEditor. In SqlEditor we already exposed `perfAnalyzer`. To access it from the parent, change SqlEditor to expose it via `bind:this` and a getter. Actually simpler: lift the analyzer to SqlDrawer.

Refactor: move the `createPerfAnalyzer()` call to SqlDrawer (the parent), pass the analyzer down to SqlEditor as a prop.

In SqlDrawer:

```ts
import { createPerfAnalyzer } from "$lib/stores/perf-analyzer.svelte";

const perfAnalyzer = createPerfAnalyzer();

// Connection toggle: read auto_perf_analysis from active connection meta
// (workspace +page.svelte already loaded this). For MVP we toggle by listening
// to a derived from sqlEditor.connection-level safety. The flag isn't currently
// surfaced into the sql-editor store, so we accept a prop from the parent.
```

Add prop:

```ts
  type Props = {
    onCancel: () => void;
    onExplainWithAI: (msg: string) => void;
    onAnalyze?: () => void;
    completionSchema?: Record<string, string[]>;
    onWhySlow?: (prompt: string) => void;
    autoPerfAnalysis?: boolean;
    aiContext?: AiContext;
  };
  let {
    onCancel, onExplainWithAI, onAnalyze, completionSchema, onWhySlow,
    autoPerfAnalysis = true,
    aiContext,
  }: Props = $props();

  $effect(() => {
    perfAnalyzer.setEnabled(autoPerfAnalysis);
  });

  $effect(() => {
    perfAnalyzer.setSessionBusy(active?.running === true);
  });

  let apiKey = $state("");
  $effect(() => {
    void aiKeyGet("anthropic").then((k) => apiKey = k ?? "");
  });
```

Pass analyzer to SqlEditor (find the `<SqlEditor ...>` element and add `{perfAnalyzer}` if SqlEditor accepts a prop, else accept it in SqlEditor as a Props field).

In SqlEditor's Props, add:

```ts
  type Props = {
    // ... existing props
    perfAnalyzer?: ReturnType<typeof createPerfAnalyzer>;
  };
```

And replace the local `const analyzer = createPerfAnalyzer();` with:

```ts
  const analyzer = perfAnalyzer ?? createPerfAnalyzer();
```

Render PerfBanner in SqlDrawer below the editor pane. Find the SqlEditor
mount point inside the drawer template (search for `<SqlEditor` in
`SqlDrawer.svelte`) — it's wrapped in a `<div class="editor-pane">` or
similar that takes the upper portion of the drawer. Add the PerfBanner
IMMEDIATELY AFTER the closing tag of that editor wrapper and BEFORE the
middle drag handle (`onMidPointerDown` etc.). Concretely:

```svelte
  </div> <!-- end of editor pane / SqlEditor wrapper -->

  {#if perfAnalyzer.state.kind === "analyzed" && perfAnalyzer.state.redFlags.length > 0 && aiContext}
    <PerfBanner
      redFlags={perfAnalyzer.state.redFlags}
      sql={perfAnalyzer.state.sql}
      plan={perfAnalyzer.state.plan}
      stats={perfAnalyzer.state.stats}
      {apiKey}
      {aiContext}
    />
  {/if}

  <!-- middle drag handle (existing) -->
  <div role="separator" onpointerdown={onMidPointerDown} ... ></div>
```

The banner is intentionally OUTSIDE the editor pane so its height doesn't
push the editor's CodeMirror instance — instead it eats from the result
grid space below. If you need to ensure the drawer accommodates the banner
without overflowing, no extra CSS is needed because the existing flex
layout in `.drawer { display: flex; flex-direction: column; }` will allocate
space naturally.

- [ ] **Step 6: Pass autoPerfAnalysis + aiContext from workspace page**

In `src/routes/workspace/[id]/+page.svelte`, before the `<SqlDrawer ...>` block,
extract the `AiContext` literal already passed to `<SheepChat>` into a `$derived`
so both consumers share it. Search the file for `<SheepChat` and you'll find a
`context={...}` prop — that's the existing AiContext literal.

Add ABOVE the `<div class="shell">` block (or anywhere after `meta` and `info`
are declared and inside the script section):

```ts
  const aiContext = $derived({
    currentSchema: info?.currentSchema ?? null,
    selectedOwner: selected?.owner ?? null,
    selectedName: selected?.name ?? null,
    selectedKind: selected?.kind ?? null,
  });
```

Then update BOTH `<SheepChat context={...} ...>` (replace the inline object
literal with `context={aiContext}`) AND add to `<SqlDrawer ...>`:

```svelte
  autoPerfAnalysis={meta?.autoPerfAnalysis ?? true}
  {aiContext}
```

Verify `AiContext` shape: open `src/lib/workspace.ts` and grep for
`export type AiContext`. The four fields above (`currentSchema`,
`selectedOwner`, `selectedName`, `selectedKind`) match the existing definition.
If the type adds more fields in the future, this `$derived` will compile-error
and you'll know to extend it.

- [ ] **Step 7: Build to confirm**

```bash
bun run check
```

Expected: 0 new errors.

- [ ] **Step 8: Recompile sidecar binary**

```bash
cd sidecar && bun build src/index.ts --compile --minify --outfile ../src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe
```

Expected: completes in ~1-2s.

- [ ] **Step 9: Manual smoke test (DBA)**

Run `bun run tauri dev` and verify:
1. Open editor, type `SELECT * FROM dual` → after 500ms green badge appears in gutter, no banner
2. Type `SELECT * FROM employees` (assuming 100k+ rows seeded) → red badge + R001 banner
3. Move cursor between two statements → badge updates per statement
4. Type `BEGIN NULL; END;` → badge disappears (skipped state)
5. In Settings of the connection, uncheck "Auto-perf analysis" → reload → badges gone

- [ ] **Step 10: Commit**

```bash
git add src/lib/workspace/SqlEditor.svelte \
        src/lib/workspace/SqlDrawer.svelte \
        src/routes/workspace/\[id\]/+page.svelte \
        src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe

git commit -m "feat(perf): wire analyzer + cost badge + banner into SqlDrawer

createPerfAnalyzer() lifted to SqlDrawer; passed to SqlEditor so the
gutter and banner observe the same store. SqlEditor's CodeMirror
updateListener fires scheduleAnalysis on doc or selection changes
(extracts the statement at cursor with light splitting).

Per-connection auto_perf_analysis flag gates the analyzer via
setEnabled(); tab.running pauses analyses via setSessionBusy().

Recompiles sidecar binary so the perf.stats RPC is registered."
```

---

## Task 11: Smoke test against Oracle Docker — final E2E validation

**Files:** none (manual test pass)

This is a manual checklist the implementer runs after Task 10's automated checks pass. Document the results.

- [ ] **Step 1: Verify Oracle Docker is up**

```bash
docker ps | grep oracle
```

Expected: container running on port 1521.

- [ ] **Step 2: Open Veesker workspace against the Docker connection**

Connect with the existing test connection. Confirm StatusBar shows the connection.

- [ ] **Step 3: Run scenario A — small query, green badge**

In SQL editor, type:
```sql
SELECT * FROM hr.departments
```

Expected within 500ms:
- Cost badge in gutter: green, value something like "5"
- No red flags banner
- DevTools console: `[ChartWidget]` and analyzer logs visible

- [ ] **Step 4: Run scenario B — full scan on big table, red flag**

Assume HR.EMPLOYEES has 100k+ rows (seeded for testing). If not, run:
```sql
INSERT INTO hr.employees (employee_id, first_name, last_name, email, hire_date, job_id)
SELECT 100000 + LEVEL, 'TEST', 'TEST', 'test'||LEVEL||'@x.com', SYSDATE, 'IT_PROG'
FROM dual CONNECT BY LEVEL <= 200000;
COMMIT;
EXEC DBMS_STATS.GATHER_TABLE_STATS('HR', 'EMPLOYEES');
```

Then in editor:
```sql
SELECT * FROM hr.employees
```

Expected:
- Red badge in gutter (cost > 100k)
- R001 banner: "FULL TABLE SCAN on `EMPLOYEES` (200,000 rows)"
- "💡 Ask Sheep" button visible

- [ ] **Step 5: Run scenario C — cartesian product**

```sql
SELECT * FROM hr.employees, hr.departments
```

Expected:
- R002 banner: "CARTESIAN PRODUCT detected"

- [ ] **Step 6: Run scenario D — Why slow?**

After running scenario B's query (with F5), click "🤔 Why slow?" in the result grid footer.

Expected:
- Sheep panel opens
- Prompt is pre-filled with SQL + plan + stats + indexes
- After Anthropic responds (~3-5s), suggestion text appears

- [ ] **Step 7: Run scenario E — per-connection toggle**

Edit the connection, uncheck "Auto-perf analysis", save, reconnect. Run scenario B again.

Expected:
- No badge in gutter
- No banner
- "Why slow?" still works in result grid (on-demand only)

- [ ] **Step 8: Run scenario F — read-only mode**

Edit connection, mark Read-only, save, reconnect. Run scenario B.

Expected:
- Auto-perf still works (badge + banner appear) — read-only does NOT block EXPLAIN PLAN
- F5 on `UPDATE employees SET salary = 0 WHERE id = 1` is BLOCKED with -32030 error

- [ ] **Step 9: Document results**

If all 6 scenarios pass: write a comment in the next commit message saying "smoke test all green". If any fail: file specific issues with `id` of the rule, observed message, expected message — fix as follow-up tasks (rule tweaks usually) before claiming MVP done.

- [ ] **Step 10: Final commit**

```bash
git commit --allow-empty -m "chore(perf): MVP smoke test passed against Oracle 23ai Free

Verified scenarios A-F against local Docker:
A) green badge on small SELECT
B) red badge + R001 on FULL SCAN of 200k-row table
C) R002 on cartesian
D) Why slow? routes prompt to Sheep with full context
E) Auto-perf disabled per connection hides badges (Why slow? still works)
F) Read-only mode does not block auto-perf (only blocks DML/DDL)"
```

---

## Self-review checklist

After completing all tasks, run this checklist:

**Spec coverage:**
- [ ] All 5 MVP features implemented (cost badge, red flags banner, stats freshness, Why slow?, proactive Sheep tip via PerfBanner expander)
- [ ] All 9 rules implemented (R001-R005 Tier 1, R010-R013 Tier 2)
- [ ] Tier 3 rules deferred (not in any task)
- [ ] Per-connection `auto_perf_analysis` toggle implemented (Task 1) and gated in analyzer (Task 6 + Task 10)
- [ ] License safety: only EXPLAIN PLAN + ALL_TABLES + ALL_TAB_STATISTICS + ALL_INDEXES + ALL_IND_COLUMNS used (Task 4)
- [ ] Read-only interaction: auto-perf bypasses readOnly guard (verified by scenario F in Task 11)
- [ ] Pause-while-running: setSessionBusy implemented (Task 6) and wired (Task 10)
- [ ] Connection switch: reset() implemented (Task 6); needs $effect on connection change in SqlDrawer

**Final test counts:**
- Frontend: 184 (existing) + 20 (perf-rules) + 9 (analyzer store) = 213 vitest tests
- Sidecar: 151 (existing) + 10 (perf-stats) = 161 bun tests
- Rust: 44 (existing) + 1 (auto_perf_analysis migration) = 45 cargo tests

**Total LoC delivered:** ~700-900 across 7 new files + 11 touched files.

---

## Open follow-ups (out of MVP)

- **Tier 3 rules** — cardinality misestimation (`gather_plan_statistics`),
  LIKE leading wildcard, NOT IN→NOT EXISTS, implicit type conversion
- **Connection-switch reset trigger** — currently `reset()` exists but isn't
  called on connection switch; add a `$effect` in SqlDrawer that watches
  `sqlEditor.connectionId` (deferred — not strictly needed for MVP since
  cache hits across connections are rare, but worth a follow-up commit)
- **PLAN_TABLE cleanup** — periodic `DBMS_PLAN.DELETE_PLAN()` to keep
  PLAN_TABLE small; or migrate to `DBMS_XPLAN.DISPLAY_CURSOR` for the
  on-run analysis path
- **Per-connection threshold overrides** — letting each connection have its
  own "what counts as a big table" / "stats stale threshold"
- **Tuning Pack features** — SQL Tuning Advisor, Real-time SQL Monitor (Tier
  C in original brainstorm) — separate spec when scoped
