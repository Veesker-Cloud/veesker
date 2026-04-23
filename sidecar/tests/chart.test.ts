import { describe, test, expect, beforeEach } from "bun:test";
import { chartConfigure, chartReset } from "../src/chart";

const COLS = [
  { name: "DEPT", dataType: "VARCHAR2" },
  { name: "SALARY", dataType: "NUMBER" },
  { name: "HEADCOUNT", dataType: "NUMBER" },
];
const ROWS: unknown[][] = [
  ["IT",  8000, 32],
  ["HR",  5000, 21],
  ["FIN", 9000, 15],
  ["IT",  7000, 10],
];

beforeEach(() => {
  chartReset({ sessionId: "test" });
});

describe("chartConfigure", () => {
  test("ready: false when type not set", async () => {
    const r = await chartConfigure({
      sessionId: "test",
      patch: { xColumn: "DEPT", yColumns: ["SALARY"], title: "T" },
      columns: COLS,
      rows: ROWS,
    });
    expect(r.ready).toBe(false);
    expect(r.previewData).toBeNull();
  });

  test("ready: false when yColumns empty", async () => {
    const r = await chartConfigure({
      sessionId: "test",
      patch: { type: "bar", xColumn: "DEPT", yColumns: [], title: "T" },
      columns: COLS,
      rows: ROWS,
    });
    expect(r.ready).toBe(false);
  });

  test("ready: false when title not set", async () => {
    const r = await chartConfigure({
      sessionId: "test",
      patch: { type: "bar", xColumn: "DEPT", yColumns: ["SALARY"] },
      columns: COLS,
      rows: ROWS,
    });
    expect(r.ready).toBe(false);
  });

  test("ready: true when all required fields set for bar", async () => {
    const r = await chartConfigure({
      sessionId: "test",
      patch: { type: "bar", xColumn: "DEPT", yColumns: ["SALARY"], title: "Salary by Dept", aggregation: "sum" },
      columns: COLS,
      rows: ROWS,
    });
    expect(r.ready).toBe(true);
    expect(r.previewData).not.toBeNull();
  });

  test("aggregation sum groups by xColumn correctly", async () => {
    const r = await chartConfigure({
      sessionId: "test",
      patch: { type: "bar", xColumn: "DEPT", yColumns: ["SALARY"], title: "T", aggregation: "sum" },
      columns: COLS,
      rows: ROWS,
    });
    // IT has 8000+7000=15000, HR=5000, FIN=9000
    const itIdx = r.previewData!.labels.indexOf("IT");
    expect(r.previewData!.datasets[0].data[itIdx]).toBe(15000);
  });

  test("aggregation none uses first value per label", async () => {
    const r = await chartConfigure({
      sessionId: "test",
      patch: { type: "bar", xColumn: "DEPT", yColumns: ["SALARY"], title: "T", aggregation: "none" },
      columns: COLS,
      rows: ROWS,
    });
    const itIdx = r.previewData!.labels.indexOf("IT");
    expect(r.previewData!.datasets[0].data[itIdx]).toBe(8000);
  });

  test("kpi type: ready without xColumn, previewData has labels=[] and one dataset per yColumn", async () => {
    const r = await chartConfigure({
      sessionId: "test",
      patch: { type: "kpi", yColumns: ["SALARY", "HEADCOUNT"], title: "KPIs", aggregation: "sum" },
      columns: COLS,
      rows: ROWS,
    });
    expect(r.ready).toBe(true);
    expect(r.previewData!.labels).toEqual([]);
    expect(r.previewData!.datasets).toHaveLength(2);
  });

  test("table type: always previewData null, ready without xColumn", async () => {
    const r = await chartConfigure({
      sessionId: "test",
      patch: { type: "table", yColumns: ["SALARY"], title: "Raw Data" },
      columns: COLS,
      rows: ROWS,
    });
    expect(r.ready).toBe(true);
    expect(r.previewData).toBeNull();
  });

  test("config accumulates across calls", async () => {
    await chartConfigure({ sessionId: "test", patch: { type: "bar" }, columns: COLS, rows: ROWS });
    await chartConfigure({ sessionId: "test", patch: { xColumn: "DEPT" }, columns: COLS, rows: ROWS });
    const r = await chartConfigure({
      sessionId: "test",
      patch: { yColumns: ["SALARY"], title: "T", aggregation: "sum" },
      columns: COLS,
      rows: ROWS,
    });
    expect(r.config.type).toBe("bar");
    expect(r.config.xColumn).toBe("DEPT");
    expect(r.ready).toBe(true);
  });

  test("chartReset clears session config", async () => {
    await chartConfigure({
      sessionId: "test",
      patch: { type: "bar", xColumn: "DEPT", yColumns: ["SALARY"], title: "T", aggregation: "sum" },
      columns: COLS,
      rows: ROWS,
    });
    chartReset({ sessionId: "test" });
    const r = await chartConfigure({ sessionId: "test", patch: {}, columns: COLS, rows: ROWS });
    expect(r.config.type).toBeNull();
    expect(r.ready).toBe(false);
  });

  test("unknown column name: returns ready:false, no throw", async () => {
    const r = await chartConfigure({
      sessionId: "test",
      patch: { type: "bar", xColumn: "NONEXISTENT", yColumns: ["SALARY"], title: "T", aggregation: "sum" },
      columns: COLS,
      rows: ROWS,
    });
    expect(r.ready).toBe(false);
    expect(r.previewData).toBeNull();
  });
});
