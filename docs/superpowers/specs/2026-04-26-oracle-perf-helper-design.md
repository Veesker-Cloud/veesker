# Oracle Performance Helper — Design Spec

**Date:** 2026-04-26
**Target:** Veesker desktop IDE (Tauri 2 + SvelteKit 5 + Bun sidecar)
**Repo:** `gevianajr/veesker` (private at time of writing; safe to ship to public open-core)
**Status:** Approved (architectural decisions taken in 2026-04-26 brainstorm session)

## Summary

A passive, always-on perf assistant that surfaces Oracle red flags **as the user
types**. Reuses the existing `EXPLAIN PLAN` infrastructure. Five MVP features:

1. **Cost badge** in the editor gutter — green/yellow/red by cost classification
2. **Red-flags banner** below the editor — full table scans, cartesian, etc
3. **Stats freshness warning** — `last_analyzed > 30d` or NULL
4. **"Why slow?" button** in the result grid → sends SQL + plan + stats + indexes to Sheep AI
5. **Proactive AI tip expander** — discreet "💡 Sheep tip available" banner; lazy expand to consume

All five features use only Oracle's **free** dictionary surface (EXPLAIN PLAN,
`ALL_TABLES`, `ALL_INDEXES`, etc). No Diagnostics Pack, no Tuning Pack. Works on
Free / Standard / Enterprise editions.

## Goals (v0.1 MVP)

- **Always-on cost classification** — DBA glances at the gutter, knows
  immediately if the query is cheap, expensive, or "stop, think before running"
- **Surface the 5 most common Oracle perf bugs** — full table scan on big
  tables, cartesian joins, stale stats, NL with high outer cardinality, function
  on indexed column
- **AI-powered diagnostic on demand** — "Why slow?" puts SQL + plan + stats +
  indexes in front of Claude and gets back actionable suggestions ("create
  index on `EMPLOYEES.DEPARTMENT_ID`")
- **Zero impact on existing flows** — F5/Run keeps working unchanged; user can
  ignore everything new and still get the old experience
- **Per-connection opt-out** — paranoid prod connection? Disable auto-perf, keep
  "Why slow?" on demand only

## Non-goals (v0.1)

- **No licensed Oracle features** — explicitly avoids `V$ACTIVE_SESSION_HISTORY`
  (Diagnostics Pack), `DBMS_SQLTUNE` (Tuning Pack), `V$SQL_MONITOR` (Tuning Pack)
- **No cardinality misestimation detection** — needs `gather_plan_statistics`
  hint + `V$SQL_PLAN_STATISTICS_ALL`; deferred to Tier 3 spec
- **No Copilot-style ghost-text inline suggestions** — too intrusive for SQL,
  expensive in tokens. Banner expander pattern instead
- **No multi-statement aggregate analysis** — only the single statement under
  the cursor (matches existing Run behavior)
- **No SQL Plan Baseline management** — `DBMS_SPM` is Tuning Pack
- **No automated index creation** — only suggests; user runs CREATE INDEX
  themselves
- **No cross-database compare** — analysis is single-connection only

## Architecture decision: frontend-orchestrated

Considered alternatives: sidecar-orchestrated single-RPC analyzer. Rejected
because:

- **Reuse over duplication** — `explainPlanGet` already exists and works. Wrapping
  it in a new sidecar endpoint would either duplicate the EXPLAIN PLAN logic or
  add an indirect call layer
- **Pure-function rules in TypeScript** — heuristics live in
  `src/lib/perf/perf-rules.ts` and are unit-testable with vitest, no sidecar
  mocking required
- **Cancellation is trivial in JS** — `AbortController` natively handles
  in-flight cancel when user resumes typing; cross-process cancel via stdin
  RPC is harder
- **Smaller blast radius** — only one new sidecar RPC (`perf.stats`); rest is
  pure frontend additions

Trade-off accepted: rule logic lives in frontend code, so reusing the same
heuristics in a future CLI tool would mean duplication. Cost is low — rules
are ~150 LoC.

## Stack

- **Frontend:** SvelteKit 5 + Svelte 5 runes (matches existing IDE)
- **Editor:** CodeMirror 6 (already in use; new gutter via existing extension
  pattern from `breakpointGutter.ts`)
- **Sidecar:** Bun + TypeScript (new RPC `perf.stats`)
- **AI:** Anthropic Claude (already integrated as Sheep)
- **Tests:** Vitest (frontend, store + rules), Bun test (sidecar integration)

## Components

### Sidecar — 1 new file, 1 touch

- **NEW** `sidecar/src/perf-stats.ts`
  - `tablesStats(p: { sql: string }): Promise<{ tables: TableStats[] }>`
  - Extracts table names from SQL (lightweight regex pre-filter, refined by
    plan_table after EXPLAIN if needed)
  - Single consolidated query against `ALL_TABLES`, `ALL_TAB_STATISTICS`,
    `ALL_INDEXES`, `ALL_IND_COLUMNS` for all referenced tables
  - Returns `{ owner, name, numRows, lastAnalyzed, blocks, indexes: [{name,
    columns[], unique, status}] }` per table
- **TOUCH** `sidecar/src/index.ts` — register the `perf.stats` RPC handler

### Tauri shell — 1 touch

- **TOUCH** `src-tauri/src/commands.rs` — `perf_stats` command, delegates to
  sidecar via `call_sidecar(&app, "perf.stats", payload)`

### Frontend — 5 new files, 3 touches

- **NEW** `src/lib/perf/perf-rules.ts` — pure functions:
  - `classifyCost(cost: number | null): "green" | "yellow" | "red" | "unknown"`
  - `detectRedFlags(plan, stats, sql): RedFlag[]`
  - `detectStaleStats(stats): StaleStat[]`
- **NEW** `src/lib/stores/perf-analyzer.svelte.ts` — orchestration store:
  - Debounce, cancellation, parallel fetches, cache
  - Exposes `$derived` `currentAnalysis: AnalysisState`
- **TOUCH** `src/lib/workspace.ts` — add `perfStats(sql)` RPC wrapper
- **NEW** `src/lib/workspace/CostBadgeGutter.ts` — CodeMirror extension
  (StateField + GutterMarker), follows pattern from `breakpointGutter.ts`
- **NEW** `src/lib/workspace/PerfBanner.svelte` — discrete banner below editor:
  - Compact list of red flags (severity icon + message)
  - "💡 Ask Sheep" expander button (lazy — generates tip on click)
  - Dismiss control
- **NEW** `src/lib/workspace/WhySlowButton.svelte` — button in `ResultGrid`
  footer; opens Sheep panel with pre-built prompt (SQL + plan + stats + indexes)
- **TOUCH** `src/lib/workspace/SqlEditor.svelte` — register `CostBadgeGutter`
  extension; bind perf-analyzer to text/cursor changes
- **TOUCH** `src/lib/workspace/ResultGrid.svelte` — render `WhySlowButton` in
  the footer (only when `r.columns.length > 0`)

### Schema

- **MIGRATION** `connections.auto_perf_analysis BOOLEAN NOT NULL DEFAULT 1` —
  follows the same idempotent-ALTER pattern as the 4 safety flags shipped in
  commit `b042f39`

### Total estimated size

~600-800 LoC, ~6 commits if split TDD-style (rules → analyzer store → sidecar
RPC → cost badge → perf banner → why-slow button + per-connection toggle).

## Data flow & state machine

```
[event] textChange OR cursorMove on SqlEditor
    │
    ▼
[debounce 500ms] cancel in-flight + reschedule
    │
    ▼
[detect statement at cursor]
    reuse splitSql(buffer) + cursor pos → currentStmt
    │
    ▼
[validate]
    - currentStmt empty?         → state = "idle"
    - SELECT/WITH/INSERT/UPDATE/DELETE/MERGE? → proceed
    - DDL/PLSQL/session?         → state = "skipped"
    │
    ▼
[skip if connection busy]
    sqlEditor.active.running === true → wait until query finishes
    (don't compete with active queries for the session lock)
    │
    ▼
[parallel] new AbortController
    ├─ explainPlanGet(sql)         (timeout 5s)
    └─ perfStats(sql)              (timeout 3s)
    │
    ▼
[apply rules]
    redFlags = detectRedFlags(plan, stats, sql)
    costClass = classifyCost(plan[0].cost)
    staleStats = detectStaleStats(stats)
    │
    ▼
[state = "analyzed", { plan, stats, redFlags, costClass, staleStats }]
    │
    ▼
[$derived consumers re-render]
    ├─ CostBadgeGutter — badge on first line of currentStmt
    ├─ PerfBanner — red flags + Sheep expander
    └─ tooltip on hover — full details
```

### Store states

```ts
type AnalysisState =
  | { kind: "idle" }
  | { kind: "analyzing"; reqId: string }
  | { kind: "analyzed"; reqId: string; plan: ExplainNode[]; stats: TableStats[];
      redFlags: RedFlag[]; costClass: CostClass; staleStats: StaleStat[] }
  | { kind: "skipped"; reason: "ddl" | "plsql" | "empty" | "connection-paused" |
      "auto-perf-disabled" }
  | { kind: "error"; message: string; oraCode?: string };
```

### Cancellation

- New typing/cursor event while `analyzing` → `AbortController.abort()` + new
  request
- Connection switch (`sqlEditor.connectionId` changed) → reset to `idle`,
  clear cache
- Tab switch → reset to `idle`
- 5s timeout on EXPLAIN → `state = "error"` with friendly timeout message

### Cache

- `Map<string, AnalysisState>` keyed by `${connectionId}:${sqlHash}`
- TTL 5 minutes, max 64 entries (LRU evict oldest, matches chart-config session
  pattern in `sidecar/src/chart.ts`)

## Heuristic rules catalog

### Tier 1 — MVP critical rules

| ID | Severity | Detection | User message | Suggestion |
|---|---|---|---|---|
| **R001** `full-scan-big` | critical | `operation = "TABLE ACCESS" && options = "FULL"` AND table has `numRows > 100_000` | "FULL TABLE SCAN on `EMPLOYEES` (1.2M rows)" | "Consider an index on the WHERE/JOIN columns" |
| **R002** `cartesian` | critical | `operation` contains `"MERGE JOIN CARTESIAN"` OR `NESTED LOOPS` with no `access_predicates` AND no `filter_predicates` on the join | "CARTESIAN PRODUCT detected" | "Missing JOIN condition between tables X and Y" |
| **R003** `high-cost` | warn | `plan[0].cost > 100_000` | "Estimated cost: 124,500" | "Heavy analysis — confirm before running in prod" |
| **R004** `stats-stale` | warn | `last_analyzed > 30 days ago` for any FROM table | "Stats stale on `ORDERS` (last: 2024-08-12)" | "Run `DBMS_STATS.GATHER_TABLE_STATS('OWNER', 'ORDERS')`" |
| **R005** `stats-missing` | warn | `last_analyzed IS NULL` for any FROM table | "No stats on `STAGING_X` — optimizer is guessing" | "Gather stats before analyzing perf" |

### Tier 2 — important (plan + light SQL parsing)

| ID | Severity | Detection | Message |
|---|---|---|---|
| **R010** `nl-big-outer` | warn | `operation = "NESTED LOOPS"` AND left child `cardinality > 10_000` | "NESTED LOOPS with 50k rows on outer — consider HASH JOIN" |
| **R011** `function-on-indexed-col` | warn | regex `WHERE\s+(TRUNC|UPPER|LOWER|TO_CHAR)\s*\(\s*<col>` where `<col>` is in `ALL_IND_COLUMNS` | "TRUNC(hire_date) prevents use of index IDX_EMP_HIRE" |
| **R012** `db-link` | warn | `operation` contains `"REMOTE"` OR `object_name` contains `@` | "Remote access via DB link — confirm network and remote plan_table" |
| **R013** `index-full-scan-no-pred` | info | `operation = "INDEX"`, `options = "FULL SCAN"`, no `access_predicates` | "INDEX FULL SCAN with no predicate — scans entire index" |

### Tier 3 — out of MVP scope (future work)

- Cardinality misestimation (needs `V$SQL_PLAN_STATISTICS_ALL` with
  `gather_plan_statistics` hint)
- LIKE with leading wildcard (`'%foo%'` defeats index)
- NOT IN with NULL → suggest NOT EXISTS
- Implicit type conversion in WHERE (needs plan info we don't pull yet)

### RedFlag data type

```ts
type RedFlag = {
  id: string;            // "R001"
  severity: "critical" | "warn" | "info";
  message: string;
  suggestion?: string;
  // Anchor in editor (line of statement; null if not derivable)
  line?: number | null;
  // Telemetry/AI context
  context: { table?: string; column?: string; operation?: string; cost?: number };
};
```

### Design principles for rules

- **No-false-positive bias** — better to miss a flag than flag wrongly. A senior
  DBA who sees one bad warning loses confidence in all warnings forever.
- **Hardcoded thresholds for MVP** — 100k rows, 100k cost, 30d stats. Future:
  per-connection or global settings.
- **Suggestions are optional** — if there's no obvious fix, omit.

## License safety + connection isolation

### Oracle features used

| Feature | Pack | Edition |
|---|---|---|
| EXPLAIN PLAN | core | Free / SE / EE |
| `ALL_TABLES`, `ALL_TAB_STATISTICS` | core | all |
| `ALL_INDEXES`, `ALL_IND_COLUMNS` | core | all |
| Sheep AI (Anthropic) | external | n/a |

**Zero dependency on Tuning Pack or Diagnostics Pack.** No legal exposure when
running against client production databases.

### Read-only mode interaction

The `connection.readOnly` flag (shipped in commit `b042f39`) blocks DML/DDL/
PLSQL/session statements through `enforceSafetyForStatement()` in
`queryExecute()`.

The sidecar `explainPlan()` function does NOT route through `queryExecute()`
— it's its own function. Therefore auto-EXPLAIN bypasses the read-only guard,
which is the desired behavior: read-only should permit passive query analysis.

`PLAN_TABLE` writes from EXPLAIN PLAN are utility writes (per-session, ephemeral)
and do not violate the spirit of read-only mode.

### Per-connection opt-out

A new checkbox in the Safety Guards panel (existing UI, shipped in commit
`b042f39`):

```
☑ Auto-perf analysis (background EXPLAIN PLAN + stats)   ← default ON
   When off, cost badge / red flags / stats freshness
   are disabled for this connection. "Why slow?" button
   in the result grid keeps working (on-demand only).
```

Schema migration: new column `auto_perf_analysis BOOLEAN NOT NULL DEFAULT 1` in
`connections`, applied via the same idempotent ALTER TABLE pattern used for the
4 existing safety flags.

### Pause during run

Already covered in data flow: when `tab.running === true`, the analyzer's
debounce keeps counting but the actual EXPLAIN/stats calls wait until
`tab.running === false`. This avoids contention on the single connection's
session lock (node-oracledb Thin serializes calls on a connection).

### Connection switch / disconnect

Full reset of analyzer state when `sqlEditor.connectionId` changes. Cache key
includes connectionId, so caches don't leak across connections.

## Error handling

### EXPLAIN PLAN failures

| Scenario | Store state | UI shows |
|---|---|---|
| Syntax error (ORA-00942, ORA-00904, etc) | `error` with `code` + `message` | Gutter badge → ⚠️ amber. Tooltip: "ORA-00942: table or view does not exist". No banner. |
| No active session | `skipped` | Nothing visible. Auto-perf is meaningless without a session. |
| Timeout >5s | `error` | Gutter badge → 🔍 grey. Tooltip: "Analysis timed out — query too complex". No banner. |
| `connection.readOnly` AND statement is DDL/DML | `skipped` | Nothing (auto-perf only fires for SELECT/WITH anyway). |
| AbortController cancel (typing continued) | previous state preserved | Nothing. Cancellation is silent. |
| Network error / sidecar crash | `error` | Tooltip: "Perf analyzer unavailable". Badge grey. **Editor stays fully usable.** |

### perfStats failures

Non-fatal. Continue with plan-only analysis:
- Without `tablesStats`, R004/R005 (stats freshness) are not evaluated, and
  R001 falls back to flagging FULL SCAN without the size qualifier.
- Discrete banner note: "Table stats unavailable — `ALL_TAB_STATISTICS`
  privilege missing?"

### Sheep AI failures (item 5 — proactive tips)

- API key not configured → expander shows "Configure API key in Settings to
  enable tips"
- Anthropic API error/timeout → expander shows "Tip generation failed:
  <reason>" + Retry button
- Quota exceeded → specific message: "Anthropic API quota reached"

### Principles

1. **Auto-perf errors never break the editor.** Typing keeps working, F5 works.
2. **Silent when it makes sense** (cancel, no session). Not every error
   deserves a banner.
3. **Discrete when worth showing** — tooltip on the gutter, not modal. Modals
   only for "Why slow?" and the existing UnsafeDmlModal.
4. **Console logs for debugging** — DevTools shows:
   ```
   [perf] explainPlan failed: ORA-00942 ...
   [perf] perfStats degraded — privilege issue
   [perf] aborted (typing continued)
   ```

### PLAN_TABLE pollution awareness

EXPLAIN PLAN writes ~5-15 rows per call to PLAN_TABLE by design. With debounce
500ms, an active typing session writes ~hundreds of rows over an hour.
PLAN_TABLE is per-session and discardable, so this is normal. But:

- DBMS_AUDIT (if enabled at the client) may log EXPLAIN PLAN statements
- Future cleanup (not in MVP): periodic `DBMS_PLAN.DELETE_PLAN(...)` of old
  entries, or use `DBMS_XPLAN.DISPLAY_CURSOR` against `V$SQL_PLAN` instead

## Testing strategy

### Unit — pure rules (Vitest, target 100%)

`src/lib/perf/perf-rules.test.ts` — 1:1 coverage of the rule catalog. For each
rule R001-R013:
- Positive case (must flag)
- Negative case (must not flag)
- Edge case (NULL stats, empty plan, zero cardinality)

```ts
test("R001 flags FULL TABLE SCAN on big table", () => {
  const plan = [{ id: 0, operation: "TABLE ACCESS", options: "FULL",
                  objectName: "EMPLOYEES", cost: 50000, cardinality: 1_200_000 }];
  const stats = [{ owner: "HR", name: "EMPLOYEES", numRows: 1_200_000,
                   lastAnalyzed: "2026-04-25", blocks: 8000, indexes: [] }];
  const flags = detectRedFlags(plan, stats, "SELECT * FROM EMPLOYEES");
  expect(flags).toContainEqual(expect.objectContaining({
    id: "R001", severity: "critical"
  }));
});

test("R001 does NOT flag FULL SCAN on small table (<100k rows)", () => {
  const plan = [{ ..., operation: "TABLE ACCESS", options: "FULL",
                  objectName: "DEPARTMENTS" }];
  const stats = [{ ..., numRows: 27 }];
  expect(detectRedFlags(plan, stats, "SELECT * FROM DEPARTMENTS"))
    .not.toContainEqual(expect.objectContaining({ id: "R001" }));
});

test("classifyCost thresholds", () => {
  expect(classifyCost(500)).toBe("green");
  expect(classifyCost(50_000)).toBe("yellow");
  expect(classifyCost(150_000)).toBe("red");
  expect(classifyCost(null)).toBe("unknown");
});
```

### Store — orchestration (Vitest with mocked RPCs, target 80%+)

`src/lib/stores/perf-analyzer.test.ts`:
- Debounce: rapid changes within 500ms collapse into one RPC call
- Cancellation: AbortController.abort() called when new event arrives during
  in-flight analysis
- Pause-while-running: tab.running=true → analyzer waits
- Connection switch: full reset + cache clear
- Cache hit: same SQL within TTL returns from cache without RPC

```ts
import { vi } from "vitest";

vi.mock("$lib/workspace", () => ({
  explainPlanGet: vi.fn(),
  perfStats: vi.fn(),
}));

test("debounce coalesces rapid changes into single RPC call", async () => {
  const analyzer = createPerfAnalyzer();
  analyzer.scheduleAnalysis("SELECT 1 FROM dual");
  analyzer.scheduleAnalysis("SELECT 2 FROM dual");
  analyzer.scheduleAnalysis("SELECT 3 FROM dual");
  await advanceTimers(600);
  expect(explainPlanGet).toHaveBeenCalledTimes(1);
  expect(explainPlanGet).toHaveBeenCalledWith("SELECT 3 FROM dual");
});
```

### Sidecar — perfStats (Bun test, target 70%+ with optional integration)

`sidecar/tests/perf-stats.test.ts`:
- Unit (mocked `conn.execute`): given a query result, returns the right shape
- Integration (skip if Oracle off — existing pattern from `flow.integration.test.ts`):
  against the local Docker Oracle 23ai Free with HR sample
  - `tablesStats({ sql: "SELECT * FROM EMPLOYEES e JOIN DEPARTMENTS d ON e.department_id = d.department_id" })`
  - Expects: both tables present with index info

### E2E — manual smoke test

Documented for the DBA to run manually after implementation completes:
1. Open editor with `SELECT * FROM dual` → green badge, no flags
2. Switch to `SELECT * FROM employees` → after 500ms badge updates + R001 if >100k rows
3. Move cursor between two statements → badge updates per current statement
4. Edit connection → uncheck "Auto-perf analysis" → badges disappear
5. Enable `read_only` on connection → auto-perf still works (doesn't block EXPLAIN PLAN)
6. Click "Why slow?" in result grid after running → Sheep panel opens with pre-built prompt

### Coverage targets

- `perf-rules.ts`: **100%** branches (pure functions, easy)
- `perf-analyzer.svelte.ts`: **80%+** (state machine + debounce)
- `perf-stats.ts` (sidecar): **70%+** unit + integration
- UI components: smoke (renders with props, click handlers fire)

### CI gate

New tests run via the existing `bun run test` (frontend) and `bun test`
(sidecar) jobs in `.github/workflows/ci.yml` (commit `8c73f29`). No new
workflow needed.

## Open questions

None at design-approval time — every architectural choice has been validated
against the existing Veesker codebase, the user's licensing constraints
(strictly free Oracle features), and the brainstormed UX direction.

## References

- Existing EXPLAIN PLAN: `sidecar/src/oracle.ts` `explainPlan()` function and
  `src/lib/workspace.ts` `explainPlanGet` wrapper
- Existing CodeMirror gutter pattern: `src/lib/workspace/breakpointGutter.ts`
- Existing safety panel UI: `src/lib/ConnectionForm.svelte` (commit `b042f39`)
- Existing safety schema migration pattern:
  `src-tauri/src/persistence/store.rs` `add_safety_columns_if_missing`
- Existing Sheep AI integration: `src/lib/workspace/SheepChat.svelte` and
  `aiChat()` in `src/lib/workspace.ts`
- Tier B/C future features (deferred): `V$SQL_PLAN_STATISTICS_ALL`,
  `DBMS_SQLTUNE`, real-time SQL Monitor — separate spec when Veesker tier
  for licensed Oracle features is scoped
