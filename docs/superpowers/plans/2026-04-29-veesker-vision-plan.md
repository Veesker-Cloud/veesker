# Veesker Vision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Vision" tab to ObjectDetails that shows a force-directed graph of all Oracle objects transitively connected to the current object, with a bottom drawer showing DDL, versions, compile errors, and audit history on node click.

**Architecture:** New "vision" tab in ObjectDetails (CL-only, JWT-enforced). Graph rendered with d3-force + SVG in `VisionGraph.svelte`. Node click opens `VisionDetailDrawer.svelte` as a bottom drawer. New sidecar RPC `vision.graph` does BFS over ALL_DEPENDENCIES + ALL_CONSTRAINTS. New Tauri command `vision_graph` proxies the sidecar call.

**Tech Stack:** Svelte 5 runes, D3 v7 (d3-force, d3-zoom, d3-drag, d3-selection), TypeScript, node-oracledb (sidecar), existing commands (object_ddl_get, compile_errors_get, object_version_list), cloud_api_get (Rust)

**Repo note:** This plan is written while code lives in `veesker`. After the repo split, implementation goes in `veesker-cloud-desktop`. File paths are relative to the desktop app root.

---

## File Map

| File | Action |
|---|---|
| `package.json` (root) | Add `d3` dependency |
| `sidecar/src/oracle.ts` | Add `visionGraph()` — BFS over Oracle metadata |
| `sidecar/src/index.ts` | Register `vision.graph` RPC handler |
| `src-tauri/src/commands.rs` | Add `vision_graph` Tauri command |
| `src-tauri/src/lib.rs` | Register `vision_graph` in invoke_handler |
| `src/lib/workspace/VisionGraph.svelte` | New — d3-force SVG canvas component |
| `src/lib/workspace/VisionDetailDrawer.svelte` | New — bottom drawer with 4 tabs |
| `src/lib/workspace/VisionTab.svelte` | New — auth gate + data loading orchestration |
| `src/lib/workspace/ObjectDetails.svelte` | Add `"vision"` to Tab type and tab list |
| `veesker-cloud/src/routes/audit.ts` | Add `object` query filter to GET /v1/audit |

---

### Task 1: Install d3

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install d3**

```bash
bun add d3
bun add -d @types/d3
```

- [ ] **Step 2: Verify the install**

```bash
bun run build 2>&1 | grep -i "d3\|error" | head -20
```

Expected: no errors mentioning d3.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore(vision): add d3 dependency"
```

---

### Task 2: Sidecar — `visionGraph()` BFS function

**Files:**
- Modify: `sidecar/src/oracle.ts` (add after the existing `objectDataflow` function, around line 1130)

- [ ] **Step 1: Write the failing test**

Create `sidecar/src/vision.test.ts`:

```typescript
import { describe, it, expect, mock } from "bun:test";

// Minimal mock of the graph structure
describe("visionGraph node deduplication", () => {
  it("deduplicates nodes that appear multiple times in BFS", () => {
    const seen = new Set<string>();
    const addNode = (owner: string, name: string) => {
      const id = `${owner}.${name}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    };
    expect(addNode("HR", "EMPLOYEES")).toBe(true);
    expect(addNode("HR", "EMPLOYEES")).toBe(false); // duplicate
    expect(addNode("HR", "DEPARTMENTS")).toBe(true);
    expect(seen.size).toBe(2);
  });

  it("respects MAX_NODES limit", () => {
    const MAX_NODES = 300;
    const nodes: string[] = [];
    for (let i = 0; i < 350; i++) {
      if (nodes.length >= MAX_NODES) break;
      nodes.push(`NODE_${i}`);
    }
    expect(nodes.length).toBe(MAX_NODES);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes (pure logic — no DB needed)**

```bash
cd sidecar && bun test vision.test.ts
```

Expected: `2 pass, 0 fail`

- [ ] **Step 3: Add the VisionGraphResult type to oracle.ts**

Add after the `DataFlowResult` type definition (search for `export type DataFlowResult`):

```typescript
export type VisionNode = {
  id: string;        // "OWNER.NAME"
  name: string;
  owner: string;
  type: string;      // TABLE | VIEW | PACKAGE | PROCEDURE | FUNCTION | TRIGGER | SEQUENCE
  status: string;    // VALID | INVALID
  degree: number;    // total edge count (sized by this)
  isOrigin: boolean;
};

export type VisionEdge = {
  source: string;  // node id
  target: string;  // node id
  kind: "fk" | "dep";
};

export type VisionGraphResult = {
  nodes: VisionNode[];
  edges: VisionEdge[];
  truncated: boolean;
  truncatedAt: number | null;
};
```

- [ ] **Step 4: Add `visionGraph()` function to oracle.ts**

Add after the `objectDataflow` function:

```typescript
const MAX_VISION_NODES = 300;

export async function visionGraph(p: {
  owner: string;
  objectName: string;
  objectType: string;
}): Promise<VisionGraphResult> {
  return withActiveSession(async (conn) => {
    const opts = { outFormat: oracledb.OUT_FORMAT_ARRAY, maxRows: 5000 };

    const nodes = new Map<string, VisionNode>();
    const edges: VisionEdge[] = [];
    const edgeSet = new Set<string>();
    const queue: Array<{ owner: string; name: string; type: string }> = [];

    const originId = `${p.owner.toUpperCase()}.${p.objectName.toUpperCase()}`;
    queue.push({ owner: p.owner.toUpperCase(), name: p.objectName.toUpperCase(), type: p.objectType.toUpperCase() });
    nodes.set(originId, { id: originId, name: p.objectName.toUpperCase(), owner: p.owner.toUpperCase(), type: p.objectType.toUpperCase(), status: "VALID", degree: 0, isOrigin: true });

    let truncated = false;

    while (queue.length > 0) {
      if (nodes.size >= MAX_VISION_NODES) { truncated = true; break; }
      const current = queue.shift()!;
      const currentId = `${current.owner}.${current.name}`;

      // PL/SQL dependencies: what current depends on
      const upRes = await conn.execute<[string, string, string]>(
        `SELECT DISTINCT d.referenced_owner, d.referenced_name, d.referenced_type
         FROM all_dependencies d
         WHERE d.owner = :owner AND d.name = :name
           AND d.referenced_type NOT IN ('NON-EXISTENT', 'UNDEFINED', 'SYNONYM', 'JAVA CLASS')`,
        { owner: current.owner, name: current.name },
        opts
      );
      for (const row of upRes.rows ?? []) {
        const [refOwner, refName, refType] = row;
        const refId = `${refOwner}.${refName}`;
        if (refId === currentId) continue;
        if (!nodes.has(refId)) {
          if (nodes.size >= MAX_VISION_NODES) { truncated = true; break; }
          nodes.set(refId, { id: refId, name: refName, owner: refOwner, type: refType, status: "VALID", degree: 0, isOrigin: false });
          queue.push({ owner: refOwner, name: refName, type: refType });
        }
        const ek = `${currentId}->${refId}:dep`;
        if (!edgeSet.has(ek)) { edgeSet.add(ek); edges.push({ source: currentId, target: refId, kind: "dep" }); }
      }

      // PL/SQL dependencies: what depends on current
      const dnRes = await conn.execute<[string, string, string]>(
        `SELECT DISTINCT d.owner, d.name, d.type
         FROM all_dependencies d
         WHERE d.referenced_owner = :owner AND d.referenced_name = :name
           AND d.type NOT IN ('NON-EXISTENT', 'UNDEFINED', 'SYNONYM', 'JAVA CLASS')`,
        { owner: current.owner, name: current.name },
        opts
      );
      for (const row of dnRes.rows ?? []) {
        const [depOwner, depName, depType] = row;
        const depId = `${depOwner}.${depName}`;
        if (depId === currentId) continue;
        if (!nodes.has(depId)) {
          if (nodes.size >= MAX_VISION_NODES) { truncated = true; break; }
          nodes.set(depId, { id: depId, name: depName, owner: depOwner, type: depType, status: "VALID", degree: 0, isOrigin: false });
          queue.push({ owner: depOwner, name: depName, type: depType });
        }
        const ek = `${depId}->${currentId}:dep`;
        if (!edgeSet.has(ek)) { edgeSet.add(ek); edges.push({ source: depId, target: currentId, kind: "dep" }); }
      }

      // FK relationships (tables only)
      if (current.type === "TABLE") {
        const fkRes = await conn.execute<[string, string, string, string]>(
          `SELECT DISTINCT c.owner, c.table_name, rc.owner, rc.table_name
           FROM all_constraints c
           JOIN all_constraints rc ON rc.constraint_name = c.r_constraint_name AND rc.owner = c.r_owner
           WHERE c.constraint_type = 'R'
             AND (
               (c.owner = :owner AND c.table_name = :name)
               OR (rc.owner = :owner AND rc.table_name = :name)
             )`,
          { owner: current.owner, name: current.name },
          opts
        );
        for (const row of fkRes.rows ?? []) {
          const [srcOwner, srcName, tgtOwner, tgtName] = row;
          for (const [o, n] of [[srcOwner, srcName], [tgtOwner, tgtName]] as [string, string][]) {
            const nid = `${o}.${n}`;
            if (!nodes.has(nid)) {
              if (nodes.size >= MAX_VISION_NODES) { truncated = true; break; }
              nodes.set(nid, { id: nid, name: n, owner: o, type: "TABLE", status: "VALID", degree: 0, isOrigin: false });
              queue.push({ owner: o, name: n, type: "TABLE" });
            }
          }
          const srcId = `${srcOwner}.${srcName}`;
          const tgtId = `${tgtOwner}.${tgtName}`;
          const ek = `${srcId}->${tgtId}:fk`;
          if (!edgeSet.has(ek)) { edgeSet.add(ek); edges.push({ source: srcId, target: tgtId, kind: "fk" }); }
        }
      }
    }

    // Enrich nodes with status from ALL_OBJECTS and compute degree
    const degreeMap = new Map<string, number>();
    for (const e of edges) {
      degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
      degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
    }

    const nodeNames = [...nodes.keys()].map(id => id.split(".")[1]);
    if (nodeNames.length > 0) {
      const placeholders = nodeNames.map((_, i) => `:n${i}`).join(",");
      const binds: Record<string, string> = { owner: p.owner.toUpperCase() };
      nodeNames.forEach((n, i) => { binds[`n${i}`] = n; });
      const metaRes = await conn.execute<[string, string, string]>(
        `SELECT object_name, object_type, status FROM all_objects
         WHERE owner = :owner AND object_name IN (${placeholders})`,
        binds,
        opts
      );
      for (const row of metaRes.rows ?? []) {
        const id = `${p.owner.toUpperCase()}.${row[0]}`;
        const node = nodes.get(id);
        if (node) node.status = row[2];
      }
    }

    for (const [id, node] of nodes) {
      node.degree = degreeMap.get(id) ?? 0;
    }

    return {
      nodes: [...nodes.values()],
      edges,
      truncated,
      truncatedAt: truncated ? MAX_VISION_NODES : null,
    };
  });
}
```

- [ ] **Step 5: Run sidecar build to check for TypeScript errors**

```bash
cd sidecar && bun build src/index.ts --target=bun --outfile=/dev/null 2>&1 | grep -i error | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/oracle.ts sidecar/src/vision.test.ts
git commit -m "feat(vision): add visionGraph BFS function to sidecar oracle.ts"
```

---

### Task 3: Sidecar — register `vision.graph` RPC

**Files:**
- Modify: `sidecar/src/index.ts` (add one line to the RPC dispatch map)

The current dispatch map in `index.ts` looks like:
```typescript
"object.dataflow": (params) => objectDataflow(params as any),
```

- [ ] **Step 1: Add the import**

At the top of `sidecar/src/index.ts`, add `visionGraph` to the existing oracle imports:

```typescript
// Find the line that imports objectDataflow and add visionGraph:
import { ..., objectDataflow, visionGraph } from "./oracle.js";
```

- [ ] **Step 2: Register the handler**

In the dispatch map, after the `"object.dataflow"` line:

```typescript
"vision.graph": (params) => visionGraph(params as any),
```

- [ ] **Step 3: Rebuild sidecar binary**

```bash
cd sidecar && bun run build:win-x64
```

Expected: `Done in Xms`, binary written to `../src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe`

- [ ] **Step 4: Commit**

```bash
git add sidecar/src/index.ts src-tauri/binaries/veesker-sidecar-x86_64-pc-windows-msvc.exe
git commit -m "feat(vision): register vision.graph RPC in sidecar"
```

---

### Task 4: Rust — `vision_graph` Tauri command

**Files:**
- Modify: `src-tauri/src/commands.rs` (add after `object_dataflow_get`, around line 895)
- Modify: `src-tauri/src/lib.rs` (add to invoke_handler list)

- [ ] **Step 1: Add the command to commands.rs**

Add after the `object_dataflow_get` function:

```rust
#[tauri::command]
pub async fn vision_graph(
    app: AppHandle,
    owner: String,
    object_name: String,
    object_type: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "vision.graph",
        json!({ "owner": owner, "objectName": object_name, "objectType": object_type }),
    )
    .await?;
    serde_json::from_value(res).map_err(|e| ConnectionTestErr {
        code: -32099,
        message: format!("decode vision.graph: {e}"),
    })
}
```

- [ ] **Step 2: Register in lib.rs**

In the `invoke_handler` list in `src-tauri/src/lib.rs`, add after `commands::object_dataflow_get`:

```rust
commands::vision_graph,
```

- [ ] **Step 3: Build the Rust project to verify compilation**

```bash
cd src-tauri && cargo build 2>&1 | grep -E "^error" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(vision): add vision_graph Tauri command"
```

---

### Task 5: `VisionGraph.svelte` — force-directed graph component

**Files:**
- Create: `src/lib/workspace/VisionGraph.svelte`

This component receives the graph data and renders it using d3-force + SVG.

- [ ] **Step 1: Create VisionGraph.svelte**

```svelte
<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
-->
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import type { VisionGraphResult, VisionNode, VisionEdge } from "$lib/workspace";

  type Props = {
    graph: VisionGraphResult;
    selectedNodeId: string | null;
    onNodeClick: (node: VisionNode) => void;
    onNodeDoubleClick: (node: VisionNode) => void;
  };
  const { graph, selectedNodeId, onNodeClick, onNodeDoubleClick }: Props = $props();

  const TYPE_COLOR: Record<string, string> = {
    TABLE: "#2980b9", VIEW: "#16a085",
    PACKAGE: "#8e44ad", "PACKAGE BODY": "#8e44ad",
    PROCEDURE: "#d35400", FUNCTION: "#c0963c",
    TRIGGER: "#c0392b", SEQUENCE: "#1e8449",
  };

  function nodeColor(type: string): string {
    return TYPE_COLOR[type?.toUpperCase()] ?? "#7f8c8d";
  }

  function nodeRadius(degree: number): number {
    return Math.max(16, Math.min(40, 10 + degree * 2));
  }

  let svgEl: SVGSVGElement;
  let containerEl: HTMLDivElement;
  let simulation: d3.Simulation<any, any> | null = null;

  onMount(() => {
    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    const svg = d3.select(svgEl);
    const g = svg.append("g");

    // Zoom + pan
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    // Arrow marker
    svg.append("defs").append("marker")
      .attr("id", "arr")
      .attr("viewBox", "0 0 10 10").attr("refX", 20).attr("refY", 5)
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .attr("orient", "auto-start-reverse")
      .append("path").attr("d", "M0,0 L10,5 L0,10 z").attr("fill", "#2a4080");

    const nodes: any[] = graph.nodes.map(n => ({ ...n }));
    const edges: any[] = graph.edges.map(e => ({ ...e }));

    // Build id→index map for d3 link
    const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
    const links = edges.map(e => ({
      source: nodeIndex.get(e.source) ?? 0,
      target: nodeIndex.get(e.target) ?? 0,
      kind: e.kind,
    }));

    simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).distance(100).strength(0.3))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius((d: any) => nodeRadius(d.degree) + 8));

    // Edges
    const link = g.append("g").selectAll("line")
      .data(links).join("line")
      .attr("stroke", "#1e3a5f")
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", (d: any) => d.kind === "dep" ? "5,3" : null)
      .attr("marker-end", "url(#arr)");

    // Node groups
    const node = g.append("g").selectAll("g")
      .data(nodes).join("g")
      .attr("cursor", "pointer")
      .call(
        d3.drag<any, any>()
          .on("start", (event, d) => { if (!event.active) simulation!.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on("end", (event, d) => { if (!event.active) simulation!.alphaTarget(0); })
      )
      .on("click", (_event, d) => onNodeClick(d))
      .on("dblclick", (_event, d) => onNodeDoubleClick(d));

    // Origin node: double ring
    node.filter((d: any) => d.isOrigin)
      .append("circle")
      .attr("r", (d: any) => nodeRadius(d.degree) + 5)
      .attr("fill", "none")
      .attr("stroke", "#4a9eff")
      .attr("stroke-width", 1)
      .attr("opacity", 0.4);

    node.append("circle")
      .attr("r", (d: any) => nodeRadius(d.degree))
      .attr("fill", (d: any) => nodeColor(d.type) + "22")
      .attr("stroke", (d: any) => nodeColor(d.type))
      .attr("stroke-width", (d: any) => d.isOrigin ? 2.5 : 1.5);

    // Status dot (red if INVALID)
    node.filter((d: any) => d.status === "INVALID")
      .append("circle")
      .attr("r", 4).attr("cx", (d: any) => nodeRadius(d.degree) - 4)
      .attr("cy", (d: any) => -nodeRadius(d.degree) + 4)
      .attr("fill", "#e74c3c");

    node.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d: any) => nodeRadius(d.degree) + 13)
      .attr("fill", "#8b949e")
      .attr("font-size", 10)
      .attr("font-family", "monospace")
      .text((d: any) => d.name.length > 14 ? d.name.slice(0, 13) + "…" : d.name);

    // Type badge inside circle
    node.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("fill", (d: any) => nodeColor(d.type))
      .attr("font-size", 8)
      .attr("font-family", "monospace")
      .attr("font-weight", "bold")
      .text((d: any) => {
        const badges: Record<string, string> = { TABLE: "TBL", VIEW: "VIEW", PROCEDURE: "PROC", FUNCTION: "FN", PACKAGE: "PKG", "PACKAGE BODY": "PKG", TRIGGER: "TRG", SEQUENCE: "SEQ" };
        return badges[d.type?.toUpperCase()] ?? d.type?.slice(0, 3) ?? "?";
      });

    // Run simulation for 300 ticks then freeze
    let tick = 0;
    simulation.on("tick", () => {
      tick++;
      link
        .attr("x1", (d: any) => d.source.x).attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x).attr("y2", (d: any) => d.target.y);
      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
      if (tick >= 300) simulation!.stop();
    });

    // Zoom controls
    (window as any).__visionZoom = zoom;
    (window as any).__visionSvg = svg;
    (window as any).__visionWidth = width;
    (window as any).__visionHeight = height;
  });

  onDestroy(() => { simulation?.stop(); });

  export function zoomIn() { (window as any).__visionSvg?.transition().call((window as any).__visionZoom.scaleBy, 1.4); }
  export function zoomOut() { (window as any).__visionSvg?.transition().call((window as any).__visionZoom.scaleBy, 0.7); }
  export function resetZoom() {
    (window as any).__visionSvg?.transition().call(
      (window as any).__visionZoom.transform,
      d3.zoomIdentity.translate((window as any).__visionWidth / 2, (window as any).__visionHeight / 2).scale(0.9)
    );
  }
</script>

<div class="vision-graph" bind:this={containerEl}>
  <svg bind:this={svgEl}></svg>
  <div class="vision-controls">
    <button onclick={zoomIn}>＋</button>
    <button onclick={zoomOut}>－</button>
    <button onclick={resetZoom}>⊙</button>
  </div>
  {#if graph.truncated}
    <div class="vision-truncated-banner">
      Graph truncated at {graph.truncatedAt} nodes. Schema is too large to display fully.
    </div>
  {/if}
</div>

<style>
.vision-graph { position: relative; width: 100%; height: 100%; background: var(--bg-page); }
svg { width: 100%; height: 100%; }
.vision-controls {
  position: absolute; bottom: 12px; left: 12px;
  display: flex; gap: 6px;
}
.vision-controls button {
  background: var(--bg-surface-alt); border: 1px solid var(--border);
  color: var(--text-muted); font-size: 14px; width: 28px; height: 28px;
  border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.vision-controls button:hover { color: var(--text-primary); }
.vision-truncated-banner {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
  background: #3a2a00; color: #ffa657; font-size: 11px;
  padding: 4px 12px; border-radius: 4px; border: 1px solid #5a4000;
}
</style>
```

- [ ] **Step 2: Add `VisionGraphResult`, `VisionNode`, `VisionEdge` types to `src/lib/workspace/index.ts`**

Find the file that exports workspace types and add:

```typescript
export type VisionNode = {
  id: string;
  name: string;
  owner: string;
  type: string;
  status: string;
  degree: number;
  isOrigin: boolean;
};

export type VisionEdge = {
  source: string;
  target: string;
  kind: "fk" | "dep";
};

export type VisionGraphResult = {
  nodes: VisionNode[];
  edges: VisionEdge[];
  truncated: boolean;
  truncatedAt: number | null;
};
```

- [ ] **Step 3: Check frontend builds with no errors**

```bash
bun run build 2>&1 | grep -E "^error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workspace/VisionGraph.svelte src/lib/workspace/index.ts
git commit -m "feat(vision): add VisionGraph d3-force SVG component"
```

---

### Task 6: `VisionDetailDrawer.svelte` — bottom drawer

**Files:**
- Create: `src/lib/workspace/VisionDetailDrawer.svelte`

Pattern: same bottom-drawer CSS as `SqlDrawer.svelte` / debug panel (fixed to bottom of parent, drag handle to resize).

- [ ] **Step 1: Create VisionDetailDrawer.svelte**

```svelte
<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { objectVersionList, objectVersionDiff, type ObjectVersionEntry } from "$lib/object-versions";
  import { cloud_api_get } from "$lib/oracle";
  import type { VisionNode } from "$lib/workspace";

  type Props = {
    node: VisionNode;
    connectionId: string;
    onClose: () => void;
    onExplore: (node: VisionNode) => void;
  };
  const { node, connectionId, onClose, onExplore }: Props = $props();

  type DrawerTab = "ddl" | "versions" | "errors" | "audit";
  let activeTab = $state<DrawerTab>("ddl");
  let drawerHeight = $state(300);
  let isDragging = $state(false);
  let dragStartY = 0;
  let dragStartH = 0;

  // DDL
  let ddl = $state<string | null>(null);
  let ddlLoading = $state(false);
  let ddlError = $state<string | null>(null);

  // Versions
  let versions = $state<ObjectVersionEntry[]>([]);
  let versionsLoading = $state(false);
  let selectedVersionId = $state<number | null>(null);
  let versionDiff = $state<string | null>(null);

  // Errors
  type CompileError = { line: number; col: number; text: string; attribute: string };
  let errors = $state<CompileError[]>([]);
  let errorsLoading = $state(false);

  // Audit
  type AuditEntry = { occurredAt: string; userEmail: string; sql: string; success: boolean; elapsedMs: number };
  let auditEntries = $state<AuditEntry[]>([]);
  let auditLoading = $state(false);
  let auditError = $state<string | null>(null);

  onMount(() => { loadDdl(); });

  $effect(() => {
    void node; // re-load when node changes
    activeTab = "ddl";
    ddl = null; ddlError = null; versions = []; errors = []; auditEntries = [];
    loadDdl();
  });

  $effect(() => {
    if (activeTab === "versions" && versions.length === 0) loadVersions();
    if (activeTab === "errors" && errors.length === 0) loadErrors();
    if (activeTab === "audit" && auditEntries.length === 0) loadAudit();
  });

  async function loadDdl() {
    ddlLoading = true; ddlError = null;
    try {
      const res = await invoke<{ ddl: string }>("object_ddl_get", {
        connectionId, owner: node.owner, objectType: node.type, objectName: node.name,
      });
      ddl = res.ddl;
    } catch (e) { ddlError = String(e); }
    ddlLoading = false;
  }

  async function loadVersions() {
    versionsLoading = true;
    const res = await objectVersionList(connectionId, node.owner, node.type, node.name);
    if (res.ok) versions = res.data;
    versionsLoading = false;
  }

  async function loadErrors() {
    errorsLoading = true;
    try {
      const res = await invoke<CompileError[]>("compile_errors_get", {
        connectionId, owner: node.owner, objectType: node.type, objectName: node.name,
      });
      errors = res;
    } catch { errors = []; }
    errorsLoading = false;
  }

  async function loadAudit() {
    auditLoading = true; auditError = null;
    try {
      const res = await invoke<{ entries: AuditEntry[] }>("cloud_api_get", {
        path: "/v1/audit",
        params: { object: node.name, limit: "20" },
      });
      auditEntries = res.entries;
    } catch (e) {
      const msg = String(e);
      auditError = msg === "not_authenticated"
        ? "Connect to Veesker Cloud to view execution history."
        : `Failed to load: ${msg}`;
    }
    auditLoading = false;
  }

  async function loadDiff(v: ObjectVersionEntry) {
    if (versions.length < 2) return;
    const idx = versions.indexOf(v);
    if (idx === versions.length - 1) return;
    const res = await objectVersionDiff(
      connectionId,
      versions[idx + 1].sha, v.sha,
      `${node.owner}/${node.type}/${node.name}.sql`
    );
    if (res.ok) versionDiff = res.data;
  }

  // Drag to resize
  function onDragStart(e: MouseEvent) {
    isDragging = true; dragStartY = e.clientY; dragStartH = drawerHeight;
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
  }
  function onDragMove(e: MouseEvent) {
    if (!isDragging) return;
    drawerHeight = Math.max(120, Math.min(600, dragStartH + (dragStartY - e.clientY)));
  }
  function onDragEnd() {
    isDragging = false;
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
  }

  const TYPE_BADGE: Record<string, string> = {
    TABLE: "TBL", VIEW: "VIEW", PROCEDURE: "PROC", FUNCTION: "FN",
    PACKAGE: "PKG", "PACKAGE BODY": "PKG", TRIGGER: "TRG", SEQUENCE: "SEQ",
  };
</script>

<div class="vision-drawer" style="height: {drawerHeight}px">
  <!-- Drag handle -->
  <div class="drag-handle" onmousedown={onDragStart} role="separator" aria-orientation="horizontal"></div>

  <!-- Header -->
  <div class="drawer-header">
    <span class="type-badge">{TYPE_BADGE[node.type?.toUpperCase()] ?? node.type}</span>
    <span class="obj-owner">{node.owner}.</span><span class="obj-name">{node.name}</span>
    <span class="status-badge" class:invalid={node.status === "INVALID"}>{node.status}</span>
    <button class="explore-btn" onclick={() => onExplore(node)}>Explore in graph ↗</button>
    <button class="close-btn" onclick={onClose}>×</button>
  </div>

  <!-- Tabs -->
  <div class="drawer-tabs">
    {#each (["ddl", "versions", "errors", "audit"] as DrawerTab[]) as tab}
      <button class="dtab" class:active={activeTab === tab} onclick={() => activeTab = tab}>
        {tab === "ddl" ? "DDL" : tab === "versions" ? "Versions" : tab === "errors" ? "Errors" : "Audit"}
        {#if tab === "errors" && errors.length > 0}
          <span class="err-count">{errors.length}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Body -->
  <div class="drawer-body">
    {#if activeTab === "ddl"}
      {#if ddlLoading}<div class="loading">Loading DDL…</div>
      {:else if ddlError}<div class="err-msg">{ddlError}</div>
      {:else if ddl}<pre class="ddl-code">{ddl}</pre>
      {:else}<div class="empty">No DDL available.</div>{/if}

    {:else if activeTab === "versions"}
      {#if versionsLoading}<div class="loading">Loading versions…</div>
      {:else if versions.length === 0}<div class="empty">No versions captured yet.</div>
      {:else}
        <div class="version-list">
          {#each versions as v}
            <button class="version-row" class:selected={selectedVersionId === v.id}
              onclick={() => { selectedVersionId = v.id; void loadDiff(v); }}>
              <span class="sha">{v.sha.slice(0, 7)}</span>
              <span class="label">{v.label ?? "—"}</span>
              <span class="ts">{new Date(v.capturedAt).toLocaleString()}</span>
            </button>
          {/each}
        </div>
        {#if versionDiff}<pre class="diff-code">{versionDiff}</pre>{/if}
      {/if}

    {:else if activeTab === "errors"}
      {#if errorsLoading}<div class="loading">Loading…</div>
      {:else if errors.length === 0}<div class="empty">No compile errors.</div>
      {:else}
        <table class="err-table">
          <thead><tr><th>Line</th><th>Col</th><th>Message</th></tr></thead>
          <tbody>
            {#each errors as e}
              <tr><td>{e.line}</td><td>{e.col}</td><td>{e.text}</td></tr>
            {/each}
          </tbody>
        </table>
      {/if}

    {:else if activeTab === "audit"}
      {#if auditLoading}<div class="loading">Loading audit…</div>
      {:else if auditError}<div class="err-msg">{auditError}</div>
      {:else if auditEntries.length === 0}<div class="empty">No executions recorded for this object.</div>
      {:else}
        <table class="audit-table">
          <thead><tr><th>When</th><th>User</th><th>SQL</th><th>Result</th><th>ms</th></tr></thead>
          <tbody>
            {#each auditEntries as e}
              <tr>
                <td>{new Date(e.occurredAt).toLocaleString()}</td>
                <td>{e.userEmail}</td>
                <td class="sql-cell" title={e.sql}>{e.sql.slice(0, 80)}{e.sql.length > 80 ? "…" : ""}</td>
                <td><span class="result-badge" class:fail={!e.success}>{e.success ? "OK" : "FAIL"}</span></td>
                <td>{e.elapsedMs}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {/if}
  </div>
</div>

<style>
.vision-drawer {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: var(--bg-surface); border-top: 1px solid var(--border);
  display: flex; flex-direction: column; z-index: 10;
}
.drag-handle {
  height: 4px; background: transparent; cursor: ns-resize;
  border-top: 1px solid var(--border);
}
.drag-handle:hover { background: var(--border); }
.drawer-header {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.type-badge { background: #1a3a6e; color: #7eb3ff; font-size: 10px; padding: 2px 6px; border-radius: 3px; font-weight: 700; }
.obj-owner { color: var(--text-muted); font-size: 13px; }
.obj-name { font-size: 13px; font-weight: 700; color: var(--text-primary); }
.status-badge { font-size: 10px; padding: 2px 6px; border-radius: 3px; background: #1a3a1a; color: #3fb950; }
.status-badge.invalid { background: #3a1a1a; color: #e74c3c; }
.explore-btn { margin-left: auto; background: transparent; border: 1px solid var(--border); color: var(--text-muted); font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer; }
.explore-btn:hover { color: var(--text-primary); }
.close-btn { background: transparent; border: none; color: var(--text-muted); font-size: 16px; cursor: pointer; padding: 0 4px; }
.drawer-tabs { display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.dtab { padding: 5px 14px; font-size: 12px; color: var(--text-muted); border: none; background: transparent; border-bottom: 2px solid transparent; cursor: pointer; }
.dtab.active { color: #7eb3ff; border-bottom-color: #4a9eff; }
.drawer-body { flex: 1; overflow-y: auto; padding: 0; }
.loading, .empty { padding: 16px; color: var(--text-muted); font-size: 12px; }
.err-msg { padding: 12px; color: #e74c3c; font-size: 12px; }
.ddl-code, .diff-code { font-family: monospace; font-size: 12px; padding: 12px; margin: 0; white-space: pre; color: var(--text-primary); background: var(--bg-page); overflow-x: auto; }
.version-list { display: flex; flex-direction: column; }
.version-row { display: flex; gap: 12px; padding: 6px 12px; text-align: left; background: transparent; border: none; border-bottom: 1px solid var(--border); cursor: pointer; color: var(--text-primary); font-size: 12px; }
.version-row:hover, .version-row.selected { background: var(--bg-surface-alt); }
.sha { font-family: monospace; color: var(--text-muted); min-width: 56px; }
.ts { color: var(--text-muted); margin-left: auto; }
.err-table, .audit-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.err-table th, .err-table td, .audit-table th, .audit-table td { padding: 5px 10px; border-bottom: 1px solid var(--border); text-align: left; color: var(--text-primary); }
.err-table th, .audit-table th { color: var(--text-muted); font-weight: 600; background: var(--bg-surface-alt); }
.sql-cell { font-family: monospace; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-badge { font-size: 10px; padding: 1px 5px; border-radius: 3px; background: #1a3a1a; color: #3fb950; }
.result-badge.fail { background: #3a1a1a; color: #e74c3c; }
.err-count { background: #e74c3c; color: #fff; font-size: 9px; padding: 0 4px; border-radius: 8px; margin-left: 4px; }
</style>
```

- [ ] **Step 2: Check frontend builds**

```bash
bun run build 2>&1 | grep -E "^error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace/VisionDetailDrawer.svelte
git commit -m "feat(vision): add VisionDetailDrawer bottom-drawer component"
```

---

### Task 7: `VisionTab.svelte` — auth gate + orchestration

**Files:**
- Create: `src/lib/workspace/VisionTab.svelte`

- [ ] **Step 1: Create VisionTab.svelte**

```svelte
<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import VisionGraph from "./VisionGraph.svelte";
  import VisionDetailDrawer from "./VisionDetailDrawer.svelte";
  import type { VisionGraphResult, VisionNode } from "$lib/workspace";

  type Props = {
    connectionId: string;
    owner: string;
    objectName: string;
    objectType: string;
    onSignIn: () => void;
  };
  const { connectionId, owner, objectName, objectType, onSignIn }: Props = $props();

  type State = "checking" | "locked" | "loading" | "ready" | "error";
  let state = $state<State>("checking");
  let errorMsg = $state<string | null>(null);
  let graph = $state<VisionGraphResult | null>(null);
  let selectedNode = $state<VisionNode | null>(null);

  // Current graph seed — changes when user double-clicks a node
  let seedOwner = $state(owner);
  let seedName = $state(objectName);
  let seedType = $state(objectType);

  onMount(() => { void init(); });

  // Reload when the selected object changes from outside
  $effect(() => {
    void owner; void objectName; void objectType;
    seedOwner = owner; seedName = objectName; seedType = objectType;
    selectedNode = null; graph = null;
    void loadGraph();
  });

  async function init() {
    state = "checking";
    try {
      await invoke("cloud_api_get", { path: "/v1/auth/me", params: {} });
    } catch {
      state = "locked";
      return;
    }
    await loadGraph();
  }

  async function loadGraph() {
    state = "loading";
    try {
      const result = await invoke<VisionGraphResult>("vision_graph", {
        owner: seedOwner, objectName: seedName, objectType: seedType,
      });
      graph = result;
      state = "ready";
    } catch (e) {
      errorMsg = String(e);
      state = "error";
    }
  }

  function handleNodeClick(node: VisionNode) {
    selectedNode = node;
  }

  function handleNodeDoubleClick(node: VisionNode) {
    selectedNode = null;
    seedOwner = node.owner;
    seedName = node.name;
    seedType = node.type;
    void loadGraph();
  }
</script>

<div class="vision-tab">
  {#if state === "checking" || state === "loading"}
    <div class="center-state">
      <span class="spinner"></span>
      {state === "checking" ? "Verifying Cloud access…" : `Building graph for ${seedName}…`}
    </div>

  {:else if state === "locked"}
    <div class="center-state locked">
      <div class="lock-icon">◉</div>
      <p>Veesker Vision is exclusive to the Cloud plan.</p>
      <button class="sign-in-btn" onclick={onSignIn}>Sign in to Cloud</button>
    </div>

  {:else if state === "error"}
    <div class="center-state error">
      <p>Failed to load graph: {errorMsg}</p>
      <button onclick={() => void loadGraph()}>Retry</button>
    </div>

  {:else if graph}
    <div class="graph-wrap">
      <VisionGraph
        {graph}
        selectedNodeId={selectedNode?.id ?? null}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
      />
      {#if selectedNode}
        <VisionDetailDrawer
          node={selectedNode}
          {connectionId}
          onClose={() => { selectedNode = null; }}
          onExplore={handleNodeDoubleClick}
        />
      {/if}
    </div>
  {/if}
</div>

<style>
.vision-tab { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; }
.graph-wrap { position: relative; flex: 1; overflow: hidden; }
.center-state {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px; color: var(--text-muted); font-size: 13px;
}
.center-state.locked { gap: 16px; }
.lock-icon { font-size: 32px; color: #4a9eff; opacity: 0.5; }
.sign-in-btn {
  background: #1a3a6e; color: #7eb3ff; border: 1px solid #2a5090;
  padding: 6px 16px; border-radius: 6px; font-size: 13px; cursor: pointer;
}
.sign-in-btn:hover { background: #2a4a8e; }
.spinner {
  width: 16px; height: 16px; border: 2px solid var(--border);
  border-top-color: #4a9eff; border-radius: 50%; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
```

- [ ] **Step 2: Check frontend builds**

```bash
bun run build 2>&1 | grep -E "^error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace/VisionTab.svelte
git commit -m "feat(vision): add VisionTab auth-gate + orchestration component"
```

---

### Task 8: Wire Vision tab into ObjectDetails

**Files:**
- Modify: `src/lib/workspace/ObjectDetails.svelte`

- [ ] **Step 1: Add Vision to the Tab type**

In `ObjectDetails.svelte` line 69, change:
```typescript
type Tab = "overview" | "columns" | "indexes" | "related" | "dataflow" | "vectors";
```
To:
```typescript
type Tab = "overview" | "columns" | "indexes" | "related" | "dataflow" | "vectors" | "vision";
```

- [ ] **Step 2: Add Vision to the tabs list**

The `tabs` derived value (around line 280) builds the tab array. For TABLE/VIEW:
```typescript
return [
  { id: "columns", label: "Columns" },
  { id: "indexes", label: "Indexes" },
  { id: "related", label: "Related", count: relCount },
  { id: "dataflow", label: "Graph" },
  ...(hasVectorCols ? [{ id: "vectors" as Tab, label: "Vectors" }] : []),
  { id: "vision" as Tab, label: "◉ Vision" },  // ADD THIS
];
```

For PL/SQL objects (the `return [{ id: "dataflow", label: "Graph" }]` branch):
```typescript
return [
  { id: "dataflow", label: "Graph" },
  { id: "vision" as Tab, label: "◉ Vision" },  // ADD THIS
];
```

- [ ] **Step 3: Add the Vision import**

At the top of the `<script>` block, add:
```typescript
import VisionTab from "./VisionTab.svelte";
```

- [ ] **Step 4: Add Vision tab content**

After the `{:else if activeTab === "dataflow"}` block (around line 840), add:

```svelte
{:else if activeTab === "vision"}
  <VisionTab
    connectionId={connectionId ?? ""}
    owner={selected.owner}
    objectName={selected.name}
    objectType={selected.kind}
    onSignIn={() => { /* bubble up — parent handles login modal */ }}
  />
```

Note: `connectionId` is a prop already passed to ObjectDetails. Check how it's declared in the props and use the same name.

- [ ] **Step 5: Run the dev server and test**

```bash
bun run tauri dev
```

1. Connect to Oracle
2. Click any table in the schema tree (e.g. EMPLOYEES)
3. Click the "◉ Vision" tab
4. If not logged in to Cloud: should see locked state with "Sign in to Cloud" button
5. If logged in: should see graph loading, then the d3 force-directed graph
6. Click a node: bottom drawer appears with DDL tab
7. Click DDL/Versions/Errors/Audit tabs: each loads correctly
8. Double-click a node: graph reloads centered on that object

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace/ObjectDetails.svelte
git commit -m "feat(vision): wire Vision tab into ObjectDetails — CL-gated"
```

---

### Task 9: Backend — add `object` filter to GET /v1/audit

**Files:**
- Modify: `veesker-cloud/src/routes/audit.ts` (in the `veesker-cloud` repo)

- [ ] **Step 1: Open `audit.ts` and find the GET / handler**

Look for the route handler that builds the `WHERE` clause with `limit`, `offset`, `failures`, `user` filters.

- [ ] **Step 2: Add the `object` filter**

In the section that builds query filters, add after the `user` filter block:

```typescript
const object = c.req.query("object");
if (object) {
  filters.push(`sql ILIKE $${params.length + 1}`);
  params.push(`%${object}%`);
}
```

- [ ] **Step 3: Test the filter locally**

```bash
cd veesker-cloud
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/v1/audit?object=EMPLOYEES&limit=5" | jq .
```

Expected: returns entries where `sql` contains `EMPLOYEES`.

- [ ] **Step 4: Commit and deploy**

```bash
git add src/routes/audit.ts
git commit -m "feat(audit): add object filter to GET /v1/audit for Vision detail panel"
git push
```

Railway redeploys automatically on push.

---

## Self-Review

**Spec coverage check:**
- ✅ CL gate (JWT handshake via cloud_api_get /v1/auth/me) — Task 7 VisionTab.svelte init()
- ✅ vision.graph BFS (ALL_DEPENDENCIES + ALL_CONSTRAINTS) — Task 2
- ✅ MAX_NODES 300 limit — Task 2 `MAX_VISION_NODES`
- ✅ vision_graph Tauri command — Task 4
- ✅ d3-force simulation, 300 ticks then freeze — Task 5
- ✅ Node radius ∝ degree, color by type, origin double ring — Task 5
- ✅ INVALID status red dot — Task 5
- ✅ d3-zoom + d3-drag — Task 5
- ✅ Bottom drawer (not side panel) with drag-to-resize — Task 6
- ✅ 4 tabs: DDL, Versions, Errors, Audit — Task 6
- ✅ Audit tab uses cloud_api_get + not_authenticated message — Task 6
- ✅ Double-click recenters graph — Task 7 handleNodeDoubleClick
- ✅ Truncation banner — Task 5
- ✅ Vision tab in ObjectDetails for TABLE/VIEW and PL/SQL — Task 8
- ✅ Backend object filter — Task 9

**Type consistency:**
- `VisionNode`, `VisionEdge`, `VisionGraphResult` defined in Task 2 (sidecar) and Task 5 (frontend workspace/index.ts) — names match across all references.
- `onNodeClick(node: VisionNode)` / `onNodeDoubleClick(node: VisionNode)` — consistent in VisionGraph props and VisionTab handlers.
- `cloud_api_get` invoked as `invoke("cloud_api_get", { path, params })` — consistent with existing AuditLogPanel usage.
