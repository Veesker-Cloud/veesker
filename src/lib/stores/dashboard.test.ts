import { describe, expect, it, beforeEach } from "vitest";
import { dashboardState, addChart, removeChart, clearDashboard } from "./dashboard.svelte";
import type { ChartConfig, PreviewData } from "$lib/workspace";

const cfg: ChartConfig = { type: "bar", xColumn: "DEPT", yColumns: ["SALARY"], aggregation: "sum", title: "Test" };
const pd: PreviewData  = { labels: ["IT"], datasets: [{ label: "SALARY", data: [5000] }] };

beforeEach(() => clearDashboard());

describe("dashboard store", () => {
  it("starts empty", () => {
    expect(dashboardState.charts).toHaveLength(0);
  });

  it("addChart appends a chart with generated id", () => {
    addChart({ config: cfg, previewData: pd, sql: "SELECT 1", columns: [], rows: [] });
    expect(dashboardState.charts).toHaveLength(1);
    expect(dashboardState.charts[0].id).toBeTruthy();
    expect(dashboardState.charts[0].config.title).toBe("Test");
  });

  it("removeChart removes by id", () => {
    addChart({ config: cfg, previewData: pd, sql: "SELECT 1", columns: [], rows: [] });
    const id = dashboardState.charts[0].id;
    removeChart(id);
    expect(dashboardState.charts).toHaveLength(0);
  });

  it("clearDashboard empties all charts", () => {
    addChart({ config: cfg, previewData: pd, sql: "SELECT 1", columns: [], rows: [] });
    addChart({ config: cfg, previewData: pd, sql: "SELECT 2", columns: [], rows: [] });
    clearDashboard();
    expect(dashboardState.charts).toHaveLength(0);
  });
});
