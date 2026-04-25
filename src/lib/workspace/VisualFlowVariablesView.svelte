<script lang="ts">
  import type { FlowTraceEvent } from "$lib/workspace";

  type Props = {
    event: FlowTraceEvent | null;
  };
  let { event }: Props = $props();

  let expanded = $state(true);
  let lastKind = $state<string | null>(null);

  $effect(() => {
    const k = event?.kind ?? null;
    if (k !== lastKind) {
      expanded = k !== "explain.node";
      lastKind = k;
    }
  });

  const variables = $derived.by(() => {
    if (!event || event.kind !== "plsql.frame") return [];
    return event.variables;
  });

  const explainStats = $derived.by(() => {
    if (!event || event.kind !== "explain.node") return null;
    return {
      cost: event.cost,
      cardEst: event.cardinalityEstimated,
      cardAct: event.cardinalityActual,
      elapsed: event.elapsedMsActual,
      bufferGets: event.bufferGets,
    };
  });
</script>

<section class="vars" class:vars--collapsed={!expanded}>
  <button
    type="button"
    class="header"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
  >
    <span class="caret" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
    {#if variables.length > 0}
      Variables ({variables.length})
    {:else if explainStats}
      Plan stats
    {:else}
      Details
    {/if}
  </button>
  {#if expanded}
    <div class="body">
      {#if variables.length > 0}
        <table>
          <tbody>
            {#each variables as v}
              <tr>
                <td class="name">{v.name}</td>
                <td class="type">{v.type}</td>
                <td class="value">{v.value}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else if explainStats}
        <table>
          <tbody>
            <tr><td class="name">Cost</td><td class="value">{explainStats.cost ?? "—"}</td></tr>
            <tr><td class="name">Cardinality (est)</td><td class="value">{explainStats.cardEst ?? "—"}</td></tr>
            <tr><td class="name">Cardinality (actual)</td><td class="value">{explainStats.cardAct ?? "—"}</td></tr>
            <tr><td class="name">Elapsed (ms)</td><td class="value">{explainStats.elapsed ?? "—"}</td></tr>
            <tr><td class="name">Buffer gets</td><td class="value">{explainStats.bufferGets ?? "—"}</td></tr>
          </tbody>
        </table>
      {:else}
        <p class="empty">No detail available for this step.</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .vars {
    border-top: 1px solid var(--border);
    background: var(--bg-surface-alt);
  }
  .header {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    color: var(--text-primary);
    padding: 8px 12px;
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .caret {
    color: var(--text-muted);
    width: 10px;
  }
  .body {
    max-height: 240px;
    overflow-y: auto;
    padding: 0 12px 12px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  td {
    padding: 4px 6px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  .name {
    color: var(--text-muted);
    width: 30%;
  }
  .type {
    color: var(--text-muted);
    width: 20%;
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
  }
  .value {
    font-family: "JetBrains Mono", monospace;
    word-break: break-all;
  }
  .empty {
    color: var(--text-muted);
    font-size: 12px;
    margin: 0;
  }
</style>
