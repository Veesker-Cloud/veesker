<script lang="ts">
  import type { VarValue } from "$lib/workspace";

  let { locals }: { locals: VarValue[] } = $props();
</script>

<div class="dl-wrap">
  <div class="dl-header">Locals ({locals.length})</div>
  {#if locals.length === 0}
    <div class="dl-empty">No locals visible in current frame.</div>
  {:else}
    <table class="dl-table">
      <thead>
        <tr><th>Name</th><th>Value</th></tr>
      </thead>
      <tbody>
        {#each locals as l (l.name)}
          <tr>
            <td class="dl-name">{l.name}</td>
            <td class="dl-value">{l.value ?? 'NULL'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .dl-wrap { display: flex; flex-direction: column; height: 100%; overflow: auto; background: var(--bg-surface-alt); }
  .dl-header {
    padding: 6px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
    color: var(--text-muted); background: var(--bg-page); border-bottom: 1px solid var(--border);
    flex-shrink: 0; position: sticky; top: 0;
  }
  .dl-empty { padding: 12px; font-size: 12px; color: var(--text-muted); font-style: italic; }
  .dl-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .dl-table th, .dl-table td {
    padding: 4px 10px; text-align: left; border-bottom: 1px solid var(--border);
    font-family: monospace;
  }
  .dl-table th {
    color: var(--text-muted); font-weight: normal; font-size: 11px; text-transform: uppercase;
    background: var(--bg-page);
  }
  .dl-name { color: #7dcfff; }
  .dl-value { color: var(--text-primary); white-space: pre-wrap; word-break: break-all; }
</style>
