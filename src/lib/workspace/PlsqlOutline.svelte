<script lang="ts">
  import { extractSubprograms, extractSections, type OutlineItem } from "./plsql-outline-parser";

  type Props = {
    sql: string;
    packageSpec?: string;
    objectType: string;
    activeTab?: "spec" | "body";
    onNavigate: (line: number) => void;
    onTabChange?: (tab: "spec" | "body") => void;
  };

  let { sql, packageSpec, objectType, activeTab, onNavigate, onTabChange }: Props = $props();

  const WIDTH_KEY = "veesker.outline.width";

  function loadWidth(): number {
    if (typeof window === "undefined") return 160;
    try {
      const n = parseInt(localStorage.getItem(WIDTH_KEY) ?? "", 10);
      if (Number.isFinite(n) && n >= 100 && n <= 320) return n;
    } catch {}
    return 160;
  }

  let width = $state(loadWidth());
  let specExpanded = $state(true);
  let bodyExpanded = $state(true);

  const isPackage = $derived(
    objectType.toUpperCase() === "PACKAGE" || objectType.toUpperCase() === "PACKAGE BODY"
  );
  const specItems = $derived(
    isPackage && packageSpec ? extractSubprograms(packageSpec) : []
  );
  const bodyItems = $derived(
    isPackage ? extractSubprograms(sql) : extractSections(sql)
  );

  function handleClick(item: OutlineItem, targetTab: "spec" | "body" | undefined) {
    if (targetTab && onTabChange) onTabChange(targetTab);
    onNavigate(item.line);
  }

  function onDragStart(e: PointerEvent) {
    const el = e.currentTarget as HTMLDivElement;
    el.setPointerCapture(e.pointerId);
  }

  function onDragMove(e: PointerEvent) {
    const el = e.currentTarget as HTMLDivElement;
    if (!el.hasPointerCapture(e.pointerId)) return;
    width = Math.max(100, Math.min(320, e.clientX - (el.parentElement?.getBoundingClientRect().left ?? 0)));
  }

  function onDragEnd(e: PointerEvent) {
    const el = e.currentTarget as HTMLDivElement;
    if (el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
      try { localStorage.setItem(WIDTH_KEY, String(width)); } catch {}
    }
  }
</script>

<div class="outline" style="width:{width}px">
  <div class="outline-hdr">Outline</div>
  <div class="outline-body">
    {#if isPackage}
      <button class="group" onclick={() => { specExpanded = !specExpanded; }}>
        <span class="chev">{specExpanded ? "▼" : "▶"}</span> Spec
      </button>
      {#if specExpanded}
        {#each specItems as item (item.line)}
          <button
            class="item"
            onclick={() => handleClick(item, "spec")}
          >
            <span class="icon" class:icon-fn={item.kind === "FUNCTION"} class:icon-proc={item.kind === "PROCEDURE"}>
              {item.kind === "FUNCTION" ? "ƒ" : "P"}
            </span>
            {item.label}
          </button>
        {/each}
      {/if}
      <button class="group" onclick={() => { bodyExpanded = !bodyExpanded; }}>
        <span class="chev">{bodyExpanded ? "▼" : "▶"}</span> Body
      </button>
      {#if bodyExpanded}
        {#each bodyItems as item (item.line)}
          <button
            class="item"
            onclick={() => handleClick(item, "body")}
          >
            <span class="icon" class:icon-fn={item.kind === "FUNCTION"} class:icon-proc={item.kind === "PROCEDURE"}>
              {item.kind === "FUNCTION" ? "ƒ" : "P"}
            </span>
            {item.label}
          </button>
        {/each}
      {/if}
    {:else}
      {#each bodyItems as item (item.line)}
        <button class="item" onclick={() => handleClick(item, undefined)}>
          <span class="icon icon-sec">§</span>
          {item.label}
        </button>
      {/each}
    {/if}
  </div>
  <div
    class="drag-handle"
    role="separator"
    aria-orientation="vertical"
    onpointerdown={onDragStart}
    onpointermove={onDragMove}
    onpointerup={onDragEnd}
    onpointercancel={onDragEnd}
  ></div>
</div>

<style>
  .outline {
    position: relative;
    flex-shrink: 0;
    background: var(--bg-page);
    border-right: 1px solid rgba(255,255,255,0.06);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 100px;
    max-width: 320px;
  }
  .outline-hdr {
    padding: 4px 8px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: rgba(255,255,255,0.25);
    border-bottom: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
  }
  .outline-body {
    flex: 1;
    overflow-y: auto;
    padding: 2px 0;
  }
  .group {
    width: 100%;
    background: transparent;
    border: none;
    padding: 3px 8px;
    display: flex;
    align-items: center;
    gap: 4px;
    color: rgba(255,255,255,0.3);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: .04em;
    cursor: pointer;
    text-align: left;
    margin-top: 4px;
  }
  .group:hover { color: rgba(255,255,255,0.55); }
  .chev { font-size: 7px; }
  .item {
    width: 100%;
    background: transparent;
    border: none;
    padding: 2px 8px 2px 20px;
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 9px;
    font-family: "Space Grotesk", sans-serif;
    color: rgba(255,255,255,0.55);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-left: 2px solid transparent;
  }
  .item:hover { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.85); }
  .icon { font-size: 9px; flex-shrink: 0; }
  .icon-fn { color: #7ec96a; }
  .icon-proc { color: #88b4e7; }
  .icon-sec { color: rgba(255,255,255,0.25); }
  .drag-handle {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    cursor: ew-resize;
    background: transparent;
  }
  .drag-handle:hover { background: rgba(179,62,31,0.4); }
</style>
