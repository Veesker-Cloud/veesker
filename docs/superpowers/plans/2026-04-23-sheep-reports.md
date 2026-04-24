# Sheep Reports & Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to generate visual dashboards and exportable PDF reports from any query result, guided by a scripted conversational flow inside SheepChat with inline Chart.js previews.

**Architecture:** Sidecar accumulates chart config deterministically via `chart.configure` RPC (no AI for config logic). SheepChat drives a step-by-step question flow using scripted messages; each user answer is matched against known values, then `chartConfigure` is called and the result rendered inline as a `<ChartWidget>`. Confirmed charts are added to a `DashboardTab` workspace tab with intelligent layout (KPIs top, 2/3 + 1/3 split). PDF exported via `window.print()`.

**Tech Stack:** SvelteKit 5 runes, Chart.js (npm), Bun/TypeScript sidecar, Tauri 2, `window.print()` for PDF.

---

## Task 1: Sidecar chart config accumulator (`sidecar/src/chart.ts`)

**Files:**
- Create: `sidecar/src/chart.ts`
- Create: `sidecar/tests/chart.test.ts`
- Modify: `sidecar/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `sidecar/tests/chart.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd sidecar
bun test tests/chart.test.ts
```

Expected: FAIL — `../src/chart` not found.

- [ ] **Step 3: Implement `sidecar/src/chart.ts`**

```ts
export type ChartType = "bar" | "bar-h" | "line" | "pie" | "kpi" | "table";
export type ChartAggregation = "none" | "sum" | "avg" | "count" | "max" | "min";

export type ChartConfig = {
  type: ChartType | null;
  xColumn: string | null;
  yColumns: string[];
  aggregation: ChartAggregation;
  title: string | null;
};

export type PreviewData = {
  labels: string[];
  datasets: { label: string; data: number[] }[];
};

export type ChartConfigureResult = {
  config: ChartConfig;
  previewData: PreviewData | null;
  ready: boolean;
};

type ConfigureParams = {
  sessionId: string;
  patch: Partial<ChartConfig>;
  columns: { name: string; dataType: string }[];
  rows: unknown[][];
};

const sessions = new Map<string, ChartConfig>();

function emptyConfig(): ChartConfig {
  return { type: null, xColumn: null, yColumns: [], aggregation: "none", title: null };
}

function colIndex(columns: { name: string }[], name: string): number {
  return columns.findIndex((c) => c.name === name);
}

function applyAgg(values: number[], agg: ChartAggregation): number {
  if (values.length === 0) return 0;
  switch (agg) {
    case "sum": return values.reduce((a, b) => a + b, 0);
    case "avg": return values.reduce((a, b) => a + b, 0) / values.length;
    case "count": return values.length;
    case "max": return Math.max(...values);
    case "min": return Math.min(...values);
    default: return values[0];
  }
}

function buildPreview(
  config: ChartConfig,
  columns: { name: string; dataType: string }[],
  rows: unknown[][]
): PreviewData | null {
  if (!config.type || config.yColumns.length === 0) return null;
  if (config.type === "table") return null;

  if (config.type === "kpi") {
    const datasets = config.yColumns.map((yCol) => {
      const yi = colIndex(columns, yCol);
      if (yi === -1) return { label: yCol, data: [0] };
      const values = rows.map((r) => Number(r[yi]) || 0);
      return { label: yCol, data: [applyAgg(values, config.aggregation)] };
    });
    return { labels: [], datasets };
  }

  if (!config.xColumn) return null;
  const xi = colIndex(columns, config.xColumn);
  if (xi === -1) return null;

  // Collect unique labels preserving insertion order
  const labelSet: string[] = [];
  const labelIndex = new Map<string, number>();
  for (const row of rows) {
    const label = String(row[xi] ?? "");
    if (!labelIndex.has(label)) {
      labelIndex.set(label, labelSet.length);
      labelSet.push(label);
    }
  }

  const datasets = config.yColumns.map((yCol) => {
    const yi = colIndex(columns, yCol);
    if (yi === -1) return { label: yCol, data: labelSet.map(() => 0) };
    // Group values by label
    const groups = new Map<string, number[]>();
    for (const label of labelSet) groups.set(label, []);
    for (const row of rows) {
      const label = String(row[xi] ?? "");
      if (groups.has(label)) groups.get(label)!.push(Number(row[yi]) || 0);
    }
    const data = labelSet.map((label) => applyAgg(groups.get(label)!, config.aggregation));
    return { label: yCol, data };
  });

  return { labels: labelSet, datasets };
}

function isReady(config: ChartConfig): boolean {
  if (!config.type || config.yColumns.length === 0 || !config.title) return false;
  if (config.type === "kpi" || config.type === "table") return true;
  return config.xColumn !== null;
}

export async function chartConfigure(p: ConfigureParams): Promise<ChartConfigureResult> {
  const config = sessions.get(p.sessionId) ?? emptyConfig();
  const patch = p.patch;

  if (patch.type !== undefined && patch.type !== null) config.type = patch.type;
  if (patch.xColumn !== undefined && patch.xColumn !== null) config.xColumn = patch.xColumn;
  if (patch.yColumns !== undefined) config.yColumns = patch.yColumns;
  if (patch.aggregation !== undefined && patch.aggregation !== null) config.aggregation = patch.aggregation;
  if (patch.title !== undefined && patch.title !== null) config.title = patch.title;

  sessions.set(p.sessionId, config);

  const previewData = buildPreview(config, p.columns, p.rows);
  const ready = isReady(config) && previewData !== null ||
    (isReady(config) && config.type === "table");

  return { config: { ...config }, previewData, ready };
}

export function chartReset(p: { sessionId: string }): { ok: true } {
  sessions.delete(p.sessionId);
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd sidecar
bun test tests/chart.test.ts
```

Expected: all 11 tests PASS.

- [ ] **Step 5: Register handlers in `sidecar/src/index.ts`**

Add import at top alongside other imports:
```ts
import { chartConfigure, chartReset } from "./chart";
```

Add to the `handlers` object (after `"proc.execute"` entry):
```ts
"chart.configure": (params) => chartConfigure(params as any),
"chart.reset":     (params) => chartReset(params as any),
```

- [ ] **Step 6: Run all sidecar tests**

```bash
cd sidecar
bun test
```

Expected: 91+ tests pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add sidecar/src/chart.ts sidecar/src/index.ts sidecar/tests/chart.test.ts
git commit -m "feat(chart): add chart config accumulator RPC — chartConfigure, chartReset"
```

---

## Task 2: Tauri plumbing — Rust commands + TS wrappers

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/workspace.ts`

- [ ] **Step 1: Add Rust commands to `src-tauri/src/commands.rs`**

Append at the end of the file (after `proc_execute`):

```rust
#[tauri::command]
pub async fn chart_configure(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "chart.configure", payload).await?;
    Ok(res)
}

#[tauri::command]
pub async fn chart_reset(app: AppHandle, session_id: String) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "chart.reset", json!({ "sessionId": session_id })).await?;
    Ok(res)
}
```

- [ ] **Step 2: Register commands in `src-tauri/src/lib.rs`**

Add after `commands::proc_execute,` in the `invoke_handler!` macro:
```rust
commands::chart_configure,
commands::chart_reset,
```

- [ ] **Step 3: Add types and wrappers to `src/lib/workspace.ts`**

Append at the end of `src/lib/workspace.ts`:

```ts
// ── Chart Reports ────────────────────────────────────────────────────────────

export type ChartType = "bar" | "bar-h" | "line" | "pie" | "kpi" | "table";
export type ChartAggregation = "none" | "sum" | "avg" | "count" | "max" | "min";

export type ChartConfig = {
  type: ChartType | null;
  xColumn: string | null;
  yColumns: string[];
  aggregation: ChartAggregation;
  title: string | null;
};

export type PreviewData = {
  labels: string[];
  datasets: { label: string; data: number[] }[];
};

export type ChartConfigureResult = {
  config: ChartConfig;
  previewData: PreviewData | null;
  ready: boolean;
};

export const chartConfigureRpc = (payload: {
  sessionId: string;
  patch: Partial<ChartConfig>;
  columns: { name: string; dataType: string }[];
  rows: unknown[][];
}) => call<ChartConfigureResult>("chart_configure", { payload });

export const chartResetRpc = (sessionId: string) =>
  call<{ ok: true }>("chart_reset", { sessionId });
```

- [ ] **Step 4: Build to verify Rust compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: `Compiling veesker ...` then `Finished`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/workspace.ts
git commit -m "feat(chart): add chart_configure and chart_reset Tauri commands and TS wrappers"
```

---

## Task 3: ChartWidget component

**Files:**
- Create: `src/lib/workspace/ChartWidget.svelte`
- Create: `src/lib/workspace/ChartWidget.test.ts`

- [ ] **Step 1: Install Chart.js**

```bash
bun add chart.js
```

Verify `package.json` now lists `"chart.js"` in dependencies.

- [ ] **Step 2: Write failing tests**

Create `src/lib/workspace/ChartWidget.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import ChartWidget from "./ChartWidget.svelte";
import type { ChartConfig, PreviewData } from "$lib/workspace";

const barConfig: ChartConfig = {
  type: "bar", xColumn: "DEPT", yColumns: ["SALARY"],
  aggregation: "sum", title: "Salary by Dept",
};
const lineConfig: ChartConfig = { ...barConfig, type: "line" };
const pieConfig: ChartConfig  = { ...barConfig, type: "pie" };
const barHConfig: ChartConfig = { ...barConfig, type: "bar-h" };

const previewData: PreviewData = {
  labels: ["IT", "HR", "FIN"],
  datasets: [{ label: "SALARY", data: [15000, 5000, 9000] }],
};

const kpiConfig: ChartConfig = {
  type: "kpi", xColumn: null, yColumns: ["SALARY", "HEADCOUNT"],
  aggregation: "sum", title: "KPIs",
};
const kpiData: PreviewData = {
  labels: [],
  datasets: [
    { label: "SALARY", data: [29000] },
    { label: "HEADCOUNT", data: [78] },
  ],
};

const tableConfig: ChartConfig = {
  type: "table", xColumn: null, yColumns: [],
  aggregation: "none", title: "Raw Data",
};

describe("ChartWidget", () => {
  it("renders a canvas for bar type", () => {
    render(ChartWidget, { props: { config: barConfig, previewData, rows: [] } });
    expect(document.querySelector("canvas")).toBeTruthy();
  });

  it("renders a canvas for line type", () => {
    render(ChartWidget, { props: { config: lineConfig, previewData, rows: [] } });
    expect(document.querySelector("canvas")).toBeTruthy();
  });

  it("renders a canvas for pie type", () => {
    render(ChartWidget, { props: { config: pieConfig, previewData, rows: [] } });
    expect(document.querySelector("canvas")).toBeTruthy();
  });

  it("renders a canvas for bar-h type", () => {
    render(ChartWidget, { props: { config: barHConfig, previewData, rows: [] } });
    expect(document.querySelector("canvas")).toBeTruthy();
  });

  it("renders KPI cards for kpi type — no canvas", () => {
    render(ChartWidget, { props: { config: kpiConfig, previewData: kpiData, rows: [] } });
    expect(document.querySelector("canvas")).toBeFalsy();
    expect(screen.getByText("SALARY")).toBeInTheDocument();
    expect(screen.getByText("29000")).toBeInTheDocument();
  });

  it("renders a table for table type — no canvas", () => {
    const cols = [{ name: "DEPT", dataType: "VARCHAR2" }, { name: "SALARY", dataType: "NUMBER" }];
    const rows = [["IT", 8000], ["HR", 5000]];
    render(ChartWidget, { props: { config: tableConfig, previewData: null, columns: cols, rows } });
    expect(document.querySelector("canvas")).toBeFalsy();
    expect(document.querySelector("table")).toBeTruthy();
    expect(screen.getByText("DEPT")).toBeInTheDocument();
    expect(screen.getByText("IT")).toBeInTheDocument();
  });

  it("applies compact class when compact=true", () => {
    const { container } = render(ChartWidget, {
      props: { config: kpiConfig, previewData: kpiData, rows: [], compact: true },
    });
    expect(container.querySelector(".chart-widget.compact")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun run test src/lib/workspace/ChartWidget.test.ts
```

Expected: FAIL — `ChartWidget.svelte` not found.

- [ ] **Step 4: Implement `src/lib/workspace/ChartWidget.svelte`**

```svelte
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { ChartConfig, PreviewData } from "$lib/workspace";

  type Props = {
    config: ChartConfig;
    previewData: PreviewData | null;
    columns?: { name: string; dataType: string }[];
    rows?: unknown[][];
    compact?: boolean;
  };
  let { config, previewData, columns = [], rows = [], compact = false }: Props = $props();

  const PALETTE = ["#4a9eda", "#8bc4a8", "#c3a66e", "#f5a08a", "#7aa8c4", "#a78bfa"];

  let canvas = $state<HTMLCanvasElement | null>(null);
  let chart: any = null;

  function destroyChart() {
    if (chart) { chart.destroy(); chart = null; }
  }

  async function buildChart() {
    if (!canvas || !previewData) return;
    destroyChart();
    const { Chart, registerables } = await import("chart.js");
    Chart.register(...registerables);

    const isHorizontal = config.type === "bar-h";
    const isDoughnut   = config.type === "pie";
    const chartType    = isDoughnut ? "doughnut" : "bar";

    chart = new Chart(canvas, {
      type: config.type === "line" ? "line" : chartType,
      data: {
        labels: previewData.labels,
        datasets: previewData.datasets.map((ds, i) => ({
          label: ds.label,
          data: ds.data,
          backgroundColor: isDoughnut
            ? previewData.labels.map((_, j) => PALETTE[j % PALETTE.length])
            : PALETTE[i % PALETTE.length] + "cc",
          borderColor: PALETTE[i % PALETTE.length],
          borderWidth: 1.5,
          fill: config.type === "line",
          tension: 0.3,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        indexAxis: isHorizontal ? "y" : "x",
        plugins: {
          legend: { display: previewData.datasets.length > 1 || isDoughnut, labels: { color: "var(--text-primary)", font: { size: 10 } } },
          title: { display: false },
        },
        scales: isDoughnut ? {} : {
          x: { ticks: { color: "var(--text-muted)", font: { size: 9 } }, grid: { color: "var(--border)" } },
          y: { ticks: { color: "var(--text-muted)", font: { size: 9 } }, grid: { color: "var(--border)" } },
        },
      },
    });
  }

  $effect(() => {
    if (config.type && config.type !== "kpi" && config.type !== "table" && previewData) {
      void buildChart();
    }
    return destroyChart;
  });

  onDestroy(destroyChart);

  function kpiValue(data: number[]): string {
    const v = data[0] ?? 0;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}k`;
    return String(v);
  }
</script>

<div class="chart-widget" class:compact>
  {#if config.type === "kpi" && previewData}
    <div class="kpi-row">
      {#each previewData.datasets as ds, i}
        <div class="kpi-card">
          <div class="kpi-label">{ds.label}</div>
          <div class="kpi-value" style="color:{PALETTE[i % PALETTE.length]}">{kpiValue(ds.data)}</div>
        </div>
      {/each}
    </div>
  {:else if config.type === "table"}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>{#each columns as col}<th>{col.name}</th>{/each}</tr>
        </thead>
        <tbody>
          {#each rows as row}
            <tr>{#each row as cell}<td>{cell ?? "NULL"}</td>{/each}</tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <canvas bind:this={canvas}></canvas>
  {/if}
</div>

<style>
  .chart-widget { background: var(--bg-surface-alt); border-radius: 4px; padding: 8px; width: 100%; }
  .chart-widget.compact { max-height: 160px; overflow: hidden; }
  canvas { width: 100% !important; max-height: 200px; }
  .chart-widget.compact canvas { max-height: 130px; }
  .kpi-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .kpi-card { flex: 1; min-width: 80px; background: var(--bg-surface); border-radius: 4px; padding: 8px; text-align: center; }
  .kpi-label { font-size: 9px; color: var(--text-muted); margin-bottom: 4px; }
  .kpi-value { font-size: 18px; font-weight: 700; }
  .chart-widget.compact .kpi-value { font-size: 14px; }
  .table-wrap { overflow: auto; max-height: 180px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; color: var(--text-primary); }
  th { background: var(--bg-surface); color: var(--text-muted); padding: 3px 6px; text-align: left; font-weight: 600; position: sticky; top: 0; }
  td { padding: 3px 6px; border-bottom: 1px solid var(--border); }
  tr:nth-child(even) { background: rgba(255,255,255,0.02); }
</style>
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun run test src/lib/workspace/ChartWidget.test.ts
```

Expected: 7 tests PASS. (Canvas tests pass because canvas exists even if getContext is not implemented in jsdom.)

- [ ] **Step 6: Run full test suite**

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/workspace/ChartWidget.svelte src/lib/workspace/ChartWidget.test.ts package.json bun.lockb
git commit -m "feat(chart): add ChartWidget component — 6 chart types via Chart.js"
```

---

## Task 4: Dashboard store + DashboardTab component

**Files:**
- Create: `src/lib/stores/dashboard.svelte.ts`
- Create: `src/lib/workspace/DashboardTab.svelte`
- Modify: `src/routes/workspace/[id]/+page.svelte`

- [ ] **Step 1: Write failing store tests**

Create `src/lib/stores/dashboard.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun run test src/lib/stores/dashboard.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/stores/dashboard.svelte.ts`**

```ts
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
```

- [ ] **Step 4: Run store tests to verify they pass**

```bash
bun run test src/lib/stores/dashboard.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Implement `src/lib/workspace/DashboardTab.svelte`**

```svelte
<script lang="ts">
  import { dashboardState, removeChart, clearDashboard } from "$lib/stores/dashboard.svelte";
  import ChartWidget from "./ChartWidget.svelte";

  const kpiCharts    = $derived(dashboardState.charts.filter((c) => c.config.type === "kpi"));
  const nonKpiCharts = $derived(dashboardState.charts.filter((c) => c.config.type !== "kpi"));

  async function exportPdf() {
    const root = document.createElement("div");
    root.id = "pdf-print-root";

    // Cover page
    const firstTitle = dashboardState.charts[0]?.config.title ?? "Dashboard Report";
    const firstSql   = dashboardState.charts[0]?.sql ?? "";
    const cover = document.createElement("div");
    cover.className = "pdf-cover";
    cover.innerHTML = `
      <h1>${firstTitle}</h1>
      <p class="pdf-date">${new Date().toISOString().slice(0, 10)}</p>
      ${firstSql ? `<pre class="pdf-sql">${firstSql}</pre>` : ""}
    `;
    root.appendChild(cover);

    // Each chart
    for (const chart of dashboardState.charts) {
      const section = document.createElement("div");
      section.className = "pdf-section";

      const heading = document.createElement("h2");
      heading.textContent = chart.config.title ?? "Chart";
      section.appendChild(heading);

      // Chart image from canvas
      const canvasEl = document.querySelector<HTMLCanvasElement>(`[data-chart-id="${chart.id}"] canvas`);
      if (canvasEl) {
        const img = document.createElement("img");
        img.src = canvasEl.toDataURL("image/png");
        img.style.width = "100%";
        section.appendChild(img);
      }

      // Data table
      if (chart.columns.length > 0 && chart.rows.length > 0) {
        const table = document.createElement("table");
        table.className = "pdf-table";
        const thead = `<tr>${chart.columns.map((c) => `<th>${c.name}</th>`).join("")}</tr>`;
        const tbody = chart.rows.slice(0, 50).map(
          (row) => `<tr>${(row as unknown[]).map((cell) => `<td>${cell ?? "NULL"}</td>`).join("")}</tr>`
        ).join("");
        table.innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
        section.appendChild(table);
      }

      root.appendChild(section);
    }

    document.body.appendChild(root);
    window.print();
    // Give print dialog time to open before removing
    setTimeout(() => document.body.removeChild(root), 1000);
  }
</script>

<div class="dashboard-root">
  <div class="dash-header">
    <span class="dash-title">Dashboard</span>
    <div class="dash-actions">
      {#if dashboardState.charts.length > 0}
        <button class="dash-btn" onclick={clearDashboard}>Clear All</button>
        <button class="dash-btn primary" onclick={() => void exportPdf()}>Export PDF</button>
      {/if}
    </div>
  </div>

  {#if dashboardState.charts.length === 0}
    <div class="dash-empty">
      <p>No charts yet. Run a query and click <strong>📊 Analyze</strong> to get started.</p>
    </div>
  {:else}
    <div class="dash-body">
      {#if kpiCharts.length > 0}
        <div class="kpi-strip">
          {#each kpiCharts as chart (chart.id)}
            <div class="chart-cell" data-chart-id={chart.id} style="flex:1">
              <div class="chart-cell-header">
                <span class="chart-cell-title">{chart.config.title}</span>
                <button class="remove-btn" onclick={() => removeChart(chart.id)} title="Remove">✕</button>
              </div>
              <ChartWidget config={chart.config} previewData={chart.previewData} columns={chart.columns} rows={chart.rows} />
            </div>
          {/each}
        </div>
      {/if}

      {#each { length: Math.ceil(nonKpiCharts.length / 2) } as _, rowIdx}
        {@const main = nonKpiCharts[rowIdx * 2]}
        {@const side = nonKpiCharts[rowIdx * 2 + 1]}
        <div class="chart-row">
          {#if main}
            <div class="chart-cell" data-chart-id={main.id} style="flex:2">
              <div class="chart-cell-header">
                <span class="chart-cell-title">{main.config.title}</span>
                <button class="remove-btn" onclick={() => removeChart(main.id)} title="Remove">✕</button>
              </div>
              <ChartWidget config={main.config} previewData={main.previewData} columns={main.columns} rows={main.rows} />
            </div>
          {/if}
          {#if side}
            <div class="chart-cell" data-chart-id={side.id} style="flex:1">
              <div class="chart-cell-header">
                <span class="chart-cell-title">{side.config.title}</span>
                <button class="remove-btn" onclick={() => removeChart(side.id)} title="Remove">✕</button>
              </div>
              <ChartWidget config={side.config} previewData={side.previewData} columns={side.columns} rows={side.rows} />
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dashboard-root { display:flex; flex-direction:column; height:100%; background:var(--bg-surface); overflow:hidden; }
  .dash-header { display:flex; align-items:center; padding:6px 12px; border-bottom:1px solid var(--border); flex-shrink:0; gap:8px; }
  .dash-title { font-size:11px; color:var(--text-muted); flex:1; }
  .dash-actions { display:flex; gap:6px; }
  .dash-btn { font-size:11px; padding:3px 8px; border-radius:4px; border:1px solid var(--border); background:var(--input-bg); color:var(--text-primary); cursor:pointer; }
  .dash-btn.primary { background:rgba(179,62,31,0.15); border-color:rgba(179,62,31,0.4); color:#f5a08a; }
  .dash-btn:hover { background:var(--row-hover); }
  .dash-empty { flex:1; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:12px; }
  .dash-body { flex:1; overflow-y:auto; padding:10px; display:flex; flex-direction:column; gap:10px; }
  .kpi-strip { display:flex; gap:10px; }
  .chart-row { display:flex; gap:10px; }
  .chart-cell { min-width:0; background:var(--bg-surface-alt); border-radius:6px; padding:8px; }
  .chart-cell-header { display:flex; align-items:center; margin-bottom:6px; gap:4px; }
  .chart-cell-title { flex:1; font-size:10px; font-weight:600; color:var(--text-primary); }
  .remove-btn { background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px; padding:1px 3px; border-radius:2px; }
  .remove-btn:hover { color:#f5a08a; background:rgba(179,62,31,0.15); }

  @media print {
    :global(body > *:not(#pdf-print-root)) { display: none !important; }
    :global(#pdf-print-root) { display: block; font-family: sans-serif; }
    :global(#pdf-print-root .pdf-cover) { page-break-after: always; padding: 40px; }
    :global(#pdf-print-root .pdf-cover h1) { font-size: 28px; margin-bottom: 8px; }
    :global(#pdf-print-root .pdf-date) { color: #666; margin-bottom: 16px; }
    :global(#pdf-print-root .pdf-sql) { font-family: monospace; font-size: 10px; background: #f5f5f5; padding: 12px; border-radius: 4px; white-space: pre-wrap; }
    :global(#pdf-print-root .pdf-section) { page-break-before: always; padding: 20px; }
    :global(#pdf-print-root .pdf-section h2) { font-size: 18px; margin-bottom: 12px; }
    :global(#pdf-print-root .pdf-table) { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 12px; }
    :global(#pdf-print-root .pdf-table th) { background: #f0f0f0; padding: 4px 8px; border: 1px solid #ccc; text-align: left; }
    :global(#pdf-print-root .pdf-table td) { padding: 4px 8px; border: 1px solid #ddd; }
  }
</style>
```

- [ ] **Step 6: Add Dashboard tab to `src/routes/workspace/[id]/+page.svelte`**

Find the import block at the top and add:
```ts
import DashboardTab from "$lib/workspace/DashboardTab.svelte";
```

Find where workspace tabs are declared (the `<div class="ws-tabs">` or similar tab bar). Add a Dashboard tab button. The exact location depends on the existing tab markup — look for the area where tab buttons like "SQL" are rendered and add alongside them:

```svelte
<button
  class="ws-tab"
  class:active={activeWsTab === "dashboard"}
  onclick={() => activeWsTab = "dashboard"}
>
  📊 Dashboard
</button>
```

Then in the tab content area add (alongside the existing SQL tab content block):
```svelte
{#if activeWsTab === "dashboard"}
  <DashboardTab />
{/if}
```

If `activeWsTab` state doesn't exist yet, add it:
```ts
let activeWsTab = $state<"sql" | "dashboard">("sql");
```

- [ ] **Step 7: Run all frontend tests**

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/stores/dashboard.svelte.ts src/lib/stores/dashboard.test.ts src/lib/workspace/DashboardTab.svelte src/routes/workspace/[id]/+page.svelte
git commit -m "feat(dashboard): add dashboard store, DashboardTab with intelligent layout and PDF export"
```

---

## Task 5: Analyze flow — SheepChat rich messages + ResultGrid trigger

**Files:**
- Modify: `src/lib/workspace/SheepChat.svelte`
- Modify: `src/lib/workspace/ResultGrid.svelte`
- Modify: `src/routes/workspace/[id]/+page.svelte`

- [ ] **Step 1: Extend SheepChat with analyze mode**

In `src/lib/workspace/SheepChat.svelte`, update the `Props` type and add analyze state:

```ts
// Add imports
import { chartConfigureRpc, chartResetRpc } from "$lib/workspace";
import { addChart } from "$lib/stores/dashboard.svelte";
import ChartWidget from "./ChartWidget.svelte";
import type { ChartConfig, PreviewData, ChartConfigureResult } from "$lib/workspace";

// Update Props type:
type Props = {
  context: AiContext;
  onClose: () => void;
  pendingMessage?: string;
  analyzePayload?: AnalyzePayload | null;
  onChartAdded?: () => void;
};

// Add new type for analyze payload:
type AnalyzePayload = {
  sessionId: string;
  columns: { name: string; dataType: string }[];
  rows: unknown[][];
  sql: string;
};

// Add to internal message type:
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  chartPreview?: { config: ChartConfig; previewData: PreviewData | null };
};

// Replace messages state type:
let messages = $state<ChatMessage[]>([]);

// Add analyze state:
let analyzeStep = $state<"type" | "xColumn" | "yColumns" | "aggregation" | "title" | "confirm" | null>(null);
let analyzePayload = $derived((props as any).analyzePayload as AnalyzePayload | null);
```

Replace the `$effect` for `pendingMessage` and add analyze trigger:

```ts
$effect(() => {
  if (pendingMessage) input = pendingMessage;
});

$effect(() => {
  if (analyzePayload) {
    void startAnalyze(analyzePayload);
  }
});
```

Add the analyze conversation functions:

```ts
async function startAnalyze(payload: AnalyzePayload) {
  await chartResetRpc(payload.sessionId);
  analyzeStep = "type";
  const colList = payload.columns.map((c) => c.name).join(", ");
  messages = [];
  pushAssistant(
    `I'll help you build a chart from this result (${payload.columns.length} columns, ${payload.rows.length} rows).\n\n` +
    `**What type of chart would you like?**\n` +
    `- bar — vertical bars\n- bar-h — horizontal bars\n- line — trend line\n- pie — donut/pie\n- kpi — big number cards\n- table — formatted table\n\nAvailable columns: \`${colList}\``
  );
  await scrollToBottom();
}

function pushAssistant(content: string, chartPreview?: ChatMessage["chartPreview"]) {
  messages = [...messages, { role: "assistant" as const, content, chartPreview }];
}

const CHART_TYPES: Record<string, string> = {
  bar: "bar", "bar-h": "bar-h", barh: "bar-h", horizontal: "bar-h",
  line: "line", trend: "line",
  pie: "pie", donut: "pie",
  kpi: "kpi", card: "kpi", number: "kpi",
  table: "table", raw: "table",
};

const AGG_MAP: Record<string, string> = {
  sum: "sum", total: "sum",
  avg: "avg", average: "avg", mean: "avg",
  count: "count", cnt: "count",
  max: "max", maximum: "max",
  min: "min", minimum: "min",
  none: "none", raw: "none",
};

async function handleAnalyzeAnswer(text: string, payload: AnalyzePayload) {
  const lower = text.toLowerCase().trim();

  if (analyzeStep === "type") {
    const matched = Object.entries(CHART_TYPES).find(([k]) => lower.includes(k));
    if (!matched) {
      pushAssistant("I didn't catch that — please say one of: bar, bar-h, line, pie, kpi, table.");
      return;
    }
    const r = await chartConfigureRpc({ sessionId: payload.sessionId, patch: { type: matched[1] as any }, columns: payload.columns, rows: payload.rows });
    if (matched[1] === "kpi" || matched[1] === "table") {
      analyzeStep = "yColumns";
      const numericCols = payload.columns.filter((c) => c.dataType.includes("NUMBER") || c.dataType.includes("FLOAT") || c.dataType.includes("INT"));
      pushAssistant(
        `Got it — **${matched[1]}** chart.\n\n**Which column(s) for the values?** ` +
        `(comma-separated if multiple)\nNumeric columns: \`${numericCols.map((c) => c.name).join(", ") || payload.columns.map((c) => c.name).join(", ")}\``,
        { config: r.config, previewData: r.previewData }
      );
    } else {
      analyzeStep = "xColumn";
      pushAssistant(
        `Got it — **${matched[1]}** chart.\n\n**Which column for the X axis (labels)?**\nColumns: \`${payload.columns.map((c) => c.name).join(", ")}\``,
        { config: r.config, previewData: r.previewData }
      );
    }

  } else if (analyzeStep === "xColumn") {
    const col = payload.columns.find((c) => c.name.toLowerCase() === lower || lower.includes(c.name.toLowerCase()));
    if (!col) {
      pushAssistant(`Column not found. Available: \`${payload.columns.map((c) => c.name).join(", ")}\``);
      return;
    }
    const r = await chartConfigureRpc({ sessionId: payload.sessionId, patch: { xColumn: col.name }, columns: payload.columns, rows: payload.rows });
    analyzeStep = "yColumns";
    const numericCols = payload.columns.filter((c) => c.dataType.includes("NUMBER") || c.dataType.includes("FLOAT") || c.dataType.includes("INT"));
    pushAssistant(
      `X axis: **${col.name}**\n\n**Which column(s) for the Y axis (values)?** (comma-separated)\nNumeric columns: \`${numericCols.map((c) => c.name).join(", ") || payload.columns.map((c) => c.name).join(", ")}\``,
      { config: r.config, previewData: r.previewData }
    );

  } else if (analyzeStep === "yColumns") {
    const parts = text.split(",").map((s) => s.trim());
    const matched = parts.map((p) => payload.columns.find((c) => c.name.toLowerCase() === p.toLowerCase() || p.toLowerCase().includes(c.name.toLowerCase()))).filter(Boolean);
    if (matched.length === 0) {
      pushAssistant(`No columns matched. Available: \`${payload.columns.map((c) => c.name).join(", ")}\``);
      return;
    }
    const r = await chartConfigureRpc({ sessionId: payload.sessionId, patch: { yColumns: matched.map((c) => c!.name) }, columns: payload.columns, rows: payload.rows });
    analyzeStep = "aggregation";
    pushAssistant(
      `Y axis: **${matched.map((c) => c!.name).join(", ")}**\n\n**Aggregation for duplicate X values?**\nOptions: sum, avg, count, max, min, none`,
      { config: r.config, previewData: r.previewData }
    );

  } else if (analyzeStep === "aggregation") {
    const agg = Object.entries(AGG_MAP).find(([k]) => lower.includes(k));
    if (!agg) {
      pushAssistant("Please choose: sum, avg, count, max, min, or none.");
      return;
    }
    const r = await chartConfigureRpc({ sessionId: payload.sessionId, patch: { aggregation: agg[1] as any }, columns: payload.columns, rows: payload.rows });
    analyzeStep = "title";
    pushAssistant(
      `Aggregation: **${agg[1]}**\n\n**Give your chart a title:**`,
      { config: r.config, previewData: r.previewData }
    );

  } else if (analyzeStep === "title") {
    const r = await chartConfigureRpc({ sessionId: payload.sessionId, patch: { title: text }, columns: payload.columns, rows: payload.rows });
    analyzeStep = "confirm";
    pushAssistant(
      `Title: **${text}**\n\nHere's your chart — **add it to the Dashboard?** (yes / no)`,
      { config: r.config, previewData: r.previewData }
    );

  } else if (analyzeStep === "confirm") {
    if (lower.includes("yes") || lower.includes("y") || lower.includes("add")) {
      const r = await chartConfigureRpc({ sessionId: payload.sessionId, patch: {}, columns: payload.columns, rows: payload.rows });
      addChart({ config: r.config, previewData: r.previewData, sql: payload.sql, columns: payload.columns, rows: payload.rows });
      analyzeStep = null;
      pushAssistant("✅ Chart added to Dashboard! Switch to the **📊 Dashboard** tab to see it.\n\nWant to add another chart from this result? Just ask.");
      (props as any).onChartAdded?.();
    } else {
      analyzeStep = "type";
      pushAssistant("No problem — let's start over. **What type of chart would you like?**");
    }
  }
}
```

Update the `send()` function to route to analyze handler when in analyze mode:

```ts
async function send() {
  const text = input.trim();
  if (!text || loading) return;
  input = "";
  error = null;
  messages = [...messages, { role: "user" as const, content: text }];
  await scrollToBottom();

  if (analyzeStep !== null && analyzePayload) {
    await handleAnalyzeAnswer(text, analyzePayload);
    await scrollToBottom();
    return;
  }

  loading = true;
  const res = await aiChat(apiKey, messages.map(({ role, content }) => ({ role, content })), context);
  loading = false;
  if (res.ok) {
    messages = [...messages, { role: "assistant" as const, content: res.data.content }];
  } else {
    error = (res.error as any)?.message ?? "Unknown error";
  }
  await scrollToBottom();
}
```

Update the message rendering in the template to show `chartPreview` below text:

Find the assistant message bubble rendering (where `renderMarkdown` is called) and add after it:
```svelte
{#if msg.chartPreview}
  <div class="msg-chart-preview">
    <ChartWidget
      config={msg.chartPreview.config}
      previewData={msg.chartPreview.previewData}
      compact={true}
    />
  </div>
{/if}
```

Add to `<style>`:
```css
.msg-chart-preview { margin-top: 8px; }
```

- [ ] **Step 2: Add "📊 Analyze" button to `src/lib/workspace/ResultGrid.svelte`**

Add `onAnalyze?: () => void` to the Props type at the top of the script.

In the footer section, alongside the Export button, add:

```svelte
{#if onAnalyze && ar?.result && ar.result.columns.length > 0}
  <button class="analyze-btn" onclick={onAnalyze}>📊 Analyze</button>
{/if}
```

Add to `<style>`:
```css
.analyze-btn {
  font-size: 11px; padding: 3px 8px; border-radius: 4px;
  border: 1px solid rgba(179,62,31,0.3); background: rgba(179,62,31,0.1);
  color: #f5a08a; cursor: pointer;
}
.analyze-btn:hover { background: rgba(179,62,31,0.2); }
```

- [ ] **Step 3: Wire everything in `src/routes/workspace/[id]/+page.svelte`**

Add state for the analyze payload:
```ts
import type { AnalyzePayload } from "$lib/workspace/SheepChat.svelte"; // if exported, else declare inline
let analyzePayload = $state<{ sessionId: string; columns: { name: string; dataType: string }[]; rows: unknown[][]; sql: string } | null>(null);
```

Add `onAnalyze` handler (to be passed to ResultGrid):
```ts
function handleAnalyze() {
  const tab = sqlEditor.active;
  const result = tab ? activeResult(tab) : null;
  if (!result?.result) return;
  analyzePayload = {
    sessionId: `${tab!.id}-${Date.now()}`,
    columns: result.result.columns,
    rows: result.result.rows,
    sql: tab!.sql,
  };
  // Open sheep panel if not open
  sheepOpen = true;
}
```

Pass `onAnalyze={handleAnalyze}` and `{analyzePayload}` to the relevant components:
- `<ResultGrid ... onAnalyze={handleAnalyze} />`
- `<SheepChat ... {analyzePayload} onChartAdded={() => { activeWsTab = "dashboard"; }} />`

After passing analyzePayload, reset it with a microtask so a second click re-triggers:
```ts
function handleAnalyze() {
  // ... set analyzePayload ...
  Promise.resolve().then(() => { analyzePayload = null; });
}
```

- [ ] **Step 4: Run all tests**

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 5: Compile sidecar and do manual test**

```bash
cd sidecar
bun build src/index.ts --compile --minify --outfile ../src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe
cd ..
```

Kill any zombie veesker processes, then:
```powershell
Get-Process | Where-Object { $_.Name -like "*veesker*" } | Stop-Process -Force
```

Then `bun run tauri dev`.

Manual test flow:
1. Connect to Oracle, run `SELECT * FROM VEESKER.EMPLOYEES FETCH FIRST 200 ROWS ONLY`
2. Click **📊 Analyze** in the result footer
3. Sheep panel opens — type `bar`, press Enter
4. Type a column name for X axis (e.g. `DEPARTMENT_ID`)
5. Type a column for Y axis (e.g. `SALARY`)
6. Type `sum`
7. Type `Salary by Department`
8. Type `yes`
9. Switch to 📊 Dashboard tab — verify chart appears

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace/SheepChat.svelte src/lib/workspace/ResultGrid.svelte src/routes/workspace/[id]/+page.svelte src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe
git commit -m "feat(analyze): Sheep guided chart builder — inline previews, dashboard integration"
```

---

## Task 6: Final wiring, polish, and sidecar recompile

**Files:**
- Modify: `src/lib/workspace/DashboardTab.svelte` (minor fixes if needed from manual testing)
- No new files

- [ ] **Step 1: Verify Dashboard tab is accessible from workspace**

In the running app:
1. Add 2+ charts via Analyze flow
2. Confirm KPI chart goes to top strip, non-KPI charts follow 2/3 + 1/3 layout
3. Confirm ✕ removes individual charts
4. Confirm "Clear All" empties dashboard

- [ ] **Step 2: Verify PDF export**

1. With charts in dashboard, click "Export PDF"
2. Browser print dialog opens
3. Print preview shows: cover page with title + date + SQL, then each chart as image + data table below

- [ ] **Step 3: Verify dark mode**

Toggle dark mode in the app. Verify:
- DashboardTab background uses `--bg-surface`
- Chart cells use `--bg-surface-alt`
- Chart.js axis labels use `var(--text-muted)` (these are set in Chart.js options, not CSS — they should work)

- [ ] **Step 4: Run full test suite one final time**

```bash
bun run test
cd sidecar && bun test && cd ..
```

Expected: all tests pass.

- [ ] **Step 5: Final commit and push**

```bash
git add -A
git commit -m "feat(sheep-reports): complete Sheep Reports & Dashboards feature

- chart.configure / chart.reset sidecar RPC with aggregation engine
- ChartWidget: 6 chart types via Chart.js (bar, bar-h, line, pie, kpi, table)
- Dashboard store + DashboardTab with intelligent layout (KPIs top, 2/3+1/3 split)
- SheepChat analyze mode: scripted step-by-step conversation with inline previews
- ResultGrid Analyze button triggers Sheep conversation from active result
- PDF export via window.print() — cover page, chart images, data tables"
git push
```
