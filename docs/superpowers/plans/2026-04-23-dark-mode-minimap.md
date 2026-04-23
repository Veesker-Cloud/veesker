# Dark Mode + SQL Editor Minimap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Veesker-branded dark mode (warm `#1a1612` palette, toggled via StatusBar icon) and an always-visible CodeMirror 6 minimap to the SQL editor.

**Architecture:** CSS custom properties on `:root` / `[data-theme="dark"]` drive theming; a tiny module-level Svelte 5 rune store persists the choice to localStorage and sets `data-theme` on `<html>` via `+layout.svelte`. The minimap is a single CodeMirror 6 extension added to SqlEditor's extension array.

**Tech Stack:** SvelteKit 5 (Svelte 5 runes), CSS custom properties, `@replit/codemirror-minimap`, Vitest, Bun.

---

## File map

| Action | File |
|---|---|
| Create | `src/app.css` |
| Create | `src/routes/+layout.svelte` |
| Create | `src/lib/stores/theme.svelte.ts` |
| Create | `src/lib/stores/theme.test.ts` |
| Modify | `src/lib/workspace/StatusBar.svelte` |
| Modify | `src/routes/workspace/[id]/+page.svelte` |
| Modify | `src/lib/workspace/ResultGrid.svelte` |
| Modify | `src/lib/workspace/ObjectDetails.svelte` |
| Modify | `src/lib/workspace/QueryHistory.svelte` |
| Modify | `src/lib/workspace/ExecutionLog.svelte` |
| Modify | `src/lib/workspace/VectorScatter.svelte` |
| Modify | `src/lib/workspace/DataFlow.svelte` |
| Modify | `src/routes/+page.svelte` |
| Modify | `src/routes/connections/new/+page.svelte` |
| Modify | `src/routes/connections/[id]/edit/+page.svelte` |
| Modify | `src/lib/workspace/SqlEditor.svelte` |

---

## CSS variable reference

```
Light value               Dark value                Variable name
─────────────────────────────────────────────────────────────────
#faf7f2 / #f6f1e8        #18140f                   --bg-page
#faf7f2 / #f6f1e8        #1a1612                   --bg-surface
#f0ebe3                   #201c17                   --bg-surface-alt
#ffffff                   #201c17                   --bg-surface-raised
#1a1612                   rgba(246,241,232,0.85)    --text-primary
rgba(26,22,18,0.65)       rgba(246,241,232,0.55)    --text-secondary
rgba(26,22,18,0.4-0.55)   rgba(246,241,232,0.35)    --text-muted
rgba(0,0,0,0.08)          rgba(255,255,255,0.07)    --border
rgba(0,0,0,0.15-0.22)     rgba(255,255,255,0.12)    --border-strong
rgba(26,22,18,0.04-0.06)  rgba(255,255,255,0.04)    --row-hover
rgba(26,22,18,0.02)       rgba(255,255,255,0.02)    --row-alt
rgba(0,0,0,0.15)          rgba(255,255,255,0.12)    --scrollbar-thumb
white (in color-mix)      #1a1612                   --bg (for DataFlow)
```

---

## Task 1: CSS foundation + theme store + layout

**Files:**
- Create: `src/app.css`
- Create: `src/lib/stores/theme.svelte.ts`
- Create: `src/lib/stores/theme.test.ts`
- Create: `src/routes/+layout.svelte`

- [ ] **Step 1: Create `src/app.css`**

```css
/* Veesker design tokens — consumed via var() in component <style> blocks */
:root {
  --bg-page: #faf7f2;
  --bg-surface: #faf7f2;
  --bg-surface-alt: #f0ebe3;
  --bg-surface-raised: #ffffff;
  --text-primary: #1a1612;
  --text-secondary: rgba(26, 22, 18, 0.65);
  --text-muted: rgba(26, 22, 18, 0.4);
  --border: rgba(0, 0, 0, 0.08);
  --border-strong: rgba(0, 0, 0, 0.18);
  --row-hover: rgba(26, 22, 18, 0.04);
  --row-alt: rgba(26, 22, 18, 0.02);
  --scrollbar-thumb: rgba(0, 0, 0, 0.15);
  --bg: #faf7f2; /* used by DataFlow color-mix */
}

[data-theme="dark"] {
  --bg-page: #18140f;
  --bg-surface: #1a1612;
  --bg-surface-alt: #201c17;
  --bg-surface-raised: #201c17;
  --text-primary: rgba(246, 241, 232, 0.85);
  --text-secondary: rgba(246, 241, 232, 0.55);
  --text-muted: rgba(246, 241, 232, 0.35);
  --border: rgba(255, 255, 255, 0.07);
  --border-strong: rgba(255, 255, 255, 0.12);
  --row-hover: rgba(255, 255, 255, 0.04);
  --row-alt: rgba(255, 255, 255, 0.02);
  --scrollbar-thumb: rgba(255, 255, 255, 0.12);
  --bg: #1a1612;
}
```

- [ ] **Step 2: Write failing test for theme store**

Create `src/lib/stores/theme.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const _ls: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => _ls[k] ?? null,
  setItem: (k: string, v: string) => { _ls[k] = v; },
  removeItem: (k: string) => { delete _ls[k]; },
  clear: () => { for (const k of Object.keys(_ls)) delete _ls[k]; },
};
vi.stubGlobal("localStorage", mockLocalStorage);

beforeEach(() => { mockLocalStorage.clear(); });

describe("theme store", () => {
  it("defaults to light when localStorage is empty", async () => {
    const { theme } = await import("./theme.svelte");
    expect(theme.current).toBe("light");
  });

  it("toggle switches light → dark", async () => {
    const { theme } = await import("./theme.svelte");
    theme.reset();
    theme.toggle();
    expect(theme.current).toBe("dark");
  });

  it("toggle switches dark → light", async () => {
    const { theme } = await import("./theme.svelte");
    theme.reset();
    theme.toggle();
    theme.toggle();
    expect(theme.current).toBe("light");
  });

  it("toggle persists to localStorage", async () => {
    const { theme } = await import("./theme.svelte");
    theme.reset();
    theme.toggle();
    expect(mockLocalStorage.getItem("veesker_theme")).toBe("dark");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
bun run test --reporter=verbose src/lib/stores/theme.test.ts
```

Expected: FAIL — `Cannot find module './theme.svelte'`

- [ ] **Step 4: Create `src/lib/stores/theme.svelte.ts`**

```ts
function loadTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    const raw = localStorage.getItem("veesker_theme");
    if (raw === "dark" || raw === "light") return raw;
  } catch { /* restricted environment */ }
  return "light";
}

let _theme = $state<"light" | "dark">(loadTheme());

export const theme = {
  get current() { return _theme; },
  toggle() {
    _theme = _theme === "light" ? "dark" : "light";
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("veesker_theme", _theme);
      }
    } catch { /* restricted environment */ }
  },
  reset() {
    _theme = "light";
    try {
      if (typeof window !== "undefined") localStorage.removeItem("veesker_theme");
    } catch { /* */ }
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun run test --reporter=verbose src/lib/stores/theme.test.ts
```

Expected: PASS — 4 tests passing

- [ ] **Step 6: Create `src/routes/+layout.svelte`**

This file applies `data-theme` to `<html>` and centralises font loading (remove the duplicate `<svelte:head>` font links from `+page.svelte` and `workspace/[id]/+page.svelte` in later tasks).

```svelte
<script lang="ts">
  import "../app.css";
  import { theme } from "$lib/stores/theme.svelte";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  $effect(() => {
    document.documentElement.dataset.theme = theme.current;
  });
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
    rel="stylesheet"
  />
</svelte:head>

{@render children()}
```

- [ ] **Step 7: Run full test suite**

```bash
bun run test
```

Expected: all previously passing tests still pass (no regressions from new layout.svelte)

- [ ] **Step 8: Commit**

```bash
git add src/app.css src/lib/stores/theme.svelte.ts src/lib/stores/theme.test.ts src/routes/+layout.svelte
git commit -m "feat: add CSS design tokens and theme store for dark mode"
```

---

## Task 2: StatusBar toggle button + workspace page wiring

**Files:**
- Modify: `src/lib/workspace/StatusBar.svelte`
- Modify: `src/routes/workspace/[id]/+page.svelte`

- [ ] **Step 1: Add toggle props to StatusBar**

In `src/lib/workspace/StatusBar.svelte`, modify the `Props` type and destructuring to add the theme toggle:

```svelte
<script lang="ts">
  import { sqlEditor } from "$lib/stores/sql-editor.svelte";
  import VeeskerMark from "$lib/VeeskerMark.svelte";

  type Props = {
    connectionName: string;
    userLabel: string;
    schema: string;
    serverVersion: string;
    hasPendingTx?: boolean;
    chatOpen?: boolean;
    onToggleChat?: () => void;
    onDisconnect: () => void;
    onSwitchConnection: () => void;
    theme?: "light" | "dark";
    onToggleTheme?: () => void;
  };
  let {
    connectionName, userLabel, schema, serverVersion,
    hasPendingTx = false, chatOpen = false, onToggleChat,
    onDisconnect, onSwitchConnection,
    theme = "light", onToggleTheme,
  }: Props = $props();

  const shortVersion = $derived(() => {
    const m = serverVersion.match(/(\d+\.\d+[\d.]*)/);
    return m ? m[1] : serverVersion.split(" ").slice(0, 3).join(" ");
  });
</script>
```

- [ ] **Step 2: Add the theme toggle button to the bar-right div**

In `StatusBar.svelte`, add the button between the existing SQL button and Switch button inside `<div class="bar-right">`:

```svelte
    <button
      class="action-btn theme-btn"
      class:active={theme === "dark"}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      onclick={onToggleTheme}
    >
      {#if theme === "dark"}🌙{:else}☀{/if}
    </button>
```

Place it between the SQL button and the Switch button (after `.sql-btn`, before `.switch-btn`).

- [ ] **Step 3: Add theme-btn CSS to StatusBar**

In the `<style>` section of `StatusBar.svelte`, add after `.sql-btn.active:hover`:

```css
  .theme-btn.active {
    background: rgba(249, 115, 22, 0.15);
    border-color: rgba(249, 115, 22, 0.4);
    color: #fb923c;
  }
  .theme-btn.active:hover { background: rgba(249, 115, 22, 0.25); }
```

- [ ] **Step 4: Wire theme into the workspace page**

In `src/routes/workspace/[id]/+page.svelte`, import the theme store at the top of `<script>`:

```ts
import { theme } from "$lib/stores/theme.svelte";
```

Then update the `<StatusBar>` component call to pass the new props:

```svelte
    <StatusBar
      connectionName={meta.name}
      userLabel={userLabel(meta)}
      schema={info.currentSchema}
      serverVersion={info.serverVersion}
      hasPendingTx={sqlEditor.pendingTx}
      chatOpen={showChat}
      onToggleChat={() => showChat = !showChat}
      onDisconnect={onDisconnect}
      onSwitchConnection={onSwitchConnection}
      theme={theme.current}
      onToggleTheme={() => theme.toggle()}
    />
```

- [ ] **Step 5: Verify in dev mode**

```bash
bun run tauri dev
```

Open a workspace. The StatusBar should show a ☀ button. Clicking it should toggle to 🌙 with orange highlight. The `data-theme` attribute on `<html>` should change (verify in DevTools → Elements → `<html>`). No visual change to the workspace yet (CSS vars not used in components yet).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace/StatusBar.svelte src/routes/workspace/[id]/+page.svelte
git commit -m "feat: add dark mode toggle button to StatusBar"
```

---

## Task 3: Workspace body + ResultGrid dark mode

**Files:**
- Modify: `src/routes/workspace/[id]/+page.svelte` (CSS section only)
- Modify: `src/lib/workspace/ResultGrid.svelte`

- [ ] **Step 1: Update workspace page body CSS**

In `src/routes/workspace/[id]/+page.svelte`, in the `<style>` block, change:

```css
  /* BEFORE */
  :global(body) {
    margin: 0;
    background: #18140f;
    color: #1a1612;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
    background: #faf7f2;
    overflow: hidden;
    transition: flex 0.18s ease;
  }
```

Replace with:

```css
  :global(body) {
    margin: 0;
    background: #18140f;
    color: var(--text-primary);
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
    background: var(--bg-page);
    overflow: hidden;
    transition: flex 0.18s ease;
  }
```

Also update `.loading` color:

```css
  /* BEFORE */
  .loading {
    max-width: 480px;
    margin: 4rem auto;
    color: rgba(26, 22, 18, 0.5);
    font-size: 13px;
  }

  /* AFTER */
  .loading {
    max-width: 480px;
    margin: 4rem auto;
    color: var(--text-muted);
    font-size: 13px;
  }
```

- [ ] **Step 2: Update ResultGrid.svelte CSS**

In `src/lib/workspace/ResultGrid.svelte`, find and replace the following in the `<style>` block.

The grid section background:
```css
/* BEFORE */
  section.grid {
    ...
    background: #f9f5ed;
    ...
    color: #1a1612;
  }
/* AFTER */
  section.grid {
    ...
    background: var(--bg-surface);
    ...
    color: var(--text-primary);
  }
```

The placeholder text:
```css
/* BEFORE */
  .placeholder {
    ...
    color: rgba(26, 22, 18, 0.55);
  }
/* AFTER */
  .placeholder {
    ...
    color: var(--text-secondary);
  }
```

Table header background:
```css
/* BEFORE */
  thead th {
    background: rgba(26, 22, 18, 0.05);
    color: rgba(26, 22, 18, 0.6);
  }
  thead th:hover { background: rgba(179, 62, 31, 0.15); }
/* AFTER */
  thead th {
    background: var(--bg-surface-alt);
    color: var(--text-secondary);
  }
  thead th:hover { background: rgba(179, 62, 31, 0.15); }
```

Table rows:
```css
/* BEFORE */
  tbody tr:nth-child(even) { background: rgba(26, 22, 18, 0.02); }
/* AFTER */
  tbody tr:nth-child(even) { background: var(--row-alt); }
```

Row hover (find `.result-row:hover` or `tbody tr:hover`):
```css
/* BEFORE */
  tbody tr:hover { background: rgba(26, 22, 18, 0.04); }
/* AFTER */
  tbody tr:hover { background: var(--row-hover); }
```

Export button and menu (background #fff):
```css
/* BEFORE */
  .export-trigger { background: #fff; ... }
  .export-menu { background: #fff; ... }
/* AFTER */
  .export-trigger { background: var(--bg-surface-raised); ... }
  .export-menu { background: var(--bg-surface-raised); ... }
```

Export button text color:
```css
/* BEFORE */
  .export-btn { color: rgba(26,22,18,0.7); }
  .export-btn:hover { background: rgba(26,22,18,0.06); }
  .export-menu button { color: #1a1612; }
  .export-menu button:hover { background: rgba(26,22,18,0.06); }
/* AFTER */
  .export-btn { color: var(--text-secondary); }
  .export-btn:hover { background: var(--row-hover); }
  .export-menu button { color: var(--text-primary); }
  .export-menu button:hover { background: var(--row-hover); }
```

Cell text color:
```css
/* BEFORE */
  td { color: rgba(26, 22, 18, 0.7); }
/* AFTER */
  td { color: var(--text-secondary); }
```

NULL cell:
```css
/* BEFORE */
  .null-cell { color: rgba(26, 22, 18, 0.4); }
/* AFTER */
  .null-cell { color: var(--text-muted); }
```

- [ ] **Step 3: Verify in dev mode**

```bash
bun run tauri dev
```

Open a workspace, run a SELECT query. Toggle dark mode — the result grid and workspace body should switch between warm cream and warm dark. Check that column headers, rows, and the export button all look correct in both modes.

- [ ] **Step 4: Commit**

```bash
git add src/routes/workspace/[id]/+page.svelte src/lib/workspace/ResultGrid.svelte
git commit -m "feat: apply dark mode to workspace body and ResultGrid"
```

---

## Task 4: ObjectDetails + QueryHistory + ExecutionLog

**Files:**
- Modify: `src/lib/workspace/ObjectDetails.svelte`
- Modify: `src/lib/workspace/QueryHistory.svelte`
- Modify: `src/lib/workspace/ExecutionLog.svelte`

- [ ] **Step 1: Update ObjectDetails.svelte CSS**

In `src/lib/workspace/ObjectDetails.svelte` `<style>` block, apply the following replacements (use the exact hex value to find each rule — do not guess class names):

| Find | Replace with |
|---|---|
| `background: #faf7f2` (line ~1210, main panel bg) | `background: var(--bg-surface)` |
| `color: #1a1612` (`.obj-name` and similar text) | `color: var(--text-primary)` |
| `color: rgba(26,22,18,0.45)` (`.obj-owner`) | `color: var(--text-muted)` |
| `color: rgba(26,22,18,0.25)` (`.obj-sep`) | `color: var(--text-muted)` |
| `color: rgba(26,22,18,0.55)` (section labels) | `color: var(--text-secondary)` |
| `background: rgba(26,22,18,0.05)` (section label bg) | `background: var(--bg-surface-alt)` |
| `color: rgba(26,22,18,0.35)` (muted chips) | `color: var(--text-muted)` |
| `color: rgba(26,22,18,0.4)` (back button, placeholder) | `color: var(--text-muted)` |
| `background: #fff` (line ~1259, input or raised bg) | `background: var(--bg-surface-raised)` |
| `background: #1a1612` + `color: #f6f1e8` (open-in-editor button, line ~1330) | `background: var(--text-primary)` + `color: var(--bg-surface)` |

- [ ] **Step 2: Update QueryHistory.svelte CSS**

In `src/lib/workspace/QueryHistory.svelte` `<style>` block:

| Find | Replace with |
|---|---|
| `background: #f6f1e8` (line ~197, panel bg) | `background: var(--bg-surface)` |
| `background: #fff` (line ~235, search input) | `background: var(--bg-surface-raised)` |
| `background: rgba(26, 22, 18, 0.04)` (row hover) | `background: var(--row-hover)` |
| `background: rgba(26, 22, 18, 0.10)` (line ~346) | `background: var(--bg-surface-alt)` |
| `background: rgba(26, 22, 18, 0.02)` (row alt) | `background: var(--row-alt)` |
| `color: rgba(26, 22, 18, 0.X)` text colors | `var(--text-secondary)` or `var(--text-muted)` by opacity |

- [ ] **Step 3: Update ExecutionLog.svelte CSS**

In `src/lib/workspace/ExecutionLog.svelte` `<style>` block:

| Find | Replace with |
|---|---|
| `background: #f6f1e8` (line ~136, panel bg) | `background: var(--bg-surface)` |
| `background: #fff` (line ~127, row or raised bg) | `background: var(--bg-surface-raised)` |
| `background: rgba(26, 22, 18, 0.04)` (row hover, line ~175) | `background: var(--row-hover)` |
| `color: #8a6e4c` (dbms toggle, line ~225) | `color: var(--text-muted)` |

- [ ] **Step 4: Verify in dev mode**

```bash
bun run tauri dev
```

Click an object in the schema tree to see ObjectDetails. Toggle dark mode. Verify the details panel, DDL viewer, column tables, and back button all adapt. Run a query with DBMS output to test ExecutionLog. Open query history to verify it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace/ObjectDetails.svelte src/lib/workspace/QueryHistory.svelte src/lib/workspace/ExecutionLog.svelte
git commit -m "feat: apply dark mode to ObjectDetails, QueryHistory, ExecutionLog"
```

---

## Task 5: Home page + connection pages + VectorScatter + DataFlow

**Files:**
- Modify: `src/routes/+page.svelte`
- Modify: `src/routes/connections/new/+page.svelte`
- Modify: `src/routes/connections/[id]/edit/+page.svelte`
- Modify: `src/lib/workspace/VectorScatter.svelte`
- Modify: `src/lib/workspace/DataFlow.svelte`

- [ ] **Step 1: Remove duplicate font links from pages**

Now that `+layout.svelte` provides the font links globally, remove the `<svelte:head>` font link blocks from:
- `src/routes/+page.svelte` (lines 52–58)
- `src/routes/workspace/[id]/+page.svelte` (lines 408–415)

Each of those files has identical `<svelte:head>` blocks loading Google Fonts. Delete those blocks entirely — layout.svelte handles it.

- [ ] **Step 2: Update home page CSS**

In `src/routes/+page.svelte`, in the `<style>` block:

Main background:
```css
/* BEFORE */
  main { background: #f6f1e8; color: #1a1612; ... }
/* AFTER */
  main { background: var(--bg-surface); color: var(--text-primary); ... }
```

Connection card:
```css
/* BEFORE */
  .card { background: #fff; border-color: rgba(26,22,18,0.22); ... }
  .card:hover { background: rgba(26, 22, 18, 0.06); }
/* AFTER */
  .card { background: var(--bg-surface-raised); border-color: var(--border-strong); ... }
  .card:hover { background: var(--row-hover); }
```

Card text:
```css
/* BEFORE */
  .card-name { color: #1a1612; }
  .card-meta { color: rgba(26, 22, 18, 0.5); }
  .card-host { color: rgba(26, 22, 18, 0.4); }
/* AFTER */
  .card-name { color: var(--text-primary); }
  .card-meta { color: var(--text-secondary); }
  .card-host { color: var(--text-muted); }
```

Section label and muted text:
```css
/* BEFORE */
  .section-label { color: rgba(26, 22, 18, 0.4); }
  .muted { color: rgba(26, 22, 18, 0.5); }
/* AFTER */
  .section-label { color: var(--text-muted); }
  .muted { color: var(--text-muted); }
```

Empty state text:
```css
/* BEFORE */
  .empty-title { color: #1a1612; }
  .empty-sub { color: rgba(26, 22, 18, 0.5); }
/* AFTER */
  .empty-title { color: var(--text-primary); }
  .empty-sub { color: var(--text-secondary); }
```

- [ ] **Step 3: Update connection pages CSS**

In `src/routes/connections/new/+page.svelte`:

```css
/* BEFORE */
  main { background: #f6f1e8; color: #1a1612; }
/* AFTER */
  main { background: var(--bg-surface); color: var(--text-primary); }
```

Apply the same change in `src/routes/connections/[id]/edit/+page.svelte` (same 2-line pattern).

- [ ] **Step 4: Update VectorScatter.svelte**

In `src/lib/workspace/VectorScatter.svelte`, the canvas tooltip/legend panel uses `#faf7f2`:

```css
/* BEFORE: tooltip or wrapper */
  .scatter-panel { background: #faf7f2; ... }
  .tooltip { background: rgba(255,252,245,0.97); ... }
/* AFTER */
  .scatter-panel { background: var(--bg-surface); ... }
  .tooltip { background: var(--bg-surface-raised); ... }
```

Note: the canvas itself renders vector dots — the dot colours do not change.

- [ ] **Step 5: Update DataFlow.svelte**

DataFlow uses `var(--bg, white)` in `color-mix()` — this is a CSS custom property that now resolves to `--bg` from `app.css`. **No code change needed in `DataFlow.svelte`** — the `--bg` variable defined in Step 1 of Task 1 already cascades in.

Verify this by opening a table with foreign key relations, toggling dark mode, and confirming the dependency node backgrounds adapt.

- [ ] **Step 6: Run full test suite**

```bash
bun run test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/routes/+page.svelte src/routes/connections/new/+page.svelte src/routes/connections/[id]/edit/+page.svelte src/lib/workspace/VectorScatter.svelte src/lib/workspace/DataFlow.svelte src/routes/workspace/[id]/+page.svelte
git commit -m "feat: apply dark mode to home page, connection pages, VectorScatter, DataFlow"
```

---

## Task 6: Minimap in SQL editor

**Files:**
- Modify: `src/lib/workspace/SqlEditor.svelte`

- [ ] **Step 1: Install the minimap package**

```bash
bun add @replit/codemirror-minimap
```

Expected output: `@replit/codemirror-minimap` added to `package.json` dependencies.

If this fails with "package not found", use the fallback: `bun add codemirror-minimap` (lishid's package). For the fallback, the import changes from `import { minimap } from "@replit/codemirror-minimap"` to `import { minimap } from "codemirror-minimap"` — the API is the same.

- [ ] **Step 2: Verify the package installed correctly**

```bash
ls node_modules/@replit/codemirror-minimap
```

Expected: shows `package.json`, `dist/`, etc.

- [ ] **Step 3: Add minimap to SqlEditor.svelte**

In `src/lib/workspace/SqlEditor.svelte`, add the import at the top of `<script>`:

```ts
import { minimap } from "@replit/codemirror-minimap";
```

Then in `onMount`, add `minimap({ displayText: "characters" })` to the extensions array, after `lintGutter()`:

```ts
      state: EditorState.create({
        doc: value,
        extensions: [
          Prec.highest(
            keymap.of([
              /* ... existing keybindings unchanged ... */
            ])
          ),
          basicSetup,
          sql({ dialect: PLSQL }),
          oneDark,
          lintGutter(),
          minimap({ displayText: "characters" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange(u.state.doc.toString());
          }),
        ],
      }),
```

- [ ] **Step 4: Verify in dev mode**

```bash
bun run tauri dev
```

Open the SQL Drawer (⌘J), write a multi-line query (at least 20 lines). A minimap panel should appear on the right side of the editor (~55px wide) showing a scaled-down overview of the code. Scrolling in the editor should update the viewport indicator in the minimap. Clicking a point in the minimap should scroll the editor to that position.

- [ ] **Step 5: Run full test suite**

```bash
bun run test
```

Expected: all tests pass (minimap is a runtime-only extension, no new unit tests needed).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace/SqlEditor.svelte package.json bun.lockb
git commit -m "feat: add always-visible minimap to SQL editor"
```

---

## macOS build notes

Both features are frontend-only — no Rust or sidecar changes. The macOS build process is unchanged:

```bash
# Compile sidecar for macOS (same as always — no new steps)
cd sidecar
bun build src/index.ts --compile --minify \
  --outfile ../src-tauri/binaries/veesker-sidecar-aarch64-apple-darwin
cd ..
bun run tauri build
```

The `@replit/codemirror-minimap` package is pure JS/TS — `bun install` resolves it on macOS without any native compilation.

---

## Final verification checklist

- [ ] Toggle ☀/🌙 in StatusBar switches all panels (ResultGrid, ObjectDetails, home page, connection forms)
- [ ] Preference survives page reload (localStorage key `veesker_theme`)
- [ ] Default is light for new users (no localStorage entry → light)
- [ ] StatusBar and SchemaTree sidebar look identical in both modes (already dark)
- [ ] Editor (oneDark) is unchanged in both modes
- [ ] Minimap renders to the right of the editor in the SQL Drawer
- [ ] Minimap viewport indicator updates on scroll
- [ ] Clicking minimap scrolls editor to that position
- [ ] `bun run test` passes with no regressions
- [ ] `cargo clippy -- -D warnings` passes (no Rust changes, but verify nothing broke)
