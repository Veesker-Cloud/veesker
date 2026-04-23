# Phase 5 — INSERT Export, Explain Plan, Procedure Execution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add INSERT SQL export to the result grid, an interactive Explain Plan tree with AI integration, and a procedure/function execution modal launched from the SchemaTree.

**Architecture:** All three features are frontend-only + sidecar TypeScript — no Rust/Tauri changes beyond adding three thin pass-through commands following the existing `call_sidecar` pattern. The Explain Plan result is stored as a synthetic `TabResult` with `status: "explain"` in the existing SQL editor store. Procedure results reuse the same `TabResult` system.

**Tech Stack:** SvelteKit 5 (Svelte 5 runes), Bun/TypeScript sidecar, `node-oracledb` Thin mode, Vitest (frontend unit tests), Bun test (sidecar).

---

## File Map

| File | Change |
|---|---|
| `src/lib/csv-export.ts` | Add `toInsertSql()` |
| `src/lib/csv-export.test.ts` | Add tests for `toInsertSql` |
| `src/lib/sql-files.ts` | Extend `saveBlob` to accept `"sql"` extension |
| `src/lib/workspace/ResultGrid.svelte` | Add "INSERT SQL" export option |
| `sidecar/src/oracle.ts` | Add `explainPlan()`, `procDescribe()`, `procExecute()` |
| `sidecar/src/index.ts` | Register 3 new RPC handlers |
| `src-tauri/src/commands.rs` | Add `explain_plan_get`, `proc_describe`, `proc_execute` commands |
| `src-tauri/src/lib.rs` | Register 3 new commands in `generate_handler!` |
| `src/lib/workspace.ts` | Add `ExplainNode`, `ProcParam`, `ProcExecuteResult` types + 3 wrappers |
| `src/lib/stores/sql-editor.svelte.ts` | Add `"explain"` status + `explainNodes` to `TabResult`; add `runExplain()` + `addProcResults()` |
| `src/lib/workspace/ExplainPlan.svelte` | New: tree + details panel component |
| `src/lib/workspace/SqlDrawer.svelte` | Show `ExplainPlan` when active result status is `"explain"`; add Explain button to toolbar |
| `src/lib/workspace/SqlEditor.svelte` | Add `onExplain` prop + F6 keybinding |
| `src/lib/workspace/SheepChat.svelte` | Add `pendingMessage?: string` prop |
| `src/lib/workspace/ProcExecModal.svelte` | New: procedure/function execution modal |
| `src/lib/workspace/SchemaTree.svelte` | Add `onExecuteProc` prop + Execute button on PROCEDURE/FUNCTION nodes |
| `src/routes/workspace/[id]/+page.svelte` | Wire Explain + ProcExecModal; pass `pendingMessage` to SheepChat |

---

## Task 1: INSERT SQL Export

**Files:**
- Modify: `src/lib/csv-export.ts`
- Modify: `src/lib/csv-export.test.ts`
- Modify: `src/lib/sql-files.ts`
- Modify: `src/lib/workspace/ResultGrid.svelte`

- [ ] **Step 1: Write failing tests for `toInsertSql`**

Add to the bottom of `src/lib/csv-export.test.ts`:

```ts
describe("toInsertSql", () => {
  it("basic row with number and string", () => {
    const result = toInsertSql("EMPLOYEES", ["ID", "NAME"], [[1, "Alice"]]);
    expect(result).toBe(`INSERT INTO "EMPLOYEES" ("ID", "NAME") VALUES (1, 'Alice');\n`);
  });

  it("null and undefined become NULL", () => {
    const result = toInsertSql("T", ["A", "B"], [[null, undefined]]);
    expect(result).toBe(`INSERT INTO "T" ("A", "B") VALUES (NULL, NULL);\n`);
  });

  it("string with single quote is escaped", () => {
    const result = toInsertSql("T", ["NAME"], [["O'Brien"]]);
    expect(result).toBe(`INSERT INTO "T" ("NAME") VALUES ('O''Brien');\n`);
  });

  it("boolean becomes literal", () => {
    const result = toInsertSql("T", ["FLAG"], [[true], [false]]);
    expect(result).toBe(
      `INSERT INTO "T" ("FLAG") VALUES (true);\nINSERT INTO "T" ("FLAG") VALUES (false);\n`
    );
  });

  it("Date at midnight UTC becomes TO_DATE", () => {
    const d = new Date("2024-01-15T00:00:00.000Z");
    const result = toInsertSql("T", ["DT"], [[d]]);
    expect(result).toBe(`INSERT INTO "T" ("DT") VALUES (TO_DATE('2024-01-15','YYYY-MM-DD'));\n`);
  });

  it("Date with time becomes TIMESTAMP", () => {
    const d = new Date("2024-01-15T10:30:00.000Z");
    const result = toInsertSql("T", ["DT"], [[d]]);
    expect(result).toBe(`INSERT INTO "T" ("DT") VALUES (TIMESTAMP '2024-01-15 10:30:00');\n`);
  });

  it("multiple rows — one INSERT per row", () => {
    const result = toInsertSql("T", ["A"], [["x"], ["y"]]);
    expect(result).toBe(
      `INSERT INTO "T" ("A") VALUES ('x');\nINSERT INTO "T" ("A") VALUES ('y');\n`
    );
  });

  it("empty rows — empty string", () => {
    const result = toInsertSql("T", ["A"], []);
    expect(result).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
bun run test src/lib/csv-export.test.ts
```

Expected: FAIL with "toInsertSql is not a function"

- [ ] **Step 3: Implement `toInsertSql` in `src/lib/csv-export.ts`**

Append to the file (after the existing `quoteField` function):

```ts
export function toInsertSql(tableName: string, columns: string[], rows: unknown[][]): string {
  if (rows.length === 0) return "";
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const lines: string[] = [];
  for (const row of rows) {
    const values = row.map(insertValue).join(", ");
    lines.push(`INSERT INTO "${tableName}" (${colList}) VALUES (${values});`);
  }
  return lines.join("\n") + "\n";
}

function insertValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) {
    const iso = v.toISOString();
    if (iso.endsWith("T00:00:00.000Z")) return `TO_DATE('${iso.slice(0, 10)}','YYYY-MM-DD')`;
    return `TIMESTAMP '${iso.replace("T", " ").slice(0, 19)}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
bun run test src/lib/csv-export.test.ts
```

Expected: all `toInsertSql` tests PASS

- [ ] **Step 5: Extend `saveBlob` in `src/lib/sql-files.ts`**

Change the `ext` parameter union type from `"csv" | "json"` to `"csv" | "json" | "sql"`:

```ts
export async function saveBlob(
  defaultName: string,
  content: string,
  ext: "csv" | "json" | "sql"
): Promise<string | null> {
  const path = await save({
    defaultPath: `${defaultName}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (!path) return null;
  await writeTextFile(path, content);
  return path;
}
```

- [ ] **Step 6: Add INSERT export to `ResultGrid.svelte`**

After the existing `import { toCsv, toJson }` line, add `toInsertSql` to the import:

```ts
import { toCsv, toJson, toInsertSql } from "$lib/csv-export";
```

After the `exportJson()` function, add:

```ts
function detectTableName(): string {
  const sql = tab?.sql ?? "";
  const m = sql.match(/\bFROM\s+["']?([\w.]+)["']?/i);
  if (m) return m[1].split(".").pop()?.toUpperCase() ?? "EXPORT";
  return (tab?.title ?? "EXPORT").replace(/\s+/g, "_").toUpperCase();
}

async function exportInsert() {
  exportMenuOpen = false;
  if (!ar?.result) return;
  const cols = ar.result.columns.map((c) => c.name);
  const tableName = detectTableName();
  const content = toInsertSql(tableName, cols, sortedRows);
  await saveBlob(tab?.title ?? "export", content, "sql");
}
```

In the export menu HTML (after the `exportJson` button):

```svelte
<button onclick={exportInsert}>INSERT SQL</button>
```

- [ ] **Step 7: Commit**

```
git add src/lib/csv-export.ts src/lib/csv-export.test.ts src/lib/sql-files.ts src/lib/workspace/ResultGrid.svelte
git commit -m "feat: add INSERT SQL export to result grid"
```

---

## Task 2: Explain Plan — Sidecar + Rust + TS Wrapper

**Files:**
- Modify: `sidecar/src/oracle.ts`
- Modify: `sidecar/src/index.ts`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/workspace.ts`

- [ ] **Step 1: Add `explainPlan` to `sidecar/src/oracle.ts`**

Append at the end of `sidecar/src/oracle.ts`:

```ts
// ── Explain Plan ──────────────────────────────────────────────────────────────

export type ExplainNode = {
  id: number;
  parentId: number | null;
  operation: string;
  options: string | null;
  objectName: string | null;
  objectOwner: string | null;
  cost: number | null;
  cardinality: number | null;
  bytes: number | null;
  accessPredicates: string | null;
  filterPredicates: string | null;
};

export async function explainPlan(p: { sql: string }): Promise<{ nodes: ExplainNode[] }> {
  return withActiveSession(async (conn) => {
    const sid = `V${Date.now()}`;
    await conn.execute(`EXPLAIN PLAN SET STATEMENT_ID = :sid FOR ${p.sql}`, { sid });
    const res = await conn.execute<{
      ID: number;
      PARENT_ID: number | null;
      OPERATION: string;
      OPTIONS: string | null;
      OBJECT_NAME: string | null;
      OBJECT_OWNER: string | null;
      COST: number | null;
      CARDINALITY: number | null;
      BYTES: number | null;
      ACCESS_PREDICATES: string | null;
      FILTER_PREDICATES: string | null;
    }>(
      `SELECT id               AS ID,
              parent_id        AS PARENT_ID,
              operation        AS OPERATION,
              options          AS OPTIONS,
              object_name      AS OBJECT_NAME,
              object_owner     AS OBJECT_OWNER,
              cost             AS COST,
              cardinality      AS CARDINALITY,
              bytes            AS BYTES,
              access_predicates  AS ACCESS_PREDICATES,
              filter_predicates  AS FILTER_PREDICATES
         FROM plan_table
        WHERE statement_id = :sid
        START WITH id = 0
        CONNECT BY PRIOR id = parent_id
        ORDER SIBLINGS BY id`,
      { sid },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    await conn.execute(`DELETE FROM plan_table WHERE statement_id = :sid`, { sid });
    const nodes: ExplainNode[] = (res.rows ?? []).map((r) => ({
      id: r.ID,
      parentId: r.PARENT_ID ?? null,
      operation: r.OPERATION,
      options: r.OPTIONS ?? null,
      objectName: r.OBJECT_NAME ?? null,
      objectOwner: r.OBJECT_OWNER ?? null,
      cost: r.COST ?? null,
      cardinality: r.CARDINALITY ?? null,
      bytes: r.BYTES ?? null,
      accessPredicates: r.ACCESS_PREDICATES ?? null,
      filterPredicates: r.FILTER_PREDICATES ?? null,
    }));
    return { nodes };
  });
}
```

- [ ] **Step 2: Register the handler in `sidecar/src/index.ts`**

Add to the imports at the top (inside the `from "./oracle"` import block):
```ts
  explainPlan,
```

Add to the `handlers` object:
```ts
  "explain.plan": (params) => explainPlan(params as any),
```

- [ ] **Step 3: Add the Rust command to `src-tauri/src/commands.rs`**

Append at the end of the file:

```rust
#[tauri::command]
pub async fn explain_plan_get(app: AppHandle, sql: String) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "explain.plan", json!({ "sql": sql })).await?;
    Ok(res)
}
```

- [ ] **Step 4: Register the command in `src-tauri/src/lib.rs`**

Inside the `tauri::generate_handler![...]` block, add after `commands::connection_rollback,`:
```rust
            commands::explain_plan_get,
```

- [ ] **Step 5: Add types and wrapper to `src/lib/workspace.ts`**

After the `CompileError` type definition, add:

```ts
export type ExplainNode = {
  id: number;
  parentId: number | null;
  operation: string;
  options: string | null;
  objectName: string | null;
  objectOwner: string | null;
  cost: number | null;
  cardinality: number | null;
  bytes: number | null;
  accessPredicates: string | null;
  filterPredicates: string | null;
};

export const explainPlanGet = (sql: string) =>
  call<{ nodes: ExplainNode[] }>("explain_plan_get", { sql });
```

- [ ] **Step 6: Build and verify Rust compiles**

```
cd src-tauri && cargo build 2>&1 | tail -5
```

Expected: `Finished` with no errors.

- [ ] **Step 7: Commit**

```
git add sidecar/src/oracle.ts sidecar/src/index.ts src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/workspace.ts
git commit -m "feat: add explainPlan RPC — sidecar, Rust command, TS wrapper"
```

---

## Task 3: Explain Plan — Store Changes + ExplainPlan.svelte

**Files:**
- Modify: `src/lib/stores/sql-editor.svelte.ts`
- Create: `src/lib/workspace/ExplainPlan.svelte`

- [ ] **Step 1: Extend `TabResult` in `src/lib/stores/sql-editor.svelte.ts`**

Change the `status` union in `TabResult` and add the `explainNodes` field:

```ts
export type TabResult = {
  id: string;
  statementIndex: number;
  sqlPreview: string;
  status: "ok" | "error" | "cancelled" | "running" | "explain";
  result: QueryResult | null;
  error: { code: number; message: string } | null;
  elapsedMs: number;
  dbmsOutput: string[] | null;
  compileErrors: CompileError[] | null;
  explainNodes: import("$lib/workspace").ExplainNode[] | null;
};
```

Also update the existing place where `TabResult` objects are created (in `pushHistory`, `runActive`, etc.) to include `explainNodes: null`. Search for all object literals that have `compileErrors:` and add `explainNodes: null` beside them.

- [ ] **Step 2: Add `explainPlanGet` import and `runExplain` method to the store**

At the top of `sql-editor.svelte.ts`, extend the import from `$lib/workspace`:
```ts
import { compileErrorsGet, connectionCommit, connectionRollback, explainPlanGet } from "$lib/workspace";
```

At the end of the file (before the final closing), add:

```ts
export async function runExplain(sql: string): Promise<void> {
  const tab = _tabs.find((t) => t.id === _activeId);
  if (!tab) return;
  const res = await explainPlanGet(sql);
  const resultId = crypto.randomUUID();
  const tabResult: TabResult = {
    id: resultId,
    statementIndex: 0,
    sqlPreview: "EXPLAIN PLAN",
    status: res.ok ? "explain" : "error",
    result: null,
    error: res.ok ? null : res.error,
    elapsedMs: 0,
    dbmsOutput: null,
    compileErrors: null,
    explainNodes: res.ok ? res.data.nodes : null,
  };
  const t = _tabs.find((x) => x.id === _activeId);
  if (!t) return;
  t.results = [...t.results, tabResult];
  t.activeResultId = resultId;
  _tabs = [..._tabs];
}
```

- [ ] **Step 3: Create `src/lib/workspace/ExplainPlan.svelte`**

```svelte
<script lang="ts">
  import type { ExplainNode } from "$lib/workspace";

  type Props = {
    nodes: ExplainNode[];
    onBack: () => void;
    onExplainWithAI: (planText: string) => void;
  };
  let { nodes, onBack, onExplainWithAI }: Props = $props();

  let selectedId = $state<number | null>(nodes.find((n) => n.parentId === null)?.id ?? null);
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
    function depth(node: ExplainNode): number {
      let d = 0;
      let cur: ExplainNode | undefined = node;
      while (cur?.parentId !== null && cur?.parentId !== undefined) {
        cur = nodes.find((n) => n.id === cur!.parentId);
        if (++d > 30) break;
      }
      return d;
    }
    return nodes
      .map((n) => {
        const indent = "  ".repeat(depth(n));
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
```

- [ ] **Step 4: Run frontend tests**

```
bun run test
```

Expected: PASS (no regressions — ExplainPlan.svelte has no unit tests yet; store changes are verified by TypeScript compilation)

- [ ] **Step 5: Commit**

```
git add src/lib/stores/sql-editor.svelte.ts src/lib/workspace/ExplainPlan.svelte
git commit -m "feat: add ExplainPlan component and explain result type to SQL editor store"
```

---

## Task 4: Explain Plan — F6 Keybinding + Toolbar Button + Page Wiring

**Files:**
- Modify: `src/lib/workspace/SqlEditor.svelte`
- Modify: `src/lib/workspace/SqlDrawer.svelte`
- Modify: `src/lib/workspace/SheepChat.svelte`
- Modify: `src/routes/workspace/[id]/+page.svelte`

- [ ] **Step 1: Add `onExplain` prop and F6 keybinding to `SqlEditor.svelte`**

In the Props type, add after `onSaveAs`:
```ts
onExplain: () => void;
```

In the destructuring line:
```ts
let { value, onChange, onRunCursor, onRunAll, onSave, onSaveAs, onExplain, compileErrors = null }: Props = $props();
```

In the keymap array, add after the F5 binding:
```ts
{
  key: "F6",
  preventDefault: true,
  run: () => { onExplain(); return true; },
},
```

- [ ] **Step 2: Add Explain button and ExplainPlan rendering to `SqlDrawer.svelte`**

At the top of the script, extend the existing import from the store:
```ts
import { sqlEditor, COMPILE_REGEX, runExplain, setActiveResult } from "$lib/stores/sql-editor.svelte";
import ExplainPlan from "./ExplainPlan.svelte";
```

In the toolbar where the Run/Compile buttons are, add an Explain button. Find the `file-actions` div and add after the Compile button (search for `Compile` in the toolbar):

```svelte
<button
  class="file-btn"
  title="Explain Plan (F6)"
  aria-label="Explain Plan"
  onclick={() => {
    const sql = active?.sql ?? "";
    if (sql.trim()) void runExplain(sql);
  }}
>
  Explain
</button>
```

In the result area section (where `ResultGrid` is rendered), wrap it to switch between ExplainPlan and ResultGrid based on `activeTabResult.status`. Find the section that renders `ResultGrid` and replace it with:

```svelte
{#if activeTabResult?.status === "explain" && activeTabResult.explainNodes !== null}
  <ExplainPlan
    nodes={activeTabResult.explainNodes}
    onBack={() => {
      if (!active) return;
      const prev = active.results.findLast((r) => r.id !== active!.activeResultId && r.status !== "explain");
      if (prev) setActiveResult(active.id, prev.id);
    }}
    onExplainWithAI={(planText) => {
      explainAiMessage = `Explain this Oracle execution plan:\n\n${planText}`;
      showChat = true;
    }}
  />
{:else}
  <ResultGrid tab={active} {onCancel} />
{/if}
```

Note: `explainAiMessage` and `showChat` are state variables that need to be declared — they live in `+page.svelte` and passed down. For this step, just add the `explainAiMessage = ""` state in `SqlDrawer.svelte` local scope and emit via a new `onExplainWithAI` prop. The cleanest approach: add `onExplainWithAI: (msg: string) => void` to SqlDrawer's props, and call it when ExplainPlan triggers the AI button.

Update `SqlDrawer.svelte` Props type:
```ts
type Props = { onCancel: () => void; onExplainWithAI: (msg: string) => void; };
let { onCancel, onExplainWithAI }: Props = $props();
```

And replace the inline lambda with `onExplainWithAI`.

Also add `setActiveResult` export to `sql-editor.svelte.ts`:
```ts
export function setActiveResult(tabId: string, resultId: string): void {
  const tab = _tabs.find((t) => t.id === tabId);
  if (!tab) return;
  tab.activeResultId = resultId;
  _tabs = [..._tabs];
}
```

- [ ] **Step 3: Add `pendingMessage` prop to `SheepChat.svelte`**

In the Props type, add:
```ts
pendingMessage?: string;
```

In the destructuring:
```ts
let { context, onClose, pendingMessage = "" }: Props = $props();
```

Add a reactive effect to pre-fill the input when `pendingMessage` changes:
```ts
$effect(() => {
  if (pendingMessage) input = pendingMessage;
});
```

- [ ] **Step 4: Wire everything in `+page.svelte`**

Add state variable:
```ts
let chatPendingMessage = $state("");
```

In the `<SqlDrawer>` component usage, add:
```svelte
onExplainWithAI={(msg) => {
  chatPendingMessage = msg;
  showChat = true;
}}
```

In the `<SheepChat>` component usage, add:
```svelte
pendingMessage={chatPendingMessage}
```

Pass `onExplain` to SqlEditor through SqlDrawer — `SqlDrawer` already calls `runExplain()` directly from the store, so no extra prop is needed in `+page.svelte`.

- [ ] **Step 5: Run frontend linter**

```
bun run lint
```

Fix any Biome warnings before continuing.

- [ ] **Step 6: Manual smoke test**

Run `bun run tauri dev`. In the SQL editor:
1. Type `SELECT * FROM dual` and press F6 or click Explain
2. Verify the Explain Plan tree renders in the result area
3. Click a tree node, verify detail panel updates
4. Click "← Results" to go back to the previous result
5. Click "Explain with AI" — verify SheepChat opens with the plan pre-filled in the input

- [ ] **Step 7: Commit**

```
git add src/lib/workspace/SqlEditor.svelte src/lib/workspace/SqlDrawer.svelte src/lib/workspace/SheepChat.svelte src/routes/workspace/[id]/+page.svelte src/lib/stores/sql-editor.svelte.ts
git commit -m "feat: add Explain Plan F6 keybinding, toolbar button, and AI integration"
```

---

## Task 5: Procedure Execution — Sidecar + Rust + TS Wrapper

**Files:**
- Modify: `sidecar/src/oracle.ts`
- Modify: `sidecar/src/index.ts`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/workspace.ts`

- [ ] **Step 1: Add `procDescribe` and `procExecute` to `sidecar/src/oracle.ts`**

Append at the end of the file:

```ts
// ── Procedure / Function Execution ────────────────────────────────────────────

export type ProcParam = {
  name: string;
  position: number;
  direction: "IN" | "OUT" | "IN/OUT";
  dataType: string;
};

export async function procDescribe(p: {
  owner: string;
  name: string;
}): Promise<{ params: ProcParam[] }> {
  return withActiveSession(async (conn) => {
    const res = await conn.execute<{
      NAME: string;
      POSITION: number;
      DIRECTION: string;
      DATA_TYPE: string;
    }>(
      `SELECT argument_name AS NAME,
              position      AS POSITION,
              in_out        AS DIRECTION,
              data_type     AS DATA_TYPE
         FROM all_arguments
        WHERE owner       = :owner
          AND object_name = :name
          AND data_level  = 0
        ORDER BY position`,
      { owner: p.owner.toUpperCase(), name: p.name.toUpperCase() },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const params: ProcParam[] = (res.rows ?? []).map((r) => ({
      name: r.NAME ?? `RETURN`,
      position: r.POSITION,
      direction: (r.DIRECTION as ProcParam["direction"]) ?? "IN",
      dataType: r.DATA_TYPE ?? "VARCHAR2",
    }));
    return { params };
  });
}

export type ProcExecuteResult = {
  outParams: { name: string; value: string }[];
  refCursors: { name: string; columns: QueryColumn[]; rows: QueryResultRow[] }[];
  dbmsOutput: string[];
};

function oracleTypeFor(dataType: string): number {
  const t = dataType.toUpperCase();
  if (t.includes("NUMBER") || t.includes("INTEGER") || t.includes("FLOAT")) return oracledb.NUMBER;
  if (t.includes("DATE") || t.includes("TIMESTAMP")) return oracledb.DATE;
  return oracledb.STRING;
}

function convertInputValue(v: string, dataType: string): unknown {
  if (!v || v.toUpperCase() === "NULL") return null;
  const t = dataType.toUpperCase();
  if (t.includes("NUMBER") || t.includes("INTEGER") || t.includes("FLOAT")) return Number(v);
  if (t.includes("DATE") || t.includes("TIMESTAMP")) return new Date(v);
  return v;
}

export async function procExecute(p: {
  owner: string;
  name: string;
  params: { name: string; value: string }[];
}): Promise<ProcExecuteResult> {
  return withActiveSession(async (conn) => {
    const { params: paramMeta } = await procDescribe({ owner: p.owner, name: p.name });

    const binds: Record<string, oracledb.BindDefinition> = {};
    const callArgs: string[] = [];

    for (const pm of paramMeta) {
      const isRefCursor = pm.dataType === "REF CURSOR";
      if (pm.direction === "IN") {
        const v = p.params.find((x) => x.name === pm.name);
        binds[`i_${pm.name}`] = {
          dir: oracledb.BIND_IN,
          val: convertInputValue(v?.value ?? "", pm.dataType),
        };
        callArgs.push(`${pm.name} => :i_${pm.name}`);
      } else if (pm.direction === "OUT" && !isRefCursor) {
        binds[`o_${pm.name}`] = {
          dir: oracledb.BIND_OUT,
          type: oracleTypeFor(pm.dataType),
          maxSize: 32767,
        };
        callArgs.push(`${pm.name} => :o_${pm.name}`);
      } else if (pm.direction === "OUT" && isRefCursor) {
        binds[`o_${pm.name}`] = { dir: oracledb.BIND_OUT, type: oracledb.CURSOR };
        callArgs.push(`${pm.name} => :o_${pm.name}`);
      } else if (pm.direction === "IN/OUT") {
        const v = p.params.find((x) => x.name === pm.name);
        binds[`io_${pm.name}`] = {
          dir: oracledb.BIND_INOUT,
          val: convertInputValue(v?.value ?? "", pm.dataType),
          type: oracleTypeFor(pm.dataType),
          maxSize: 32767,
        };
        callArgs.push(`${pm.name} => :io_${pm.name}`);
      }
    }

    const callExpr = `${quoteIdent(p.owner)}.${quoteIdent(p.name)}(${callArgs.join(", ")})`;
    const block = `BEGIN ${callExpr}; END;`;

    await conn.execute(`BEGIN DBMS_OUTPUT.ENABLE(NULL); END;`);
    const result = await conn.execute(block, binds, {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
    });
    const ob = (result.outBinds ?? {}) as Record<string, unknown>;

    const outParams: { name: string; value: string }[] = [];
    const refCursors: { name: string; columns: QueryColumn[]; rows: QueryResultRow[] }[] = [];

    for (const pm of paramMeta) {
      const isRefCursor = pm.dataType === "REF CURSOR";
      if (pm.direction === "OUT" && !isRefCursor) {
        const val = ob[`o_${pm.name}`];
        outParams.push({
          name: pm.name,
          value: val === null || val === undefined ? "NULL" : String(val),
        });
      } else if (pm.direction === "IN/OUT") {
        const val = ob[`io_${pm.name}`];
        outParams.push({
          name: pm.name,
          value: val === null || val === undefined ? "NULL" : String(val),
        });
      } else if (pm.direction === "OUT" && isRefCursor) {
        const rs = ob[`o_${pm.name}`] as oracledb.ResultSet<unknown[]> | null;
        if (rs) {
          const meta = (rs.metaData ?? []) as Array<{ name: string; fetchType?: number }>;
          const columns: QueryColumn[] = meta.map((m) => ({
            name: m.name,
            dataType: formatColumnType(m as any),
          }));
          const rows: unknown[][] = [];
          let row: unknown[] | undefined;
          while ((row = (await rs.getRow()) as unknown[] | undefined)) {
            rows.push(row.map(normalizeCell));
          }
          await rs.close();
          refCursors.push({ name: pm.name, columns, rows });
        }
      }
    }

    const dbmsOutput = (await drainDbmsOutput(conn)) ?? [];
    return { outParams, refCursors, dbmsOutput };
  });
}
```

- [ ] **Step 2: Register the handlers in `sidecar/src/index.ts`**

Add to the imports from `"./oracle"`:
```ts
  procDescribe,
  procExecute,
```

Add to `handlers`:
```ts
  "proc.describe": (params) => procDescribe(params as any),
  "proc.execute": (params) => procExecute(params as any),
```

- [ ] **Step 3: Add Rust commands to `src-tauri/src/commands.rs`**

```rust
#[tauri::command]
pub async fn proc_describe(
    app: AppHandle,
    owner: String,
    name: String,
) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "proc.describe", json!({ "owner": owner, "name": name })).await?;
    Ok(res)
}

#[tauri::command]
pub async fn proc_execute(app: AppHandle, payload: Value) -> Result<Value, ConnectionTestErr> {
    let res = call_sidecar(&app, "proc.execute", payload).await?;
    Ok(res)
}
```

- [ ] **Step 4: Register in `src-tauri/src/lib.rs`**

Add to `generate_handler!`:
```rust
            commands::proc_describe,
            commands::proc_execute,
```

- [ ] **Step 5: Add types and wrappers to `src/lib/workspace.ts`**

After the `ExplainNode` type, add:

```ts
export type ProcParam = {
  name: string;
  position: number;
  direction: "IN" | "OUT" | "IN/OUT";
  dataType: string;
};

export type ProcExecuteResult = {
  outParams: { name: string; value: string }[];
  refCursors: { name: string; columns: Array<{ name: string; dataType: string }>; rows: unknown[][] }[];
  dbmsOutput: string[];
};

export const procDescribeGet = (owner: string, name: string) =>
  call<{ params: ProcParam[] }>("proc_describe", { owner, name });

export const procExecuteRun = (payload: {
  owner: string;
  name: string;
  params: { name: string; value: string }[];
}) => call<ProcExecuteResult>("proc_execute", { payload });
```

- [ ] **Step 6: Build and verify**

```
cd src-tauri && cargo build 2>&1 | tail -5
```

Expected: `Finished` with no errors.

- [ ] **Step 7: Commit**

```
git add sidecar/src/oracle.ts sidecar/src/index.ts src-tauri/src/commands.rs src-tauri/src/lib.rs src/lib/workspace.ts
git commit -m "feat: add procDescribe and procExecute RPC — sidecar, Rust, TS wrapper"
```

---

## Task 6: ProcExecModal Component

**Files:**
- Create: `src/lib/workspace/ProcExecModal.svelte`
- Modify: `src/lib/stores/sql-editor.svelte.ts`

- [ ] **Step 1: Add `addProcResults` to `src/lib/stores/sql-editor.svelte.ts`**

Add the import for workspace types at the top (extend existing import):
```ts
import { compileErrorsGet, connectionCommit, connectionRollback, explainPlanGet, type ProcExecuteResult } from "$lib/workspace";
```

Add method at end of file:

```ts
export function addProcResults(result: ProcExecuteResult): void {
  const tab = _tabs.find((t) => t.id === _activeId);
  if (!tab) return;

  const logLines: string[] = [
    ...result.outParams.map((p) => `OUT ${p.name} = ${p.value}`),
    ...result.dbmsOutput,
  ];

  let lastId: string | null = null;

  if (result.refCursors.length > 0) {
    for (const rc of result.refCursors) {
      const id = crypto.randomUUID();
      tab.results = [
        ...tab.results,
        {
          id,
          statementIndex: 0,
          sqlPreview: `REF CURSOR: ${rc.name}`,
          status: "ok",
          result: { columns: rc.columns, rows: rc.rows, rowCount: rc.rows.length, elapsedMs: 0 },
          error: null,
          elapsedMs: 0,
          dbmsOutput: logLines.length > 0 ? logLines : null,
          compileErrors: null,
          explainNodes: null,
        },
      ];
      lastId = id;
    }
  } else {
    const id = crypto.randomUUID();
    tab.results = [
      ...tab.results,
      {
        id,
        statementIndex: 0,
        sqlPreview: "Procedure executed",
        status: "ok",
        result: null,
        error: null,
        elapsedMs: 0,
        dbmsOutput: logLines.length > 0 ? logLines : ["(no output)"],
        compileErrors: null,
        explainNodes: null,
      },
    ];
    lastId = id;
  }

  if (lastId) tab.activeResultId = lastId;
  _tabs = [..._tabs];
}
```

- [ ] **Step 2: Create `src/lib/workspace/ProcExecModal.svelte`**

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import type { ProcParam, ProcExecuteResult } from "$lib/workspace";
  import { procDescribeGet, procExecuteRun } from "$lib/workspace";

  type Props = {
    owner: string;
    name: string;
    objectType: "PROCEDURE" | "FUNCTION";
    onClose: () => void;
    onResult: (result: ProcExecuteResult) => void;
  };
  let { owner, name, objectType, onClose, onResult }: Props = $props();

  let params = $state<ProcParam[]>([]);
  let values = $state<Record<string, string>>({});
  let loading = $state(true);
  let executing = $state(false);
  let execError = $state<string | null>(null);

  onMount(async () => {
    const res = await procDescribeGet(owner, name);
    if (res.ok) {
      params = res.data.params;
    } else {
      execError = res.error.message;
    }
    loading = false;
  });

  async function execute() {
    executing = true;
    execError = null;
    const paramsToSend = params
      .filter((p) => p.direction !== "OUT")
      .map((p) => ({ name: p.name, value: values[p.name] ?? "" }));
    const res = await procExecuteRun({ owner, name, params: paramsToSend });
    executing = false;
    if (res.ok) {
      onResult(res.data);
      onClose();
    } else {
      execError = res.error.message;
    }
  }

  // inputParams: params that need a value from the user (IN and IN/OUT)
  let inputParams = $derived(params.filter((p) => p.direction !== "OUT"));
  // outOnlyParams: OUT scalar params (shown as read-only labels, no input needed)
  let outOnlyParams = $derived(params.filter((p) => p.direction === "OUT" && p.dataType !== "REF CURSOR"));
</script>

<dialog class="modal" open onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <div class="modal-box" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <span class="modal-title">Execute: {owner}.{name} ({objectType})</span>
      <button class="modal-close" onclick={onClose} aria-label="Close">×</button>
    </div>
    <div class="modal-body">
      {#if loading}
        <p class="hint">Loading parameters…</p>
      {:else if execError}
        <p class="err">{execError}</p>
      {:else if params.length === 0}
        <p class="hint">No parameters — ready to execute.</p>
      {:else}
        <div class="param-list">
          {#each inputParams as p (p.name)}
            <label class="param-row">
              <span class="param-label">{p.name} <span class="param-type">({p.dataType})</span></span>
              <input
                class="param-input"
                type="text"
                placeholder={p.direction === "IN/OUT" ? "IN/OUT" : "value"}
                bind:value={values[p.name]}
              />
            </label>
          {/each}
          {#each outOnlyParams as p (p.name)}
            <div class="param-row out-row">
              <span class="param-label">{p.name} <span class="param-type">({p.dataType})</span></span>
              <span class="out-hint">output — no input needed</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
    <div class="modal-footer">
      <button class="btn-cancel" onclick={onClose} disabled={executing}>Cancel</button>
      <button class="btn-execute" onclick={execute} disabled={executing || loading}>
        {#if executing}<span class="spinner"></span>{/if}
        Execute
      </button>
    </div>
  </div>
</dialog>

<style>
  .modal {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center;
    border: none; padding: 0; z-index: 200;
  }
  .modal-box {
    background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: 8px; width: 440px; max-width: 90vw; max-height: 80vh;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .modal-header {
    display: flex; align-items: center; padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .modal-title { flex: 1; font-size: 12px; font-weight: 600; color: var(--text-primary); }
  .modal-close {
    background: none; border: none; font-size: 16px; cursor: pointer;
    color: var(--text-muted); padding: 0 4px;
  }
  .modal-body { flex: 1; overflow-y: auto; padding: 16px; }
  .param-list { display: flex; flex-direction: column; gap: 10px; }
  .param-row { display: flex; flex-direction: column; gap: 4px; }
  .param-label { font-size: 11px; color: var(--text-primary); }
  .param-type { color: var(--text-muted); font-size: 10px; }
  .param-input {
    background: var(--input-bg); border: 1px solid var(--input-border);
    border-radius: 4px; padding: 5px 8px; font-size: 12px; color: var(--text-primary);
    font-family: "JetBrains Mono", monospace;
  }
  .out-row { opacity: 0.6; }
  .out-hint { font-size: 11px; color: var(--text-muted); font-style: italic; }
  .modal-footer {
    display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px;
    border-top: 1px solid var(--border);
  }
  .btn-cancel, .btn-execute {
    padding: 6px 16px; border-radius: 5px; font-size: 12px; cursor: pointer; border: none;
  }
  .btn-cancel { background: var(--input-bg); color: var(--text-primary); }
  .btn-execute {
    background: #b33e1f; color: #fff; display: flex; align-items: center; gap: 6px;
  }
  .btn-execute:disabled { opacity: 0.5; cursor: not-allowed; }
  .spinner {
    width: 10px; height: 10px; border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .hint { font-size: 12px; color: var(--text-muted); }
  .err { font-size: 12px; color: #e74c3c; }
</style>
```

- [ ] **Step 3: Run lint**

```
bun run lint
```

Fix any Biome warnings.

- [ ] **Step 4: Commit**

```
git add src/lib/workspace/ProcExecModal.svelte src/lib/stores/sql-editor.svelte.ts
git commit -m "feat: add ProcExecModal component and addProcResults store method"
```

---

## Task 7: SchemaTree Execute Action + Page Wiring

**Files:**
- Modify: `src/lib/workspace/SchemaTree.svelte`
- Modify: `src/routes/workspace/[id]/+page.svelte`

- [ ] **Step 1: Add `onExecuteProc` prop to `SchemaTree.svelte`**

In the Props type, add:
```ts
onExecuteProc?: (owner: string, name: string, objectType: "PROCEDURE" | "FUNCTION") => void;
```

In the destructuring:
```ts
let { schemas, selected, onToggle, onSelect, onRetry, onRefresh, refreshing = false, onExecuteProc }: Props = $props();
```

- [ ] **Step 2: Add Execute button to PROCEDURE and FUNCTION object rows**

In the template section that renders individual objects (inside the `{#each filtered as o}` block), modify the object button to show a small Execute action for PROCEDURE and FUNCTION kinds. Find the existing button around line 238 and add a conditional Execute button beside the object name:

```svelte
{#each filtered as o (o.name)}
  <div class="obj-row">
    <button
      class="object"
      class:selected={isSelected(s.name, o.name, kind)}
      style={isSelected(s.name, o.name, kind) ? `--kc:${KIND_COLOR[kind]}` : ""}
      onclick={() => onSelect(s.name, o.name, kind)}
      title="{s.name}.{o.name}"
    >
      <span class="obj-name">{o.name}</span>
      {#if kind === "TABLE" && s.vectorTables?.has(o.name)}
        <span class="vector-dot" title="Has VECTOR columns" aria-label="vector">⬡</span>
      {/if}
      {#if o.status && o.status !== "VALID"}
        <span class="invalid-dot" title="{o.status}" aria-label="invalid"></span>
      {/if}
    </button>
    {#if (kind === "PROCEDURE" || kind === "FUNCTION") && onExecuteProc}
      <button
        class="exec-btn"
        onclick={(e) => { e.stopPropagation(); onExecuteProc!(s.name, o.name, kind as "PROCEDURE" | "FUNCTION"); }}
        title="Execute {o.name}"
        aria-label="Execute {o.name}"
      >▶</button>
    {/if}
  </div>
{:else}
  <div class="muted-row">— none —</div>
{/each}
```

Replace the existing button-only markup with this `obj-row` wrapper. The `obj-row` div needs to be added as a flex container in the styles.

Add to the `<style>` section:
```css
.obj-row { display: flex; align-items: center; }
.obj-row .object { flex: 1; }
.exec-btn {
  flex-shrink: 0; background: none; border: none; cursor: pointer;
  color: var(--text-muted); font-size: 9px; padding: 2px 5px; border-radius: 3px;
  opacity: 0; transition: opacity 0.1s;
}
.obj-row:hover .exec-btn { opacity: 1; }
.exec-btn:hover { background: rgba(179,62,31,0.15); color: #f5a08a; }
```

- [ ] **Step 3: Wire `ProcExecModal` in `+page.svelte`**

Add imports at the top:
```ts
import ProcExecModal from "$lib/workspace/ProcExecModal.svelte";
import { addProcResults } from "$lib/stores/sql-editor.svelte";
```

Add state:
```ts
let procExecTarget = $state<{ owner: string; name: string; objectType: "PROCEDURE" | "FUNCTION" } | null>(null);
```

Pass `onExecuteProc` to `SchemaTree`:
```svelte
onExecuteProc={(owner, name, objectType) => {
  procExecTarget = { owner, name, objectType };
}}
```

Mount the modal conditionally (anywhere inside the page, e.g. just before the closing `</div>` of the root element):
```svelte
{#if procExecTarget}
  <ProcExecModal
    owner={procExecTarget.owner}
    name={procExecTarget.name}
    objectType={procExecTarget.objectType}
    onClose={() => (procExecTarget = null)}
    onResult={(result) => {
      addProcResults(result);
      procExecTarget = null;
    }}
  />
{/if}
```

- [ ] **Step 4: Run lint**

```
bun run lint
```

Fix any Biome warnings.

- [ ] **Step 5: Manual smoke test**

Run `bun run tauri dev`. In the SchemaTree:
1. Expand a schema that has procedures — hover over a procedure name and verify the ▶ button appears
2. Click ▶ — verify the modal opens with the procedure name in the header
3. If the procedure has IN params, fill them and click Execute
4. Verify OUT scalar params appear in the execution log as `OUT param_name = value`
5. If the procedure has a REF CURSOR OUT param, verify a result grid appears in the SQL editor result area

- [ ] **Step 6: Commit**

```
git add src/lib/workspace/SchemaTree.svelte src/routes/workspace/[id]/+page.svelte
git commit -m "feat: add procedure/function Execute action to SchemaTree with modal form"
```

---

## Final check

Run full test suite:

```
bun run test
```

Expected: all passing (same as before — `sql-splitter.test.ts` import errors are pre-existing and not blocking).

Run lint:
```
bun run lint
cargo clippy -- -D warnings
```

Expected: no new warnings.
