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
    // Sync timer advance fires setTimeout callback without flushing microtasks,
    // so we observe the synchronous "analyzing" state set inside runAnalysis
    // before the awaited explainPlanGet/perfStats promises resolve.
    vi.advanceTimersByTime(500);
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

  it("setSessionBusy(true) defers analysis; setSessionBusy(false) re-fires it", async () => {
    const a = createPerfAnalyzer();
    a.setSessionBusy(true);
    a.scheduleAnalysis("SELECT * FROM dual");
    await vi.advanceTimersByTimeAsync(600);
    expect(a.state.kind).toBe("skipped");
    if (a.state.kind === "skipped") {
      expect(a.state.reason).toBe("session-busy");
    }
    expect(mockedExplain).not.toHaveBeenCalled();

    a.setSessionBusy(false);
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockedExplain).toHaveBeenCalledTimes(1);
    expect(mockedExplain).toHaveBeenCalledWith("SELECT * FROM dual");
  });

  it("cache hit returns previous result without re-running RPC", async () => {
    const a = createPerfAnalyzer();
    a.scheduleAnalysis("SELECT * FROM dual");
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockedExplain).toHaveBeenCalledTimes(1);
    expect(a.state.kind).toBe("analyzed");

    a.scheduleAnalysis("SELECT * FROM dual");
    await vi.advanceTimersByTimeAsync(600);
    await Promise.resolve();
    expect(mockedExplain).toHaveBeenCalledTimes(1);
    expect(a.state.kind).toBe("analyzed");
  });

  it("reset() while RPC is in-flight clears state and prevents stale write", async () => {
    let resolveExplain!: (v: any) => void;
    mockedExplain.mockImplementationOnce(() => new Promise((r) => { resolveExplain = r; }));

    const a = createPerfAnalyzer();
    a.scheduleAnalysis("SELECT * FROM dual");
    await vi.advanceTimersByTimeAsync(500);
    expect(a.state.kind).toBe("analyzing");

    a.reset();
    expect(a.state.kind).toBe("idle");

    resolveExplain({
      ok: true,
      data: { nodes: [{ id: 0, parentId: null, operation: "SELECT STATEMENT", options: null,
                        objectName: null, objectOwner: null, cost: 100, cardinality: 1,
                        bytes: null, accessPredicates: null, filterPredicates: null }] },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(a.state.kind).toBe("idle");
  });

  it("new scheduleAnalysis aborts the previous in-flight analysis", async () => {
    let resolveFirst!: (v: any) => void;
    mockedExplain.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));

    const a = createPerfAnalyzer();
    a.scheduleAnalysis("SELECT 1 FROM dual");
    await vi.advanceTimersByTimeAsync(500);
    expect(a.state.kind).toBe("analyzing");
    if (a.state.kind === "analyzing") {
      expect(a.state.sql).toBe("SELECT 1 FROM dual");
    }

    // Second scheduling: the second runAnalysis uses the default mock which
    // resolves synchronously, so by the time microtasks flush the state will
    // already be "analyzed" for SELECT 2. That is fine — the contract under
    // test is that the *first* analysis (still pending via resolveFirst) does
    // NOT overwrite the result for SELECT 2 once we resolve it below.
    a.scheduleAnalysis("SELECT 2 FROM dual");
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    await Promise.resolve();
    expect(["analyzing", "analyzed"]).toContain(a.state.kind);
    if (a.state.kind === "analyzed") {
      expect(a.state.sql).toBe("SELECT 2 FROM dual");
    }
    expect(mockedExplain).toHaveBeenCalledTimes(2);

    // Resolve the first (stale) RPC — abort signal for the first run is set,
    // so its post-resolution state write must be skipped.
    resolveFirst({
      ok: true,
      data: { nodes: [{ id: 0, parentId: null, operation: "STALE", options: null,
                        objectName: null, objectOwner: null, cost: 999_999, cardinality: 1,
                        bytes: null, accessPredicates: null, filterPredicates: null }] },
    });
    await Promise.resolve();
    await Promise.resolve();
    // State must reflect the second analysis, not the stale first.
    expect(a.state.kind).toBe("analyzed");
    if (a.state.kind === "analyzed") {
      expect(a.state.sql).toBe("SELECT 2 FROM dual");
      expect(a.state.plan[0].operation).not.toBe("STALE");
    }
  });
});
