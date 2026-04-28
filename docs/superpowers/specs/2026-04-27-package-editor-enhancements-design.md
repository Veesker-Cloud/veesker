# Package Editor Enhancements — Design Spec

**Goal:** Improve the PL/SQL editing experience by splitting PACKAGE Spec/Body into separate sub-tabs within a single editor tab, and adding a resizable object outline panel for all PL/SQL objects.

**Architecture:** Client-side DDL parsing for the outline (no new RPC); sidecar returns split `spec`/`body` strings for PACKAGE; SqlTab model extended with three optional fields; new `PlsqlOutline.svelte` component placed in the drawer body alongside the existing editor pane.

**Tech Stack:** SvelteKit 5 runes, CodeMirror 6, TypeScript, Bun/TypeScript sidecar (node-oracledb)

---

## 1. Data Model — SqlTab

Add three optional fields to `SqlTab` in `src/lib/stores/sql-editor.svelte.ts`:

```typescript
packageSpec?: string            // PACKAGE spec DDL (undefined for non-package tabs)
packageActiveTab?: "spec" | "body"  // which sub-tab is shown (undefined for non-package)
specMeta?: PlsqlMeta            // { objectType: "PACKAGE", connectionId, owner, objectName }
// existing plsqlMeta becomes the body meta: { objectType: "PACKAGE BODY", ... }
```

`makeTab()` initialises all three as `undefined`.

Three new store actions:

```typescript
setPackageActiveTab(tabId: string, tab: "spec" | "body"): void
updatePackageSpec(tabId: string, sql: string): void
setPackageSpec(tabId: string, spec: string, specMeta: PlsqlMeta): void
// setPackageSpec also sets packageActiveTab = "spec"
```

Non-package tabs (PROCEDURE, FUNCTION, TRIGGER, TYPE) require no tab model changes.

---

## 2. Sidecar — `objectDdl` response shape

Modify `objectDdl()` in `sidecar/src/oracle.ts`:

- When `objectType === "PACKAGE"`: return `{ ddl: string, spec: string, body: string }`
  - `spec` = `DBMS_METADATA.GET_DDL('PACKAGE', name, owner)`
  - `body` = `DBMS_METADATA.GET_DDL('PACKAGE BODY', name, owner)` (empty string if ORA-31603)
  - `ddl` = `spec.trimEnd() + "\n\n" + body` (unchanged — kept for any caller that uses the combined form)
- All other object types: return `{ ddl: string }` unchanged.

Update the TypeScript response type in `src/lib/workspace.ts`:

```typescript
export async function objectDdlGet(owner, objectType, objectName): Promise<Result<{ ddl: string; spec?: string; body?: string }>>
```

---

## 3. Workspace page — opening packages

In `src/routes/workspace/[id]/+page.svelte`, when opening a PL/SQL object from the schema tree or `onViewDdl` callback:

- If `objectType === "PACKAGE"` and response includes `spec` + `body`:
  - Call `sqlEditor.openWithDdl(title, body, plsqlMeta)` where `plsqlMeta.objectType = "PACKAGE BODY"`
  - Then on the created tab: `sqlEditor.setPackageSpec(tab.id, spec, specMeta)` — sets `packageSpec`, `packageActiveTab = "spec"`, `specMeta`
  - Fire `objectVersionCapture(..., "PACKAGE", spec, "baseline")` for spec
  - Fire `objectVersionCapture(..., "PACKAGE BODY", body, "baseline")` for body
- Non-package types: no change.

New store action needed:

```typescript
setPackageSpec(tabId: string, spec: string, specMeta: PlsqlMeta): void
// sets packageSpec, packageActiveTab = "spec", specMeta
```

---

## 4. `PlsqlOutline.svelte` — new component

**Location:** `src/lib/workspace/PlsqlOutline.svelte`

**Props:**
```typescript
type Props = {
  sql: string           // body DDL (or full DDL for non-package)
  packageSpec?: string  // spec DDL (package only)
  objectType: string    // "PACKAGE" | "PACKAGE BODY" | "PROCEDURE" | "FUNCTION" | "TRIGGER" | "TYPE"
  activeTab?: "spec" | "body"  // package only
  onNavigate: (line: number) => void
  onTabChange?: (tab: "spec" | "body") => void  // package only
}
```

**Width:** `$state(160)`, initialised from `localStorage.getItem("outline-width")`, persisted on drag end.

**Resizing:** drag handle on the right edge (`cursor: ew-resize`), `pointer-capture` pattern matching the existing mid/top handles in `SqlDrawer.svelte`. Min width 100px, max 320px.

**Parsing — client-side regex, line-by-line scan:**

For **PACKAGE** — scan `packageSpec` and `sql` separately:

```typescript
// Pattern: PROCEDURE or FUNCTION at the start of a line (after optional whitespace)
const SUBPROGRAM_RE = /^\s*(PROCEDURE|FUNCTION)\s+(\w+)/i;
```

Produce two sections:
- `Spec` section: items from `packageSpec`
- `Body` section: items from `sql`

Each item: `{ kind: "PROCEDURE" | "FUNCTION", name: string, line: number, section: "spec" | "body" }`

For **PROCEDURE / FUNCTION** — scan `sql`:
- Object header at line 1
- Line containing `IS` or `AS` keyword (standalone on line)
- Line containing `BEGIN` (standalone)
- Line containing `EXCEPTION` (standalone)

Produce flat list: `{ kind: "section", label: "PROCEDURE name" | "IS" | "BEGIN" | "EXCEPTION", line: number }`

For **TRIGGER** — scan `sql`:
- Object header at line 1
- `BEGIN` section
- `EXCEPTION` section (if present)

**Rendering:**
- PACKAGE: two collapsible groups (Spec ▼ / Body ▼) with items indented below
- PROCEDURE/FUNCTION/TRIGGER: flat list of sections
- Item icons: `ƒ` (green, `#7ec96a`) for FUNCTION, `P` (blue, `#88b4e7`) for PROCEDURE, `§` (muted) for sections
- Hover highlight; active item highlighted with left border `2px solid` matching icon color
- Clicking a Body item calls `onTabChange?.("body")` then `onNavigate(line)`
- Clicking a Spec item calls `onTabChange?.("spec")` then `onNavigate(line)`

---

## 5. `SqlDrawer.svelte` — wiring outline + sub-tabs

**Outline placement:** In `.drawer-body`, render `<PlsqlOutline>` before `.main-area` when `active?.plsqlMeta` is set. Pass `editorRef?.gotoLine` as `onNavigate`.

```svelte
{#if active?.plsqlMeta}
  <PlsqlOutline
    sql={active.sql}
    packageSpec={active.packageSpec}
    objectType={active.plsqlMeta.objectType}
    activeTab={active.packageActiveTab}
    onNavigate={(line) => editorRef?.gotoLine(line)}
    onTabChange={(tab) => sqlEditor.setPackageActiveTab(active.id, tab)}
  />
{/if}
```

**Sub-tabs (PACKAGE only):** Rendered inside `.editor-pane`, above the `<SqlEditor>` component, when `active.packageSpec != null`:

```svelte
{#if tab.packageSpec != null}
  <div class="pkg-tabs">
    <button class:active={tab.packageActiveTab === "spec"}
            onclick={() => sqlEditor.setPackageActiveTab(tab.id, "spec")}>Spec</button>
    <button class:active={tab.packageActiveTab === "body"}
            onclick={() => sqlEditor.setPackageActiveTab(tab.id, "body")}>Body</button>
  </div>
{/if}
```

**Editor value:** Pass to `<SqlEditor>` based on active sub-tab:
```typescript
const editorSql = tab.packageActiveTab === "spec" ? (tab.packageSpec ?? tab.sql) : tab.sql;
```

**onChange handler:** Route to the correct update action:
```typescript
onChange={(s) => {
  if (tab.packageActiveTab === "spec") sqlEditor.updatePackageSpec(tab.id, s);
  else { sqlEditor.updateSql(tab.id, s); perf.scheduleAnalysis(s); }
}}
```

**Compile button:** Show when `COMPILE_REGEX` matches the active sub-tab's SQL (`editorSql`).

---

## 6. Compile + versioning

The existing compile capture logic in `runActiveAll`, `runActive`, and `runStatementAtCursor`:

```typescript
if (ceRes.ok && ceRes.data.length === 0 && t.plsqlMeta) {
  const meta = t.packageActiveTab === "spec" ? t.specMeta : t.plsqlMeta;
  if (meta) {
    const sql = t.packageActiveTab === "spec" ? (t.packageSpec ?? t.sql) : t.sql;
    void objectVersionCapture(meta.connectionId, meta.owner, meta.objectType, meta.objectName, sql, "compile");
  }
}
```

Version badge: always bound to `plsqlMeta` (PACKAGE BODY). The badge reflects body compile history, which is the most actively edited part.

---

## 7. Files changed

| File | Change |
|---|---|
| `sidecar/src/oracle.ts` | `objectDdl()` returns `spec` + `body` for PACKAGE |
| `src/lib/workspace.ts` | Update `objectDdlGet` return type |
| `src/lib/stores/sql-editor.svelte.ts` | 3 new tab fields, 3 new actions |
| `src/routes/workspace/[id]/+page.svelte` | Package open path sets spec + fires two baselines |
| `src/lib/workspace/PlsqlOutline.svelte` | New component |
| `src/lib/workspace/SqlDrawer.svelte` | Outline panel, pkg sub-tabs, editor value routing |

---

## 8. Out of scope

- Outline panel for TYPE objects (skeleton only — no meaningful sub-items to parse)
- Diff between spec and body in version flyout (unchanged)
- Remote git push for spec (only body is versioned via badge)
- Persist collapsed/expanded state of outline sections across sessions
