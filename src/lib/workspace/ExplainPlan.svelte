<script lang="ts">
  import type { ExplainNode } from "$lib/workspace";

  type Props = {
    nodes: ExplainNode[];
    onBack: () => void;
    onExplainWithAI: (planText: string) => void;
  };
  let { nodes, onBack, onExplainWithAI }: Props = $props();

  let selectedId = $state<number | null>(nodes.find((n) => n.parentId === null)?.id ?? null);
  $effect(() => {
    nodes; // establish reactive dependency
    selectedId = nodes.find((n) => n.parentId === null)?.id ?? null;
  });
  let selectedNode = $derived(
    selectedId !== null ? (nodes.find((n) => n.id === selectedId) ?? null) : null
  );

  let childrenOf = $derived.by(() => {
    const map = new Map<number | null, ExplainNode[]>();
    for (const node of nodes) {
      const key = node.parentId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(node);
    }
    return map;
  });

  function opColor(operation: string): string {
    const op = operation.toUpperCase();
    if (op.includes("TABLE ACCESS")) return "#8bc4a8";
    if (op.includes("INDEX")) return "#7aa8c4";
    if (op.includes("JOIN")) return "#c3a66e";
    return "var(--text-primary)";
  }

  function formatPlanForAI(): string {
    const parentMap = new Map(nodes.map((n) => [n.id, n.parentId]));
    function depth(id: number): number {
      let d = 0;
      let cur: number | null = id;
      while (true) {
        const p = parentMap.get(cur);
        if (p === undefined || p === null) break;
        cur = p;
        d++;
      }
      return d;
    }
    return nodes
      .map((n) => {
        const indent = "  ".repeat(depth(n.id));
        const op = n.options ? `${n.operation} ${n.options}` : n.operation;
        const obj = n.objectName
          ? ` [${n.objectOwner ? n.objectOwner + "." : ""}${n.objectName}]`
          : "";
        const cost = n.cost !== null ? ` Cost=${n.cost}` : "";
        const rows = n.cardinality !== null ? ` Rows=${n.cardinality}` : "";
        return `${indent}${op}${obj}${cost}${rows}`;
      })
      .join("\n");
  }

  let roots = $derived(childrenOf.get(null) ?? []);
</script>

<div class="ep-root">
  <div class="ep-header">
    <button class="back-btn" onclick={onBack}>← Results</button>
    <span class="ep-title">Explain Plan</span>
    <button class="ai-btn" onclick={() => onExplainWithAI(formatPlanForAI())}>
      Explain with AI
    </button>
  </div>
  <div class="ep-body">
    <div class="tree-col">
      {#snippet renderNode(node: ExplainNode)}
        <button
          class="tree-node"
          class:selected={selectedId === node.id}
          onclick={() => (selectedId = node.id)}
        >
          <span class="op" style="color:{opColor(node.operation)}">
            {node.operation}{node.options ? ` ${node.options}` : ""}
          </span>
          {#if node.objectName}
            <span class="obj"> {node.objectName}</span>
          {/if}
          {#if node.cost !== null}
            <span class="cost"> ·{node.cost}</span>
          {/if}
        </button>
        {#each childrenOf.get(node.id) ?? [] as child (child.id)}
          <div class="tree-children">
            {@render renderNode(child)}
          </div>
        {/each}
      {/snippet}
      {#each roots as root (root.id)}
        {@render renderNode(root)}
      {/each}
    </div>
    <div class="detail-col">
      {#if selectedNode}
        <dl class="detail-grid">
          <dt>Operation</dt>
          <dd>{selectedNode.operation}{selectedNode.options ? ` ${selectedNode.options}` : ""}</dd>
          {#if selectedNode.objectName}
            <dt>Object</dt>
            <dd>{selectedNode.objectOwner ? `${selectedNode.objectOwner}.` : ""}{selectedNode.objectName}</dd>
          {/if}
          {#if selectedNode.cost !== null}
            <dt>Cost</dt><dd>{selectedNode.cost}</dd>
          {/if}
          {#if selectedNode.cardinality !== null}
            <dt>Rows</dt><dd>{selectedNode.cardinality.toLocaleString()}</dd>
          {/if}
          {#if selectedNode.bytes !== null}
            <dt>Bytes</dt><dd>{selectedNode.bytes.toLocaleString()}</dd>
          {/if}
          {#if selectedNode.accessPredicates}
            <dt>Access</dt><dd class="mono">{selectedNode.accessPredicates}</dd>
          {/if}
          {#if selectedNode.filterPredicates}
            <dt>Filter</dt><dd class="mono">{selectedNode.filterPredicates}</dd>
          {/if}
        </dl>
      {:else}
        <p class="hint">Select a node to see details</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .ep-root { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
  .ep-header {
    display: flex; align-items: center; gap: 8px; padding: 6px 10px;
    border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .ep-title { flex: 1; font-size: 11px; color: var(--text-muted); }
  .back-btn, .ai-btn {
    font-size: 11px; padding: 3px 8px; border-radius: 4px; cursor: pointer;
    background: var(--input-bg); border: 1px solid var(--input-border);
    color: var(--text-primary);
  }
  .ai-btn { color: #f5a08a; border-color: rgba(179,62,31,0.3); }
  .back-btn:hover, .ai-btn:hover { background: var(--row-hover); }
  .ep-body { display: flex; flex: 1; overflow: hidden; }
  .tree-col {
    flex: 1; overflow-y: auto; padding: 8px 4px;
    border-right: 1px solid var(--border);
  }
  .tree-node {
    display: block; width: 100%; text-align: left; padding: 3px 8px;
    font-family: "JetBrains Mono", monospace; font-size: 11px;
    background: none; border: none; cursor: pointer; border-radius: 3px;
    color: var(--text-primary); white-space: nowrap;
  }
  .tree-node:hover { background: var(--row-hover); }
  .tree-node.selected { background: rgba(179,62,31,0.12); }
  .tree-children { padding-left: 16px; }
  .obj { color: var(--text-muted); }
  .cost { color: var(--text-muted); font-size: 10px; }
  .detail-col { width: 220px; flex-shrink: 0; overflow-y: auto; padding: 10px 12px; }
  .detail-grid { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0; }
  dt { font-size: 10px; color: var(--text-muted); align-self: start; padding-top: 1px; }
  dd { font-size: 11px; color: var(--text-primary); margin: 0; word-break: break-all; }
  .mono { font-family: "JetBrains Mono", monospace; font-size: 10px; }
  .hint { font-size: 11px; color: var(--text-muted); margin: 0; }
</style>
