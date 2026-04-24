import type { ChartConfig, PreviewData } from "$lib/workspace";

export type DashboardChart = {
  id: string;
  config: ChartConfig;
  previewData: PreviewData | null;
  sql: string;
  columns: { name: string; dataType: string }[];
  rows: unknown[][];
  totalRows: number;
  addedAt: number;
};

const ROW_CAP = 500;

class DashboardStore {
  charts = $state<DashboardChart[]>([]);

  addChart(chart: Omit<DashboardChart, "id" | "addedAt" | "totalRows">): void {
    const id = crypto.randomUUID();
    const totalRows = chart.rows.length;
    const rows = totalRows > ROW_CAP ? chart.rows.slice(0, ROW_CAP) : chart.rows;
    this.charts = [...this.charts, { ...chart, rows, totalRows, id, addedAt: Date.now() }];
  }

  removeChart(id: string): void {
    this.charts = this.charts.filter((c) => c.id !== id);
  }

  clearDashboard(): void {
    this.charts = [];
  }
}

export const dashboard = new DashboardStore();
