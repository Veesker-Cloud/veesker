# Veesker Help Documentation — Design Spec

**Date:** 2026-04-24
**Status:** Approved

---

## Summary

Add a training-level interactive documentation system to Veesker, accessible from the **Veesker → Help** native menu item. The documentation opens as a full-screen modal over the app, structured as a self-contained interactive training course with 10 modules and progress tracking.

---

## Decisions Made

| Question | Decision |
|---|---|
| Container | Full-screen modal over the main app window |
| Structure | Interactive training course — modules with steps and progress |
| Interactivity | Self-contained: simulated demos inside the docs (no live app interaction) |
| Quizzes | No knowledge checks |
| Language | English only |
| Theme | Veesker real theme (warm browns, `#b33e1f` accent) |

---

## Architecture

### New files

**`src/lib/workspace/HelpModal.svelte`**
The shell component. Renders the modal UI: header, progress bar, sidebar module list, active step content, previous/next navigation. Reads module data from `help-modules.ts`. Writes progress to `localStorage`.

**`src/lib/help-modules.ts`**
All training content as a typed array of `HelpModule` objects. No UI logic — pure data. Easy to extend with new modules without touching presentation code.

### Modified files

**`src-tauri/src/main.rs`** (or wherever the Tauri menu is built)
Add a `"Help"` menu item under the existing `Veesker` menu (between the future top items and `Exit`). When clicked, emit a Tauri event `"open-help"` to the frontend.

**`src/routes/+page.svelte`**
Listen for the `"open-help"` Tauri event. Add `let showHelp = $state(false)`. Mount `<HelpModal>` when `showHelp` is true; close when the modal emits its close event.

---

## Content Schema

```typescript
type HelpStep = {
  heading: string;
  body: string;           // plain text — component renders as <p>
  tip?: string;           // shown in burnt-orange callout block
  shortcuts?: { keys: string[]; description: string }[];
  demo?: string;          // raw HTML string rendered in a sandboxed demo block
};

type HelpModule = {
  id: string;
  emoji: string;
  title: string;
  steps: HelpStep[];
};
```

`demo` is an HTML string injected via `{@html}` into a sandboxed `<div>` inside the demo block. Content is authored in `help-modules.ts` (trusted, not user-supplied), so injection is safe.

---

## Progress Tracking

- Key: `localStorage['veesker_help_progress']`
- Value: JSON array of strings in the form `"moduleId:stepIndex"` (e.g. `"schema-tree:2"`)
- A step is marked complete when the user clicks **Next** past it, or when they click **Previous** back from a later step (already seen = done)
- A module shows `✓` in the sidebar when all its steps are in the progress array
- Progress survives across app restarts; no server or SQLite involved
- No reset UI needed in v1 — can be added later via `localStorage.removeItem`

---

## Module List (10 modules)

| # | ID | Emoji | Title | Steps |
|---|---|---|---|---|
| 1 | `getting-started` | 🚀 | Getting Started | 4 |
| 2 | `schema-tree` | 🌳 | Schema Tree | 5 |
| 3 | `sql-editor` | ⌨️ | SQL Editor | 6 |
| 4 | `object-inspector` | 🔎 | Object Inspector | 5 |
| 5 | `data-flow` | 🕸️ | Data Flow | 3 |
| 6 | `sheep-ai` | 🤖 | Sheep AI | 5 |
| 7 | `dashboard` | 📊 | Dashboard | 4 |
| 8 | `plsql-debugger` | 🐛 | PL/SQL Debugger | 7 |
| 9 | `vector-search` | 🔍 | Vector Search | 5 |
| 10 | `shortcuts-reference` | ⌨️ | Shortcuts Reference | 1 (single reference card) |

**Total:** ~45 steps across 10 modules.

### Module content outlines

**1. Getting Started**
- What Veesker is (Oracle 23ai desktop IDE, no Instant Client)
- Creating your first connection (host, port, service name, credentials → OS keychain)
- Navigating the main layout (Schema Tree, Object Details, Status Bar, SQL Drawer, Sheep AI)
- Security disclaimer note (SheepChat sends data to Anthropic)

**2. Schema Tree**
- Expanding schemas, object-type categories and colour codes
- Browsing object types; filter chips; hiding system schemas (SYS toggle)
- Searching objects inline; Command Palette (`Ctrl+K`)
- Right-click context menu (View DDL, Execute, Test Window, Data Flow)
- Refresh the tree

**3. SQL Editor**
- Opening the SQL Drawer (`Ctrl+J` / SQL button); resizing via drag handle
- Multiple tabs (`Ctrl+T`); running a statement (`Ctrl+Enter`); running all
- Result Grid — virtual scrolling, column widths, copy cell
- Execution Log — DBMS_OUTPUT, row counts, elapsed time
- Query History — replay previous queries
- EXPLAIN PLAN (`F6`) and sending it to Sheep AI

**4. Object Inspector**
- Selecting a table/view — Columns tab (types, nullable, search)
- Indexes tab; DDL view; Related objects
- Live row count button
- Selecting a procedure/function — parameters, DDL

**5. Data Flow**
- What it shows (upstream dependencies, downstream references, FK parents/children, triggers)
- Reading the SVG diagram; clicking nodes to navigate
- Navigating the dependency chain

**6. Sheep AI**
- Opening SheepChat (`Ctrl+I` / AI button); API key setup
- Asking SQL questions in natural language
- Sending EXPLAIN PLAN to AI for interpretation
- Guided chart builder — choosing chart type, X/Y columns, aggregation, title
- Adding a chart to the Dashboard

**7. Dashboard**
- What the Dashboard tab shows (KPI cards + charts)
- Intelligent layout (KPI cards row + chart grid)
- PDF export — what's included (cover page, charts as images, data tables)
- Clearing the dashboard

**8. PL/SQL Debugger**
- Prerequisites: procedure/function must be compiled with debug (`ALTER … COMPILE DEBUG`)
- Opening the Test Window from Schema Tree right-click
- Setting breakpoints — gutter click or `Ctrl+B`
- Starting a debug session (`F9` / Debug button)
- Step Into (`F7`), Step Over (`F10`), Step Out (`Shift+F7`), Continue (`F5`), Stop (`Shift+F5`)
- Reading the Call Stack panel
- Inspecting live variable values in the Locals panel; hover tooltips

**9. Vector Search**
- Oracle 23ai AI Vector Search overview
- Creating a vector index on a table column
- Configuring an embedding provider (Ollama local / OpenAI / Voyage AI / Custom URL)
- Running a semantic similarity search; distance metrics (COSINE, EUCLIDEAN, DOT)
- Reading the PCA scatter plot

**10. Shortcuts Reference**
- Single-step module: one full reference card of all keyboard shortcuts in the app, grouped by area

| Area | Shortcut | Action |
|---|---|---|
| Global | `Ctrl+I` | Toggle Sheep AI chat |
| Global | `Ctrl+J` | Toggle SQL Drawer |
| Global | `Ctrl+K` | Command Palette |
| Global | `Ctrl+O` | Open SQL file |
| Global | `Ctrl+S` | Save active SQL tab |
| Global | `Ctrl+Shift+S` | Save active SQL tab as… |
| Global | `Ctrl+Shift+E` | Toggle expanded SQL editor |
| Global | `Ctrl+W` | Close active SQL tab |
| Global | `Ctrl+.` | Cancel running query |
| SQL Editor | `Ctrl+Enter` | Run selected / current statement |
| Debugger | `F9` | Start debug session |
| Debugger | `F8` | Run (no debug) |
| Debugger | `F7` | Step Into |
| Debugger | `F10` | Step Over |
| Debugger | `Shift+F7` | Step Out |
| Debugger | `F5` | Continue |
| Debugger | `Shift+F5` | Stop |
| Debugger | `Ctrl+B` | Toggle breakpoint at cursor |

---

## Visual Design

Follows the Veesker theme exactly — no new colours introduced.

| Token | Value |
|---|---|
| Modal background | `var(--bg-surface)` → `#1a1612` dark |
| Header / footer background | `#100e0b` |
| Surface alt (sidebar, demo blocks) | `var(--bg-surface-alt)` → `#201c17` |
| Text primary | `var(--text-primary)` → `rgba(246,241,232,0.85)` |
| Text muted | `var(--text-muted)` → `rgba(246,241,232,0.35)` |
| Border | `var(--border)` → `rgba(255,255,255,0.07)` |
| Accent / active / primary button | `#b33e1f` |
| Tip callout background | `rgba(179,62,31,0.08)` |
| Active sidebar border | `#b33e1f` left border, `rgba(179,62,31,0.1)` bg |
| Fonts | Space Grotesk (headings), Inter (body), JetBrains Mono (code/keys) |
| Progress bar fill | `#b33e1f` |
| Step dots — active | `#b33e1f` |
| Step dots — done | `rgba(179,62,31,0.4)` |
| Done check in sidebar | `#b33e1f` |

---

## Component Structure (HelpModal.svelte)

```
HelpModal
├── header (title, subtitle, close button)
├── progress-wrap (progress bar + "N of 10 · X%" label)
└── modal-body
    ├── sidebar
    │   └── module-row × 10 (num, emoji, label, optional ✓)
    └── content-area
        ├── step-header (module title, "Step N of M", dot indicators)
        ├── step-body (scrollable)
        │   ├── step-heading
        │   ├── step-text
        │   ├── tip callout (optional)
        │   ├── shortcut chips (optional)
        │   └── demo block with {@html step.demo} (optional)
        └── step-nav (← Previous | fraction | Next →)
```

---

## Error Handling

- If `localStorage` is unavailable (unlikely in Tauri WebView), progress silently doesn't persist — no crash.
- The `help-modules.ts` data is static and cannot fail to load.
- `{@html step.demo}` content is authored in the codebase, not user-supplied — XSS is not a concern.

---

## Out of Scope (v1)

- Search within the documentation
- Module locking (all modules accessible in any order)
- Knowledge checks / quizzes
- Reset progress button
- Animated transitions between steps
- Light mode variant (modal inherits `data-theme` from the page — light mode will just work via CSS vars)
