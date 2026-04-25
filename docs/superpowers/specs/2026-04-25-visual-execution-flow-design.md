# Visual Execution Flow — Design Spec

**Date:** 2026-04-25
**Target version:** v0.3
**Status:** Approved (brainstorm session 2026-04-25)

## Summary

Add a side-panel visualization that animates the execution flow of a PL/SQL procedure/function/package method or a SQL statement's EXPLAIN PLAN, step-by-step, with NEXT/PREV navigation. The trace is captured once (replay-and-record) and the user navigates the recorded history locally — zero round-trips to Oracle during navigation.

## Goals

- Help developers understand WHAT runs and IN WHAT ORDER for non-trivial PL/SQL and SQL.
- Show variable values, timing, and call stack at every step (PL/SQL).
- Show plan operation order, cardinality estimate vs actual, cost, and buffer reads (SQL).
- Reuse the existing PL/SQL debugger (`DBMS_DEBUG_JDWP`) and EXPLAIN PLAN infrastructure — no new Oracle privileges beyond what the debugger already requires.

## Non-goals (this MVP — v0.3)

- Static-only PL/SQL parsing via PL/Scope (deferred to v0.4).
- Range-of-lines tracing for very large procedures (deferred to v0.4).
- Export trace to file or animated GIF (deferred).
- Diff between two trace runs (deferred).
- Live highlight of current step in the source-code editor (deferred — could be added without changing this spec).

## User flow

1. User has a procedure/function/package method or a SQL statement open in the editor.
2. User clicks **▶ Run with Visual Flow** button (next to the existing Run / Debug buttons).
3. App opens the side panel and starts capturing.
4. When trace finishes, the diagram renders with all steps. The first step is selected.
5. User navigates with `NEXT` / `PREV` buttons, the scrubber bar, or keyboard shortcuts.
6. User can rerun without retracing (cached) or re-trace (button).

## Architecture

```
Frontend (Svelte 5)
    │
    │ click "Run with Visual Flow"
    ▼
src/lib/workspace/VisualFlowPanel.svelte (side panel container)
    │
    │ invoke('flow_trace_proc', {...}) | invoke('flow_trace_sql', {...})
    ▼
Rust shell (Tauri 2)
    │
    │ JSON-RPC over stdin/stdout
    ▼
Sidecar (Bun + node-oracledb Thin)
    sidecar/src/flow.ts (NEW)
        ├─ traceProc({owner, name, args, maxSteps, timeoutMs}) → TraceResult
        └─ explainPlanFlow({sql, withRuntimeStats}) → TraceResult
```

The sidecar produces a complete `TraceResult` once. The frontend stores it in a Svelte 5 rune store and navigates locally.

## Data model

A single `TraceResult` schema covers both PL/SQL and SQL — the frontend renders differently based on `event.kind`.

```typescript
type TraceEvent =
  | {
      kind: "plsql.frame";
      stepIndex: number;                                // 0-based, monotonic
      objectOwner: string;                              // e.g. "HR"
      objectName: string;                               // proc, function, or "PKG.METHOD"
      lineNumber: number;
      sourceLine: string;                               // truncated to 200 chars
      enteredAtMs: number;                              // delta from trace start
      exitedAtMs: number | null;                        // null on the last step
      stack: { name: string; line: number }[];          // call stack at this point
      variables: { name: string; type: string; value: string }[];  // each value <= 1KB
      branchTaken?: "then" | "else" | "loop" | "exit";  // optional metadata
    }
  | {
      kind: "explain.node";
      stepIndex: number;                                // 0-based, in execution order (leaf-first)
      planId: number;                                   // PLAN_TABLE.id or V$SQL_PLAN.id
      operation: string;                                // "TABLE ACCESS FULL", "HASH JOIN", etc.
      objectOwner: string | null;
      objectName: string | null;
      cost: number | null;
      cardinalityEstimated: number | null;
      cardinalityActual: number | null;                 // populated only when withRuntimeStats=true
      bytesEstimated: number | null;
      elapsedMsActual: number | null;                   // populated only with stats
      bufferGets: number | null;                        // populated only with stats
      childIds: number[];                               // for edge-drawing in the SVG
    };

type TraceResult = {
  kind: "plsql" | "sql";
  startedAt: string;                                    // ISO 8601 UTC
  totalElapsedMs: number;
  events: TraceEvent[];
  finalResult?: { rowCount?: number; outBinds?: Record<string, unknown> };
  truncated?: boolean;                                  // true if hit maxSteps cap
  error?: { code: number; message: string; atStep?: number };
};
```

### Constraints

- `events.length` ≤ 5000 (configurable). If the trace would exceed this, the trace stops, `truncated: true` is set, and the panel shows a "trace was truncated" badge.
- Each variable value is truncated to 1KB. Total variables payload per step capped at 64KB.
- Source lines truncated to 200 characters (continuation marker if truncated).

## Sidecar capture

### `traceProc()` — PL/SQL

```typescript
async function traceProc(p: {
  owner: string;
  name: string;
  args: Record<string, unknown>;
  maxSteps?: number;            // default 5000
  timeoutMs?: number;            // default 60_000
}): Promise<TraceResult> {
  // 1. Open DebugSession (reuses sidecar/src/debug.ts).
  // 2. Set breakpoint at line 1 of the entry object.
  // 3. Loop:
  //    - synchronizeWithTimeout — wait for first paused frame
  //    - capture: line, frame stack, variable values, sourceLine
  //    - push TraceEvent to events[]
  //    - if events.length >= maxSteps, set truncated=true and break
  //    - safeStep(BREAK_ANY_LINE) — advance one line
  // 4. On completion / error / cancel: session.stop() releases both Oracle connections.
  // 5. Return TraceResult.
}
```

**Reused infrastructure** (no new files in `sidecar/src/debug.ts`):
- `DebugSession.create()` — opens 2 Oracle connections (target + debug).
- `setBreakpoint()` — entry breakpoint.
- `safeStep(BREAK_ANY_LINE)` — already exists; loops one line at a time.
- `getValuesForVars()` — captures variable snapshot.
- `closingPromise()` — guarantees connections actually closed.

This is essentially the same code path as the interactive debugger, but driven from Rust → sidecar without the user clicking step buttons. The "trace mode" is just headless step-through with capture.

### `explainPlanFlow()` — SQL

Two modes:

**Static (default, no execution):**
1. Run `EXPLAIN PLAN SET STATEMENT_ID = '<sid>' FOR <user-sql>` — uses the existing safe `explainPlan()` from `oracle.ts` (which already validates single-statement and rejects DDL).
2. Read `PLAN_TABLE` rows, sort by execution order (post-order traversal of the parent_id tree).
3. Convert each row to `TraceEvent { kind: "explain.node", cardinalityActual: null, elapsedMsActual: null, bufferGets: null }`.

**With runtime stats** (`withRuntimeStats: true`):
1. `ALTER SESSION SET STATISTICS_LEVEL = ALL` (session-scoped).
2. Execute the user's SQL with `/*+ GATHER_PLAN_STATISTICS */` hint.
3. After execution, query `V$SQL_PLAN_STATISTICS_ALL` for the cursor (lookup via `V$SESSION` + `PREV_SQL_ID`).
4. Combine with plan rows from `V$SQL_PLAN` for the operation tree.
5. Convert to `TraceEvent` with `cardinalityActual`, `elapsedMsActual`, `bufferGets` populated.

### Privileges required

- **PL/SQL trace:** `DEBUG ANY PROCEDURE` or `DEBUG CONNECT SESSION` on target schema (same as the existing debugger).
- **SQL static:** `SELECT_CATALOG_ROLE` (already required for EXPLAIN). No extra privileges.
- **SQL runtime stats:** `SELECT_CATALOG_ROLE` + `ALTER SESSION` (default for any user). No extra privileges. If V$SQL_PLAN_STATISTICS_ALL is denied, the trace silently falls back to static mode.

## Frontend components

```
src/lib/workspace/
├── VisualFlowPanel.svelte             (side panel container, header, resize handle)
├── VisualFlowGraph.svelte              (SVG renderer — vertical flow, scrollable)
├── VisualFlowNode.svelte               (single step node — used inside Graph)
├── VisualFlowControls.svelte           (NEXT/PREV/play/scrub bar, keyboard shortcut handler)
└── VisualFlowVariablesView.svelte      (collapsible variables panel for current step)

src/lib/stores/
└── visual-flow.svelte.ts               ($state holder: currentTrace, currentStepIndex, isPlaying)
```

### Side panel layout

- Width: 320px default, user-resizable 280–600px (saved per-workspace).
- Position: docked right (workspace gets squished horizontally).
- Header: title, close (×), expand-to-modal (▢), minimize (–).
- Body sections (top→bottom):
  1. SVG flow graph (scrollable vertical)
  2. Sticky info bar: `Step N/M — <operation> — <elapsed> · <line>`
  3. Variables panel (collapsible, default open for PL/SQL, collapsed for SQL)
  4. Controls: PREV, play/pause, NEXT, scrubber

### Visual style (matches existing app)

- Current step: orange accent `#e8643a` (the brand color).
- Visited steps: dimmed text on `#3b3837` background.
- Pending steps: outline-only, very low contrast.
- Operation-specific tints (SQL EXPLAIN nodes only):
  - TABLE ACCESS — green `#8bc4a8`
  - INDEX — blue `#7aa8c4`
  - JOIN — amber `#c3a66e`
  - SORT/AGG — pink `#c4869b`
- Error: red `#c44a4a` with X-mark icon.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `→` or `Space` | NEXT |
| `←` or `Backspace` | PREV |
| `Home` | First step |
| `End` | Last step |
| `Esc` | Close panel |
| `Cmd/Ctrl + .` | Pause autoplay if running |
| `P` | Toggle autoplay |

### Integration points

- New button **▶ Run with Visual Flow** placed:
  - In `ProcExecModal.svelte` next to the existing Run button.
  - In `SqlEditor.svelte` next to the existing EXPLAIN button.
- The button is disabled when no workspace is open (no active connection).
- Panel state (open/closed/width) persists per workspace tab via the existing dashboard store pattern.

## Error handling

| Scenario | Behavior |
|---|---|
| Procedure not compiled with debug | Inline tip in panel: "Object lacks debug symbols. Recompile with `ALTER ... COMPILE DEBUG;`" plus a one-click button to issue that ALTER. |
| Trace exceeds 5000 steps | Stop, set `truncated: true`, render visible portion, show banner: "Trace truncated at 5000 steps. Future versions will support range-of-lines selection." |
| Trace timeout (60s) | Abort, return partial trace, banner: "Trace timed out at <N> steps". |
| EXPLAIN PLAN failed | Render error panel with Oracle code + message; no fluxo. |
| `V$SQL_PLAN_STATISTICS_ALL` denied | Silently fall back to static EXPLAIN. Banner: "Runtime stats unavailable — showing static plan." |
| User cancels mid-trace | `DebugSession.stop()` releases both connections; partial trace returned. |
| Variable value > 1KB | Truncated at 1KB, suffix `…(<actual-bytes> total, truncated)`. |
| Variable type unsupported (LOB, REF CURSOR, OBJECT) | Shown as `<type>` placeholder; no value capture. |
| No active connection | Button is disabled with tooltip "Open a workspace first". |
| Proc has no parameters in input args | Trace runs with empty bind set; debugger handles defaults. |

## Testing strategy

### Unit tests (sidecar)

`sidecar/tests/flow.test.ts`:

- Schema validation — `TraceEvent` shapes for both kinds.
- Variable truncation — value over 1KB gets cut.
- Source line truncation — line over 200 chars gets cut.
- Truncation flag — events array hits 5000, `truncated: true` set.
- Mocked `oracledb` for happy path (proc returns trace, SQL returns plan).
- Error paths — ORA-00942 in EXPLAIN, debugger fails to attach.
- Privilege fallback — V$SQL_PLAN_STATISTICS_ALL denial returns static result.

### Unit tests (frontend)

`src/lib/workspace/VisualFlowPanel.test.ts`:

- Renders both PL/SQL and SQL traces from fixtures.
- NEXT advances `currentStepIndex` and rerenders.
- PREV decrements.
- Keyboard shortcuts fire actions.
- Esc closes panel.
- Resize handle updates width and persists to store.
- Truncated trace shows the banner.
- Error trace shows the error block.

### Integration test (Oracle 23ai container)

`sidecar/tests/flow.integration.test.ts`:

- Pre-canned procedure: `validate_record` with 3 paths (success / not-found / error). Trace each, assert event count and structure.
- Pre-canned SQL: simple SELECT, JOIN, JOIN with index. EXPLAIN flow returns expected operation order.
- With `withRuntimeStats: true`: `cardinalityActual` is non-null and matches actual rows.

## Implementation phases

### Phase A — sidecar trace producers (~3-4 days)

1. Create `sidecar/src/flow.ts` with `traceProc` and `explainPlanFlow` skeletons.
2. Implement `traceProc` using the existing `DebugSession` infrastructure.
3. Implement `explainPlanFlow` static mode (reuses `explainPlan` from `oracle.ts`).
4. Implement `explainPlanFlow` runtime-stats mode.
5. Wire RPC handlers in `sidecar/src/index.ts`.
6. Unit tests in `sidecar/tests/flow.test.ts`.

### Phase B — Tauri commands (~half day)

1. Add `flow_trace_proc` and `flow_trace_sql` commands in `src-tauri/src/commands.rs`.
2. Register them in `lib.rs` `invoke_handler`.

### Phase C — Frontend store + panel container (~1 day)

1. Create `src/lib/stores/visual-flow.svelte.ts`.
2. Create `src/lib/workspace/VisualFlowPanel.svelte` with header and stub body.
3. Wire close/expand/minimize buttons.

### Phase D — Frontend graph + controls (~2 days)

1. Create `VisualFlowGraph.svelte` (SVG).
2. Create `VisualFlowNode.svelte`.
3. Create `VisualFlowControls.svelte` with keyboard shortcut binding.
4. Create `VisualFlowVariablesView.svelte`.
5. Integrate the four into `VisualFlowPanel.svelte`.

### Phase E — Integration buttons (~half day)

1. Add **Run with Visual Flow** button in `ProcExecModal.svelte`.
2. Add **EXPLAIN with Visual Flow** button in `SqlEditor.svelte` toolbar.
3. Wire to invoke commands; on result, open the side panel.

### Phase F — Testing & polish (~1-2 days)

1. Frontend unit tests with `@testing-library/svelte`.
2. Integration test against Oracle 23ai container.
3. Manual smoke testing: 5 different procedure shapes, 5 different SQL shapes.
4. CSS dark-mode review (use `--bg-surface`, `--bg-surface-alt`, `--text-primary` per CLAUDE.md).

**Total estimate:** 8-10 working days, single developer.

## Open questions

None at design-approval time — all major architectural decisions resolved during the brainstorm:

- Capture mechanism: **hybrid static + debugger trace** (P1: E)
- Animation: **step-through interactive** (P2: B)
- SQL plan: **static + optional runtime stats** (P3: E3)
- Layout: **side panel right** (P4: C)
- Step model: **trace-and-replay** (P5: T1)
- MVP scope: **S1 — SQL hybrid + PL/SQL T1** (no static-only PL/SQL parser in MVP)

## References

- Existing debugger: `sidecar/src/debug.ts` (`DebugSession`, `safeStep`, `getValuesForVars`)
- Existing EXPLAIN: `sidecar/src/oracle.ts` `explainPlan()` (post-validation refactor)
- Existing tree UI: `src/lib/workspace/ExplainPlan.svelte` — reference for visual style
- Existing graph UI: `src/lib/workspace/DataFlow.svelte` — reference for SVG/HTML layout patterns
- Brainstorm session: 2026-04-25 (this conversation)
