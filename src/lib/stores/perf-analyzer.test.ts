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
});
