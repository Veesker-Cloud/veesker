<script lang="ts">
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

  function cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || name;
  }

  async function buildChart(c: HTMLCanvasElement, pd: PreviewData, type: string, w: number, h: number) {
    destroyChart();
    const { Chart, registerables } = await import("chart.js");
    Chart.register(...registerables);
    if (!c.isConnected) return;

    c.width  = w;
    c.height = h;

    const colorPrimary = cssVar("--text-primary");
    const colorMuted   = cssVar("--text-muted");
    const colorBorder  = cssVar("--border");

    const isHorizontal = type === "bar-h";
    const isDoughnut   = type === "pie";
    const chartType    = isDoughnut ? "doughnut" : "bar";

    chart = new Chart(c, {
      type: type === "line" ? "line" : chartType,
      data: {
        labels: pd.labels,
        datasets: pd.datasets.map((ds, i) => ({
          label: ds.label,
          data: ds.data,
          backgroundColor: isDoughnut
            ? pd.labels.map((_, j) => PALETTE[j % PALETTE.length])
            : PALETTE[i % PALETTE.length] + "cc",
          borderColor: PALETTE[i % PALETTE.length],
          borderWidth: 1.5,
          fill: type === "line",
          tension: 0.3,
        })),
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        indexAxis: isHorizontal ? "y" : "x",
        plugins: {
          legend: { display: pd.datasets.length > 1 || isDoughnut, labels: { color: colorPrimary, font: { size: 10 } } },
          title: { display: false },
        },
        scales: isDoughnut ? {} : {
          x: { ticks: { color: colorMuted, font: { size: 9 } }, grid: { color: colorBorder } },
          y: { ticks: { color: colorMuted, font: { size: 9 } }, grid: { color: colorBorder } },
        },
      },
    });
  }

  $effect(() => {
    const c = canvas;
    const type = config.type;
    const pd = previewData;
    if (!c || !type || type === "kpi" || type === "table" || !pd) return destroyChart;
    let raf = requestAnimationFrame(() => {
      const wrap = c.parentElement;
      const w = (wrap?.offsetWidth  || 320);
      const h = (wrap?.offsetHeight || (compact ? 130 : 200));
      void buildChart(c, pd, type, w, h);
    });
    return () => { cancelAnimationFrame(raf); destroyChart(); };
  });

  function kpiValue(data: number[]): string {
    const v = data[0] ?? 0;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}k`;
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
    <div class="canvas-wrap">
      <canvas bind:this={canvas}></canvas>
    </div>
  {/if}
</div>

<style>
  .chart-widget { background: var(--bg-surface-alt); border-radius: 4px; padding: 8px; width: 100%; }
  .chart-widget.compact { max-height: 160px; overflow: hidden; }
  .canvas-wrap { position: relative; height: 200px; }
  .chart-widget.compact .canvas-wrap { height: 130px; }
  canvas { width: 100% !important; display: block; }
  .kpi-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .kpi-card { flex: 1; min-width: 80px; background: var(--bg-surface); border-radius: 4px; padding: 8px; text-align: center; }
  .kpi-label { font-size: 9px; color: var(--text-muted); margin-bottom: 4px; }
  .kpi-value { font-size: 18px; font-weight: 700; }
  .chart-widget.compact .kpi-value { font-size: 14px; }
  .table-wrap { overflow: auto; max-height: 180px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; color: var(--text-primary); }
  th { background: var(--bg-surface); color: var(--text-muted); padding: 3px 6px; text-align: left; font-weight: 600; position: sticky; top: 0; }
  td { padding: 3px 6px; border-bottom: 1px solid var(--border); }
  tr:nth-child(even) { background: var(--row-alt); }
</style>
