# SQL Autocomplete Implementation Design

**Date:** 2026-04-24
**Status:** Approved

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add context-aware SQL autocomplete in the CodeMirror editor — table and view names from the active connection's current schema, suggested automatically while the user types.

**Architecture:** Use a CodeMirror `Compartment` to hold the `sql({ dialect: PLSQL, schema })` extension so it can be reconfigured at runtime without recreating the editor. The workspace page fetches tables and views for the current schema during bootstrap and passes the result down as a prop through `SqlDrawer` to `SqlEditor`. No new sidecar RPC is needed — `objectsList` already exists.

**Tech Stack:** SvelteKit 5 (Svelte runes), CodeMirror 6 (`@codemirror/state` Compartment, `@codemirror/lang-sql` SQLConfig schema option), existing `objectsList` Tauri invoke wrapper.

---

## Scope

- **Included:** table names and view names from the current user's schema (the schema whose `isCurrent` flag is `true` in `schemaList()`)
- **Excluded:** columns, PL/SQL objects (packages, procedures, functions), other schemas
- **Trigger:** automatic — the existing `autocompletion()` from `basicSetup` handles popup timing; no `Ctrl+Space` required (it continues to work as a manual trigger)

---

## File Map

| File | Action |
|---|---|
| `src/routes/workspace/[id]/+page.svelte` | Modify — fetch tables+views after bootstrap, build `completionSchema`, pass as prop to `SqlDrawer` |
| `src/lib/workspace/SqlDrawer.svelte` | Modify — add `completionSchema` prop, pass through to `SqlEditor` |
| `src/lib/workspace/SqlEditor.svelte` | Modify — add `completionSchema` prop, Compartment, `$effect` to reconfigure |

No new files. No sidecar changes.

---

## Data Flow

```
bootstrap() in +page.svelte
  └─ schemaList() → find isCurrent schema (currentSchema)
  └─ Promise.allSettled([
       objectsList(currentSchema, "TABLE"),
       objectsList(currentSchema, "VIEW")
     ])
  └─ build completionSchema: Record<string, string[]>
       { EMPLOYEES: [], DEPARTMENTS: [], V_ACTIVE: [], ... }
  └─ completionSchema = $state({})  →  prop  →  SqlDrawer  →  SqlEditor
                                                                    └─ $effect → Compartment.reconfigure(
                                                                         sql({ dialect: PLSQL, schema: completionSchema })
                                                                       )
```

---

## SqlEditor changes (detailed)

### New prop
```typescript
completionSchema?: Record<string, string[]>;
```

### Compartment setup
```typescript
import { Compartment } from "@codemirror/state";

const sqlLangCompartment = new Compartment();
```
Created outside `onMount` so each editor instance has its own Compartment.

### EditorState.create — replace static `sql()` call
```typescript
// before
sql({ dialect: PLSQL })

// after
sqlLangCompartment.of(sql({ dialect: PLSQL }))
```

### $effect to reconfigure when prop arrives
```typescript
$effect(() => {
  if (!view || !completionSchema) return;
  view.dispatch({
    effects: sqlLangCompartment.reconfigure(
      sql({ dialect: PLSQL, schema: completionSchema })
    ),
  });
});
```

---

## SqlDrawer changes (detailed)

Add `completionSchema` to the `Props` type and pass it down to `<SqlEditor>`:

```typescript
type Props = {
  // ... existing props
  completionSchema?: Record<string, string[]>;
};
let { ..., completionSchema }: Props = $props();
```

```svelte
<SqlEditor
  ...existing props...
  {completionSchema}
/>
```

---

## +page.svelte changes (detailed)

### New state
```typescript
let completionSchema = $state<Record<string, string[]>>({});
```

### In bootstrap(), after currentSchema is determined
```typescript
const [tablesRes, viewsRes] = await Promise.allSettled([
  objectsList(currentSchema, "TABLE"),
  objectsList(currentSchema, "VIEW"),
]);
const schema: Record<string, string[]> = {};
if (tablesRes.status === "fulfilled" && tablesRes.value.ok)
  for (const t of tablesRes.value.data) schema[t.name] = [];
if (viewsRes.status === "fulfilled" && viewsRes.value.ok)
  for (const v of viewsRes.value.data) schema[v.name] = [];
completionSchema = schema;
```

### Pass to SqlDrawer
```svelte
<SqlDrawer
  ...existing props...
  {completionSchema}
/>
```

---

## Error handling and edge cases

| Scenario | Behavior |
|---|---|
| `objectsList` RPC fails (one or both) | `Promise.allSettled` — settled result ignored; schema built from whichever succeeded. Editor works without completions. |
| No current schema (`isCurrent` not found) | Skip the fetch entirely. `completionSchema` stays `{}`. |
| Schema not yet loaded (editor opens before fetch completes) | Editor starts with `sql({ dialect: PLSQL })` — PL/SQL keywords still complete. Schema completions activate when `$effect` fires on prop arrival. |
| Very large schema (500+ tables) | `Record<string, string[]>` with empty arrays is ~40 KB in memory. No pagination needed. |
| Workspace without active connection | `currentSchema` is `null`; fetch block is skipped. No crash. |

---

## What stays the same

- `autocompletion()` from `basicSetup` is already registered — popup timing, keyboard navigation, and dismiss behavior are unchanged
- PL/SQL keyword completions continue to work exactly as before
- No change to the `Prec.highest(keymap.of([...]))` block — existing run/save/explain shortcuts are unaffected
- `Ctrl+Space` continues to work as a manual trigger to force the popup
