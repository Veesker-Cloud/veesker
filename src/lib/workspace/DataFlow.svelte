<script lang="ts">
  import type { DataFlowResult, DataFlowNode } from "$lib/workspace";

  type Props = {
    result: DataFlowResult;
    onNavigate?: (owner: string, objectType: string, name: string) => void;
  };
  const { result, onNavigate }: Props = $props();

  const TYPE_COLOR: Record<string, string> = {
    TABLE:        "#4a7fa5",
    VIEW:         "#4a9e8a",
    PROCEDURE:    "#b87333",
    FUNCTION:     "#a07840",
    PACKAGE:      "#7b5ea7",
    "PACKAGE BODY": "#7b5ea7",
    TRIGGER:      "#b34a4a",
    TYPE:         "#5a7a9a",
    "TYPE BODY":  "#5a7a9a",
    SEQUENCE:     "#6b8c6b",
    INDEX:        "#888",
    SYNONYM:      "#888",
  };

  const TYPE_BADGE: Record<string, string> = {
    TABLE: "tbl", VIEW: "view", PROCEDURE: "proc", FUNCTION: "fn",
    PACKAGE: "pkg", "PACKAGE BODY": "pkg", TRIGGER: "trg",
    TYPE: "type", SEQUENCE: "seq",
  };

  function color(t: string) { return TYPE_COLOR[t.toUpperCase()] ?? "#888"; }
  function badge(t: string) { return TYPE_BADGE[t.toUpperCase()] ?? t.toLowerCase().slice(0, 4); }

  // Merge upstream + fkParents for left column, downstream + fkChildren for right
  const leftNodes = $derived([
    ...result.fkParents.map(n => ({ ...n, rel: "fk-parent" as const })),
    ...result.upstream.map(n => ({ ...n, rel: "dep" as const })),
  ]);

  const rightNodes = $derived([
    ...result.downstream.map(n => ({ ...n, rel: "dep" as const })),
    ...result.fkChildren.map(n => ({ ...n, rel: "fk-child" as const })),
  ]);

  const hasData = $derived(
    leftNodes.length > 0 || rightNodes.length > 0 || result.triggers.length > 0
  );
</script>

<div class="dataflow">
  {#if !hasData}
    <p class="empty">No dependencies or dependents found for this object.</p>
  {:else}
    <div class="flow-grid">
      <!-- LEFT: upstream -->
      <div class="col col-upstream">
        {#if leftNodes.length > 0}
          <div class="col-label">UPSTREAM</div>
          {#each leftNodes as node}
            <button
              class="node"
              style="--c: {color(node.objectType)}"
              onclick={() => onNavigate?.(node.owner, node.objectType, node.name)}
              title="{node.owner}.{node.name}"
            >
              <span class="badge">{badge(node.objectType)}</span>
              <span class="node-name">{node.name}</span>
              {#if node.rel === "fk-parent"}
                <span class="rel-tag">FK ↑</span>
              {/if}
            </button>
          {/each}
        {:else}
          <div class="col-empty">no upstream</div>
        {/if}
      </div>

      <!-- CENTER ARROW LEFT -->
      <div class="arrow-col">
        {#if leftNodes.length > 0}
          <div class="arrow">→</div>
        {/if}
      </div>

      <!-- CENTER: this object is shown by caller, just connectors here -->
      <div class="col col-center">
        <div class="center-dot"></div>
      </div>

      <!-- CENTER ARROW RIGHT -->
      <div class="arrow-col">
        {#if rightNodes.length > 0}
          <div class="arrow">→</div>
        {/if}
      </div>

      <!-- RIGHT: downstream -->
      <div class="col col-downstream">
        {#if rightNodes.length > 0}
          <div class="col-label">DOWNSTREAM</div>
          {#each rightNodes as node}
            <button
              class="node"
              style="--c: {color(node.objectType)}"
              onclick={() => onNavigate?.(node.owner, node.objectType, node.name)}
              title="{node.owner}.{node.name}"
            >
              <span class="badge">{badge(node.objectType)}</span>
              <span class="node-name">{node.name}</span>
              {#if node.rel === "fk-child"}
                <span class="rel-tag">FK ↓</span>
              {/if}
            </button>
          {/each}
        {:else}
          <div class="col-empty">no downstream</div>
        {/if}
      </div>
    </div>

    {#if result.triggers.length > 0}
      <div class="triggers-section">
        <div class="triggers-label">TRIGGERS</div>
        <div class="triggers-list">
          {#each result.triggers as trg}
            <div class="trigger-row" class:inactive={trg.status !== "ENABLED"}>
              <span class="trigger-name">{trg.name}</span>
              <span class="trigger-meta">{trg.triggerType} · {trg.event}</span>
              {#if trg.status !== "ENABLED"}
                <span class="trigger-disabled">DISABLED</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .dataflow {
    padding: 0.75rem 1rem;
  }

  .empty {
    color: var(--text-muted, #888);
    font-size: 0.8rem;
    font-style: italic;
    margin: 0;
  }

  .flow-grid {
    display: grid;
    grid-template-columns: 1fr 20px 40px 20px 1fr;
    gap: 0.25rem;
    align-items: center;
    min-height: 60px;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .col-label {
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--text-muted, #888);
    margin-bottom: 0.15rem;
  }

  .col-empty {
    font-size: 0.75rem;
    color: var(--text-muted, #888);
    font-style: italic;
    opacity: 0.5;
  }

  .col-center {
    align-items: center;
    justify-content: center;
  }

  .center-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent, #b34a1f);
    flex-shrink: 0;
  }

  .arrow-col {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .arrow {
    color: var(--text-muted, #888);
    font-size: 1rem;
    opacity: 0.5;
  }

  .node {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
    background: color-mix(in srgb, var(--c) 8%, transparent);
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background 0.1s;
    font-size: 0.75rem;
    color: inherit;
  }

  .node:hover {
    background: color-mix(in srgb, var(--c) 18%, transparent);
  }

  .badge {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 15%, transparent);
    padding: 1px 4px;
    border-radius: 3px;
    flex-shrink: 0;
    font-family: monospace;
  }

  .node-name {
    font-family: monospace;
    font-size: 0.72rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .rel-tag {
    font-size: 0.6rem;
    color: var(--text-muted, #888);
    flex-shrink: 0;
  }

  .triggers-section {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border, #333);
  }

  .triggers-label {
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--text-muted, #888);
    margin-bottom: 0.4rem;
  }

  .triggers-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .trigger-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    padding: 0.2rem 0;
  }

  .trigger-row.inactive {
    opacity: 0.5;
  }

  .trigger-name {
    font-family: monospace;
    font-weight: 500;
    color: #b34a4a;
  }

  .trigger-meta {
    color: var(--text-muted, #888);
    font-size: 0.7rem;
  }

  .trigger-disabled {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #888;
    background: #333;
    padding: 1px 5px;
    border-radius: 3px;
  }
</style>
