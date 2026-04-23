# Sheep Reports & Dashboards — Design Spec

## Goal

Allow users to generate visual dashboards and exportable PDF reports from any query result, guided by a conversational AI flow inside SheepChat. The Sheep asks one question at a time, renders inline chart previews with real data, and builds charts deterministically via a sidecar RPC — no reliance on AI to produce structured output.

---

## User Flow

1. User runs any query in the SQL editor.
2. A new **"📊 Analyze"** button appears in the ResultGrid toolbar.
3. Clicking it opens SheepChat with context pre-loaded: column definitions, a sample of the first rows, and the SQL that produced the result.
4. Sheep asks one question at a time — chart type, X axis column, Y axis column(s), aggregation function, title.
5. After each answer, the frontend calls `chart.configure` on the sidecar, which accumulates config deterministically and returns computed preview data.
6. Sheep renders a **live mini-chart inline** in its message bubble using the real data.
7. When `ready: true` is returned, Sheep shows the final preview and asks: *"Looks good — add to Dashboard?"*
8. User confirms → chart is added to the **Dashboard tab** in the workspace.
9. The user can repeat to add more charts to the same dashboard.
10. The **"Export PDF"** button in the Dashboard tab generates a file: cover page (title, date, SQL), each chart as an image, and a data table below each chart.

All text in the UI, Sheep messages, and PDF output is in English.

---

## Architecture

### New files

| File | Responsibility |
|---|---|
| `src/lib/workspace/DashboardTab.svelte` | Dashboard workspace tab — intelligent layout, Export PDF button |
| `src/lib/workspace/ChartWidget.svelte` | Individual chart widget — renders any of the 6 chart types via Chart.js |
| `src/lib/stores/dashboard.svelte.ts` | Svelte 5 rune store — dashboard state (one dashboard per workspace tab) |
| `sidecar/src/chart.ts` | `chartConfigure` and `chartReset` logic — accumulates config, computes preview data |

### Modified files

| File | Change |
|---|---|
| `src/lib/workspace/ResultGrid.svelte` | Add "📊 Analyze" button to toolbar |
| `src/lib/workspace/SheepChat.svelte` | Support rich messages: `chartPreview` field renders `<ChartWidget>` inline |
| `src/routes/workspace/[id]/+page.svelte` | Mount `<DashboardTab>` when active, wire `onAnalyze` from ResultGrid |
| `sidecar/src/index.ts` | Register `chart.configure` and `chart.reset` RPC handlers |
| `src/lib/workspace.ts` | Add Tauri invoke wrappers: `chartConfigure`, `chartReset` |
| `src-tauri/src/commands.rs` | Add `chart_configure` and `chart_reset` Tauri commands |

### New dependency

`chart.js` (npm) — installed in the frontend. Works in WebView2 (Windows) and WKWebView (macOS) without native dependencies. Covers all 6 chart types required.

---

## Feature 1 — Chart Configuration RPC

### `sidecar/src/chart.ts`

Maintains a partial config per `sessionId` in module-level state.

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
```

**`chartConfigure(p: { sessionId: string; patch: Partial<ChartConfig>; columns: QueryColumn[]; rows: unknown[][] })`**

1. Retrieve or create config for `sessionId`.
2. Apply `patch` fields (only non-null/non-undefined values overwrite existing).
3. Compute `previewData` if `type`, `xColumn`, and at least one `yColumn` are set:
   - Extract x labels from `rows[*][xColumn index]`
   - For each yColumn, apply aggregation grouped by xColumn, producing numeric dataset
   - For KPI type: compute sum/avg/count/max/min per yColumn — no labels needed
   - For table type: previewData is null (table renders raw rows directly)
4. Set `ready = true` when: `type` is set, `yColumns.length > 0`, and `title` is set. `xColumn` is additionally required for all types except `kpi` and `table`.
5. Return `{ config, previewData, ready }`.

**`chartReset(p: { sessionId: string })`**

Deletes the config for `sessionId`. Returns `{ ok: true }`.

**Error handling:** If column names don't match `columns`, return `{ config, previewData: null, ready: false }` — never throw.

### RPC handlers in `sidecar/src/index.ts`

```ts
"chart.configure" → chartConfigure(p)
"chart.reset"     → chartReset(p)
```

### Tauri commands in `src-tauri/src/commands.rs`

```rust
#[tauri::command]
pub async fn chart_configure(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    call_sidecar(&app, "chart.configure", payload).await.map(Ok)?
}

#[tauri::command]
pub async fn chart_reset(app: AppHandle, session_id: String) -> Result<Value, ConnectionTestErr> {
    call_sidecar(&app, "chart.reset", json!({ "sessionId": session_id })).await.map(Ok)?
}
```

### Wrappers in `src/lib/workspace.ts`

```ts
export const chartConfigure = (payload: {
  sessionId: string;
  patch: Partial<ChartConfig>;
  columns: QueryColumn[];
  rows: unknown[][];
}) => call<ChartConfigureResult>("chart_configure", { payload });

export const chartReset = (sessionId: string) =>
  call<{ ok: true }>("chart_reset", { sessionId });
```

---

## Feature 2 — ChartWidget Component

### `src/lib/workspace/ChartWidget.svelte`

Props:
```ts
type Props = {
  config: ChartConfig;
  previewData: PreviewData | null;
  compact?: boolean; // true for inline SheepChat previews, false for dashboard
};
```

Renders a `<canvas>` element and initialises a Chart.js instance on mount via `$effect`. Destroys and recreates when `config.type` changes. Updates data when `previewData` changes.

Chart type mapping:
- `bar` → `type: "bar"`, vertical
- `bar-h` → `type: "bar"`, `indexAxis: "y"`
- `line` → `type: "line"`, fill: true
- `pie` → `type: "doughnut"`
- `kpi` → no canvas; renders styled `<div>` cards showing computed values (sum/avg/count per yColumn)
- `table` → no canvas; renders an HTML `<table>` with column headers and formatted rows

Color palette (consistent with app theme): `["#4a9eda", "#8bc4a8", "#c3a66e", "#f5a08a", "#7aa8c4", "#a78bfa"]`

Background: `var(--bg-surface-alt)`. Text: `var(--text-primary)`. Grid lines: `var(--border)`.

---

## Feature 3 — SheepChat Rich Messages

### Message type extension in `SheepChat.svelte`

The internal message array gains an optional `chartPreview` field:

```ts
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  chartPreview?: { config: ChartConfig; previewData: PreviewData | null };
};
```

When rendering an assistant message that has `chartPreview` set, a `<ChartWidget compact={true}>` is rendered below the message text inside the bubble. This requires no change to the sidecar `aiChat` interface — the frontend attaches `chartPreview` after receiving the `ChartConfigureResult` from the `chart.configure` call.

### Sheep conversation protocol

When Sheep receives context with `{ columns, sampleRows, sql, mode: "analyze" }`, it follows this script (questions in English):

1. "What type of chart would you like?" — shows type names inline
2. "Which column for the X axis?" — lists column names
3. "Which column(s) for the Y axis?" — lists numeric columns
4. "Aggregation for Y values — sum, avg, count, max, min, or none?"
5. "Give it a title:"
6. After each answer: calls `chartConfigure`, attaches result to next message as `chartPreview`
7. When `ready: true`: "Here's your chart — add it to the Dashboard?" (Yes / No)

If user says No: "Want to change anything?" and continues from that step.

---

## Feature 4 — Dashboard Tab

### `src/lib/stores/dashboard.svelte.ts`

```ts
type DashboardChart = {
  id: string;
  config: ChartConfig;
  previewData: PreviewData | null;
  sql: string;
  columns: QueryColumn[];
  rows: unknown[][];
  addedAt: number;
};

type DashboardState = {
  charts: DashboardChart[];
};

let state = $state<DashboardState>({ charts: [] });

export function addChart(chart: Omit<DashboardChart, "id" | "addedAt">) { ... }
export function removeChart(id: string) { ... }
export function clearDashboard() { ... }
export { state as dashboardState };
```

### `src/lib/workspace/DashboardTab.svelte`

**Layout (intelligent by type):**

1. KPI cards — always rendered first as a horizontal flex row spanning full width.
2. First non-KPI chart — `flex: 2` (approximately 2/3 width).
3. Each subsequent non-KPI chart — `flex: 1`, placed beside the previous in the same row. A new row starts after every 2 side-by-side charts.

**Header:** title "Dashboard" + "Clear All" button + **"Export PDF"** button.

**Empty state:** "No charts yet. Run a query and click 📊 Analyze to get started."

Each chart has a small ✕ remove button in the top-right corner.

### ResultGrid integration

A new "📊 Analyze" button is added to the ResultGrid toolbar alongside the existing CSV / JSON / INSERT SQL export buttons. Clicking it:
1. Calls `chartReset(sessionId)` to clear any previous config for this session.
2. Sets `pendingMessage` on SheepChat to trigger the analyze flow with the current result context.

---

## Feature 5 — PDF Export

Triggered by the "Export PDF" button in DashboardTab.

**Implementation using `window.print()`:**

1. Build a hidden `<div id="pdf-print-root">` in the DOM containing:
   - Cover page: dashboard title (from first chart title or "Dashboard Report"), current date formatted as `YYYY-MM-DD`, and the SQL query in a monospace block.
   - For each chart: `<img>` captured via `canvas.toDataURL("image/png")` (or the KPI/table HTML directly), followed by an HTML `<table>` with the chart's raw data rows.
2. Apply `@media print` CSS that hides everything except `#pdf-print-root` and sets page breaks between charts.
3. Call `window.print()`.
4. Remove the hidden div after print dialog closes.

**KPI and table chart types** have no canvas — their HTML is cloned directly into the print root.

---

## Chart Types Summary

| Type | X required | Y required | Aggregation | Notes |
|---|---|---|---|---|
| `bar` | Yes | Yes | Optional | Vertical bars |
| `bar-h` | Yes | Yes | Optional | Horizontal bars |
| `line` | Yes | Yes | Optional | Filled area line |
| `pie` | Yes | Yes | Optional | Doughnut style |
| `kpi` | No | Yes | Required | Cards with big numbers |
| `table` | No | No | No | Formatted HTML table with totals row |

---

## Testing

**Unit tests — `sidecar/src/chart.test.ts`:**
- `chartConfigure` with type + xColumn + yColumn returns non-null `previewData`
- `chartConfigure` with `aggregation: "sum"` groups and sums correctly
- `chartReset` clears config for the session
- `ready: false` when required fields are missing
- `ready: true` when all required fields are set

**Frontend unit tests — `ChartWidget.test.ts`:**
- Renders canvas for bar/line/pie types
- Renders div cards for kpi type
- Renders table for table type

**Manual:**
- Run a query → click Analyze → complete Sheep conversation → verify chart appears in Dashboard tab
- Add 3+ charts, verify layout (KPIs top, 2/3 + 1/3 split)
- Export PDF, verify cover page + all charts + data tables present
- Dark mode: verify chart backgrounds use CSS variables

---

## Cross-platform notes

All changes are frontend + sidecar (TypeScript). `chart.js` is a pure JavaScript library — no native dependencies. `window.print()` is available in both WebView2 (Windows) and WKWebView (macOS). No Rust changes beyond two thin command handlers.
