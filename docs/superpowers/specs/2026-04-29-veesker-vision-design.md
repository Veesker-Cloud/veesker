# Veesker Vision — Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Vision" tab to ObjectDetails that renders a force-directed graph (Obsidian-style) of all Oracle objects transitively connected to the selected object, with a bottom-drawer detail panel showing DDL, versions, compile errors, and audit history on node click.

**Architecture:** New tab "Vision" in ObjectDetails (CL-only, server-enforced via JWT). Graph rendered with d3-force + SVG (d3-zoom for pan/zoom). Clicking a node opens a bottom drawer (same pattern as SQL result panel) with 4 tabs. New sidecar RPC `vision.graph` queries ALL_DEPENDENCIES + ALL_CONSTRAINTS transitively via BFS.

**Tech Stack:** Svelte 5 runes, D3 v7 (d3-force, d3-zoom, d3-drag), TypeScript, node-oracledb (sidecar), existing Tauri commands (object_ddl_get, compile_errors_get), existing frontend services (objectVersionList, cloud_api_get)

**Repo note:** This feature must be built in `veesker-cloud-desktop` (private repo), NOT in `veesker` (public Apache 2.0). The spec is written here for reference; implementation goes in the private repo after the repo split.

---

## Gate: CL-only (server-enforced)

When the Vision tab activates, the frontend calls `cloud_api_get("/v1/auth/me")` via the Rust command (bypasses WebView2). If the response is not 200, the tab shows a locked state: *"Veesker Vision is exclusive to the Cloud plan. Sign in to continue."* with a Sign In button. This enforcement survives frontend tier-check removal because the Rust command returns "not_authenticated" without a valid JWT.

---

## Data Layer — `vision.graph` sidecar RPC

### Input
```ts
{ owner: string; name: string; objectType: string }
```

### Algorithm
BFS from the seed object using two Oracle data sources:

**Dependencies** (PL/SQL — packages, procedures, functions, views referencing tables/packages):
```sql
SELECT name, type, owner, referenced_name, referenced_type, referenced_owner
FROM all_dependencies
WHERE owner = :owner
```
Filter to rows where `name = current` OR `referenced_name = current`. Expand recursively.

**FK relationships** (tables):
```sql
SELECT ac.table_name        AS src,
       ac.owner             AS src_owner,
       bc.table_name        AS tgt,
       bc.owner             AS tgt_owner
FROM   all_constraints ac
JOIN   all_constraints bc ON ac.r_constraint_name = bc.constraint_name
WHERE  ac.constraint_type = 'R'
  AND  ac.owner           = :owner
```

**Node metadata** (status, last_ddl_time):
```sql
SELECT object_name, object_type, status, last_ddl_time
FROM   all_objects
WHERE  owner = :owner
  AND  object_name IN (:names)
```

**Safety limit:** BFS stops at 300 nodes. If truncated, response includes `{ truncated: true, truncatedAt: 300 }`.

### Output
```ts
type VisionGraphResult = {
  nodes: {
    id: string;           // "OWNER.NAME"
    name: string;
    owner: string;
    type: string;         // TABLE | VIEW | PACKAGE | PROCEDURE | FUNCTION | TRIGGER | SEQUENCE
    status: string;       // VALID | INVALID
    degree: number;       // total connections (for node sizing)
    isOrigin: boolean;    // true for the seed object
  }[];
  edges: {
    source: string;       // node id
    target: string;       // node id
    kind: "fk" | "dep";  // FK relationship or PL/SQL dependency
  }[];
  truncated: boolean;
  truncatedAt: number | null;
}
```

---

## Frontend Components

### VisionTab.svelte
Entry point rendered inside ObjectDetails when the "Vision" tab is active.

Responsibilities:
- On mount: call `cloud_api_get("/v1/auth/me")` → if fails, render locked state
- If auth OK: call `vision_graph` Tauri command → render `VisionGraph`
- Manage `selectedNode` state (null or node id)
- Render `VisionDetailDrawer` when `selectedNode !== null`

### VisionGraph.svelte
Props: `graph: VisionGraphResult`, `selectedNode: string | null`, `onNodeClick: (id: string) => void`, `onNodeDoubleClick: (id: string) => void`

SVG canvas with:
- `d3.forceSimulation` with `forceManyBody` (repulsion), `forceLink` (edges), `forceCenter`
- Simulation runs for 300 ticks then stops (`simulation.stop()` on tick 300)
- `d3.zoom` attached to the SVG element — zoom/pan the inner `<g>` transform
- `d3.drag` on each node — repositions and pins (`node.fx`, `node.fy`) on dragend
- Node radius: `Math.max(16, Math.min(40, 10 + degree * 2))`
- Origin node: double stroke ring
- Selected node: `filter: drop-shadow(0 0 8px #4a9eff)`
- >150 nodes: switch to Canvas renderer instead of SVG

**Node colors:**
```ts
const TYPE_COLOR = {
  TABLE: "#2980b9", VIEW: "#16a085",
  PACKAGE: "#8e44ad", "PACKAGE BODY": "#8e44ad",
  PROCEDURE: "#d35400", FUNCTION: "#c0963c",
  TRIGGER: "#c0392b", SEQUENCE: "#1e8449",
}
```

**Edge colors:** `#1e3a5f` default, `#4a9eff` when either endpoint is selected.

**Controls (bottom-left overlay):**
- `+` / `−` zoom buttons (programmatic zoom via d3.zoom transform)
- `⊙` reset — re-centers and resets zoom to fit all nodes

**Double click on node:** calls `onNodeDoubleClick(id)` → parent reloads graph centered on that node (new `vision_graph` call with new seed).

### VisionDetailDrawer.svelte
Props: `node: VisionNode`, `connectionId: string`, `onClose: () => void`

Bottom drawer — same CSS pattern as the existing SQL result/debug drawers:
- Fixed to bottom of the Vision tab container
- Default height: 40% of tab height
- Drag handle at top edge (resize)
- Header: `[TYPE_BADGE] OWNER.NAME` + status badge + close button `×`
- Sub-header: `Depends on: N · Referenced by: M · Last DDL: YYYY-MM-DD`
- "Explore in graph" button → calls `onNodeDoubleClick` on parent

**4 tabs:**

**DDL** — calls `object_ddl_get(connectionId, owner, objectType, name)`. Renders in a read-only code block with syntax highlighting (same CSS as SqlEditor). Shows spinner while loading.

**Versions** — calls `objectVersionList(connectionId, owner, objectType, name)`. Lists versions with label, timestamp, diff on click. "No versions captured yet" if empty.

**Errors** — calls `compile_errors_get(connectionId, owner, objectType, name)`. Table: line, column, message. "No compile errors" if VALID and empty.

**Audit** *(CL — requires valid JWT)* — calls `cloud_api_get("/v1/audit", { object: name, limit: "20" })`. Table: user, timestamp, SQL (truncated 80 chars), success/failure badge. "Connect to Veesker Cloud to view execution history" if not authenticated.

---

## Tauri Command

New command `vision_graph` in `commands.rs`:
```rust
#[tauri::command]
pub async fn vision_graph(
    connection_id: String,
    owner: String,
    name: String,
    object_type: String,
) -> Result<Value, String>
```
Delegates to sidecar RPC `vision.graph` via `crate::sidecar::call_raw`.

Registered in `lib.rs` invoke_handler.

---

## ObjectDetails integration

In `ObjectDetails.svelte`, add "Vision" tab after "Graph":
```svelte
{#if authCtx.tier === "cloud"}
  <button class="tab" class:active={activeTab === "vision"}
    onclick={() => activeTab = "vision"}>
    ◉ Vision
  </button>
{/if}
```
Tab content renders `<VisionTab>` when `activeTab === "vision"`.

The frontend tier check is a UX convenience (hides the tab in CE). The real enforcement is inside `VisionTab` via the JWT handshake.

---

## Backend API change (veesker-cloud)

The Audit tab in VisionDetailDrawer calls `GET /v1/audit?object=EMPLOYEES&limit=20`. The existing `/v1/audit` route currently supports `limit`, `offset`, `failures`, `user` filters. Add `object` filter:

```ts
// audit.ts route handler — add to existing query filters
if (c.req.query("object")) {
  filters.push(`sql ILIKE $${params.length + 1}`);
  params.push(`%${c.req.query("object")}%`);
}
```

---

## File Summary

| File | Action |
|---|---|
| `sidecar/src/oracle.ts` | Add `visionGraph()` function — BFS over ALL_DEPENDENCIES + ALL_CONSTRAINTS |
| `sidecar/src/index.ts` | Register `vision.graph` RPC handler |
| `src-tauri/src/commands.rs` | Add `vision_graph` command |
| `src-tauri/src/lib.rs` | Register `vision_graph` in invoke_handler |
| `src/lib/workspace/VisionTab.svelte` | New — auth gate + orchestration |
| `src/lib/workspace/VisionGraph.svelte` | New — d3-force SVG/Canvas graph |
| `src/lib/workspace/VisionDetailDrawer.svelte` | New — bottom drawer with 4 tabs |
| `src/lib/workspace/ObjectDetails.svelte` | Add Vision tab (CL-gated) |
| `veesker-cloud/src/routes/audit.ts` | Add `object` filter to GET /v1/audit |

---

## Out of Scope

- Global schema graph (all objects in schema regardless of connection to current object)
- Graph export (PNG/SVG)
- Node filtering/search within the graph
- Edge labels rendered on the canvas (tooltip on hover is sufficient)
- Saving graph layouts between sessions
