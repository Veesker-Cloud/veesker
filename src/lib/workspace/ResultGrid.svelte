<script lang="ts">
  import type { SqlTab } from "$lib/stores/sql-editor.svelte";
  import { activeResult } from "$lib/stores/sql-editor.svelte";
  import CancelOverlay from "./CancelOverlay.svelte";

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
            {#each r.columns as c (c.name)}
              <th class:numeric={isNumericType(c.dataType)}>
                <div class="th-stack">
                  <span class="cname">{c.name}</span>
                  <span class="ctype">{c.dataType}</span>
                </div>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each r.rows as row, i (i)}
            <tr>
              {#each row as cell, j (j)}
                <td class:numeric={isNumericType(r.columns[j].dataType)} class:null-cell={cell === null}>{formatCell(cell)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="footer">{r.rowCount} rows · {r.elapsedMs}ms</div>
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
  }
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
  .footer {
    border-top: 1px solid rgba(26, 22, 18, 0.08);
    padding: 0.4rem 0.8rem;
    color: rgba(26, 22, 18, 0.55);
    font-size: 11px;
    background: #fff;
  }
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
