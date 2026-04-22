<script lang="ts">
  import { tick } from "svelte";
  import type { DataFlowResult } from "$lib/workspace";

  type Props = {
    objectName: string;
    objectType: string;
    result: DataFlowResult;
    onNavigate?: (owner: string, objectType: string, name: string) => void;
  };
  const { objectName, objectType, result, onNavigate }: Props = $props();

  const TYPE_COLOR: Record<string, string> = {
    TABLE: "#2980b9", VIEW: "#16a085", PROCEDURE: "#d35400",
    FUNCTION: "#c0963c", PACKAGE: "#8e44ad", "PACKAGE BODY": "#8e44ad",
    TRIGGER: "#c0392b", TYPE: "#2471a3", "TYPE BODY": "#2471a3",
    SEQUENCE: "#1e8449", SYNONYM: "#7f8c8d",
  };
  const TYPE_BADGE: Record<string, string> = {
    TABLE: "TBL", VIEW: "VIEW", PROCEDURE: "PROC", FUNCTION: "FN",
    PACKAGE: "PKG", "PACKAGE BODY": "PKG", TRIGGER: "TRG",
    TYPE: "TYPE", "TYPE BODY": "TYPE", SEQUENCE: "SEQ",
  };

  function col(t: string) { return TYPE_COLOR[t?.toUpperCase()] ?? "#7f8c8d"; }
  function bdg(t: string) { return TYPE_BADGE[t?.toUpperCase()] ?? t?.slice(0, 4).toUpperCase() ?? "?"; }

  const leftNodes = $derived([
    ...result.fkParents.map(n => ({ ...n, rel: "FK ↑" })),
    ...result.upstream
      .filter(n => n.name !== objectName || n.objectType !== objectType)
      .map(n => ({ ...n, rel: "uses" })),
  ]);
  const rightNodes = $derived([
    ...result.downstream
      .filter(n => n.name !== objectName || n.objectType !== objectType)
      .map(n => ({ ...n, rel: "ref" })),
    ...result.fkChildren.map(n => ({ ...n, rel: "FK ↓" })),
  ]);
  const hasData = $derived(leftNodes.length > 0 || rightNodes.length > 0 || result.triggers.length > 0);

  // SVG bezier paths
  let wrap: HTMLElement;
  let centerEl: HTMLElement;
  let leftEls = $state<(HTMLElement | null)[]>([]);
  let rightEls = $state<(HTMLElement | null)[]>([]);
  let paths = $state<{ d: string; color: string; side: "left" | "right" }[]>([]);
  let svgH = $state(0);
  let svgW = $state(0);

  async function drawPaths() {
    await tick();
    if (!wrap || !centerEl) return;
    const wRect = wrap.getBoundingClientRect();
    svgW = wRect.width;
    svgH = wRect.height;
    const c = centerEl.getBoundingClientRect();
    const cx = c.left - wRect.left + c.width / 2;
    const cy = c.top - wRect.top + c.height / 2;
    const newPaths: typeof paths = [];

    for (let i = 0; i < leftNodes.length; i++) {
      const el = leftEls[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const px = r.right - wRect.left;
      const py = r.top - wRect.top + r.height / 2;
      // target: left edge of center node
      const tx = c.left - wRect.left;
      const ty = cy;
      const mx = (px + tx) / 2;
      newPaths.push({
        d: `M${px},${py} C${mx},${py} ${mx},${ty} ${tx},${ty}`,
        color: col(leftNodes[i].objectType),
        side: "left",
      });
    }

    for (let i = 0; i < rightNodes.length; i++) {
      const el = rightEls[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const px = r.left - wRect.left;
      const py = r.top - wRect.top + r.height / 2;
      // source: right edge of center node
      const sx = c.right - wRect.left;
      const sy = cy;
      const mx = (sx + px) / 2;
      newPaths.push({
        d: `M${sx},${sy} C${mx},${sy} ${mx},${py} ${px},${py}`,
        color: col(rightNodes[i].objectType),
        side: "right",
      });
    }

    paths = newPaths;
  }

  $effect(() => {
    void leftNodes; void rightNodes; void objectName;
    void drawPaths();
  });
</script>

<svelte:window onresize={drawPaths} />

<div class="df" bind:this={wrap}>
  {#if !hasData}
    <p class="empty">No dependencies or dependents found.</p>
  {:else}
    <!-- SVG overlay for bezier paths -->
    <svg
      class="svg-layer"
      style="width:{svgW}px;height:{svgH}px"
      aria-hidden="true"
    >
      <defs>
        {#each paths as p, i}
          <marker id="arr-{i}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill={p.color} opacity="0.6" />
          </marker>
        {/each}
      </defs>
      {#each paths as p, i}
        <path
          d={p.d}
          stroke={p.color}
          stroke-width="1.5"
          fill="none"
          opacity="0.5"
          marker-end="url(#arr-{i})"
        />
      {/each}
    </svg>

    <div class="df-layout">
      <!-- LEFT: upstream -->
      <div class="lane">
        <div class="lane-hd">UPSTREAM</div>
        {#if leftNodes.length === 0}
          <span class="lane-none">none</span>
        {:else}
          {#each leftNodes as node, i}
            <button
              class="node"
              style="--c:{col(node.objectType)}"
              bind:this={leftEls[i]}
              onclick={() => onNavigate?.(node.owner, node.objectType, node.name)}
              title="{node.owner}.{node.name}"
            >
              <span class="badge">{bdg(node.objectType)}</span>
              <span class="nname">{node.name}</span>
              <span class="rel">{node.rel}</span>
            </button>
          {/each}
        {/if}
      </div>

      <!-- CENTER -->
      <div class="center-col">
        <div class="focal" bind:this={centerEl} style="--c:{col(objectType)}">
          <span class="focal-badge">{bdg(objectType)}</span>
          <span class="focal-name">{objectName}</span>
        </div>
      </div>

      <!-- RIGHT: downstream -->
      <div class="lane lane-right">
        <div class="lane-hd">DOWNSTREAM</div>
        {#if rightNodes.length === 0}
          <span class="lane-none">none</span>
        {:else}
          {#each rightNodes as node, i}
            <button
              class="node"
              style="--c:{col(node.objectType)}"
              bind:this={rightEls[i]}
              onclick={() => onNavigate?.(node.owner, node.objectType, node.name)}
              title="{node.owner}.{node.name}"
            >
              <span class="rel">{node.rel}</span>
              <span class="nname">{node.name}</span>
              <span class="badge">{bdg(node.objectType)}</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>

    {#if result.triggers.length > 0}
      <div class="trigs">
        <div class="trigs-hd">TRIGGERS</div>
        {#each result.triggers as t}
          <div class="trig" class:off={t.status !== "ENABLED"}>
            <span class="trig-dot" style="background:{t.status === 'ENABLED' ? '#27ae60' : '#aaa'}"></span>
            <span class="trig-name">{t.name}</span>
            <span class="trig-info">{t.triggerType} · {t.event}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .df {
    position: relative;
    padding: 0.5rem 1rem 0.75rem;
    min-height: 80px;
  }

  .empty {
    font-size: 0.8rem;
    color: var(--text-muted, #999);
    font-style: italic;
    margin: 0;
  }

  /* SVG overlay */
  .svg-layer {
    position: absolute;
    top: 0; left: 0;
    pointer-events: none;
    overflow: visible;
    z-index: 0;
  }

  /* Three-column grid with explicit sizes */
  .df-layout {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 1fr 160px 1fr;
    gap: 2.5rem;
    align-items: center;
    min-height: 90px;
    padding: 0.5rem 0;
  }

  /* Lanes */
  .lane {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.4rem;
  }
  .lane-right {
    align-items: flex-start;
  }
  .lane-hd {
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--text-muted, #aaa);
    margin-bottom: 0.15rem;
  }
  .lane-none {
    font-size: 0.72rem;
    color: var(--text-muted, #bbb);
    font-style: italic;
  }

  /* Node pill */
  .node {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.55rem;
    border-radius: 6px;
    border: 1.5px solid color-mix(in srgb, var(--c) 40%, transparent);
    background: color-mix(in srgb, var(--c) 9%, var(--bg, white));
    cursor: pointer;
    color: inherit;
    text-align: left;
    max-width: 100%;
    transition: background 0.1s, border-color 0.1s, transform 0.1s;
  }
  .node:hover {
    background: color-mix(in srgb, var(--c) 18%, var(--bg, white));
    border-color: color-mix(in srgb, var(--c) 65%, transparent);
    transform: translateX(-2px);
    z-index: 2;
    position: relative;
  }
  .lane-right .node:hover {
    transform: translateX(2px);
  }

  .badge {
    font-size: 0.58rem;
    font-weight: 800;
    font-family: monospace;
    letter-spacing: 0.03em;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 15%, transparent);
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    line-height: 1.6;
  }
  .nname {
    font-family: monospace;
    font-size: 0.73rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 160px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .rel {
    font-size: 0.58rem;
    color: var(--text-muted, #aaa);
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* Focal object — center card */
  .center-col {
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
    z-index: 1;
  }
  .focal {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    padding: 0.7rem 0.75rem;
    border-radius: 10px;
    border: 2px solid color-mix(in srgb, var(--c) 70%, transparent);
    background: color-mix(in srgb, var(--c) 8%, var(--bg, white));
    box-shadow:
      0 0 0 4px color-mix(in srgb, var(--c) 12%, transparent),
      0 2px 8px color-mix(in srgb, var(--c) 15%, transparent);
    width: 100%;
    text-align: center;
  }
  .focal-badge {
    font-size: 0.6rem;
    font-weight: 800;
    font-family: monospace;
    letter-spacing: 0.06em;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 15%, transparent);
    padding: 2px 8px;
    border-radius: 4px;
    line-height: 1.6;
  }
  .focal-name {
    font-family: monospace;
    font-size: 0.75rem;
    font-weight: 700;
    word-break: break-all;
    line-height: 1.35;
    color: var(--text, inherit);
    max-width: 140px;
  }

  /* Triggers */
  .trigs {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border, #e0e0e0);
  }
  .trigs-hd {
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--text-muted, #aaa);
    margin-bottom: 0.45rem;
  }
  .trig {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    font-size: 0.75rem;
  }
  .trig.off { opacity: 0.4; }
  .trig-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .trig-name {
    font-family: monospace;
    font-weight: 600;
    color: #c0392b;
  }
  .trig-info {
    color: var(--text-muted, #999);
    font-size: 0.68rem;
  }
</style>
