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

import { detectStaleStats } from "./perf-rules";
import type { TableStats } from "./perf-rules";

describe("detectStaleStats", () => {
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
