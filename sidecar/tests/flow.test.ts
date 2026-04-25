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
    expect(truncateSourceLine("SELECT * FROM dual")).toBe(
      "SELECT * FROM dual"
    );
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
      0
    );
    expect(totalBytes).toBeLessThanOrEqual(MAX_STEP_VARIABLES_BYTES);
    const last = result[result.length - 1];
    expect(last.name).toBe("__truncated__");
    expect(last.value).toMatch(/^\d+ more variables omitted$/);
  });
});

import { traceProc, setTraceProcDebugSessionFactoryForTest } from "../src/flow";
import type { PlsqlFrameEvent, TraceResult, Variable } from "../src/flow-types";

describe("traceProc", () => {
  it("captures one event per debugger step until completion", async () => {
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

import { explainPlanFlow, setExplainPlanForTest, setRuntimeStatsRunnerForTest } from "../src/flow";

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
    const last = result.events[3];
    if (last.kind !== "explain.node") throw new Error("expected explain.node");
    expect(last.operation).toBe("SELECT STATEMENT");
    const first = result.events[0];
    if (first.kind !== "explain.node") throw new Error("expected explain.node");
    expect(first.operation).toBe("TABLE ACCESS FULL");
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

type FakeStep = {
  line: number;
  owner: string;
  objectName: string;
  objectType: string;
  vars: Variable[];
};

function createFakeDebugSession(steps: FakeStep[]) {
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
