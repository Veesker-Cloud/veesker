# Dark Mode + SQL Editor Minimap — Design Spec

## Goal

Add two independent UI enhancements to Veesker:
1. An optional **dark mode** that extends the existing warm-dark brand palette to the full workspace, toggled by an icon button in the StatusBar.
2. A **minimap** in the SQL editor — an always-visible code overview panel on the right side, identical in concept to VS Code's minimap.

---

## Feature 1 — Dark Mode

### Toggle placement

A sun/moon icon button (`☀` / `🌙`) is added to the **right side of the StatusBar**, between the existing buttons (after SQL, before Switch). No text label — icon only, same size/padding as the other action buttons. When dark mode is active, the button uses the same orange highlight style as the active AI button (`rgba(179,62,31,0.25)` background, `#f5a08a` color).

Default: **light** (current theme). Preference persisted in `localStorage` key `veesker_theme` (`"light"` | `"dark"`).

### Color palette

The Veesker brand uses warm brown/amber tones. Dark mode extends the existing dark sidebar palette to all surfaces. The editor (oneDark) and StatusBar are unchanged.

| Role | Light | Dark |
|---|---|---|
| Page / workspace bg | `#faf7f2` | `#18140f` |
| Surface (result grid, object details, modals, cards) | `#faf7f2` | `#1a1612` |
| Sidebar (SchemaTree) | `#18140f` | `#18140f` *(no change)* |
| StatusBar | `#100e0b` | `#100e0b` *(no change)* |
| Editor (oneDark) | unchanged | unchanged |
| Primary text | `#3d3530` | `rgba(246,241,232,0.85)` |
| Secondary / muted text | `#8a7e74` | `rgba(246,241,232,0.4)` |
| Borders | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.07)` |
| Input background | `#ffffff` | `#201c17` |
| Input border | `#d4cfc9` | `rgba(255,255,255,0.1)` |
| Accent (orange) | `#b33e1f` | `#b33e1f` *(no change)* |
| Table header bg | `#f0ebe3` | `#201c17` |
| Table row hover | `rgba(179,62,31,0.05)` | `rgba(179,62,31,0.08)` |
| Table row alt | `rgba(0,0,0,0.02)` | `rgba(255,255,255,0.02)` |
| Scrollbar thumb | `rgba(0,0,0,0.15)` | `rgba(255,255,255,0.12)` |

### Implementation approach

**CSS custom properties** on `:root` and `[data-theme="dark"]`. All affected components reference `var(--bg-surface)`, `var(--text-primary)`, etc. instead of hard-coded hex values.

**Theme store** — `src/lib/stores/theme.svelte.ts`:
```ts
let theme = $state<"light" | "dark">(
  (localStorage.getItem("veesker_theme") as "light" | "dark") ?? "light"
);
export function toggleTheme() {
  theme = theme === "light" ? "dark" : "light";
  localStorage.setItem("veesker_theme", theme);
}
export { theme };
```

**`+layout.svelte`** reads the store on mount and applies `document.documentElement.dataset.theme = theme`. An `$effect` keeps it in sync with subsequent toggles.

**`StatusBar.svelte`** receives a `theme` prop and `onToggleTheme` callback from the workspace page, renders the icon button.

### Scope of components to update

All components that currently hard-code light-mode background/text colors need to switch to CSS variables. Specifically:
- `src/app.css` (global resets, scrollbar)
- `src/routes/workspace/[id]/+page.svelte` (layout containers)
- `src/lib/workspace/ResultGrid.svelte`
- `src/lib/workspace/ObjectDetails.svelte`
- `src/lib/workspace/SchemaTree.svelte` — sidebar already dark, only needs text/border var updates
- `src/lib/workspace/StatusBar.svelte` — add toggle button only; bg stays `#100e0b`
- `src/lib/workspace/SheepChat.svelte`
- `src/lib/workspace/SqlDrawer.svelte`
- `src/lib/workspace/CompileErrors.svelte`
- `src/lib/workspace/QueryHistory.svelte`
- `src/lib/workspace/CommandPalette.svelte`
- `src/lib/workspace/DataFlow.svelte`
- `src/lib/workspace/VectorScatter.svelte`
- Connection pages (`src/routes/connections/`, `src/routes/+page.svelte`)

---

## Feature 2 — SQL Editor Minimap

### Behavior

Always visible — no toggle. Rendered as a ~55px-wide panel on the **right side of the editor**, inside `SqlEditor.svelte`. Shows a scaled-down, syntax-colored overview of the entire document. A lighter rectangle indicates the currently visible viewport; clicking or dragging it scrolls the editor.

### Implementation

Use the **`@replit/codemirror-minimap`** npm package, which provides a ready-made CodeMirror 6 extension. Added to the extensions array in `SqlEditor.svelte` alongside `basicSetup`, `sql({ dialect: PLSQL })`, `oneDark`, and `keymap`.

```ts
import { minimap } from "@replit/codemirror-minimap";

// inside the extensions array:
minimap({ displayText: "characters" }),
```

No store changes, no new props, no Tauri command changes. Purely a local UI enhancement inside the CodeMirror instance.

If `@replit/codemirror-minimap` is not available or has compatibility issues, fallback is `codemirror-minimap` (alternative package). Check with `bun add @replit/codemirror-minimap` first.

---

## Architecture notes

- The two features are fully independent — they can be implemented and committed separately.
- Dark mode uses no Tauri/Rust changes — it's frontend-only.
- Minimap uses no store/RPC changes — it's a single CodeMirror extension.
- Both features are additive — zero risk of regressions in existing functionality if scoped correctly.

---

## Cross-platform / macOS build

Both features are **frontend-only** — no Rust or sidecar changes. The macOS build process is identical to the existing flow:

```bash
# Compile sidecar for macOS (unchanged — same binary as before)
cd sidecar
bun build src/index.ts --compile --minify \
  --outfile ../src-tauri/binaries/veesker-sidecar-aarch64-apple-darwin
# (or x86_64-apple-darwin for Intel Mac)
cd ..

bun run tauri build
```

The `@replit/codemirror-minimap` package is a pure JS/TS dependency — `bun install` resolves it on both Windows and macOS without any native compilation step.

---

## Testing

**Dark mode:**
- Toggle switches theme visually on all workspace panels
- Preference survives page reload (localStorage)
- Light theme is default for new users (no localStorage entry)
- All text has readable contrast in both modes
- Accent orange visible and correct in both modes

**Minimap:**
- Minimap renders to the right of the editor
- Viewport indicator updates as you scroll
- Clicking minimap scrolls editor to that position
- Minimap is present for both new query tabs and DDL views
- No layout overflow or horizontal scrollbar introduced
