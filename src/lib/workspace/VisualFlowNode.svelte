<script lang="ts">
  import type { FlowTraceEvent } from "$lib/workspace";

  type Props = {
    event: FlowTraceEvent;
    state: "current" | "visited" | "pending";
    onClick?: () => void;
  };
  let { event, state, onClick }: Props = $props();

  const operation = $derived.by(() => {
    if (event.kind === "plsql.frame") return `${event.objectName}:${event.lineNumber}`;
    return event.operation;
  });

  const subtitle = $derived.by(() => {
    if (event.kind === "plsql.frame") {
      const ms = event.exitedAtMs !== null ? event.exitedAtMs - event.enteredAtMs : 0;
      return `${ms}ms`;
    }
    const cost = event.cost !== null ? `cost ${event.cost}` : "";
    const card = event.cardinalityActual ?? event.cardinalityEstimated;
    const cardLabel = card !== null && card !== undefined ? `~${card} rows` : "";
    return [cost, cardLabel].filter(Boolean).join(" · ");
  });

  function colorForOperation(op: string): string {
    const u = op.toUpperCase();
    if (u.includes("TABLE ACCESS")) return "#8bc4a8";
    if (u.includes("INDEX")) return "#7aa8c4";
    if (u.includes("JOIN")) return "#c3a66e";
    if (u.includes("SORT") || u.includes("AGG")) return "#c4869b";
    return "var(--text-primary)";
  }

  const accentColor = $derived(event.kind === "explain.node" ? colorForOperation(event.operation) : "#e8643a");
</script>

<button
  type="button"
  class="node node--{state}"
  style="--accent: {accentColor}"
  onclick={onClick}
  aria-current={state === "current"}
>
  <span class="op">{operation}</span>
  {#if subtitle}
    <span class="sub">{subtitle}</span>
  {/if}
</button>

<style>
  .node {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-surface);
    text-align: left;
    cursor: pointer;
    width: 100%;
    color: var(--text-primary);
    font-family: inherit;
  }
  .node--current {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .node--visited {
    opacity: 0.85;
  }
  .node--pending {
    opacity: 0.45;
  }
  .op {
    font-weight: 600;
    font-size: 13px;
  }
  .sub {
    font-size: 11px;
    color: var(--text-muted);
  }
  .node--current .sub {
    color: rgba(255, 255, 255, 0.85);
  }
</style>
