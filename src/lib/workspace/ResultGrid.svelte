<script lang="ts">
  import type { SqlTab } from "$lib/stores/sql-editor.svelte";
  import { activeResult } from "$lib/stores/sql-editor.svelte";
  import CancelOverlay from "./CancelOverlay.svelte";
  import { toCsv, toJson, toInsertSql } from "$lib/csv-export";
  import { saveBlob } from "$lib/sql-files";

  type Props = { tab: SqlTab | null; onCancel: () => void; onAnalyze?: () => void };
  let { tab, onCancel, onAnalyze }: Props = $props();

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

  // Reset sort + scroll when the active result changes
  $effect(() => {
    ar; // track
    sortCol = null;
    sortDir = "none";
    scrollTop = 0;
    if (scrollEl) scrollEl.scrollTop = 0;
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

  // ── Virtual scroll ───────────────────────────────────────────────────────────
  const ROW_HEIGHT = 24;
  const OVERSCAN = 10;

  let scrollEl = $state<HTMLDivElement | null>(null);
  let scrollTop = $state(0);
  let containerH = $state(400);

  $effect(() => {
    const el = scrollEl;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { containerH = el.clientHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  });

  let visibleSlice = $derived.by(() => {
    const total = sortedRows.length;
    if (total === 0) return { start: 0, end: 0, topPad: 0, botPad: 0 };
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(total, Math.ceil((scrollTop + containerH) / ROW_HEIGHT) + OVERSCAN);
    return { start, end, topPad: start * ROW_HEIGHT, botPad: (total - end) * ROW_HEIGHT };
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

  // ── Oracle error parsing ─────────────────────────────────────────────────────
  type OraLine = { code: string; rest: string };

  function parseOraError(msg: string): OraLine[] {
    const lines = msg.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out: OraLine[] = [];
    for (const l of lines) {
      const m = l.match(/^(ORA-\d{5}|PLS-\d{5}):?\s*(.*)/);
      if (m) out.push({ code: m[1], rest: m[2] });
      else if (out.length > 0) out[out.length - 1].rest += " " + l;
    }
    return out;
  }

  function formatErrorBanner(errCode: string | number | undefined, errMsg: string | undefined): { primary: OraLine | null; stack: OraLine[]; raw: string } {
    const msg = errMsg ?? "";
    const lines = parseOraError(msg);
    if (lines.length === 0) return { primary: null, stack: [], raw: msg };
    const [primary, ...stack] = lines;
    return { primary, stack, raw: msg };
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

  function detectTableName(): string {
    const sql = tab?.sql ?? "";
    const m = sql.match(/\bFROM\s+["']?([\w.]+)["']?/i);
    if (m) return m[1].split(".").pop()?.toUpperCase() ?? "EXPORT";
    return (tab?.title ?? "EXPORT").replace(/\s+/g, "_").toUpperCase();
  }

  async function exportInsert() {
    exportMenuOpen = false;
    if (!ar?.result) return;
    const cols = ar.result.columns.map((c) => c.name);
    const tableName = detectTableName();
    const content = toInsertSql(tableName, cols, sortedRows);
    await saveBlob(tab?.title ?? "export", content, "sql");
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
    {@const ef = formatErrorBanner(ar.error?.code, ar.error?.message)}
    {#if ef.primary}
      <div class="banner banner-ora">
        <div class="ora-primary">
          <span class="ora-code">{ef.primary.code}</span>
          <span class="ora-msg">{ef.primary.rest}</span>
        </div>
        {#if ef.stack.length > 0}
          <div class="ora-stack">
            {#each ef.stack as l}
              <div class="ora-stack-line"><span class="ora-code-sm">{l.code}</span><span>{l.rest}</span></div>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <div class="banner">
        <strong>{ar.error?.code}</strong>
        <span>{ar.error?.message}</span>
      </div>
    {/if}
  {:else if ar.result && ar.result.columns.length === 0}
    <div class="ok">
      ✓ Statement executed · {ar.result.rowCount} rows affected · {ar.result.elapsedMs}ms
    </div>
  {:else if ar.result}
    {@const r = ar.result}
    <div class="scroll" bind:this={scrollEl} onscroll={(e) => { scrollTop = (e.currentTarget as HTMLDivElement).scrollTop; }}>
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
          {#if visibleSlice.topPad > 0}
            <tr class="spacer" style="height:{visibleSlice.topPad}px"><td colspan={r.columns.length}></td></tr>
          {/if}
          {#each sortedRows.slice(visibleSlice.start, visibleSlice.end) as row, vi (visibleSlice.start + vi)}
            {@const rowIdx = visibleSlice.start + vi}
            <tr class:even={rowIdx % 2 === 1}>
              {#each row as cell, j (j)}
                <td class:numeric={isNumericType(r.columns[j].dataType)} class:null-cell={cell === null}>{formatCell(cell)}</td>
              {/each}
            </tr>
          {/each}
          {#if visibleSlice.botPad > 0}
            <tr class="spacer" style="height:{visibleSlice.botPad}px"><td colspan={r.columns.length}></td></tr>
          {/if}
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
              <button onclick={exportInsert}>INSERT SQL</button>
            </div>
          {/if}
        </div>
        {#if onAnalyze && r.columns.length > 0}
          <button class="analyze-btn" onclick={onAnalyze}>📊 Analyze</button>
        {/if}
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
    background: var(--bg-surface);
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    font-size: 12px;
    color: var(--text-primary);
    position: relative;
  }
  .placeholder, .ok {
    padding: 1rem;
    color: var(--text-secondary);
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
  .banner-ora {
    flex-direction: column;
    gap: 0.4rem;
  }
  .ora-primary {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }
  .ora-code {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 700;
    color: #b33e1f;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .ora-msg {
    flex: 1;
  }
  .ora-stack {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding-left: 0.1rem;
    border-left: 2px solid rgba(179, 62, 31, 0.25);
    margin-left: 0.1rem;
  }
  .ora-stack-line {
    display: flex;
    gap: 0.5rem;
    font-size: 10.5px;
    opacity: 0.7;
  }
  .ora-code-sm {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 600;
    color: #b33e1f;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .banner-splitter {
    background: rgba(179, 62, 31, 0.12);
    color: #7a2a14;
  }
  .banner-cancelled {
    background: var(--bg-surface-alt);
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border-strong);
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
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border-strong);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
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
  tbody tr { height: 24px; }
  tbody td {
    padding: 0.2rem 0.6rem;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11.5px;
    white-space: nowrap;
    vertical-align: middle;
    min-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  tbody td.numeric { text-align: right; }
  tbody tr.even { background: var(--row-alt); }
  tbody tr.spacer { background: none; }
  td.null-cell {
    color: var(--text-muted);
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
    border-top: 1px solid var(--border);
    padding: 0.4rem 0.8rem;
    color: var(--text-secondary);
    font-size: 11px;
    background: var(--bg-surface-raised);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .footer-left { display: flex; align-items: center; gap: 0.5rem; }
  .export-wrap { position: relative; }
  .export-btn {
    background: transparent;
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    padding: 0.2rem 0.5rem;
    font-size: 10.5px;
    font-family: "Space Grotesk", sans-serif;
    cursor: pointer;
    color: var(--text-secondary);
  }
  .export-btn:hover { background: var(--row-hover); }
  .export-menu {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    background: var(--bg-surface-raised);
    border: 1px solid var(--border-strong);
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
    color: var(--text-primary);
  }
  .export-menu button:hover { background: var(--row-hover); }
  .analyze-btn {
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid rgba(179,62,31,0.3);
    background: rgba(179,62,31,0.1);
    color: #f5a08a;
    cursor: pointer;
  }
  .analyze-btn:hover { background: rgba(179,62,31,0.2); }
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
