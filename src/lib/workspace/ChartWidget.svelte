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

  async function buildChart() {
    if (!canvas || !previewData) return;
    destroyChart();
    const data = previewData;
    const { Chart, registerables } = await import("chart.js");
    Chart.register(...registerables);

    const isHorizontal = config.type === "bar-h";
    const isDoughnut   = config.type === "pie";
    const chartType    = isDoughnut ? "doughnut" : "bar";

    chart = new Chart(canvas, {
      type: config.type === "line" ? "line" : chartType,
      data: {
        labels: data.labels,
        datasets: data.datasets.map((ds, i) => ({
          label: ds.label,
          data: ds.data,
          backgroundColor: isDoughnut
            ? data.labels.map((_, j) => PALETTE[j % PALETTE.length])
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
          legend: { display: data.datasets.length > 1 || isDoughnut, labels: { color: "var(--text-primary)", font: { size: 10 } } },
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
