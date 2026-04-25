# Visual Execution Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a side-panel visualization that animates the execution flow of a PL/SQL procedure/function or a SQL statement's EXPLAIN PLAN, step-by-step, with NEXT/PREV navigation. Trace is captured once and replayed locally.

**Architecture:** Sidecar produces a complete `TraceResult` via the existing PL/SQL debugger (`DBMS_DEBUG_JDWP`) for procedures, or via EXPLAIN PLAN (+ optional `GATHER_PLAN_STATISTICS`) for SQL. Frontend stores the trace in a Svelte 5 rune store, and a vertical SVG side panel lets the user navigate steps locally with no Oracle round-trips.

**Tech Stack:** Bun + TypeScript (sidecar), node-oracledb Thin (Oracle), Tauri 2 (Rust shell), SvelteKit 5 + Svelte 5 runes (frontend), Vitest + @testing-library/svelte (frontend tests), `bun test` (sidecar tests).

**Spec reference:** `docs/superpowers/specs/2026-04-25-visual-execution-flow-design.md`

---

## File map

**New files (sidecar):**
- `sidecar/src/flow-types.ts` — TraceEvent, TraceResult, TraceProcParams, TraceSqlParams type definitions
- `sidecar/src/flow.ts` — `traceProc`, `explainPlanFlow` implementation
- `sidecar/tests/flow.test.ts` — unit tests with mocked oracledb
- `sidecar/tests/flow.integration.test.ts` — integration test against Oracle 23ai container

**New files (frontend):**
- `src/lib/stores/visual-flow.svelte.ts` — Svelte 5 store holding current trace + step index + panel UI state
- `src/lib/stores/visual-flow.test.ts` — store tests
- `src/lib/workspace/VisualFlowPanel.svelte` — side panel container
- `src/lib/workspace/VisualFlowPanel.test.ts` — panel render + interaction tests
- `src/lib/workspace/VisualFlowGraph.svelte` — vertical SVG flow graph
- `src/lib/workspace/VisualFlowNode.svelte` — single step node
- `src/lib/workspace/VisualFlowControls.svelte` — NEXT/PREV/play/scrub controls + keyboard shortcuts
- `src/lib/workspace/VisualFlowVariablesView.svelte` — variables panel for current step

**Modified files:**
- `sidecar/src/index.ts` — add `flow.trace_proc` and `flow.trace_sql` RPC handlers
- `src-tauri/src/commands.rs` — add `flow_trace_proc` and `flow_trace_sql` Tauri commands
- `src-tauri/src/lib.rs` — register the two new commands in `invoke_handler`
- `src/lib/workspace.ts` — export `flowTraceProc` and `flowTraceSql` invoke wrappers
- `src/lib/workspace/ProcExecModal.svelte` — add "Run with Visual Flow" button
- `src/lib/workspace/SqlEditor.svelte` — add "EXPLAIN with Visual Flow" button

---

## Test running quick reference

| Layer | Command | Where |
|---|---|---|
| Sidecar unit | `bun test` | `cd sidecar && bun test sidecar/tests/flow.test.ts` |
| Sidecar integration | `bun test` | `cd sidecar && bun test sidecar/tests/flow.integration.test.ts` (needs Oracle container) |
| Frontend unit | `bun run test` | repo root |
| Rust build | `cargo build` | `cd src-tauri && cargo build` |
| Rust test | `cargo test --lib` | `cd src-tauri && cargo test --lib` |
| Type check | `bun run check` | repo root |

---

## Task 1: Sidecar types — `flow-types.ts`

**Files:**
- Create: `sidecar/src/flow-types.ts`

- [ ] **Step 1: Create the type module**

Write the file with the complete type definitions:

```typescript
// sidecar/src/flow-types.ts
//
// Shared types between flow.ts (capture) and the RPC boundary (consumed
// by Rust + frontend). Keep this file small and dependency-free so the
// RPC schema stays decoupled from oracledb.

export type StackEntry = { name: string; line: number };

export type Variable = {
  name: string;
  type: string;
  value: string;
};

export type PlsqlFrameEvent = {
  kind: "plsql.frame";
  stepIndex: number;
  objectOwner: string;
  objectName: string;
  lineNumber: number;
  sourceLine: string;
  enteredAtMs: number;
  exitedAtMs: number | null;
  stack: StackEntry[];
  variables: Variable[];
  branchTaken?: "then" | "else" | "loop" | "exit";
};

export type ExplainNodeEvent = {
  kind: "explain.node";
  stepIndex: number;
  planId: number;
  operation: string;
  objectOwner: string | null;
  objectName: string | null;
  cost: number | null;
  cardinalityEstimated: number | null;
  cardinalityActual: number | null;
  bytesEstimated: number | null;
  elapsedMsActual: number | null;
  bufferGets: number | null;
  childIds: number[];
};

export type TraceEvent = PlsqlFrameEvent | ExplainNodeEvent;

export type TraceResult = {
  kind: "plsql" | "sql";
  startedAt: string;
  totalElapsedMs: number;
  events: TraceEvent[];
  finalResult?: {
    rowCount?: number;
    outBinds?: Record<string, unknown>;
  };
  truncated?: boolean;
  error?: { code: number; message: string; atStep?: number };
};

export type TraceProcParams = {
  owner: string;
  name: string;
  args: Record<string, unknown>;
  maxSteps?: number;
  timeoutMs?: number;
};

export type TraceSqlParams = {
  sql: string;
  withRuntimeStats?: boolean;
};

// Truncation budgets — exposed so tests can verify them.
export const MAX_VAR_VALUE_BYTES = 1024;
export const MAX_STEP_VARIABLES_BYTES = 64 * 1024;
export const SOURCE_LINE_MAX_CHARS = 200;
export const DEFAULT_MAX_STEPS = 5000;
export const DEFAULT_TIMEOUT_MS = 60_000;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd sidecar && bun -e 'import type { TraceResult } from "./src/flow-types"; const r: TraceResult = { kind: "plsql", startedAt: "x", totalElapsedMs: 0, events: [] }; console.log("ok");'
```
Expected: prints `ok` (no compile errors).

- [ ] **Step 3: Commit**

```bash
git add sidecar/src/flow-types.ts
git commit -m "feat(flow): add TraceEvent/TraceResult type definitions"
```

---

## Task 2: Truncation helpers in `flow.ts`

**Files:**
- Create: `sidecar/src/flow.ts` (add helpers only — full implementation in later tasks)
- Create: `sidecar/tests/flow.test.ts`

- [ ] **Step 1: Write failing tests for truncation helpers**

Write `sidecar/tests/flow.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
  truncateValue,
  truncateSourceLine,
  truncateVariablesForStep,
} from "../src/flow";
import {
  MAX_VAR_VALUE_BYTES,
  MAX_STEP_VARIABLES_BYTES,
  SOURCE_LINE_MAX_CHARS,
} from "../src/flow-types";

describe("truncateValue", () => {
  it("returns short values unchanged", () => {
    expect(truncateValue("hello")).toBe("hello");
  });

  it("truncates to MAX_VAR_VALUE_BYTES with marker", () => {
    const big = "x".repeat(MAX_VAR_VALUE_BYTES + 100);
    const result = truncateValue(big);
    expect(result.length).toBeLessThanOrEqual(MAX_VAR_VALUE_BYTES + 50);
    expect(result).toMatch(/…\(\d+ total, truncated\)$/);
  });

  it("handles null and undefined as empty", () => {
    expect(truncateValue(null)).toBe("");
    expect(truncateValue(undefined)).toBe("");
  });
});

describe("truncateSourceLine", () => {
  it("returns short lines unchanged", () => {
    expect(truncateSourceLine("SELECT * FROM dual")).toBe("SELECT * FROM dual");
  });

  it("truncates to SOURCE_LINE_MAX_CHARS with ellipsis", () => {
    const long = "a".repeat(SOURCE_LINE_MAX_CHARS + 50);
    const result = truncateSourceLine(long);
    expect(result.length).toBe(SOURCE_LINE_MAX_CHARS + 1);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("truncateVariablesForStep", () => {
  it("returns variables unchanged when under budget", () => {
    const vars = [
      { name: "a", type: "NUMBER", value: "1" },
      { name: "b", type: "VARCHAR2", value: "hi" },
    ];
    expect(truncateVariablesForStep(vars)).toEqual(vars);
  });

  it("drops trailing variables when total payload exceeds 64KB", () => {
    const big = "x".repeat(800);
    const vars = Array.from({ length: 100 }, (_, i) => ({
      name: `v${i}`,
      type: "VARCHAR2",
      value: big,
    }));
    const result = truncateVariablesForStep(vars);
    const totalBytes = result.reduce(
      (sum, v) => sum + v.name.length + v.type.length + v.value.length,
      0,
    );
    expect(totalBytes).toBeLessThanOrEqual(MAX_STEP_VARIABLES_BYTES);
    const last = result[result.length - 1];
    expect(last.name).toBe("__truncated__");
    expect(last.value).toMatch(/^\d+ more variables omitted$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd sidecar && bun test tests/flow.test.ts
```
Expected: FAIL with "Cannot find module '../src/flow'" or equivalent.

- [ ] **Step 3: Implement helpers in `flow.ts`**

Create `sidecar/src/flow.ts`:

```typescript
// sidecar/src/flow.ts
//
// Visual execution flow capture — produces a complete TraceResult that
// the frontend replays locally without further Oracle round-trips.
//
// Reuses the existing DBMS_DEBUG_JDWP infrastructure in debug.ts for
// PL/SQL traces, and the EXPLAIN PLAN path in oracle.ts for SQL traces.

import {
  MAX_VAR_VALUE_BYTES,
  MAX_STEP_VARIABLES_BYTES,
  SOURCE_LINE_MAX_CHARS,
  type Variable,
} from "./flow-types";

export function truncateValue(s: string | null | undefined): string {
  if (s === null || s === undefined) return "";
  if (s.length <= MAX_VAR_VALUE_BYTES) return s;
  const totalBytes = s.length;
  const head = s.slice(0, MAX_VAR_VALUE_BYTES);
  return `${head}…(${totalBytes} total, truncated)`;
}

export function truncateSourceLine(s: string): string {
  if (s.length <= SOURCE_LINE_MAX_CHARS) return s;
  return s.slice(0, SOURCE_LINE_MAX_CHARS) + "…";
}

export function truncateVariablesForStep(vars: Variable[]): Variable[] {
  let used = 0;
  const out: Variable[] = [];
  for (let i = 0; i < vars.length; i++) {
    const v = vars[i];
    const truncatedValue = truncateValue(v.value);
    const size = v.name.length + v.type.length + truncatedValue.length;
    if (used + size > MAX_STEP_VARIABLES_BYTES) {
      const remaining = vars.length - i;
      out.push({
        name: "__truncated__",
        type: "marker",
        value: `${remaining} more variables omitted`,
      });
      return out;
    }
    used += size;
    out.push({ ...v, value: truncatedValue });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd sidecar && bun test tests/flow.test.ts
```
Expected: PASS — 7 expectations across 3 describe blocks.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/flow.ts sidecar/tests/flow.test.ts
git commit -m "feat(flow): truncation helpers for variables, source lines, per-step payload"
```

---

## Task 3: `traceProc` happy-path implementation

**Files:**
- Modify: `sidecar/src/flow.ts` (add `traceProc` function)
- Modify: `sidecar/tests/flow.test.ts` (add test using a stubbed DebugSession)

- [ ] **Step 1: Write a failing test for `traceProc`**

Append to `sidecar/tests/flow.test.ts`:

```typescript
import { traceProc } from "../src/flow";
import type { PlsqlFrameEvent, TraceResult } from "../src/flow-types";
import { mock } from "bun:test";

describe("traceProc", () => {
  it("captures one event per debugger step until completion", async () => {
    // Stub the debug-session factory so the test does not touch Oracle.
    // The harness exposes a setter — see "Step 3" for the implementation.
    const fakeSteps = [
      { line: 1, owner: "HR", objectName: "VALIDATE", objectType: "PROCEDURE", vars: [{ name: "p_id", type: "NUMBER", value: "100" }] },
      { line: 2, owner: "HR", objectName: "VALIDATE", objectType: "PROCEDURE", vars: [{ name: "p_id", type: "NUMBER", value: "100" }, { name: "v_count", type: "NUMBER", value: "0" }] },
      { line: 3, owner: "HR", objectName: "VALIDATE", objectType: "PROCEDURE", vars: [{ name: "p_id", type: "NUMBER", value: "100" }, { name: "v_count", type: "NUMBER", value: "5" }] },
    ];
    setTraceProcDebugSessionFactoryForTest(() => createFakeDebugSession(fakeSteps));

    const result: TraceResult = await traceProc({
      owner: "HR",
      name: "VALIDATE",
      args: { p_id: 100 },
      maxSteps: 100,
      timeoutMs: 5000,
    });

    expect(result.kind).toBe("plsql");
    expect(result.events).toHaveLength(3);
    expect(result.events[0].stepIndex).toBe(0);
    expect(result.events[2].stepIndex).toBe(2);
    const last = result.events[2] as PlsqlFrameEvent;
    expect(last.lineNumber).toBe(3);
    expect(last.variables.find(v => v.name === "v_count")?.value).toBe("5");
    expect(result.truncated).toBeFalsy();
    expect(result.error).toBeUndefined();

    setTraceProcDebugSessionFactoryForTest(null);
  });
});

// Test harness helpers — defined in the same file so the test stays local.
type FakeStep = {
  line: number;
  owner: string;
  objectName: string;
  objectType: string;
  vars: Variable[];
};
type FakeDebugSession = {
  initialize(): Promise<string>;
  setBreakpoint(o: string, n: string, t: string, l: number): Promise<number>;
  startTarget(s: string, b: Record<string, unknown>, c: string[]): void;
  synchronizeWithTimeout(ms: number): Promise<{ status: "paused" | "completed"; frame: { owner: string; objectName: string; objectType: string; line: number } | null; reason: number }>;
  continueExecution(flags: number): Promise<{ status: "paused" | "completed"; frame: { owner: string; objectName: string; objectType: string; line: number } | null; reason: number }>;
  getValuesForVars(names: string[]): Promise<Variable[]>;
  getCallStack(): Promise<{ owner: string; objectName: string; objectType: string; line: number }[]>;
  stop(): void;
  closingPromise(): Promise<void>;
};

import { setTraceProcDebugSessionFactoryForTest } from "../src/flow";

function createFakeDebugSession(steps: FakeStep[]): FakeDebugSession {
  let i = -1;
  const advance = (): { status: "paused" | "completed"; frame: any; reason: number } => {
    i++;
    if (i >= steps.length) return { status: "completed", frame: null, reason: 15 };
    const s = steps[i];
    return { status: "paused", frame: { owner: s.owner, objectName: s.objectName, objectType: s.objectType, line: s.line }, reason: 1 };
  };
  return {
    initialize: async () => "fake-sid",
    setBreakpoint: async () => 1,
    startTarget: () => {},
    synchronizeWithTimeout: async () => advance(),
    continueExecution: async () => advance(),
    getValuesForVars: async () => steps[Math.max(0, i)]?.vars ?? [],
    getCallStack: async () => (i >= 0 && i < steps.length ? [{ owner: steps[i].owner, objectName: steps[i].objectName, objectType: steps[i].objectType, line: steps[i].line }] : []),
    stop: () => {},
    closingPromise: async () => {},
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd sidecar && bun test tests/flow.test.ts
```
Expected: FAIL with `traceProc is not a function` or `setTraceProcDebugSessionFactoryForTest is not exported`.

- [ ] **Step 3: Implement `traceProc` and the test seam in `flow.ts`**

Append to `sidecar/src/flow.ts`:

```typescript
import type { StackEntry, TraceResult, PlsqlFrameEvent, TraceProcParams } from "./flow-types";
import { DEFAULT_MAX_STEPS, DEFAULT_TIMEOUT_MS } from "./flow-types";
import { DebugSession as RealDebugSession } from "./debug";

// Constants from debug.ts (kept inline here so we don't widen its public API).
const BREAK_ANY_CALL = 6; // step into = stop at next line + enter any call

// Test seam: tests can swap the DebugSession factory with a fake.
// In production this is null and we use RealDebugSession.create directly.
type DebugSessionFactory = () => Promise<any> | any;
let _debugSessionFactoryForTest: DebugSessionFactory | null = null;
export function setTraceProcDebugSessionFactoryForTest(f: DebugSessionFactory | null): void {
  _debugSessionFactoryForTest = f;
}

async function createDebugSession() {
  if (_debugSessionFactoryForTest) {
    return await _debugSessionFactoryForTest();
  }
  return await RealDebugSession.create();
}

function buildAnonymousBlock(owner: string, name: string, args: Record<string, unknown>): string {
  const argList = Object.keys(args)
    .map((k) => `${k} => :${k}`)
    .join(", ");
  return argList.length > 0
    ? `BEGIN ${owner}.${name}(${argList}); END;`
    : `BEGIN ${owner}.${name}; END;`;
}

export async function traceProc(p: TraceProcParams): Promise<TraceResult> {
  const maxSteps = p.maxSteps ?? DEFAULT_MAX_STEPS;
  const timeoutMs = p.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const events: PlsqlFrameEvent[] = [];

  const session = await createDebugSession();
  let traceTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let traceTimedOut = false;

  try {
    await session.initialize();
    await session.setBreakpoint(p.owner.toUpperCase(), p.name.toUpperCase(), "PROCEDURE", 1);
    const block = buildAnonymousBlock(p.owner, p.name, p.args);
    session.startTarget(block, p.args, []);

    // Trace timeout begins AFTER the entry breakpoint hits (per spec §5).
    let info = await session.synchronizeWithTimeout(30_000);

    traceTimeoutHandle = setTimeout(() => { traceTimedOut = true; }, timeoutMs);

    // MVP variable strategy: poll the procedure parameter names at every step.
    // This keeps the trace useful (the user sees parameter values flow through)
    // without requiring a PL/SQL parser. Local v_* discovery is deferred to v0.4.
    const candidateNames = Object.keys(p.args);

    let stepIndex = 0;
    while (info.status === "paused" && info.frame !== null) {
      if (traceTimedOut) break;
      if (events.length >= maxSteps) break;

      const frame = info.frame;
      const vars = await safeGetVars(session, candidateNames);
      const stack = await safeGetCallStack(session);
      const sourceLine = "";

      const event: PlsqlFrameEvent = {
        kind: "plsql.frame",
        stepIndex,
        objectOwner: frame.owner,
        objectName: frame.objectName,
        lineNumber: frame.line,
        sourceLine: truncateSourceLine(sourceLine),
        enteredAtMs: Date.now() - startedAtMs,
        exitedAtMs: null,
        stack,
        variables: truncateVariablesForStep(vars),
      };
      if (events.length > 0) {
        events[events.length - 1].exitedAtMs = event.enteredAtMs;
      }
      events.push(event);
      stepIndex++;

      info = await session.continueExecution(BREAK_ANY_CALL);
    }
  } finally {
    if (traceTimeoutHandle !== null) clearTimeout(traceTimeoutHandle);
    session.stop();
    await session.closingPromise();
  }

  const totalElapsedMs = Date.now() - startedAtMs;
  const truncated = events.length >= maxSteps;
  const result: TraceResult = {
    kind: "plsql",
    startedAt,
    totalElapsedMs,
    events,
  };
  if (truncated) result.truncated = true;
  if (traceTimedOut) {
    result.error = { code: -32004, message: `Trace timed out after ${timeoutMs}ms`, atStep: events.length };
  }
  return result;
}

async function safeGetVars(
  session: any,
  candidateNames: string[],
): Promise<Variable[]> {
  if (candidateNames.length === 0) return [];
  try {
    const vals = await session.getValuesForVars(candidateNames);
    // session.getValuesForVars returns { name, value } — promote to full Variable shape.
    return (vals ?? []).map((v: any) => ({
      name: v.name,
      type: "VARCHAR2",
      value: v.value === null || v.value === undefined ? "" : String(v.value),
    }));
  } catch {
    return [];
  }
}

async function safeGetCallStack(session: any): Promise<StackEntry[]> {
  try {
    const frames = await session.getCallStack();
    return frames.map((f: any) => ({ name: f.objectName, line: f.line }));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd sidecar && bun test tests/flow.test.ts
```
Expected: PASS — `traceProc` test passes with 3 events captured.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/flow.ts sidecar/tests/flow.test.ts
git commit -m "feat(flow): traceProc happy path — capture per-line events from DebugSession"
```

---

## Task 4: `traceProc` truncation, timeout, and error paths

**Files:**
- Modify: `sidecar/tests/flow.test.ts` (add 3 tests)

- [ ] **Step 1: Write failing tests for truncation, timeout, debugger-failed**

Append to `sidecar/tests/flow.test.ts`:

```typescript
describe("traceProc edge cases", () => {
  it("sets truncated=true when events exceeds maxSteps", async () => {
    const lots: FakeStep[] = Array.from({ length: 20 }, (_, i) => ({
      line: i + 1,
      owner: "HR",
      objectName: "VALIDATE",
      objectType: "PROCEDURE",
      vars: [],
    }));
    setTraceProcDebugSessionFactoryForTest(() => createFakeDebugSession(lots));
    const result = await traceProc({ owner: "HR", name: "VALIDATE", args: {}, maxSteps: 5, timeoutMs: 5000 });
    expect(result.events).toHaveLength(5);
    expect(result.truncated).toBe(true);
    setTraceProcDebugSessionFactoryForTest(null);
  });

  it("sets error.code=-32004 when timeoutMs elapses", async () => {
    // Fake session that pauses 100ms per step → timeout 50ms triggers immediately.
    const slowFactory = () => {
      let i = -1;
      return {
        initialize: async () => "x",
        setBreakpoint: async () => 1,
        startTarget: () => {},
        synchronizeWithTimeout: async () => { i++; await new Promise((r) => setTimeout(r, 100)); return { status: "paused", frame: { owner: "HR", objectName: "X", objectType: "PROCEDURE", line: i + 1 }, reason: 1 }; },
        continueExecution: async () => { i++; await new Promise((r) => setTimeout(r, 100)); return { status: "paused", frame: { owner: "HR", objectName: "X", objectType: "PROCEDURE", line: i + 1 }, reason: 1 }; },
        getValuesForVars: async () => [],
        getCallStack: async () => [],
        stop: () => {},
        closingPromise: async () => {},
      };
    };
    setTraceProcDebugSessionFactoryForTest(slowFactory);
    const result = await traceProc({ owner: "HR", name: "X", args: {}, maxSteps: 100, timeoutMs: 50 });
    expect(result.error?.code).toBe(-32004);
    expect(result.error?.message).toMatch(/timed out/i);
    setTraceProcDebugSessionFactoryForTest(null);
  });

  it("returns error when DebugSession.initialize throws (object not compiled with debug)", async () => {
    const failingFactory = () => ({
      initialize: async () => { throw new Error("ORA-00904: invalid identifier"); },
      stop: () => {},
      closingPromise: async () => {},
    });
    setTraceProcDebugSessionFactoryForTest(failingFactory as any);
    let caught: unknown = null;
    try {
      await traceProc({ owner: "HR", name: "X", args: {}, maxSteps: 100, timeoutMs: 5000 });
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(String(caught)).toMatch(/ORA-00904/);
    setTraceProcDebugSessionFactoryForTest(null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd sidecar && bun test tests/flow.test.ts -t "traceProc edge cases"
```
Expected: 1 of 3 tests pass (truncation already works); 2 fail (timeout test may behave inconsistently and initialize-throws test expects propagation).

- [ ] **Step 3: Update `traceProc` to handle initialize failures cleanly**

Modify `sidecar/src/flow.ts` — replace the `try { ... } finally { ... }` body with explicit init handling. Find:

```typescript
  try {
    await session.initialize();
    await session.setBreakpoint(p.owner.toUpperCase(), p.name.toUpperCase(), "PROCEDURE", 1);
```

Replace with:

```typescript
  try {
    try {
      await session.initialize();
    } catch (e) {
      // Cleanly tear down before propagating — initialize failure means no
      // further session operations are valid. Re-throw so callers see the Oracle error.
      session.stop();
      await session.closingPromise();
      throw e;
    }
    await session.setBreakpoint(p.owner.toUpperCase(), p.name.toUpperCase(), "PROCEDURE", 1);
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd sidecar && bun test tests/flow.test.ts
```
Expected: all 4 traceProc tests pass.

- [ ] **Step 5: Commit**

```bash
git add sidecar/tests/flow.test.ts sidecar/src/flow.ts
git commit -m "feat(flow): traceProc truncation, timeout, init-failure paths"
```

---

## Task 5: `explainPlanFlow` — static mode

**Files:**
- Modify: `sidecar/src/flow.ts` (add `explainPlanFlow` function)
- Modify: `sidecar/tests/flow.test.ts` (add test using stubbed `explainPlan`)

- [ ] **Step 1: Write failing test for explainPlanFlow static**

Append to `sidecar/tests/flow.test.ts`:

```typescript
import { explainPlanFlow, setExplainPlanForTest } from "../src/flow";

describe("explainPlanFlow static mode", () => {
  it("returns plan nodes ordered leaf-first", async () => {
    setExplainPlanForTest(async () => ({
      nodes: [
        { id: 0, parentId: null, operation: "SELECT STATEMENT", options: null, objectName: null, objectOwner: null, cost: 5, cardinality: 100, bytes: 200, accessPredicates: null, filterPredicates: null },
        { id: 1, parentId: 0, operation: "HASH JOIN", options: null, objectName: null, objectOwner: null, cost: 5, cardinality: 100, bytes: 200, accessPredicates: null, filterPredicates: null },
        { id: 2, parentId: 1, operation: "TABLE ACCESS", options: "FULL", objectName: "EMP", objectOwner: "HR", cost: 2, cardinality: 14, bytes: 70, accessPredicates: null, filterPredicates: null },
        { id: 3, parentId: 1, operation: "TABLE ACCESS", options: "FULL", objectName: "DEPT", objectOwner: "HR", cost: 2, cardinality: 4, bytes: 30, accessPredicates: null, filterPredicates: null },
      ],
    }));

    const result = await explainPlanFlow({ sql: "SELECT 1 FROM DUAL", withRuntimeStats: false });
    expect(result.kind).toBe("sql");
    expect(result.events).toHaveLength(4);
    // Leaf-first order: TABLE ACCESS (2 or 3) → other TABLE ACCESS → HASH JOIN → SELECT STATEMENT
    const last = result.events[3];
    if (last.kind !== "explain.node") throw new Error("expected explain.node");
    expect(last.operation).toBe("SELECT STATEMENT");
    const first = result.events[0];
    if (first.kind !== "explain.node") throw new Error("expected explain.node");
    expect(first.operation).toBe("TABLE ACCESS");
    // Runtime fields are null in static mode
    expect(first.cardinalityActual).toBeNull();
    expect(first.elapsedMsActual).toBeNull();

    setExplainPlanForTest(null);
  });

  it("propagates explainPlan errors", async () => {
    setExplainPlanForTest(async () => { throw new Error("ORA-00942: table or view does not exist"); });
    let caught: unknown = null;
    try {
      await explainPlanFlow({ sql: "SELECT 1 FROM nonexistent", withRuntimeStats: false });
    } catch (e) { caught = e; }
    expect(String(caught)).toMatch(/ORA-00942/);
    setExplainPlanForTest(null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd sidecar && bun test tests/flow.test.ts -t "explainPlanFlow static mode"
```
Expected: FAIL — `explainPlanFlow is not a function`.

- [ ] **Step 3: Implement `explainPlanFlow` static mode**

Append to `sidecar/src/flow.ts`:

```typescript
import type { ExplainNodeEvent, TraceSqlParams } from "./flow-types";
import { explainPlan as realExplainPlan } from "./oracle";

type ExplainPlanFn = (p: { sql: string }) => Promise<{ nodes: any[] }>;
let _explainPlanForTest: ExplainPlanFn | null = null;
export function setExplainPlanForTest(fn: ExplainPlanFn | null): void {
  _explainPlanForTest = fn;
}

function planExecutionOrder(nodes: any[]): any[] {
  // Oracle's PLAN_TABLE rows form a tree via parent_id. Execution order is
  // post-order: children left-to-right, then the parent. Within a sibling group
  // we keep the order Oracle returned (which mirrors id ascending and matches
  // SQL*Plus DBMS_XPLAN.DISPLAY).
  const byId = new Map<number, any>();
  const childrenOf = new Map<number | null, any[]>();
  for (const n of nodes) {
    byId.set(n.id, n);
    const arr = childrenOf.get(n.parentId) ?? [];
    arr.push(n);
    childrenOf.set(n.parentId, arr);
  }
  for (const arr of childrenOf.values()) arr.sort((a, b) => a.id - b.id);

  const out: any[] = [];
  function visit(node: any): void {
    const kids = childrenOf.get(node.id) ?? [];
    for (const k of kids) visit(k);
    out.push(node);
  }
  const roots = childrenOf.get(null) ?? [];
  for (const r of roots) visit(r);
  return out;
}

export async function explainPlanFlow(p: TraceSqlParams): Promise<TraceResult> {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const explainFn = _explainPlanForTest ?? realExplainPlan;

  const { nodes } = await explainFn({ sql: p.sql });
  const ordered = planExecutionOrder(nodes);

  const childrenOf = new Map<number | null, number[]>();
  for (const n of nodes) {
    const arr = childrenOf.get(n.parentId) ?? [];
    arr.push(n.id);
    childrenOf.set(n.parentId, arr);
  }

  const events: ExplainNodeEvent[] = ordered.map((n, idx) => ({
    kind: "explain.node",
    stepIndex: idx,
    planId: n.id,
    operation: [n.operation, n.options].filter(Boolean).join(" "),
    objectOwner: n.objectOwner ?? null,
    objectName: n.objectName ?? null,
    cost: n.cost ?? null,
    cardinalityEstimated: n.cardinality ?? null,
    cardinalityActual: null,
    bytesEstimated: n.bytes ?? null,
    elapsedMsActual: null,
    bufferGets: null,
    childIds: childrenOf.get(n.id) ?? [],
  }));

  return {
    kind: "sql",
    startedAt,
    totalElapsedMs: Date.now() - startedAtMs,
    events,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd sidecar && bun test tests/flow.test.ts
```
Expected: PASS — including the 2 new explainPlanFlow tests.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/flow.ts sidecar/tests/flow.test.ts
git commit -m "feat(flow): explainPlanFlow static mode — leaf-first execution order"
```

---

## Task 6: `explainPlanFlow` — runtime stats mode

**Files:**
- Modify: `sidecar/src/flow.ts`
- Modify: `sidecar/tests/flow.test.ts`

- [ ] **Step 1: Write failing test for runtime stats**

Append to `sidecar/tests/flow.test.ts`:

```typescript
import { setRuntimeStatsRunnerForTest } from "../src/flow";

describe("explainPlanFlow runtime stats mode", () => {
  it("populates cardinalityActual and elapsedMsActual when stats run succeeds", async () => {
    setExplainPlanForTest(async () => ({
      nodes: [
        { id: 0, parentId: null, operation: "SELECT STATEMENT", options: null, objectName: null, objectOwner: null, cost: 1, cardinality: 1, bytes: 13, accessPredicates: null, filterPredicates: null },
        { id: 1, parentId: 0, operation: "TABLE ACCESS", options: "FULL", objectName: "DUAL", objectOwner: "SYS", cost: 1, cardinality: 1, bytes: 13, accessPredicates: null, filterPredicates: null },
      ],
    }));
    setRuntimeStatsRunnerForTest(async () => ({
      perPlanId: new Map([
        [0, { cardinalityActual: 1, elapsedMsActual: 0, bufferGets: 3 }],
        [1, { cardinalityActual: 1, elapsedMsActual: 0, bufferGets: 3 }],
      ]),
    }));

    const result = await explainPlanFlow({ sql: "SELECT 1 FROM DUAL", withRuntimeStats: true });
    const tableAccess = result.events.find((e) => e.kind === "explain.node" && e.planId === 1);
    if (!tableAccess || tableAccess.kind !== "explain.node") throw new Error("missing");
    expect(tableAccess.cardinalityActual).toBe(1);
    expect(tableAccess.bufferGets).toBe(3);

    setExplainPlanForTest(null);
    setRuntimeStatsRunnerForTest(null);
  });

  it("falls back to static mode when runtime stats query is denied", async () => {
    setExplainPlanForTest(async () => ({
      nodes: [{ id: 0, parentId: null, operation: "SELECT STATEMENT", options: null, objectName: null, objectOwner: null, cost: 1, cardinality: 1, bytes: 1, accessPredicates: null, filterPredicates: null }],
    }));
    setRuntimeStatsRunnerForTest(async () => { throw new Error("ORA-00942: table or view does not exist"); });

    const result = await explainPlanFlow({ sql: "SELECT 1 FROM DUAL", withRuntimeStats: true });
    const node = result.events[0];
    if (node.kind !== "explain.node") throw new Error("expected explain.node");
    expect(node.cardinalityActual).toBeNull();
    setExplainPlanForTest(null);
    setRuntimeStatsRunnerForTest(null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd sidecar && bun test tests/flow.test.ts -t "explainPlanFlow runtime stats mode"
```
Expected: FAIL — `setRuntimeStatsRunnerForTest is not exported`.

- [ ] **Step 3: Implement runtime stats path**

Modify `sidecar/src/flow.ts`. Replace the existing `explainPlanFlow` function with:

```typescript
type RuntimeStatsResult = {
  perPlanId: Map<number, { cardinalityActual: number | null; elapsedMsActual: number | null; bufferGets: number | null }>;
};

type RuntimeStatsRunner = (sql: string) => Promise<RuntimeStatsResult>;
let _runtimeStatsRunnerForTest: RuntimeStatsRunner | null = null;
export function setRuntimeStatsRunnerForTest(fn: RuntimeStatsRunner | null): void {
  _runtimeStatsRunnerForTest = fn;
}

async function gatherRuntimeStats(sql: string): Promise<RuntimeStatsResult> {
  if (_runtimeStatsRunnerForTest) return _runtimeStatsRunnerForTest(sql);
  // Real implementation — runs the SQL with hint, then queries V$SQL_PLAN_STATISTICS_ALL.
  // Connection access is via withActiveSession from oracle.ts.
  const { withActiveSession } = await import("./oracle");
  return withActiveSession(async (conn) => {
    await conn.execute(`/*+ GATHER_PLAN_STATISTICS */ ${sql}`);
    const sqlIdRes = await conn.execute<{ SQL_ID: string; CHILD_NUMBER: number }>(
      `SELECT prev_sql_id AS SQL_ID, prev_child_number AS CHILD_NUMBER
         FROM V$SESSION
        WHERE audsid = USERENV('SESSIONID')`,
      [],
      { outFormat: 4002 /* OUT_FORMAT_OBJECT */ },
    );
    const ident = sqlIdRes.rows?.[0];
    if (!ident) return { perPlanId: new Map() };
    const stats = await conn.execute<{ ID: number; LAST_OUTPUT_ROWS: number; LAST_ELAPSED_TIME: number; LAST_CR_BUFFER_GETS: number }>(
      `SELECT id AS ID,
              last_output_rows  AS LAST_OUTPUT_ROWS,
              last_elapsed_time AS LAST_ELAPSED_TIME,
              last_cr_buffer_gets AS LAST_CR_BUFFER_GETS
         FROM V$SQL_PLAN_STATISTICS_ALL
        WHERE sql_id = :sid AND child_number = :cn`,
      { sid: ident.SQL_ID, cn: ident.CHILD_NUMBER },
      { outFormat: 4002 },
    );
    const perPlanId = new Map<number, { cardinalityActual: number | null; elapsedMsActual: number | null; bufferGets: number | null }>();
    for (const r of stats.rows ?? []) {
      perPlanId.set(r.ID, {
        cardinalityActual: r.LAST_OUTPUT_ROWS ?? null,
        elapsedMsActual: r.LAST_ELAPSED_TIME != null ? Math.round(r.LAST_ELAPSED_TIME / 1000) : null,
        bufferGets: r.LAST_CR_BUFFER_GETS ?? null,
      });
    }
    return { perPlanId };
  });
}

export async function explainPlanFlow(p: TraceSqlParams): Promise<TraceResult> {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const explainFn = _explainPlanForTest ?? realExplainPlan;

  const { nodes } = await explainFn({ sql: p.sql });
  const ordered = planExecutionOrder(nodes);

  const childrenOf = new Map<number | null, number[]>();
  for (const n of nodes) {
    const arr = childrenOf.get(n.parentId) ?? [];
    arr.push(n.id);
    childrenOf.set(n.parentId, arr);
  }

  let stats: RuntimeStatsResult = { perPlanId: new Map() };
  if (p.withRuntimeStats) {
    try {
      stats = await gatherRuntimeStats(p.sql);
    } catch {
      // Privilege denied or transient failure — silently fall back to static.
      stats = { perPlanId: new Map() };
    }
  }

  const events: ExplainNodeEvent[] = ordered.map((n, idx) => {
    const s = stats.perPlanId.get(n.id);
    return {
      kind: "explain.node",
      stepIndex: idx,
      planId: n.id,
      operation: [n.operation, n.options].filter(Boolean).join(" "),
      objectOwner: n.objectOwner ?? null,
      objectName: n.objectName ?? null,
      cost: n.cost ?? null,
      cardinalityEstimated: n.cardinality ?? null,
      cardinalityActual: s?.cardinalityActual ?? null,
      bytesEstimated: n.bytes ?? null,
      elapsedMsActual: s?.elapsedMsActual ?? null,
      bufferGets: s?.bufferGets ?? null,
      childIds: childrenOf.get(n.id) ?? [],
    };
  });

  return {
    kind: "sql",
    startedAt,
    totalElapsedMs: Date.now() - startedAtMs,
    events,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd sidecar && bun test tests/flow.test.ts
```
Expected: PASS — all flow tests including 2 new runtime-stats tests.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/flow.ts sidecar/tests/flow.test.ts
git commit -m "feat(flow): explainPlanFlow runtime-stats mode with V\$SQL_PLAN_STATISTICS_ALL"
```

---

## Task 7: Wire `flow.trace_proc` and `flow.trace_sql` RPC handlers

**Files:**
- Modify: `sidecar/src/index.ts`

- [ ] **Step 1: Add imports and handler entries**

In `sidecar/src/index.ts`, add this import block after the `debug` imports (line 51):

```typescript
import { traceProc, explainPlanFlow } from "./flow";
```

Then add these two entries to the `handlers` object (just before the closing `ping: async () => ({ pong: true }),` line):

```typescript
  "flow.trace_proc": (params) => traceProc(params as any),
  "flow.trace_sql":  (params) => explainPlanFlow(params as any),
```

- [ ] **Step 2: Verify all sidecar tests still pass**

Run:
```bash
cd sidecar && bun test
```
Expected: PASS — 114 prior tests + new flow tests = 122+ tests, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add sidecar/src/index.ts
git commit -m "feat(flow): wire flow.trace_proc and flow.trace_sql RPC handlers"
```

---

## Task 8: Tauri command `flow_trace_proc`

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Add the command**

In `src-tauri/src/commands.rs`, append this command after the existing `proc_execute` command (search for `pub async fn proc_execute` and add after its closing brace):

```rust
#[tauri::command]
pub async fn flow_trace_proc(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "flow.trace_proc", payload).await
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cd src-tauri && cargo build
```
Expected: PASS — no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(flow): Tauri command flow_trace_proc"
```

---

## Task 9: Tauri command `flow_trace_sql`

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command**

In `src-tauri/src/commands.rs`, append this command after `flow_trace_proc`:

```rust
#[tauri::command]
pub async fn flow_trace_sql(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<serde_json::Value, ConnectionTestErr> {
    call_sidecar(&app, "flow.trace_sql", payload).await
}
```

- [ ] **Step 2: Register both commands in `lib.rs`**

In `src-tauri/src/lib.rs`, find the `tauri::generate_handler!` macro call and add these two lines anywhere inside the array (kept alphabetical for tidiness):

```rust
            commands::flow_trace_proc,
            commands::flow_trace_sql,
```

- [ ] **Step 3: Verify it compiles**

Run:
```bash
cd src-tauri && cargo build
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(flow): Tauri command flow_trace_sql + register both in invoke_handler"
```

---

## Task 10: Frontend invoke wrappers

**Files:**
- Modify: `src/lib/workspace.ts`

- [ ] **Step 1: Add type exports + invoke wrappers**

At the end of `src/lib/workspace.ts`, append:

```typescript
// ── Visual Execution Flow ─────────────────────────────────────────────────────

export type StackEntry = { name: string; line: number };

export type FlowVariable = { name: string; type: string; value: string };

export type PlsqlFrameEvent = {
  kind: "plsql.frame";
  stepIndex: number;
  objectOwner: string;
  objectName: string;
  lineNumber: number;
  sourceLine: string;
  enteredAtMs: number;
  exitedAtMs: number | null;
  stack: StackEntry[];
  variables: FlowVariable[];
  branchTaken?: "then" | "else" | "loop" | "exit";
};

export type ExplainNodeEvent = {
  kind: "explain.node";
  stepIndex: number;
  planId: number;
  operation: string;
  objectOwner: string | null;
  objectName: string | null;
  cost: number | null;
  cardinalityEstimated: number | null;
  cardinalityActual: number | null;
  bytesEstimated: number | null;
  elapsedMsActual: number | null;
  bufferGets: number | null;
  childIds: number[];
};

export type FlowTraceEvent = PlsqlFrameEvent | ExplainNodeEvent;

export type FlowTraceResult = {
  kind: "plsql" | "sql";
  startedAt: string;
  totalElapsedMs: number;
  events: FlowTraceEvent[];
  finalResult?: { rowCount?: number; outBinds?: Record<string, unknown> };
  truncated?: boolean;
  error?: { code: number; message: string; atStep?: number };
};

export const flowTraceProc = (payload: {
  owner: string;
  name: string;
  args: Record<string, unknown>;
  maxSteps?: number;
  timeoutMs?: number;
}) => call<FlowTraceResult>("flow_trace_proc", { payload });

export const flowTraceSql = (payload: {
  sql: string;
  withRuntimeStats?: boolean;
}) => call<FlowTraceResult>("flow_trace_sql", { payload });
```

- [ ] **Step 2: Verify type-check passes**

Run:
```bash
bun run check
```
Expected: no new errors related to the additions (pre-existing errors documented in `.validation/findings.md` are unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace.ts
git commit -m "feat(flow): frontend invoke wrappers flowTraceProc and flowTraceSql"
```

---

## Task 11: Frontend store `visual-flow.svelte.ts`

**Files:**
- Create: `src/lib/stores/visual-flow.svelte.ts`
- Create: `src/lib/stores/visual-flow.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/stores/visual-flow.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { visualFlow } from "./visual-flow.svelte";
import type { FlowTraceResult } from "$lib/workspace";

const sampleTrace: FlowTraceResult = {
  kind: "plsql",
  startedAt: "2026-04-25T10:00:00Z",
  totalElapsedMs: 50,
  events: [
    { kind: "plsql.frame", stepIndex: 0, objectOwner: "HR", objectName: "P", lineNumber: 1, sourceLine: "BEGIN", enteredAtMs: 0, exitedAtMs: 10, stack: [], variables: [] },
    { kind: "plsql.frame", stepIndex: 1, objectOwner: "HR", objectName: "P", lineNumber: 2, sourceLine: "v := 1;", enteredAtMs: 10, exitedAtMs: 30, stack: [], variables: [] },
    { kind: "plsql.frame", stepIndex: 2, objectOwner: "HR", objectName: "P", lineNumber: 3, sourceLine: "END;", enteredAtMs: 30, exitedAtMs: null, stack: [], variables: [] },
  ],
};

describe("visualFlow store", () => {
  beforeEach(() => {
    visualFlow.close();
  });

  it("opens with a trace, currentStep starts at 0", () => {
    visualFlow.open(sampleTrace);
    expect(visualFlow.isOpen).toBe(true);
    expect(visualFlow.trace).toBe(sampleTrace);
    expect(visualFlow.currentStepIndex).toBe(0);
  });

  it("next advances and clamps at last step", () => {
    visualFlow.open(sampleTrace);
    visualFlow.next();
    expect(visualFlow.currentStepIndex).toBe(1);
    visualFlow.next();
    visualFlow.next();
    visualFlow.next();
    expect(visualFlow.currentStepIndex).toBe(2);
  });

  it("prev decrements and clamps at 0", () => {
    visualFlow.open(sampleTrace);
    visualFlow.next();
    visualFlow.prev();
    expect(visualFlow.currentStepIndex).toBe(0);
    visualFlow.prev();
    expect(visualFlow.currentStepIndex).toBe(0);
  });

  it("first/last jump to extremes", () => {
    visualFlow.open(sampleTrace);
    visualFlow.last();
    expect(visualFlow.currentStepIndex).toBe(2);
    visualFlow.first();
    expect(visualFlow.currentStepIndex).toBe(0);
  });

  it("close resets state", () => {
    visualFlow.open(sampleTrace);
    visualFlow.close();
    expect(visualFlow.isOpen).toBe(false);
    expect(visualFlow.trace).toBeNull();
  });

  it("setStep clamps to valid range", () => {
    visualFlow.open(sampleTrace);
    visualFlow.setStep(99);
    expect(visualFlow.currentStepIndex).toBe(2);
    visualFlow.setStep(-5);
    expect(visualFlow.currentStepIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
bun run test src/lib/stores/visual-flow.test.ts
```
Expected: FAIL — `Cannot find module './visual-flow.svelte'`.

- [ ] **Step 3: Implement the store**

Create `src/lib/stores/visual-flow.svelte.ts`:

```typescript
import type { FlowTraceResult } from "$lib/workspace";

class VisualFlowStore {
  trace = $state<FlowTraceResult | null>(null);
  currentStepIndex = $state(0);
  isPlaying = $state(false);
  panelWidth = $state(360);

  get isOpen(): boolean {
    return this.trace !== null;
  }

  get totalSteps(): number {
    return this.trace?.events.length ?? 0;
  }

  get currentEvent() {
    if (!this.trace) return null;
    return this.trace.events[this.currentStepIndex] ?? null;
  }

  open(trace: FlowTraceResult): void {
    this.trace = trace;
    this.currentStepIndex = 0;
    this.isPlaying = false;
  }

  close(): void {
    this.trace = null;
    this.currentStepIndex = 0;
    this.isPlaying = false;
  }

  next(): void {
    if (!this.trace) return;
    if (this.currentStepIndex < this.trace.events.length - 1) {
      this.currentStepIndex++;
    }
  }

  prev(): void {
    if (!this.trace) return;
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
    }
  }

  first(): void {
    this.currentStepIndex = 0;
  }

  last(): void {
    if (!this.trace) return;
    this.currentStepIndex = Math.max(0, this.trace.events.length - 1);
  }

  setStep(index: number): void {
    if (!this.trace) return;
    const max = Math.max(0, this.trace.events.length - 1);
    this.currentStepIndex = Math.max(0, Math.min(max, index));
  }

  togglePlay(): void {
    this.isPlaying = !this.isPlaying;
  }
}

export const visualFlow = new VisualFlowStore();
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
bun run test src/lib/stores/visual-flow.test.ts
```
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/visual-flow.svelte.ts src/lib/stores/visual-flow.test.ts
git commit -m "feat(flow): visualFlow Svelte 5 store with navigation API"
```

---

## Task 12: `VisualFlowNode.svelte` — single step node

**Files:**
- Create: `src/lib/workspace/VisualFlowNode.svelte`

- [ ] **Step 1: Implement the node component**

Create `src/lib/workspace/VisualFlowNode.svelte`:

```svelte
<script lang="ts">
  import type { FlowTraceEvent } from "$lib/workspace";

  type Props = {
    event: FlowTraceEvent;
    state: "current" | "visited" | "pending";
    onClick?: () => void;
  };
  let { event, state, onClick }: Props = $props();

  const operation = $derived.by(() => {
    if (event.kind === "plsql.frame") return `${event.objectName}:${event.lineNumber}`;
    return event.operation;
  });

  const subtitle = $derived.by(() => {
    if (event.kind === "plsql.frame") {
      const ms = event.exitedAtMs !== null ? event.exitedAtMs - event.enteredAtMs : 0;
      return `${ms}ms`;
    }
    const cost = event.cost !== null ? `cost ${event.cost}` : "";
    const card = event.cardinalityActual ?? event.cardinalityEstimated;
    const cardLabel = card !== null && card !== undefined ? `~${card} rows` : "";
    return [cost, cardLabel].filter(Boolean).join(" · ");
  });

  function colorForOperation(op: string): string {
    const u = op.toUpperCase();
    if (u.includes("TABLE ACCESS")) return "#8bc4a8";
    if (u.includes("INDEX")) return "#7aa8c4";
    if (u.includes("JOIN")) return "#c3a66e";
    if (u.includes("SORT") || u.includes("AGG")) return "#c4869b";
    return "var(--text-primary)";
  }

  const accentColor = $derived(event.kind === "explain.node" ? colorForOperation(event.operation) : "#e8643a");
</script>

<button
  type="button"
  class="node node--{state}"
  style="--accent: {accentColor}"
  onclick={onClick}
  aria-current={state === "current"}
>
  <span class="op">{operation}</span>
  {#if subtitle}
    <span class="sub">{subtitle}</span>
  {/if}
</button>

<style>
  .node {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-surface);
    text-align: left;
    cursor: pointer;
    width: 100%;
    color: var(--text-primary);
    font-family: inherit;
  }
  .node--current {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .node--visited {
    opacity: 0.85;
  }
  .node--pending {
    opacity: 0.45;
  }
  .op {
    font-weight: 600;
    font-size: 13px;
  }
  .sub {
    font-size: 11px;
    color: var(--text-muted);
  }
  .node--current .sub {
    color: rgba(255, 255, 255, 0.85);
  }
</style>
```

- [ ] **Step 2: Verify type-check still works**

Run:
```bash
bun run check
```
Expected: no NEW errors from VisualFlowNode.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace/VisualFlowNode.svelte
git commit -m "feat(flow): VisualFlowNode component for single step rendering"
```

---

## Task 13: `VisualFlowGraph.svelte` — vertical SVG layout

**Files:**
- Create: `src/lib/workspace/VisualFlowGraph.svelte`

- [ ] **Step 1: Implement the graph component**

Create `src/lib/workspace/VisualFlowGraph.svelte`:

```svelte
<script lang="ts">
  import type { FlowTraceResult } from "$lib/workspace";
  import VisualFlowNode from "./VisualFlowNode.svelte";

  type Props = {
    trace: FlowTraceResult;
    currentStepIndex: number;
    onSelectStep: (index: number) => void;
  };
  let { trace, currentStepIndex, onSelectStep }: Props = $props();

  function stateForIndex(i: number): "current" | "visited" | "pending" {
    if (i === currentStepIndex) return "current";
    if (i < currentStepIndex) return "visited";
    return "pending";
  }
</script>

<div class="graph" role="list" aria-label="Execution steps">
  {#each trace.events as event, i (event.stepIndex)}
    <div class="row" role="listitem">
      <VisualFlowNode
        {event}
        state={stateForIndex(i)}
        onClick={() => onSelectStep(i)}
      />
      {#if i < trace.events.length - 1}
        <div class="connector" aria-hidden="true">
          <svg width="12" height="14" viewBox="0 0 12 14" focusable="false">
            <line x1="6" y1="0" x2="6" y2="10" stroke="var(--border)" stroke-width="2" />
            <polygon points="2,8 10,8 6,13" fill="var(--border)" />
          </svg>
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .graph {
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
    padding: 12px;
    flex: 1 1 auto;
  }
  .row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
  }
  .connector {
    display: flex;
    justify-content: center;
    margin: 2px 0;
  }
</style>
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
bun run check
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace/VisualFlowGraph.svelte
git commit -m "feat(flow): VisualFlowGraph vertical SVG layout with click-to-jump"
```

---

## Task 14: `VisualFlowVariablesView.svelte` — variables panel

**Files:**
- Create: `src/lib/workspace/VisualFlowVariablesView.svelte`

- [ ] **Step 1: Implement the variables panel**

Create `src/lib/workspace/VisualFlowVariablesView.svelte`:

```svelte
<script lang="ts">
  import type { FlowTraceEvent } from "$lib/workspace";

  type Props = {
    event: FlowTraceEvent | null;
  };
  let { event }: Props = $props();

  let expanded = $state(true);

  const variables = $derived.by(() => {
    if (!event || event.kind !== "plsql.frame") return [];
    return event.variables;
  });

  const explainStats = $derived.by(() => {
    if (!event || event.kind !== "explain.node") return null;
    return {
      cost: event.cost,
      cardEst: event.cardinalityEstimated,
      cardAct: event.cardinalityActual,
      elapsed: event.elapsedMsActual,
      bufferGets: event.bufferGets,
    };
  });
</script>

<section class="vars" class:vars--collapsed={!expanded}>
  <button
    type="button"
    class="header"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
  >
    <span class="caret" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
    {#if variables.length > 0}
      Variables ({variables.length})
    {:else if explainStats}
      Plan stats
    {:else}
      Details
    {/if}
  </button>
  {#if expanded}
    <div class="body">
      {#if variables.length > 0}
        <table>
          <tbody>
            {#each variables as v}
              <tr>
                <td class="name">{v.name}</td>
                <td class="type">{v.type}</td>
                <td class="value">{v.value}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else if explainStats}
        <table>
          <tbody>
            <tr><td class="name">Cost</td><td class="value">{explainStats.cost ?? "—"}</td></tr>
            <tr><td class="name">Cardinality (est)</td><td class="value">{explainStats.cardEst ?? "—"}</td></tr>
            <tr><td class="name">Cardinality (actual)</td><td class="value">{explainStats.cardAct ?? "—"}</td></tr>
            <tr><td class="name">Elapsed (ms)</td><td class="value">{explainStats.elapsed ?? "—"}</td></tr>
            <tr><td class="name">Buffer gets</td><td class="value">{explainStats.bufferGets ?? "—"}</td></tr>
          </tbody>
        </table>
      {:else}
        <p class="empty">No detail available for this step.</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .vars {
    border-top: 1px solid var(--border);
    background: var(--bg-surface-alt);
  }
  .header {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    color: var(--text-primary);
    padding: 8px 12px;
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .caret {
    color: var(--text-muted);
    width: 10px;
  }
  .body {
    max-height: 240px;
    overflow-y: auto;
    padding: 0 12px 12px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  td {
    padding: 4px 6px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  .name {
    color: var(--text-muted);
    width: 30%;
  }
  .type {
    color: var(--text-muted);
    width: 20%;
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
  }
  .value {
    font-family: "JetBrains Mono", monospace;
    word-break: break-all;
  }
  .empty {
    color: var(--text-muted);
    font-size: 12px;
    margin: 0;
  }
</style>
```

- [ ] **Step 2: Verify compile**

Run:
```bash
bun run check
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace/VisualFlowVariablesView.svelte
git commit -m "feat(flow): VisualFlowVariablesView for per-step variables and plan stats"
```

---

## Task 15: `VisualFlowControls.svelte` — NEXT/PREV/scrub + keyboard

**Files:**
- Create: `src/lib/workspace/VisualFlowControls.svelte`

- [ ] **Step 1: Implement controls**

Create `src/lib/workspace/VisualFlowControls.svelte`:

```svelte
<script lang="ts">
  import { onMount } from "svelte";

  type Props = {
    currentStepIndex: number;
    totalSteps: number;
    isPlaying: boolean;
    onPrev: () => void;
    onNext: () => void;
    onFirst: () => void;
    onLast: () => void;
    onSetStep: (i: number) => void;
    onTogglePlay: () => void;
    onClose: () => void;
  };
  let {
    currentStepIndex,
    totalSteps,
    isPlaying,
    onPrev,
    onNext,
    onFirst,
    onLast,
    onSetStep,
    onTogglePlay,
    onClose,
  }: Props = $props();

  function handleKey(e: KeyboardEvent): void {
    // Ignore when typing in an input/textarea/contenteditable.
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); onNext(); }
    else if (e.key === "ArrowLeft" || e.key === "Backspace") { e.preventDefault(); onPrev(); }
    else if (e.key === "Home") { e.preventDefault(); onFirst(); }
    else if (e.key === "End") { e.preventDefault(); onLast(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "p" || e.key === "P") { e.preventDefault(); onTogglePlay(); }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  function handleScrub(e: Event): void {
    const target = e.target as HTMLInputElement;
    onSetStep(Number(target.value));
  }
</script>

<footer class="controls">
  <div class="row">
    <button type="button" onclick={onFirst} aria-label="First step" disabled={currentStepIndex === 0}>⏮</button>
    <button type="button" onclick={onPrev} aria-label="Previous step" disabled={currentStepIndex === 0}>◀</button>
    <button type="button" class="play" onclick={onTogglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
      {isPlaying ? "⏸" : "▶"}
    </button>
    <button type="button" onclick={onNext} aria-label="Next step" disabled={currentStepIndex >= totalSteps - 1}>▶</button>
    <button type="button" onclick={onLast} aria-label="Last step" disabled={currentStepIndex >= totalSteps - 1}>⏭</button>
  </div>
  <input
    type="range"
    min="0"
    max={Math.max(0, totalSteps - 1)}
    value={currentStepIndex}
    oninput={handleScrub}
    aria-label="Step scrubber"
    class="scrub"
  />
</footer>

<style>
  .controls {
    border-top: 1px solid var(--border);
    background: var(--bg-surface);
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    gap: 4px;
    justify-content: center;
  }
  button {
    background: var(--bg-surface-alt);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 14px;
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  button.play {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .scrub {
    width: 100%;
    accent-color: var(--accent);
  }
</style>
```

- [ ] **Step 2: Verify compile**

Run:
```bash
bun run check
```
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace/VisualFlowControls.svelte
git commit -m "feat(flow): VisualFlowControls with NEXT/PREV/scrub and keyboard shortcuts"
```

---

## Task 16: `VisualFlowPanel.svelte` — side panel container

**Files:**
- Create: `src/lib/workspace/VisualFlowPanel.svelte`
- Create: `src/lib/workspace/VisualFlowPanel.test.ts`

- [ ] **Step 1: Write a failing test**

Create `src/lib/workspace/VisualFlowPanel.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import VisualFlowPanel from "./VisualFlowPanel.svelte";
import { visualFlow } from "$lib/stores/visual-flow.svelte";
import type { FlowTraceResult } from "$lib/workspace";

const trace: FlowTraceResult = {
  kind: "plsql",
  startedAt: "2026-04-25T10:00:00Z",
  totalElapsedMs: 30,
  events: [
    { kind: "plsql.frame", stepIndex: 0, objectOwner: "HR", objectName: "P", lineNumber: 1, sourceLine: "BEGIN", enteredAtMs: 0, exitedAtMs: 10, stack: [], variables: [{ name: "p_id", type: "NUMBER", value: "100" }] },
    { kind: "plsql.frame", stepIndex: 1, objectOwner: "HR", objectName: "P", lineNumber: 2, sourceLine: "v := 1;", enteredAtMs: 10, exitedAtMs: null, stack: [], variables: [{ name: "p_id", type: "NUMBER", value: "100" }, { name: "v", type: "NUMBER", value: "1" }] },
  ],
};

describe("VisualFlowPanel", () => {
  beforeEach(() => visualFlow.open(trace));
  afterEach(() => visualFlow.close());

  it("renders header with step counter", () => {
    const { getByText } = render(VisualFlowPanel);
    expect(getByText(/Step 1\s*\/\s*2/)).toBeTruthy();
  });

  it("clicking next advances the store", async () => {
    const { getByLabelText, getByText } = render(VisualFlowPanel);
    expect(visualFlow.currentStepIndex).toBe(0);
    await fireEvent.click(getByLabelText("Next step"));
    expect(visualFlow.currentStepIndex).toBe(1);
    expect(getByText(/Step 2\s*\/\s*2/)).toBeTruthy();
  });

  it("clicking close hides the panel", async () => {
    const { getByLabelText } = render(VisualFlowPanel);
    expect(visualFlow.isOpen).toBe(true);
    await fireEvent.click(getByLabelText("Close panel"));
    expect(visualFlow.isOpen).toBe(false);
  });

  it("renders the truncated banner when trace.truncated=true", () => {
    visualFlow.open({ ...trace, truncated: true });
    const { getByText } = render(VisualFlowPanel);
    expect(getByText(/truncated/i)).toBeTruthy();
  });

  it("renders the error banner when trace.error is set", () => {
    visualFlow.open({ ...trace, error: { code: -32004, message: "Trace timed out" } });
    const { getByText } = render(VisualFlowPanel);
    expect(getByText(/timed out/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
bun run test src/lib/workspace/VisualFlowPanel.test.ts
```
Expected: FAIL — `Cannot find module './VisualFlowPanel.svelte'`.

- [ ] **Step 3: Implement the panel**

Create `src/lib/workspace/VisualFlowPanel.svelte`:

```svelte
<script lang="ts">
  import { visualFlow } from "$lib/stores/visual-flow.svelte";
  import VisualFlowGraph from "./VisualFlowGraph.svelte";
  import VisualFlowControls from "./VisualFlowControls.svelte";
  import VisualFlowVariablesView from "./VisualFlowVariablesView.svelte";

  const headerLabel = $derived.by(() => {
    const e = visualFlow.currentEvent;
    if (!e) return "";
    if (e.kind === "plsql.frame") return `${e.objectName} : line ${e.lineNumber}`;
    return e.operation;
  });

  const elapsedLabel = $derived.by(() => {
    const e = visualFlow.currentEvent;
    if (!e) return "";
    if (e.kind === "plsql.frame") {
      const ms = e.exitedAtMs !== null ? e.exitedAtMs - e.enteredAtMs : 0;
      return `${ms} ms`;
    }
    return e.elapsedMsActual !== null ? `${e.elapsedMsActual} ms` : "";
  });
</script>

{#if visualFlow.isOpen && visualFlow.trace}
  <aside class="panel" style="width: {visualFlow.panelWidth}px" aria-label="Visual execution flow">
    <header class="head">
      <h3>Visual Flow</h3>
      <button type="button" onclick={() => visualFlow.close()} aria-label="Close panel">×</button>
    </header>

    {#if visualFlow.trace.truncated}
      <div class="banner banner--warn">Trace truncated at {visualFlow.totalSteps} steps.</div>
    {/if}
    {#if visualFlow.trace.error}
      <div class="banner banner--error">
        {visualFlow.trace.error.message}
      </div>
    {/if}

    <VisualFlowGraph
      trace={visualFlow.trace}
      currentStepIndex={visualFlow.currentStepIndex}
      onSelectStep={(i) => visualFlow.setStep(i)}
    />

    <div class="info">
      <strong>Step {visualFlow.currentStepIndex + 1} / {visualFlow.totalSteps}</strong>
      <span class="muted">{headerLabel} {elapsedLabel ? `· ${elapsedLabel}` : ""}</span>
    </div>

    <VisualFlowVariablesView event={visualFlow.currentEvent} />

    <VisualFlowControls
      currentStepIndex={visualFlow.currentStepIndex}
      totalSteps={visualFlow.totalSteps}
      isPlaying={visualFlow.isPlaying}
      onPrev={() => visualFlow.prev()}
      onNext={() => visualFlow.next()}
      onFirst={() => visualFlow.first()}
      onLast={() => visualFlow.last()}
      onSetStep={(i) => visualFlow.setStep(i)}
      onTogglePlay={() => visualFlow.togglePlay()}
      onClose={() => visualFlow.close()}
    />
  </aside>
{/if}

<style>
  .panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    background: var(--bg-surface);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    z-index: 50;
    color: var(--text-primary);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }
  .head h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .head button {
    background: transparent;
    border: 0;
    color: var(--text-muted);
    font-size: 18px;
    cursor: pointer;
  }
  .banner {
    padding: 6px 12px;
    font-size: 12px;
    border-bottom: 1px solid var(--border);
  }
  .banner--warn {
    background: rgba(195, 166, 110, 0.18);
    color: #c3a66e;
  }
  .banner--error {
    background: rgba(196, 74, 74, 0.18);
    color: #c44a4a;
  }
  .info {
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-surface);
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .info .muted {
    color: var(--text-muted);
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
bun run test src/lib/workspace/VisualFlowPanel.test.ts
```
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace/VisualFlowPanel.svelte src/lib/workspace/VisualFlowPanel.test.ts
git commit -m "feat(flow): VisualFlowPanel container with graph + variables + controls"
```

---

## Task 17: Mount the panel in the app layout

**Files:**
- Modify: `src/routes/+layout.svelte`

- [ ] **Step 1: Find the layout file and add the import + mount point**

Open `src/routes/+layout.svelte`. Add this import alongside the existing imports near the top:

```svelte
  import VisualFlowPanel from "$lib/workspace/VisualFlowPanel.svelte";
```

Then add the component **at the end** of the `<script>` block's closing `</script>` tag, BEFORE the `<main>` or `{@render children?.()}` block. The panel renders itself only when open, so it's safe to mount globally:

```svelte
<VisualFlowPanel />
```

- [ ] **Step 2: Verify the app builds**

Run:
```bash
bun run build
```
Expected: PASS — production build completes.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+layout.svelte
git commit -m "feat(flow): mount VisualFlowPanel in root layout"
```

---

## Task 18: "Run with Visual Flow" button in `ProcExecModal.svelte`

**Files:**
- Modify: `src/lib/workspace/ProcExecModal.svelte`

- [ ] **Step 1: Find the run button**

Open `src/lib/workspace/ProcExecModal.svelte`. Locate the existing Run button (search for `procExecute` or for a button with an `onclick` that calls `procExecute`).

- [ ] **Step 2: Add the trace handler and button**

In the `<script>` block of `ProcExecModal.svelte`, add this import alongside the existing `procExecute` import:

```typescript
import { flowTraceProc } from "$lib/workspace";
import { visualFlow } from "$lib/stores/visual-flow.svelte";
```

Then add this function near the existing `runProc` (or equivalent name) function:

```typescript
async function runWithVisualFlow(): Promise<void> {
  const args = collectArgsForRpc();   // reuse the existing helper that gathers IN params
  const result = await flowTraceProc({
    owner: ownerProp,
    name: procNameProp,
    args,
    maxSteps: 5000,
    timeoutMs: 60_000,
  });
  if (!result.ok) {
    alert(`Visual Flow failed: ${result.error.message}`);
    return;
  }
  visualFlow.open(result.data);
}
```

In the template, find the existing Run button and add this sibling button right after it:

```svelte
<button type="button" class="btn-secondary" onclick={runWithVisualFlow}>
  ▶ Run with Visual Flow
</button>
```

The local variable names (`ownerProp`, `procNameProp`, `collectArgsForRpc`) MUST match what `ProcExecModal.svelte` already uses. If the existing component calls them differently, substitute accordingly — the implementation stays the same.

- [ ] **Step 3: Verify build**

Run:
```bash
bun run build
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workspace/ProcExecModal.svelte
git commit -m "feat(flow): Run with Visual Flow button in ProcExecModal"
```

---

## Task 19: "EXPLAIN with Visual Flow" button in `SqlEditor.svelte`

**Files:**
- Modify: `src/lib/workspace/SqlEditor.svelte`

- [ ] **Step 1: Add imports**

Open `src/lib/workspace/SqlEditor.svelte`. In the `<script>` block, add:

```typescript
import { flowTraceSql } from "$lib/workspace";
import { visualFlow } from "$lib/stores/visual-flow.svelte";
```

- [ ] **Step 2: Add the handler**

Add this function near the existing EXPLAIN handler in `SqlEditor.svelte`:

```typescript
async function explainWithVisualFlow(withRuntimeStats: boolean): Promise<void> {
  const sql = currentSqlForExplain();   // reuse the helper the existing EXPLAIN button uses
  if (!sql || !sql.trim()) {
    alert("No SQL to explain.");
    return;
  }
  const result = await flowTraceSql({ sql, withRuntimeStats });
  if (!result.ok) {
    alert(`Visual Flow failed: ${result.error.message}`);
    return;
  }
  visualFlow.open(result.data);
}
```

If `currentSqlForExplain` is not the existing helper name, use the same one the existing EXPLAIN button calls (it already extracts the active statement from the editor).

- [ ] **Step 3: Add the button(s) to the toolbar**

Find the existing EXPLAIN button in the template. Add these two sibling buttons right after it:

```svelte
<button type="button" class="btn-secondary" onclick={() => explainWithVisualFlow(false)}>
  Visual Flow (static)
</button>
<button type="button" class="btn-secondary" onclick={() => explainWithVisualFlow(true)}>
  Visual Flow + Stats
</button>
```

- [ ] **Step 4: Verify build**

Run:
```bash
bun run build
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace/SqlEditor.svelte
git commit -m "feat(flow): Visual Flow buttons in SqlEditor (static + with-stats)"
```

---

## Task 20: Sidecar integration test (Oracle 23ai container)

**Files:**
- Create: `sidecar/tests/flow.integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create `sidecar/tests/flow.integration.test.ts`:

```typescript
// Integration test — requires the local Oracle 23ai container started:
//   docker run -d --name oracle23ai -p 1521:1521 -e ORACLE_PASSWORD=Veesker23ai_test gvenzl/oracle-free:23-slim
//
// Skipped automatically if connection fails (so CI without Oracle is OK).

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import oracledb from "oracledb";

const cfg = {
  user: process.env.VEESKER_TEST_USER ?? "system",
  password: process.env.VEESKER_TEST_PASS ?? "Veesker23ai_test",
  connectString: process.env.VEESKER_TEST_CONN ?? "localhost:1521/FREEPDB1",
};

let oracleAvailable = false;

async function tryConnect(): Promise<oracledb.Connection | null> {
  try {
    return await oracledb.getConnection(cfg);
  } catch {
    return null;
  }
}

beforeAll(async () => {
  const c = await tryConnect();
  if (!c) {
    console.warn("[flow.integration] Oracle not reachable — tests will be skipped");
    return;
  }
  oracleAvailable = true;
  // Clean fixture and recreate.
  for (const stmt of [
    `BEGIN EXECUTE IMMEDIATE 'DROP PROCEDURE veesker_flow_test_proc'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
    `BEGIN EXECUTE IMMEDIATE 'DROP TABLE veesker_flow_test_records PURGE'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
    `CREATE TABLE veesker_flow_test_records (id NUMBER PRIMARY KEY, status VARCHAR2(20))`,
    `INSERT INTO veesker_flow_test_records VALUES (1, 'pending')`,
    `COMMIT`,
    `CREATE OR REPLACE PROCEDURE veesker_flow_test_proc(p_id IN NUMBER) AS
       v_status VARCHAR2(20);
     BEGIN
       SELECT status INTO v_status FROM veesker_flow_test_records WHERE id = p_id;
       IF v_status = 'pending' THEN
         UPDATE veesker_flow_test_records SET status = 'done' WHERE id = p_id;
       END IF;
     END;`,
    `ALTER PROCEDURE veesker_flow_test_proc COMPILE DEBUG`,
  ]) {
    await c.execute(stmt);
  }
  await c.commit();
  await c.close();
});

afterAll(async () => {
  if (!oracleAvailable) return;
  const c = await tryConnect();
  if (!c) return;
  for (const stmt of [
    `BEGIN EXECUTE IMMEDIATE 'DROP PROCEDURE veesker_flow_test_proc'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
    `BEGIN EXECUTE IMMEDIATE 'DROP TABLE veesker_flow_test_records PURGE'; EXCEPTION WHEN OTHERS THEN NULL; END;`,
    `COMMIT`,
  ]) {
    await c.execute(stmt);
  }
  await c.close();
});

describe.if(true)("flow integration — explainPlanFlow static", () => {
  it("returns events for a simple SELECT", async () => {
    if (!oracleAvailable) return;
    const { openSession, closeSession } = await import("../src/oracle");
    const { explainPlanFlow } = await import("../src/flow");
    await openSession({ ...cfg, kind: "basic" } as any);
    try {
      const result = await explainPlanFlow({ sql: "SELECT id, status FROM veesker_flow_test_records", withRuntimeStats: false });
      expect(result.kind).toBe("sql");
      expect(result.events.length).toBeGreaterThanOrEqual(1);
      const last = result.events[result.events.length - 1];
      if (last.kind !== "explain.node") throw new Error("expected explain.node");
      expect(last.operation).toMatch(/SELECT STATEMENT/);
    } finally {
      await closeSession();
    }
  });
});
```

The `describe.if(oracleAvailable)` style is approximate — Bun's test runner uses `it.skip` / `describe.skipIf`. If Bun's API differs, replace with an early `if (!oracleAvailable) return;` guard inside each `it`.

- [ ] **Step 2: Run the integration test**

Ensure Oracle container is running:
```bash
"/c/Program Files/Docker/Docker/resources/bin/docker.exe" ps --filter name=oracle23ai
```

Then:
```bash
cd sidecar && bun test tests/flow.integration.test.ts
```
Expected: PASS — at least 1 explain.node event.

- [ ] **Step 3: Commit**

```bash
git add sidecar/tests/flow.integration.test.ts
git commit -m "test(flow): integration test against Oracle 23ai container"
```

---

## Task 21: Final smoke + dark-mode CSS review

**Files:**
- Modify (if needed): any of the new Svelte components

- [ ] **Step 1: Run the dev app and exercise the feature manually**

Start the app:
```bash
bun run tauri dev
```

Manual checklist:
- [ ] Open a workspace with the local Oracle 23ai connection
- [ ] In `SqlEditor`, type `SELECT * FROM veesker_flow_test_records`. Click "Visual Flow (static)". Panel should open showing the plan, NEXT advances, ESC closes.
- [ ] In `SqlEditor`, click "Visual Flow + Stats". Cardinality (actual) should be a number, not `—`.
- [ ] In a procedure detail page, open `ProcExecModal` for `VEESKER_FLOW_TEST_PROC`, fill `p_id = 1`, click "Run with Visual Flow". Panel opens with PL/SQL events.

- [ ] **Step 2: CSS dark-mode review**

For each of the 5 new components, verify they use CSS variables (`--bg-surface`, `--bg-surface-alt`, `--text-primary`, `--text-muted`, `--border`, `--accent`) per the CLAUDE.md mandate. No hardcoded `#fff` / `#000` backgrounds in dark-mode components.

If any hardcoded colors exist, replace with the matching variable.

- [ ] **Step 3: Run all test suites one last time**

```bash
bun run test
cd sidecar && bun test
cd ../src-tauri && cargo test --lib
```
Expected: all green.

- [ ] **Step 4: Commit any polish fixes**

```bash
git add -A
git commit -m "polish(flow): manual smoke + CSS dark-mode review pass"
```

If nothing to commit, skip — this step closes the plan.

---

## Coverage check

Spec requirements → tasks:

| Spec section | Implemented in |
|---|---|
| §Architecture (sidecar/Tauri/frontend boundary) | Tasks 7, 8, 9, 10 |
| §Data model (TraceEvent, TraceResult) | Tasks 1, 10 |
| §Constraints (truncation rules) | Tasks 2, 4 |
| §Sidecar capture — traceProc | Tasks 3, 4 |
| §Sidecar capture — explainPlanFlow static | Task 5 |
| §Sidecar capture — explainPlanFlow runtime stats | Task 6 |
| §Privileges required | Tasks 5, 6 (graceful fallback on denial) |
| §Frontend components | Tasks 11, 12, 13, 14, 15, 16, 17 |
| §Side panel layout | Tasks 16, 17 |
| §Visual style + colors | Tasks 12, 14 |
| §Keyboard shortcuts | Task 15 |
| §Integration buttons | Tasks 18, 19 |
| §Error handling — truncated/timeout | Tasks 4, 16 |
| §Error handling — no debug compile | Surfaced via test fixture in Task 20 (production path covered by Task 4 init-failure handling) |
| §Error handling — V$ stats denied | Task 6 (silent fallback) |
| §Testing — unit (sidecar) | Tasks 2, 3, 4, 5, 6 |
| §Testing — unit (frontend) | Tasks 11, 16 |
| §Testing — integration | Task 20 |
| §Out of scope (PL/Scope, range, export, diff, source highlight) | not implemented (deferred per spec) |

All spec-required behavior has at least one task. ✅

---

## Done criteria

- All 21 tasks have all checkboxes ticked.
- All test suites pass (`bun run test`, `cd sidecar && bun test`, `cd src-tauri && cargo test --lib`).
- `bun run build` succeeds without errors.
- Manual smoke test of all 4 manual checks in Task 21.
