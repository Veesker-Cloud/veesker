<script lang="ts">
  import type { SqlTab } from "$lib/stores/sql-editor.svelte";
  import { activeResult } from "$lib/stores/sql-editor.svelte";
  import CancelOverlay from "./CancelOverlay.svelte";
  import { toCsv, toJson } from "$lib/csv-export";
  import { saveBlob } from "$lib/sql-files";

  type Props = { tab: SqlTab | null; onCancel: () => void };
  let { tab, onCancel }: Props = $props();

  function isNumericType(t: string): boolean {
    const u = t.toUpperCase();
    return (
      u.includes("NUMBER") ||
      u.includes("FLOAT") ||
      u.includes("DOUBLE") ||
      u.includes("INTEGER") ||
      u.includes("DATE") ||
      u.includes("TIMESTAMP")
    );
  }

  function formatCell(v: unknown): string {
    if (v === null || v === undefined) return "<NULL>";
    let s: string;
    if (typeof v === "string") s = v;
    else if (typeof v === "number" || typeof v === "boolean") s = String(v);
    else if (v instanceof Date) s = v.toISOString();
    else s = JSON.stringify(v);
    if (s.length > 60) return s.slice(0, 60) + "…";
    return s;
  }

  // Derived: get the active result for display
  let ar = $derived(tab ? activeResult(tab) : null);

  // ── Sort state ───────────────────────────────────────────────────────────────
  type SortDir = "asc" | "desc" | "none";
  let sortCol = $state<number | null>(null);
  let sortDir = $state<SortDir>("none");

  function toggleSort(colIdx: number) {
    if (sortCol !== colIdx) {
      sortCol = colIdx;
      sortDir = "asc";
    } else if (sortDir === "asc") {
      sortDir = "desc";
    } else {
      sortCol = null;
      sortDir = "none";
    }
  }

  // Reset sort when the active result changes
  $effect(() => {
    ar; // track
    sortCol = null;
    sortDir = "none";
  });

  // Sorted rows (derived)
  let sortedRows = $derived.by(() => {
    if (!ar?.result) return [];
    const rows = ar.result.rows;
    if (sortCol === null || sortDir === "none") return rows;
    const idx = sortCol;
    return [...rows].sort((a, b) => {
      const av = a[idx], bv = b[idx];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  });

  // ── Resize state ─────────────────────────────────────────────────────────────
  let colWidths = $state<number[]>([]);

  $effect(() => {
    if (ar?.result) {
      colWidths = ar.result.columns.map(() => 120);
    }
  });

  function onResizePointerDown(e: PointerEvent, colIdx: number) {
    const handle = e.currentTarget as HTMLDivElement;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = colWidths[colIdx];

    function onMove(ev: PointerEvent) {
      const newW = Math.max(60, Math.min(800, startW + (ev.clientX - startX)));
      colWidths = colWidths.map((w, i) => (i === colIdx ? newW : w));
    }

    function onUp() {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  function autoFitCol(colIdx: number) {
    // Simple auto-fit: just set a reasonable default
    colWidths = colWidths.map((w, i) => (i === colIdx ? 160 : w));
  }

  // ── Export ───────────────────────────────────────────────────────────────────
  let exportMenuOpen = $state(false);

  async function exportCsv() {
    exportMenuOpen = false;
    if (!ar?.result) return;
    const cols = ar.result.columns.map((c) => c.name);
    const content = toCsv(cols, sortedRows);
    const tabTitle = tab?.title ?? "export";
    await saveBlob(tabTitle, content, "csv");
  }

  async function exportJson() {
    exportMenuOpen = false;
    if (!ar?.result) return;
    const cols = ar.result.columns.map((c) => c.name);
    const content = toJson(cols, sortedRows);
    const tabTitle = tab?.title ?? "export";
    await saveBlob(tabTitle, content, "json");
  }
</script>

<section class="grid">
  {#if tab === null}
    <div class="placeholder">Run a query to see results.</div>
  {:else if tab.running}
    <div class="placeholder" role="status" aria-live="polite">
      <span class="spinner"></span> Running…
    </div>
    <CancelOverlay {onCancel} />
  {:else if tab.splitterError !== null}
    <div class="banner banner-splitter">
      <strong>Split error</strong>
      <span>Couldn't split: {tab.splitterError}. No statements run.</span>
    </div>
  {:else if ar === null}
    <div class="placeholder">Run a query to see results.</div>
  {:else if ar.status === "cancelled"}
    <div class="banner banner-cancelled">
      <span>⏸ Cancelled by user</span>
    </div>
  {:else if ar.status === "error"}
    <div class="banner">
      <strong>{ar.error?.code}</strong>
      <span>{ar.error?.message}</span>
    </div>
  {:else if ar.result && ar.result.columns.length === 0}
    <div class="ok">
      ✓ Statement executed · {ar.result.rowCount} rows affected · {ar.result.elapsedMs}ms
    </div>
  {:else if ar.result}
    {@const r = ar.result}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            {#each r.columns as c, ci (c.name)}
              <th
                class:numeric={isNumericType(c.dataType)}
                style="width: {colWidths[ci] ?? 120}px; min-width: {colWidths[ci] ?? 120}px; max-width: {colWidths[ci] ?? 120}px"
                onclick={() => toggleSort(ci)}
                style:cursor="pointer"
              >
                <div class="th-stack">
                  <span class="cname">
                    {c.name}
                    {#if sortCol === ci}
                      {sortDir === "asc" ? " ▲" : " ▼"}
                    {/if}
                  </span>
                  <span class="ctype">{c.dataType}</span>
                </div>
                <div
                  class="resize-handle"
                  role="separator"
                  aria-orientation="vertical"
                  ondblclick={(e) => { e.stopPropagation(); autoFitCol(ci); }}
                  onpointerdown={(e) => { e.stopPropagation(); onResizePointerDown(e, ci); }}
                ></div>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each sortedRows as row, i (i)}
            <tr>
              {#each row as cell, j (j)}
                <td class:numeric={isNumericType(r.columns[j].dataType)} class:null-cell={cell === null}>{formatCell(cell)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="footer">
      <div class="footer-left">
        <div class="export-wrap">
          <button class="export-btn" onclick={() => exportMenuOpen = !exportMenuOpen}>
            Export ▼
          </button>
          {#if exportMenuOpen}
            <div class="export-menu">
              <button onclick={exportCsv}>CSV</button>
              <button onclick={exportJson}>JSON</button>
            </div>
          {/if}
        </div>
      </div>
      <span>{r.rowCount} rows · {r.elapsedMs}ms</span>
    </div>
  {/if}
</section>

<style>
  .grid {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #f9f5ed;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    font-size: 12px;
    color: #1a1612;
    position: relative;
  }
  .placeholder, .ok {
    padding: 1rem;
    color: rgba(26, 22, 18, 0.55);
    font-size: 12px;
  }
  .ok { color: #2e6b2e; }
  .banner {
    padding: 0.85rem 1rem;
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border-bottom: 1px solid rgba(179, 62, 31, 0.3);
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11.5px;
  }
  .banner strong { font-family: "Space Grotesk", sans-serif; }
  .banner-splitter {
    background: rgba(179, 62, 31, 0.12);
    color: #7a2a14;
  }
  .banner-cancelled {
    background: rgba(26, 22, 18, 0.05);
    color: rgba(26, 22, 18, 0.6);
    border-bottom: 1px solid rgba(26, 22, 18, 0.12);
    font-family: "Space Grotesk", sans-serif;
    font-size: 12px;
  }
  .scroll {
    flex: 1;
    overflow: auto;
  }
  table {
    border-collapse: collapse;
    min-width: 100%;
  }
  thead th {
    position: sticky;
    top: 0;
    background: rgba(179, 62, 31, 0.1);
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-right: 1px solid rgba(26, 22, 18, 0.06);
    border-bottom: 1px solid rgba(26, 22, 18, 0.12);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(26, 22, 18, 0.7);
    white-space: nowrap;
    min-width: 80px;
    cursor: pointer;
    user-select: none;
  }
  thead th:hover { background: rgba(179, 62, 31, 0.15); }
  .th-stack {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .cname {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 600;
  }
  .ctype {
    opacity: 0.5;
    font-family: "JetBrains Mono", monospace;
    font-size: 9.5px;
  }
  thead th.numeric .th-stack { align-items: flex-end; }
  tbody td {
    padding: 0.3rem 0.6rem;
    border-right: 1px solid rgba(26, 22, 18, 0.04);
    border-bottom: 1px solid rgba(26, 22, 18, 0.04);
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11.5px;
    white-space: nowrap;
    vertical-align: top;
    min-width: 80px;
  }
  tbody td.numeric { text-align: right; }
  tbody tr:nth-child(even) { background: rgba(26, 22, 18, 0.02); }
  td.null-cell {
    color: rgba(26, 22, 18, 0.4);
    font-style: italic;
  }
  .resize-handle {
    position: absolute;
    right: 0; top: 0; bottom: 0;
    width: 4px;
    cursor: col-resize;
    background: transparent;
  }
  .resize-handle:hover { background: rgba(179, 62, 31, 0.5); }
  .footer {
    border-top: 1px solid rgba(26, 22, 18, 0.08);
    padding: 0.4rem 0.8rem;
    color: rgba(26, 22, 18, 0.55);
    font-size: 11px;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .footer-left { display: flex; align-items: center; gap: 0.5rem; }
  .export-wrap { position: relative; }
  .export-btn {
    background: transparent;
    border: 1px solid rgba(26,22,18,0.2);
    border-radius: 3px;
    padding: 0.2rem 0.5rem;
    font-size: 10.5px;
    font-family: "Space Grotesk", sans-serif;
    cursor: pointer;
    color: rgba(26,22,18,0.7);
  }
  .export-btn:hover { background: rgba(26,22,18,0.06); }
  .export-menu {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    background: #fff;
    border: 1px solid rgba(26,22,18,0.15);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    min-width: 90px;
    z-index: 100;
    overflow: hidden;
  }
  .export-menu button {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 0.45rem 0.75rem;
    font-size: 12px;
    font-family: "Space Grotesk", sans-serif;
    cursor: pointer;
    color: #1a1612;
  }
  .export-menu button:hover { background: rgba(26,22,18,0.06); }
  .spinner {
    display: inline-block;
    width: 12px; height: 12px;
    border: 2px solid rgba(26, 22, 18, 0.15);
    border-top-color: #b33e1f;
    border-radius: 50%;
    margin-right: 0.5rem;
    animation: spin 0.8s linear infinite;
    vertical-align: -2px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
