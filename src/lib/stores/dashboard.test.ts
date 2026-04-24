import { describe, expect, it, beforeEach } from "vitest";
import { dashboard } from "./dashboard.svelte";
import type { ChartConfig, PreviewData } from "$lib/workspace";

const cfg: ChartConfig = { type: "bar", xColumn: "DEPT", yColumns: ["SALARY"], aggregation: "sum", title: "Test" };
const pd: PreviewData  = { labels: ["IT"], datasets: [{ label: "SALARY", data: [5000] }] };

beforeEach(() => dashboard.clearDashboard());

describe("dashboard store", () => {
  it("starts empty", () => {
    expect(dashboard.charts).toHaveLength(0);
  });

  it("addChart appends a chart with generated id", () => {
    dashboard.addChart({ config: cfg, previewData: pd, sql: "SELECT 1", columns: [], rows: [] });
    expect(dashboard.charts).toHaveLength(1);
    expect(dashboard.charts[0].id).toBeTruthy();
    expect(dashboard.charts[0].config.title).toBe("Test");
  });

  it("removeChart removes by id", () => {
    dashboard.addChart({ config: cfg, previewData: pd, sql: "SELECT 1", columns: [], rows: [] });
    const id = dashboard.charts[0].id;
    dashboard.removeChart(id);
    expect(dashboard.charts).toHaveLength(0);
  });

  it("clearDashboard empties all charts", () => {
    dashboard.addChart({ config: cfg, previewData: pd, sql: "SELECT 1", columns: [], rows: [] });
    dashboard.addChart({ config: cfg, previewData: pd, sql: "SELECT 2", columns: [], rows: [] });
    dashboard.clearDashboard();
    expect(dashboard.charts).toHaveLength(0);
  });
});
