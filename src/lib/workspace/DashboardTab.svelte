<script lang="ts">
  import { tick } from "svelte";
  import { dashboard } from "$lib/stores/dashboard.svelte";
  import ChartWidget from "./ChartWidget.svelte";

  const kpiCharts    = $derived(dashboard.charts.filter((c) => c.config.type === "kpi"));
  const nonKpiCharts = $derived(dashboard.charts.filter((c) => c.config.type !== "kpi"));

  let clearConfirm = $state(false);

  async function exportPdf(): Promise<void> {
    const root = document.createElement("div");
    root.id = "pdf-print-root";

    const firstTitle = dashboard.charts[0]?.config.title ?? "Dashboard Report";
    const firstSql   = dashboard.charts[0]?.sql ?? "";
    const cover = document.createElement("div");
    cover.className = "pdf-cover";
    const coverH1 = document.createElement("h1");
    coverH1.textContent = firstTitle;
    cover.appendChild(coverH1);
    const dateP = document.createElement("p");
    dateP.className = "pdf-date";
    dateP.textContent = new Date().toISOString().slice(0, 10);
    cover.appendChild(dateP);
    if (firstSql) {
      const pre = document.createElement("pre");
      pre.className = "pdf-sql";
      pre.textContent = firstSql;
      cover.appendChild(pre);
    }
    root.appendChild(cover);

    for (const chart of dashboard.charts) {
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
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        for (const col of chart.columns) {
          const th = document.createElement("th");
          th.textContent = col.name;
          headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);
        const tbody = document.createElement("tbody");
        for (const row of chart.rows.slice(0, 50)) {
          const tr = document.createElement("tr");
          for (const cell of row as unknown[]) {
            const td = document.createElement("td");
            td.textContent = cell == null ? "NULL" : String(cell);
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        section.appendChild(table);
      }

      root.appendChild(section);
    }

    document.body.appendChild(root);
    await tick();
    await new Promise(requestAnimationFrame);
    window.print();
    setTimeout(() => root.remove(), 1000);
  }
</script>

<div class="dashboard-root">
  <div class="dash-header">
    <span class="dash-title">Dashboard</span>
    <div class="dash-actions">
      {#if dashboard.charts.length > 0}
        {#if clearConfirm}
          <span class="clear-confirm-label">Remove all charts?</span>
          <button class="dash-btn danger" onclick={() => { dashboard.clearDashboard(); clearConfirm = false; }}>Yes</button>
          <button class="dash-btn" onclick={() => clearConfirm = false}>No</button>
        {:else}
          <button class="dash-btn" onclick={() => clearConfirm = true}>Clear All</button>
          <button class="dash-btn primary" onclick={() => void exportPdf()}>Export PDF</button>
        {/if}
      {/if}
    </div>
  </div>
  {#if dashboard.charts.length === 0}
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
                <button class="remove-btn" onclick={() => dashboard.removeChart(chart.id)} title="Remove">✕</button>
              </div>
              <ChartWidget config={chart.config} previewData={chart.previewData} columns={chart.columns} rows={chart.rows} totalRows={chart.totalRows} />
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
                <button class="remove-btn" onclick={() => dashboard.removeChart(main.id)} title="Remove">✕</button>
              </div>
              <ChartWidget config={main.config} previewData={main.previewData} columns={main.columns} rows={main.rows} totalRows={main.totalRows} />
            </div>
          {/if}
          {#if side}
            <div class="chart-cell" data-chart-id={side.id} style="flex:1">
              <div class="chart-cell-header">
                <span class="chart-cell-title">{side.config.title}</span>
                <button class="remove-btn" onclick={() => dashboard.removeChart(side.id)} title="Remove">✕</button>
              </div>
              <ChartWidget config={side.config} previewData={side.previewData} columns={side.columns} rows={side.rows} totalRows={side.totalRows} />
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
  .dash-btn.danger { background:rgba(179,62,31,0.25); border-color:rgba(179,62,31,0.6); color:#f5a08a; font-weight:600; }
  .dash-btn:hover { background:var(--row-hover); }
  .dash-btn.danger:hover { background:rgba(179,62,31,0.4); }
  .clear-confirm-label { font-size:11px; color:var(--text-muted); }
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
