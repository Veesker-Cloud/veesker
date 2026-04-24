<script lang="ts">
  import { dashboardState, removeChart, clearDashboard } from "$lib/stores/dashboard.svelte";
  import ChartWidget from "./ChartWidget.svelte";

  const kpiCharts    = $derived(dashboardState.charts.filter((c) => c.config.type === "kpi"));
  const nonKpiCharts = $derived(dashboardState.charts.filter((c) => c.config.type !== "kpi"));

  async function exportPdf() {
    const root = document.createElement("div");
    root.id = "pdf-print-root";

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

    for (const chart of dashboardState.charts) {
      const section = document.createElement("div");
      section.className = "pdf-section";

      const heading = document.createElement("h2");
      heading.textContent = chart.config.title ?? "Chart";
      section.appendChild(heading);

      const canvasEl = document.querySelector<HTMLCanvasElement>(`[data-chart-id="${chart.id}"] canvas`);
      if (canvasEl) {
        const img = document.createElement("img");
        img.src = canvasEl.toDataURL("image/png");
        img.style.width = "100%";
        section.appendChild(img);
      }

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
