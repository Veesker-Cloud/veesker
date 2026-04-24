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

type DashboardState = { charts: DashboardChart[] };

let state = $state<DashboardState>({ charts: [] });

export function addChart(chart: Omit<DashboardChart, "id" | "addedAt">): void {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  state.charts = [...state.charts, { ...chart, id, addedAt: Date.now() }];
}

export function removeChart(id: string): void {
  state.charts = state.charts.filter((c) => c.id !== id);
}

export function clearDashboard(): void {
  state.charts = [];
}

export { state as dashboardState };
