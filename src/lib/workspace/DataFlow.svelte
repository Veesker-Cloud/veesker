<script lang="ts">
  import { onMount } from "svelte";
  import type { DataFlowResult } from "$lib/workspace";

  type Props = {
    objectName: string;
    objectType: string;
    result: DataFlowResult;
    onNavigate?: (owner: string, objectType: string, name: string) => void;
  };
  const { objectName, objectType, result, onNavigate }: Props = $props();

  const TYPE_COLOR: Record<string, string> = {
    TABLE: "#4a90d9", VIEW: "#27ae8a", PROCEDURE: "#e07b30",
    FUNCTION: "#c9a227", PACKAGE: "#8e5fb5", "PACKAGE BODY": "#8e5fb5",
    TRIGGER: "#c0392b", TYPE: "#5a8fb5", "TYPE BODY": "#5a8fb5",
    SEQUENCE: "#5aab5a", SYNONYM: "#888", INDEX: "#888",
  };
  const TYPE_BADGE: Record<string, string> = {
    TABLE: "TBL", VIEW: "VIEW", PROCEDURE: "PROC", FUNCTION: "FN",
    PACKAGE: "PKG", "PACKAGE BODY": "PKG", TRIGGER: "TRG",
    TYPE: "TYPE", "TYPE BODY": "TYPE", SEQUENCE: "SEQ",
  };

  function col(t: string) { return TYPE_COLOR[t.toUpperCase()] ?? "#888"; }
  function bdg(t: string) { return TYPE_BADGE[t.toUpperCase()] ?? t.slice(0, 4).toUpperCase(); }

  const leftNodes = $derived([
    ...result.fkParents.map(n => ({ ...n, rel: "FK parent" })),
    ...result.upstream.filter(n => n.name !== objectName).map(n => ({ ...n, rel: "uses" })),
  ]);
  const rightNodes = $derived([
    ...result.downstream.filter(n => n.name !== objectName).map(n => ({ ...n, rel: "used by" })),
    ...result.fkChildren.map(n => ({ ...n, rel: "FK child" })),
  ]);
  const hasData = $derived(leftNodes.length > 0 || rightNodes.length > 0 || result.triggers.length > 0);

  // SVG connection lines
  let container: HTMLElement;
  let centerEl: HTMLElement;
  let leftEls: HTMLElement[] = [];
  let rightEls: HTMLElement[] = [];
  let paths = $state<{ d: string; color: string }[]>([]);
  let svgW = $state(0);
  let svgH = $state(0);

  function mid(el: HTMLElement, ref: HTMLElement) {
    const er = el.getBoundingClientRect();
    const rr = ref.getBoundingClientRect();
    return { x: er.left - rr.left + er.width / 2, y: er.top - rr.top + er.height / 2 };
  }
  function rightEdge(el: HTMLElement, ref: HTMLElement) {
    const er = el.getBoundingClientRect(); const rr = ref.getBoundingClientRect();
    return { x: er.right - rr.left, y: er.top - rr.top + er.height / 2 };
  }
  function leftEdge(el: HTMLElement, ref: HTMLElement) {
    const er = el.getBoundingClientRect(); const rr = ref.getBoundingClientRect();
    return { x: er.left - rr.left, y: er.top - rr.top + er.height / 2 };
  }

  function drawPaths() {
    if (!container || !centerEl) return;
    const cr = container.getBoundingClientRect();
    svgW = cr.width; svgH = cr.height;
    const c = mid(centerEl, container);
    const newPaths: { d: string; color: string }[] = [];

    leftEls.forEach((el, i) => {
      if (!el) return;
      const p = rightEdge(el, container);
      const color = col(leftNodes[i]?.objectType ?? "");
      const cx1 = p.x + (c.x - p.x) * 0.5;
      newPaths.push({ d: `M${p.x},${p.y} C${cx1},${p.y} ${cx1},${c.y} ${c.x},${c.y}`, color });
    });
    rightEls.forEach((el, i) => {
      if (!el) return;
      const p = leftEdge(el, container);
      const color = col(rightNodes[i]?.objectType ?? "");
      const cx1 = c.x + (p.x - c.x) * 0.5;
      newPaths.push({ d: `M${c.x},${c.y} C${cx1},${c.y} ${cx1},${p.y} ${p.x},${p.y}`, color });
    });
    paths = newPaths;
  }

  $effect(() => {
    // re-draw whenever nodes change
    void leftNodes; void rightNodes;
    setTimeout(drawPaths, 0);
  });

  onMount(() => {
    const ro = new ResizeObserver(drawPaths);
    ro.observe(container);
    drawPaths();
    return () => ro.disconnect();
  });
</script>

<div class="df-wrap" bind:this={container}>
  {#if !hasData}
    <p class="empty">No dependencies or dependents found.</p>
  {:else}
    <!-- SVG layer for bezier connections -->
    <svg class="lines" width={svgW} height={svgH} aria-hidden="true">
      {#each paths as p}
        <path d={p.d} stroke={p.color} stroke-width="1.5" fill="none" opacity="0.45" />
      {/each}
    </svg>

    <div class="df-cols">
      <!-- LEFT: upstream -->
      <div class="lane lane-left">
        {#if leftNodes.length > 0}
          <div class="lane-label">UPSTREAM</div>
          {#each leftNodes as node, i}
            <button
              class="node"
              style="--c:{col(node.objectType)}"
              bind:this={leftEls[i]}
              onclick={() => onNavigate?.(node.owner, node.objectType, node.name)}
              title="{node.owner}.{node.name} · {node.rel}"
            >
              <span class="node-badge">{bdg(node.objectType)}</span>
              <span class="node-name">{node.name}</span>
              <span class="node-rel">{node.rel}</span>
            </button>
          {/each}
        {:else}
          <div class="lane-empty">
            <span class="lane-label">UPSTREAM</span>
            <span class="none-text">none</span>
          </div>
        {/if}
      </div>

      <!-- CENTER: focal object -->
      <div class="center-col">
        <div class="center-node" bind:this={centerEl} style="--c:{col(objectType)}">
          <span class="center-badge">{bdg(objectType)}</span>
          <span class="center-name">{objectName}</span>
        </div>
      </div>

      <!-- RIGHT: downstream -->
      <div class="lane lane-right">
        {#if rightNodes.length > 0}
          <div class="lane-label">DOWNSTREAM</div>
          {#each rightNodes as node, i}
            <button
              class="node"
              style="--c:{col(node.objectType)}"
              bind:this={rightEls[i]}
              onclick={() => onNavigate?.(node.owner, node.objectType, node.name)}
              title="{node.owner}.{node.name} · {node.rel}"
            >
              <span class="node-badge">{bdg(node.objectType)}</span>
              <span class="node-name">{node.name}</span>
              <span class="node-rel">{node.rel}</span>
            </button>
          {/each}
        {:else}
          <div class="lane-empty">
            <span class="lane-label">DOWNSTREAM</span>
            <span class="none-text">none</span>
          </div>
        {/if}
      </div>
    </div>

    {#if result.triggers.length > 0}
      <div class="triggers">
        <div class="triggers-hd">TRIGGERS</div>
        {#each result.triggers as trg}
          <div class="trg-row" class:disabled={trg.status !== "ENABLED"}>
            <span class="trg-dot" style="background:{trg.status === 'ENABLED' ? '#27ae60' : '#888'}"></span>
            <span class="trg-name">{trg.name}</span>
            <span class="trg-meta">{trg.triggerType} · {trg.event}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .df-wrap {
    position: relative;
    padding: 1rem 1rem 0.5rem;
  }

  .empty {
    font-size: 0.8rem;
    color: var(--text-muted, #888);
    font-style: italic;
    margin: 0;
  }

  /* SVG bezier lines overlay */
  .lines {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
  }

  /* Three-column layout */
  .df-cols {
    display: grid;
    grid-template-columns: 1fr 180px 1fr;
    gap: 1.5rem;
    align-items: center;
    min-height: 80px;
  }

  /* Lanes */
  .lane {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .lane-left { align-items: flex-end; }
  .lane-right { align-items: flex-start; }

  .lane-label {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--text-muted, #888);
    margin-bottom: 0.1rem;
  }
  .lane-left .lane-label { text-align: right; }

  .lane-empty {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    opacity: 0.5;
  }
  .lane-left .lane-empty { align-items: flex-end; }

  .none-text {
    font-size: 0.75rem;
    color: var(--text-muted, #888);
    font-style: italic;
  }

  /* Node cards */
  .node {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.6rem;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
    background: color-mix(in srgb, var(--c) 7%, var(--surface, #1a1a1a));
    cursor: pointer;
    color: inherit;
    font-size: 0;
    text-align: left;
    max-width: 100%;
    transition: background 0.12s, border-color 0.12s;
  }
  .node:hover {
    background: color-mix(in srgb, var(--c) 16%, var(--surface, #1a1a1a));
    border-color: color-mix(in srgb, var(--c) 60%, transparent);
  }

  .node-badge {
    font-size: 0.58rem;
    font-weight: 800;
    font-family: monospace;
    letter-spacing: 0.04em;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 18%, transparent);
    padding: 2px 5px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .node-name {
    font-family: monospace;
    font-size: 0.75rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .node-rel {
    font-size: 0.6rem;
    color: var(--text-muted, #888);
    white-space: nowrap;
    flex-shrink: 0;
    opacity: 0.7;
  }

  /* Center focal node */
  .center-col {
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .center-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 0.75rem 1rem;
    border-radius: 10px;
    border: 2px solid color-mix(in srgb, var(--c) 60%, transparent);
    background: color-mix(in srgb, var(--c) 10%, var(--surface, #1a1a1a));
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 10%, transparent);
    text-align: center;
    min-width: 120px;
  }
  .center-badge {
    font-size: 0.62rem;
    font-weight: 800;
    font-family: monospace;
    letter-spacing: 0.08em;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 20%, transparent);
    padding: 2px 8px;
    border-radius: 4px;
  }
  .center-name {
    font-family: monospace;
    font-size: 0.78rem;
    font-weight: 600;
    word-break: break-all;
    line-height: 1.3;
    color: color-mix(in srgb, var(--c) 80%, white);
  }

  /* Triggers section */
  .triggers {
    margin-top: 1.25rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border, #2a2a2a);
  }
  .triggers-hd {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--text-muted, #888);
    margin-bottom: 0.5rem;
  }
  .trg-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0;
    font-size: 0.75rem;
  }
  .trg-row.disabled { opacity: 0.45; }
  .trg-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .trg-name {
    font-family: monospace;
    font-weight: 600;
    color: #c0392b;
  }
  .trg-meta {
    color: var(--text-muted, #888);
    font-size: 0.7rem;
  }
</style>
