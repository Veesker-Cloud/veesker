<script lang="ts">
  import type { SqlTab } from "$lib/stores/sql-editor.svelte";

  type Props = { tab: SqlTab | null };
  let { tab }: Props = $props();

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
</script>

<section class="grid">
  {#if tab === null || (tab.result === null && !tab.running && tab.error === null)}
    <div class="placeholder">Run a query to see results.</div>
  {:else if tab.running}
    <div class="placeholder" role="status" aria-live="polite">
      <span class="spinner"></span> Running…
    </div>
  {:else if tab.error}
    <div class="banner">
      <strong>{tab.error.code}</strong>
      <span>{tab.error.message}</span>
    </div>
  {:else if tab.result && tab.result.columns.length === 0}
    <div class="ok">
      ✓ Statement executed · {tab.result.rowCount} rows affected · {tab.result.elapsedMs}ms
    </div>
  {:else if tab.result}
    {@const r = tab.result}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            {#each r.columns as c (c.name)}
              <th>
                <span class="cname">{c.name}</span>
                <span class="ctype">{c.dataType}</span>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each r.rows as row, i (i)}
            <tr>
              {#each row as cell, j (j)}
                <td class:null-cell={cell === null}>{formatCell(cell)}</td>
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
  }
  thead .cname {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 600;
  }
  thead .ctype {
    margin-left: 0.4rem;
    opacity: 0.55;
    font-family: "JetBrains Mono", monospace;
    font-size: 9.5px;
  }
  tbody td {
    padding: 0.3rem 0.6rem;
    border-right: 1px solid rgba(26, 22, 18, 0.04);
    border-bottom: 1px solid rgba(26, 22, 18, 0.04);
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11.5px;
    white-space: nowrap;
    vertical-align: top;
  }
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
