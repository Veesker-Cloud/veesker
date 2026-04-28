# Package Editor Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split PACKAGE DDL into Spec/Body sub-tabs within a single editor tab, and add a resizable object outline panel (procedures/functions/sections) for all PL/SQL object tabs.

**Architecture:** Seven tasks in dependency order. Sidecar returns `spec`+`body` fields for PACKAGE; Tauri command exposes them as a struct; SqlTab gains three optional package fields; a new `PlsqlOutline.svelte` component handles parsing (pure functions, tested) and rendering; `SqlDrawer.svelte` wires both the outline panel and the Spec/Body sub-tabs; compile capture becomes sub-tab-aware.

**Tech Stack:** SvelteKit 5 runes, Bun/TypeScript sidecar (node-oracledb), Tauri 2 (Rust), Vitest, Biome

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `sidecar/src/oracle.ts` | Modify | Return `spec` + `body` for PACKAGE in `objectDdl` |
| `src-tauri/src/commands.rs` | Modify | `object_ddl_get` returns `ObjectDdlResult` struct |
| `src/lib/workspace.ts` | Modify | Update `objectDdlGet` return type |
| `src/lib/stores/sql-editor.svelte.ts` | Modify | 3 new SqlTab fields, 3 new store actions, sql routing in runActive/runActiveAll |
| `src/routes/workspace/[id]/+page.svelte` | Modify | Package open paths fire two baselines + setPackageSpec |
| `src/lib/workspace/plsql-outline-parser.ts` | Create | Pure parsing functions (testable) |
| `src/lib/workspace/plsql-outline-parser.test.ts` | Create | Vitest tests for parser |
| `src/lib/workspace/PlsqlOutline.svelte` | Create | Resizable outline component |
| `src/lib/workspace/SqlDrawer.svelte` | Modify | Outline panel, Spec/Body sub-tabs, editor value routing |

---

### Task 1: Sidecar — objectDdl returns spec + body for PACKAGE

**Files:**
- Modify: `sidecar/src/oracle.ts:947-985`

- [ ] **Step 1: Verify the current implementation**

Read lines 947–985 of `sidecar/src/oracle.ts`. The function signature is:
```typescript
export async function objectDdl(p: {
  owner: string;
  objectType: string;
  objectName: string;
}): Promise<{ ddl: string }>
```
The PACKAGE branch already fetches both spec and body; it just combines them.

- [ ] **Step 2: Update the return type and PACKAGE branch**

Replace the function at lines 947–985 with:

```typescript
export async function objectDdl(p: {
  owner: string;
  objectType: string;
  objectName: string;
}): Promise<{ ddl: string; spec?: string; body?: string }> {
  return withActiveSession(async (conn) => {
    const fetchOpts = {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
      fetchTypeHandler: (meta: any) =>
        meta.dbType === oracledb.DB_TYPE_CLOB ? { type: oracledb.STRING } : undefined,
    };

    const specRes = await conn.execute<[string]>(
      `SELECT DBMS_METADATA.GET_DDL(UPPER(:type), UPPER(:name), UPPER(:owner)) FROM dual`,
      { type: p.objectType, name: p.objectName, owner: p.owner },
      fetchOpts
    );
    const specDdl: string = (specRes.rows?.[0]?.[0] as string) ?? "";

    if (p.objectType.toUpperCase() === "PACKAGE") {
      let bodyDdl = "";
      try {
        const bodyRes = await conn.execute<[string]>(
          `SELECT DBMS_METADATA.GET_DDL('PACKAGE BODY', UPPER(:name), UPPER(:owner)) FROM dual`,
          { name: p.objectName, owner: p.owner },
          fetchOpts
        );
        bodyDdl = (bodyRes.rows?.[0]?.[0] as string) ?? "";
      } catch {
        // No body exists — body stays ""
      }
      const combined = bodyDdl.trim()
        ? specDdl.trimEnd() + "\n\n" + bodyDdl
        : specDdl;
      return { ddl: combined, spec: specDdl, body: bodyDdl };
    }

    return { ddl: specDdl };
  });
}
```

- [ ] **Step 3: Run sidecar type-check**

```bash
cd sidecar
bun run tsc --noEmit
cd ..
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add sidecar/src/oracle.ts
git commit -m "feat(sidecar): objectDdl returns spec + body fields for PACKAGE"
```

---

### Task 2: Tauri command returns ObjectDdlResult struct + frontend type

**Files:**
- Modify: `src-tauri/src/commands.rs:685-703`
- Modify: `src/lib/workspace.ts:231-232`

- [ ] **Step 1: Add ObjectDdlResult struct in commands.rs**

Insert this struct just before the `object_ddl_get` function (before line 685):

```rust
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDdlResult {
    pub ddl: String,
    pub spec: Option<String>,
    pub body: Option<String>,
}
```

- [ ] **Step 2: Update object_ddl_get to return ObjectDdlResult**

Replace the `object_ddl_get` function (lines 685–703):

```rust
#[tauri::command]
pub async fn object_ddl_get(
    app: AppHandle,
    owner: String,
    object_type: String,
    object_name: String,
) -> Result<ObjectDdlResult, ConnectionTestErr> {
    let res = call_sidecar(
        &app,
        "object.ddl",
        json!({ "owner": owner, "objectType": object_type, "objectName": object_name }),
    )
    .await?;
    let ddl = res.get("ddl").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let spec = res.get("spec").and_then(|v| v.as_str()).map(|s| s.to_string());
    let body = res.get("body").and_then(|v| v.as_str()).map(|s| s.to_string());
    Ok(ObjectDdlResult { ddl, spec, body })
}
```

- [ ] **Step 3: Update objectDdlGet in workspace.ts**

Replace line 231–232 in `src/lib/workspace.ts`:

```typescript
export type ObjectDdlResult = { ddl: string; spec?: string; body?: string };
export const objectDdlGet = (owner: string, objectType: string, objectName: string) =>
  call<ObjectDdlResult>("object_ddl_get", { owner, objectType, objectName });
```

- [ ] **Step 4: Run Rust + TypeScript checks**

```bash
cd src-tauri && cargo check 2>&1 | head -30 && cd ..
bun run check 2>&1 | head -30
```

Expected: no new errors (existing pre-existing RestApiBuilder warnings are OK).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src/lib/workspace.ts
git commit -m "feat(api): object_ddl_get returns ObjectDdlResult with spec + body"
```

---

### Task 3: SqlTab model — 3 new fields + 3 store actions

**Files:**
- Modify: `src/lib/stores/sql-editor.svelte.ts`

- [ ] **Step 1: Add fields to SqlTab type (around line 42)**

The current `SqlTab` type ends with `plsqlMeta: PlsqlMeta | null;`. Add three fields after it:

```typescript
export type SqlTab = {
  id: string;
  title: string;
  sql: string;
  results: TabResult[];
  activeResultId: string | null;
  running: boolean;
  runningRequestId: string | null;
  splitterError: string | null;
  filePath: string | null;
  isDirty: boolean;
  savedContent: string | null;
  plsqlMeta: PlsqlMeta | null;
  packageSpec: string | undefined;
  packageActiveTab: "spec" | "body" | undefined;
  specMeta: PlsqlMeta | undefined;
};
```

- [ ] **Step 2: Update makeTab() to initialise the new fields (around line 173)**

```typescript
function makeTab(title: string, sql: string): SqlTab {
  return {
    id: newId(),
    title,
    sql,
    results: [],
    activeResultId: null,
    running: false,
    runningRequestId: null,
    splitterError: null,
    filePath: null,
    isDirty: false,
    savedContent: null,
    plsqlMeta: null,
    packageSpec: undefined,
    packageActiveTab: undefined,
    specMeta: undefined,
  };
}
```

- [ ] **Step 3: Update openWithDdl to initialise new fields (around line 908)**

In `openWithDdl`, inside the tab object literal (the new-tab path), add the three fields:

```typescript
const tab: SqlTab = {
  id,
  title,
  sql: ddl,
  results: [],
  activeResultId: null,
  running: false,
  runningRequestId: null,
  splitterError: null,
  filePath: null,
  isDirty: false,
  savedContent: null,
  plsqlMeta,
  packageSpec: undefined,
  packageActiveTab: undefined,
  specMeta: undefined,
};
```

- [ ] **Step 4: Add 3 store actions to the sqlEditor object**

Add these three methods after `updateSql` (around line 401):

```typescript
setPackageActiveTab(tabId: string, tab: "spec" | "body"): void {
  const t = findTab(tabId);
  if (t !== null) {
    t.packageActiveTab = tab;
    _tabs = [..._tabs];
  }
},

updatePackageSpec(tabId: string, sql: string): void {
  const t = findTab(tabId);
  if (t !== null) {
    t.packageSpec = sql;
    _tabs = [..._tabs];
  }
},

setPackageSpec(tabId: string, spec: string, specMeta: PlsqlMeta): void {
  const t = findTab(tabId);
  if (t !== null) {
    t.packageSpec = spec;
    t.specMeta = specMeta;
    t.packageActiveTab = "spec";
    _tabs = [..._tabs];
  }
},
```

- [ ] **Step 5: Run type-check**

```bash
bun run check 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/sql-editor.svelte.ts
git commit -m "feat(store): SqlTab gains packageSpec/packageActiveTab/specMeta + 3 store actions"
```

---

### Task 4: Workspace page — package-aware DDL open paths

**Files:**
- Modify: `src/routes/workspace/[id]/+page.svelte`

There are two DDL-open paths. Both need the same change: detect PACKAGE response, call `setPackageSpec`, and fire two baselines.

- [ ] **Step 1: Update selectObject function (around line 287)**

Replace:
```typescript
if (res.ok) {
  const connId = page.params.id!;
  sqlEditor.openWithDdl(`${owner}.${name}`, res.data, {
    connectionId: connId,
    owner,
    objectType: kind,
    objectName: name,
  });
  void objectVersionCapture(connId, owner, kind, name, res.data, "baseline");
}
```

With:
```typescript
if (res.ok) {
  const connId = page.params.id!;
  const ddlData = res.data;
  if (kind === "PACKAGE" && ddlData.spec !== undefined) {
    sqlEditor.openWithDdl(`${owner}.${name}`, ddlData.body ?? ddlData.ddl, {
      connectionId: connId,
      owner,
      objectType: "PACKAGE BODY",
      objectName: name,
    });
    const activeTab = sqlEditor.active;
    if (activeTab) {
      sqlEditor.setPackageSpec(activeTab.id, ddlData.spec, {
        connectionId: connId,
        owner,
        objectType: "PACKAGE",
        objectName: name,
      });
    }
    void objectVersionCapture(connId, owner, "PACKAGE", name, ddlData.spec, "baseline");
    void objectVersionCapture(connId, owner, "PACKAGE BODY", name, ddlData.body ?? "", "baseline");
  } else {
    sqlEditor.openWithDdl(`${owner}.${name}`, ddlData.ddl, {
      connectionId: connId,
      owner,
      objectType: kind,
      objectName: name,
    });
    void objectVersionCapture(connId, owner, kind, name, ddlData.ddl, "baseline");
  }
}
```

- [ ] **Step 2: Update onViewDdl callback (around line 697)**

Replace:
```typescript
if (res.ok) {
  const connId = page.params.id!;
  sqlEditor.openWithDdl(`${owner}.${name}`, res.data, {
    connectionId: connId,
    owner,
    objectType: kind,
    objectName: name,
  });
  void objectVersionCapture(connId, owner, kind, name, res.data, "baseline");
}
```

With:
```typescript
if (res.ok) {
  const connId = page.params.id!;
  const ddlData = res.data;
  if (kind === "PACKAGE" && ddlData.spec !== undefined) {
    sqlEditor.openWithDdl(`${owner}.${name}`, ddlData.body ?? ddlData.ddl, {
      connectionId: connId,
      owner,
      objectType: "PACKAGE BODY",
      objectName: name,
    });
    const activeTab = sqlEditor.active;
    if (activeTab) {
      sqlEditor.setPackageSpec(activeTab.id, ddlData.spec, {
        connectionId: connId,
        owner,
        objectType: "PACKAGE",
        objectName: name,
      });
    }
    void objectVersionCapture(connId, owner, "PACKAGE", name, ddlData.spec, "baseline");
    void objectVersionCapture(connId, owner, "PACKAGE BODY", name, ddlData.body ?? "", "baseline");
  } else {
    sqlEditor.openWithDdl(`${owner}.${name}`, ddlData.ddl, {
      connectionId: connId,
      owner,
      objectType: kind,
      objectName: name,
    });
    void objectVersionCapture(connId, owner, kind, name, ddlData.ddl, "baseline");
  }
}
```

- [ ] **Step 3: Run type-check**

```bash
bun run check 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/workspace/[id]/+page.svelte
git commit -m "feat(workspace): PACKAGE open path splits spec/body + fires two baseline captures"
```

---

### Task 5: PlsqlOutline — parser (tested) + component

**Files:**
- Create: `src/lib/workspace/plsql-outline-parser.ts`
- Create: `src/lib/workspace/plsql-outline-parser.test.ts`
- Create: `src/lib/workspace/PlsqlOutline.svelte`

- [ ] **Step 1: Write failing tests**

Create `src/lib/workspace/plsql-outline-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractSubprograms, extractSections } from "./plsql-outline-parser";

describe("extractSubprograms", () => {
  it("finds FUNCTION and PROCEDURE in package body", () => {
    const ddl = `CREATE OR REPLACE PACKAGE BODY pkg AS
  FUNCTION get_val(p_id IN NUMBER) RETURN VARCHAR2 IS
  BEGIN
    RETURN NULL;
  END;
  PROCEDURE save_val(p_id IN NUMBER) IS
  BEGIN
    NULL;
  END;
END pkg;`;
    const items = extractSubprograms(ddl);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "FUNCTION", label: "GET_VAL", line: 2 });
    expect(items[1]).toMatchObject({ kind: "PROCEDURE", label: "SAVE_VAL", line: 6 });
  });

  it("returns empty array for DDL with no subprograms", () => {
    const ddl = `CREATE OR REPLACE PACKAGE pkg AS
  c_max CONSTANT NUMBER := 100;
END pkg;`;
    expect(extractSubprograms(ddl)).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const ddl = `create or replace package body pkg as\n  function my_fn return number is begin return 1; end;\nend;`;
    const items = extractSubprograms(ddl);
    expect(items[0]).toMatchObject({ kind: "FUNCTION", label: "MY_FN" });
  });
});

describe("extractSections", () => {
  it("finds header + IS + BEGIN for a procedure", () => {
    const ddl = `CREATE OR REPLACE PROCEDURE my_proc IS
  v_x NUMBER;
BEGIN
  NULL;
EXCEPTION
  WHEN OTHERS THEN NULL;
END;`;
    const items = extractSections(ddl);
    expect(items[0]).toMatchObject({ label: "MY_PROC", line: 1 });
    expect(items.find(i => i.label === "IS")).toBeTruthy();
    expect(items.find(i => i.label === "BEGIN")).toBeTruthy();
    expect(items.find(i => i.label === "EXCEPTION")).toBeTruthy();
  });

  it("returns at least the header item", () => {
    const ddl = `CREATE OR REPLACE FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END;`;
    const items = extractSections(ddl);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].line).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to see them fail**

```bash
bun run test src/lib/workspace/plsql-outline-parser.test.ts
```

Expected: FAIL — `plsql-outline-parser` module not found.

- [ ] **Step 3: Create the parser module**

Create `src/lib/workspace/plsql-outline-parser.ts`:

```typescript
export type OutlineItem = {
  kind: "PROCEDURE" | "FUNCTION" | "section";
  label: string;
  line: number;
};

const SUBPROGRAM_RE = /^\s*(PROCEDURE|FUNCTION)\s+(\w+)/i;
const SECTION_RE = /^\s*(IS|AS|BEGIN|EXCEPTION)\s*$/i;
const HEADER_NAME_RE = /(?:PROCEDURE|FUNCTION|TRIGGER|TYPE)\s+(\w+)/i;

export function extractSubprograms(ddl: string): OutlineItem[] {
  const lines = ddl.split("\n");
  const items: OutlineItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = SUBPROGRAM_RE.exec(lines[i]);
    if (m) {
      items.push({
        kind: m[1].toUpperCase() as "PROCEDURE" | "FUNCTION",
        label: m[2].toUpperCase(),
        line: i + 1,
      });
    }
  }
  return items;
}

export function extractSections(ddl: string): OutlineItem[] {
  const lines = ddl.split("\n");
  const headerMatch = HEADER_NAME_RE.exec(lines[0] ?? "");
  const items: OutlineItem[] = [
    { kind: "section", label: headerMatch ? headerMatch[1].toUpperCase() : "Definition", line: 1 },
  ];
  for (let i = 1; i < lines.length; i++) {
    const m = SECTION_RE.exec(lines[i]);
    if (m) {
      items.push({ kind: "section", label: m[1].toUpperCase(), line: i + 1 });
    }
  }
  return items;
}
```

- [ ] **Step 4: Run tests to see them pass**

```bash
bun run test src/lib/workspace/plsql-outline-parser.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Create PlsqlOutline.svelte**

Create `src/lib/workspace/PlsqlOutline.svelte`:

```svelte
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
            class:item-active={activeTab === "body"}
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
```

- [ ] **Step 6: Run all frontend tests**

```bash
bun run test
```

Expected: the two new test suites pass, pre-existing `sql-splitter.test.ts` import errors are unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/lib/workspace/plsql-outline-parser.ts src/lib/workspace/plsql-outline-parser.test.ts src/lib/workspace/PlsqlOutline.svelte
git commit -m "feat(outline): PL/SQL outline parser (tested) + PlsqlOutline component"
```

---

### Task 6: SqlDrawer — outline panel + Spec/Body sub-tabs + editor routing

**Files:**
- Modify: `src/lib/workspace/SqlDrawer.svelte`

- [ ] **Step 1: Add PlsqlOutline import**

At the top of the `<script>` block, after the existing imports:

```typescript
import PlsqlOutline from "./PlsqlOutline.svelte";
```

- [ ] **Step 2: Add outline panel to drawer-body**

Find the `.drawer-body` div (around line 439):

```svelte
<div class="drawer-body">
  {#if sqlEditor.historyPanelOpen}
    <QueryHistory />
  {/if}
```

Add the outline right after `<QueryHistory />`:

```svelte
  {#if active?.plsqlMeta}
    <PlsqlOutline
      sql={active.sql}
      packageSpec={active.packageSpec}
      objectType={active.plsqlMeta.objectType}
      activeTab={active.packageActiveTab}
      onNavigate={(line) => editorRef?.gotoLine(line)}
      onTabChange={(tab) => { if (active) sqlEditor.setPackageActiveTab(active.id, tab); }}
    />
  {/if}
```

- [ ] **Step 3: Add Spec/Body sub-tabs inside editor-pane**

Find the `.editor-pane` section and the `{#if tab}` block inside it (around line 449). Add the sub-tabs before `<SqlEditor>`:

```svelte
{#if tab}
  {#if tab.packageSpec != null}
    <div class="pkg-subtabs">
      <button
        class="pkg-subtab"
        class:pkg-subtab-active={tab.packageActiveTab === "spec"}
        onclick={() => sqlEditor.setPackageActiveTab(tab.id, "spec")}
      >Spec</button>
      <button
        class="pkg-subtab"
        class:pkg-subtab-active={tab.packageActiveTab === "body"}
        onclick={() => sqlEditor.setPackageActiveTab(tab.id, "body")}
      >Body</button>
    </div>
  {/if}
  {@const editorSql = tab.packageActiveTab === "spec" ? (tab.packageSpec ?? tab.sql) : tab.sql}
  <SqlEditor
    bind:this={editorRef}
    value={editorSql}
    compileErrors={activeTabResult?.compileErrors ?? null}
    {costBadge}
    onChange={(s) => {
      if (tab.packageActiveTab === "spec") {
        sqlEditor.updatePackageSpec(tab.id, s);
      } else {
        sqlEditor.updateSql(tab.id, s);
        perf.scheduleAnalysis(s);
      }
    }}
    onRunCursor={(selection, cursorPos, docText) => {
      if (selection !== null) {
        void sqlEditor.runSelection(selection);
      } else {
        void sqlEditor.runStatementAtCursor(docText, cursorPos);
      }
    }}
    onRunAll={() => void sqlEditor.runActiveAll()}
    onSave={() => void sqlEditor.saveActive()}
    onSaveAs={() => void sqlEditor.saveAsActive()}
    onExplain={triggerExplain}
    {completionSchema}
    {getColumns}
  />
{/if}
```

- [ ] **Step 4: Update Compile button to test active sub-tab SQL**

Find the Compile button conditional (around line 322):

```svelte
{#if active && COMPILE_REGEX.test(active.sql)}
```

Replace with:

```svelte
{#if active && COMPILE_REGEX.test(active.packageActiveTab === "spec" ? (active.packageSpec ?? active.sql) : active.sql)}
```

- [ ] **Step 5: Add CSS for pkg-subtabs**

Add inside `<style>`:

```css
.pkg-subtabs {
  display: flex;
  background: var(--bg-page);
  border-bottom: 1px solid rgba(255,255,255,0.05);
  flex-shrink: 0;
}
.pkg-subtab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 3px 12px;
  font-size: 10px;
  font-family: "Space Grotesk", sans-serif;
  color: rgba(255,255,255,0.35);
  cursor: pointer;
  transition: color 0.1s;
}
.pkg-subtab:hover { color: rgba(255,255,255,0.7); }
.pkg-subtab-active {
  color: #f6f1e8;
  border-bottom-color: #7ec96a;
}
```

- [ ] **Step 6: Run type-check**

```bash
bun run check 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 7: Start dev server and verify UI**

```bash
bun run tauri dev
```

- Open a PACKAGE from the schema tree
- Verify: outline panel appears on the left with Spec/Body groups
- Verify: Spec and Body sub-tabs appear above the editor
- Click Spec sub-tab → editor shows spec DDL
- Click a Body item in the outline → switches to Body tab, cursor jumps to that line
- Open a PROCEDURE → outline shows sections (IS, BEGIN, EXCEPTION), no sub-tabs

- [ ] **Step 8: Commit**

```bash
git add src/lib/workspace/SqlDrawer.svelte
git commit -m "feat(drawer): PL/SQL outline panel + Spec/Body sub-tabs for packages"
```

---

### Task 7: Compile capture + SQL routing — package-aware

**Files:**
- Modify: `src/lib/stores/sql-editor.svelte.ts`

There are three compile capture sites and two places where `tab.sql` is used for the compiled SQL. All must be made package-aware.

- [ ] **Step 1: Fix runActiveAll SQL source (line 481)**

Replace:
```typescript
const sql = tab.sql;
```

With:
```typescript
const sql = tab.packageActiveTab === "spec" ? (tab.packageSpec ?? tab.sql) : tab.sql;
```

Also fix line 497 (confirm dialog uses `tab.sql`):
```typescript
{ const _c = askConfirm(tab.sql); if (_c !== true && !(await _c)) return; }
```
Replace with:
```typescript
{ const _c = askConfirm(sql); if (_c !== true && !(await _c)) return; }
```

- [ ] **Step 2: Fix runActive SQL source (line 411)**

Replace:
```typescript
const sql = stripTrailingSemicolon(tab.sql);
```

With:
```typescript
const rawSql = tab.packageActiveTab === "spec" ? (tab.packageSpec ?? tab.sql) : tab.sql;
const sql = stripTrailingSemicolon(rawSql);
```

- [ ] **Step 3: Fix compile capture in runActive (lines 464–467)**

Replace:
```typescript
if (ceRes.ok && ceRes.data.length === 0 && t.plsqlMeta) {
  const { connectionId, owner, objectType, objectName } = t.plsqlMeta;
  void objectVersionCapture(connectionId, owner, objectType, objectName, t.sql, "compile");
}
```

With:
```typescript
if (ceRes.ok && ceRes.data.length === 0 && t.plsqlMeta) {
  const meta = t.packageActiveTab === "spec" ? t.specMeta : t.plsqlMeta;
  const captureSql = t.packageActiveTab === "spec" ? (t.packageSpec ?? t.sql) : t.sql;
  if (meta) {
    const { connectionId, owner, objectType, objectName } = meta;
    void objectVersionCapture(connectionId, owner, objectType, objectName, captureSql, "compile");
  }
}
```

- [ ] **Step 4: Fix compile capture in runActiveAll (lines 621–624)**

Replace:
```typescript
if (ceRes.ok && ceRes.data.length === 0 && t.plsqlMeta) {
  const { connectionId, owner, objectType, objectName } = t.plsqlMeta;
  void objectVersionCapture(connectionId, owner, objectType, objectName, t.sql, "compile");
}
```

With (same pattern as Step 3):
```typescript
if (ceRes.ok && ceRes.data.length === 0 && t.plsqlMeta) {
  const meta = t.packageActiveTab === "spec" ? t.specMeta : t.plsqlMeta;
  const captureSql = t.packageActiveTab === "spec" ? (t.packageSpec ?? t.sql) : t.sql;
  if (meta) {
    const { connectionId, owner, objectType, objectName } = meta;
    void objectVersionCapture(connectionId, owner, objectType, objectName, captureSql, "compile");
  }
}
```

- [ ] **Step 5: Fix compile capture in runStatementAtCursor (lines 785–788)**

Replace:
```typescript
if (ceRes.ok && ceRes.data.length === 0 && t.plsqlMeta) {
  const { connectionId, owner, objectType, objectName } = t.plsqlMeta;
  void objectVersionCapture(connectionId, owner, objectType, objectName, t.sql, "compile");
}
```

With (same pattern):
```typescript
if (ceRes.ok && ceRes.data.length === 0 && t.plsqlMeta) {
  const meta = t.packageActiveTab === "spec" ? t.specMeta : t.plsqlMeta;
  const captureSql = t.packageActiveTab === "spec" ? (t.packageSpec ?? t.sql) : t.sql;
  if (meta) {
    const { connectionId, owner, objectType, objectName } = meta;
    void objectVersionCapture(connectionId, owner, objectType, objectName, captureSql, "compile");
  }
}
```

- [ ] **Step 6: Run all tests and type-check**

```bash
bun run test
bun run check 2>&1 | head -30
```

Expected: all tests pass, no new type errors.

- [ ] **Step 7: Verify end-to-end in dev server**

With `bun run tauri dev` running:
- Open `PKG_VEESKER_TEST` from the schema tree
- Tab opens on Spec sub-tab; outline shows `ƒ GET_GREETING` and `P LOG_MESSAGE` in Spec group
- Switch to Body tab; outline Body group shows the same two items
- Click Body `P LOG_MESSAGE` in outline → cursor jumps to `PROCEDURE log_message` line in body
- Edit the body (add a comment), click Compile
- Verify version badge updates to `v2`
- Switch back to Spec, click Compile → Spec version also captured

- [ ] **Step 8: Commit**

```bash
git add src/lib/stores/sql-editor.svelte.ts
git commit -m "feat(store): package-aware SQL routing and compile capture for Spec/Body sub-tabs"
```
