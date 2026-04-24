<script lang="ts">
  import type { DebugRunCursor } from "$lib/workspace";

  let { cursor }: { cursor: DebugRunCursor } = $props();

  function fmt(v: unknown): string {
    if (v === null || v === undefined) return "NULL";
    if (v instanceof Date) return v.toISOString();
    return String(v);
  }
</script>

<div class="cg-wrap">
  <div class="cg-header">
    <span class="cg-name">{cursor.name}</span>
    <span class="cg-count">{cursor.rows.length} row{cursor.rows.length === 1 ? '' : 's'}</span>
  </div>
  {#if cursor.columns.length === 0}
    <div class="cg-empty">Empty cursor.</div>
  {:else}
    <div class="cg-scroll">
      <table class="cg-table">
        <thead>
          <tr>
            {#each cursor.columns as c}
              <th>
                <div class="cg-colname">{c.name}</div>
                <div class="cg-coltype">{c.dataType}</div>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each cursor.rows as row}
            <tr>
              {#each row as cell}
                <td class:cg-null={cell === null || cell === undefined}>{fmt(cell)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .cg-wrap {
    display: flex; flex-direction: column; border: 1px solid var(--border);
    border-radius: 4px; margin-bottom: 12px; background: var(--bg-surface-alt);
    overflow: hidden;
  }
  .cg-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 10px; background: var(--bg-page); border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .cg-name { font-family: monospace; color: #7dcfff; font-weight: 500; }
  .cg-count { color: var(--text-muted); font-size: 11px; }
  .cg-empty { padding: 10px; font-size: 12px; color: var(--text-muted); font-style: italic; }
  .cg-scroll { max-height: 300px; overflow: auto; }
  .cg-table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: monospace; }
  .cg-table th, .cg-table td {
    padding: 4px 10px; text-align: left; border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .cg-table th {
    position: sticky; top: 0; background: var(--bg-page); color: var(--text-primary);
    font-weight: normal; text-align: left;
  }
  .cg-colname { color: var(--text-primary); }
  .cg-coltype { color: var(--text-muted); font-size: 10px; text-transform: uppercase; }
  .cg-null { color: var(--text-muted); font-style: italic; }
</style>
