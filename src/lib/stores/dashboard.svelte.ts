import type { ChartConfig, PreviewData } from "$lib/workspace";

export type DashboardChart = {
  id: string;
  config: ChartConfig;
  previewData: PreviewData | null;
  sql: string;
  columns: { name: string; dataType: string }[];
  rows: unknown[][];
  addedAt: number;
};

class DashboardStore {
  charts = $state<DashboardChart[]>([]);

  addChart(chart: Omit<DashboardChart, "id" | "addedAt">): void {
    const id = crypto.randomUUID();
    this.charts = [...this.charts, { ...chart, id, addedAt: Date.now() }];
  }

  removeChart(id: string): void {
    this.charts = this.charts.filter((c) => c.id !== id);
  }

  clearDashboard(): void {
    this.charts = [];
  }
}

export const dashboard = new DashboardStore();
