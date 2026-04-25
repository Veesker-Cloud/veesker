# Veesker Help Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen interactive training modal (10 modules, ~45 steps, progress tracking) opened from the Veesker native menu, using the existing warm-brown Veesker theme.

**Architecture:** A `HelpModal.svelte` shell renders module data from `help-modules.ts`. Progress is stored in `localStorage`. A `help-progress.ts` file holds pure helper functions for progress calculation. The Tauri native menu gets a Help item that emits an `"open-help"` event; `+layout.svelte` listens and shows the modal.

**Tech Stack:** SvelteKit 5 (Svelte runes), Tauri 2 (Rust menu + events), TypeScript, Vitest, Bun.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/lib/help-progress.ts` | Pure progress helper functions |
| Create | `src/lib/help-progress.test.ts` | Vitest tests for helpers |
| Create | `src/lib/help-modules.ts` | `HelpModule[]` content data |
| Create | `src/lib/workspace/HelpModal.svelte` | Full modal shell UI |
| Modify | `src-tauri/src/lib.rs:24-52` | Add Help menu item + on_menu_event |
| Modify | `src/routes/+layout.svelte` | Add showHelp state + Tauri event listener + mount modal |

---

## Task 1: Progress Helper Functions

**Files:**
- Create: `src/lib/help-progress.ts`
- Create: `src/lib/help-progress.test.ts`

- [ ] **Step 1.1: Create `src/lib/help-progress.ts`**

```typescript
export const PROGRESS_KEY = 'veesker_help_progress';

export function loadProgress(): Set<string> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function saveProgress(progress: Set<string>): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify([...progress]));
  } catch {
    // localStorage unavailable in this environment — silently skip
  }
}

export function markStepDone(
  progress: Set<string>,
  moduleId: string,
  stepIndex: number,
): Set<string> {
  const next = new Set(progress);
  next.add(`${moduleId}:${stepIndex}`);
  return next;
}

export function isModuleDone(
  progress: Set<string>,
  moduleId: string,
  stepCount: number,
): boolean {
  for (let i = 0; i < stepCount; i++) {
    if (!progress.has(`${moduleId}:${i}`)) return false;
  }
  return true;
}

export function overallProgress(
  modules: { id: string; steps: unknown[] }[],
  progress: Set<string>,
): number {
  const totalSteps = modules.reduce((s, m) => s + m.steps.length, 0);
  if (totalSteps === 0) return 0;
  return Math.round((progress.size / totalSteps) * 100);
}
```

- [ ] **Step 1.2: Create `src/lib/help-progress.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import {
  markStepDone,
  isModuleDone,
  overallProgress,
} from './help-progress';

describe('markStepDone', () => {
  it('adds the moduleId:stepIndex key', () => {
    const result = markStepDone(new Set(), 'getting-started', 0);
    expect(result.has('getting-started:0')).toBe(true);
  });

  it('does not mutate the original set', () => {
    const original = new Set<string>();
    markStepDone(original, 'getting-started', 0);
    expect(original.size).toBe(0);
  });

  it('preserves existing entries', () => {
    const existing = new Set(['mod:0']);
    const result = markStepDone(existing, 'mod', 1);
    expect(result.has('mod:0')).toBe(true);
    expect(result.has('mod:1')).toBe(true);
  });
});

describe('isModuleDone', () => {
  it('returns true when all steps are present', () => {
    const progress = new Set(['mod:0', 'mod:1', 'mod:2']);
    expect(isModuleDone(progress, 'mod', 3)).toBe(true);
  });

  it('returns false when the first step is missing', () => {
    const progress = new Set(['mod:1', 'mod:2']);
    expect(isModuleDone(progress, 'mod', 3)).toBe(false);
  });

  it('returns false when a middle step is missing', () => {
    const progress = new Set(['mod:0', 'mod:2']);
    expect(isModuleDone(progress, 'mod', 3)).toBe(false);
  });

  it('returns false for an empty progress set', () => {
    expect(isModuleDone(new Set(), 'mod', 3)).toBe(false);
  });

  it('returns true for a single-step module', () => {
    const progress = new Set(['mod:0']);
    expect(isModuleDone(progress, 'mod', 1)).toBe(true);
  });
});

describe('overallProgress', () => {
  const modules = [
    { id: 'a', steps: [{}, {}] },
    { id: 'b', steps: [{}] },
  ];

  it('returns 0 when no steps completed', () => {
    expect(overallProgress(modules, new Set())).toBe(0);
  });

  it('returns 100 when all steps completed', () => {
    const progress = new Set(['a:0', 'a:1', 'b:0']);
    expect(overallProgress(modules, progress)).toBe(100);
  });

  it('rounds to nearest integer', () => {
    const progress = new Set(['a:0']); // 1 of 3 = 33.33%
    expect(overallProgress(modules, progress)).toBe(33);
  });

  it('returns 0 for an empty module list', () => {
    expect(overallProgress([], new Set())).toBe(0);
  });
});
```

- [ ] **Step 1.3: Run tests — verify they pass**

```powershell
bun run test
```

Expected: all `help-progress` tests pass. If any fail, fix the implementation before continuing.

- [ ] **Step 1.4: Commit**

```bash
git add src/lib/help-progress.ts src/lib/help-progress.test.ts
git commit -m "feat(help): add progress helper functions with tests"
```

---

## Task 2: Content Types and Module Skeleton

**Files:**
- Create: `src/lib/help-modules.ts`

- [ ] **Step 2.1: Create `src/lib/help-modules.ts` with types and empty array**

```typescript
export type HelpStep = {
  heading: string;
  body: string;
  tip?: string;
  shortcuts?: { keys: string[]; description: string }[];
  demo?: string;
};

export type HelpModule = {
  id: string;
  emoji: string;
  title: string;
  steps: HelpStep[];
};

export const MODULES: HelpModule[] = [
  { id: 'getting-started',    emoji: '🚀', title: 'Getting Started',     steps: [] },
  { id: 'schema-tree',        emoji: '🌳', title: 'Schema Tree',         steps: [] },
  { id: 'sql-editor',         emoji: '⌨️', title: 'SQL Editor',          steps: [] },
  { id: 'object-inspector',   emoji: '🔎', title: 'Object Inspector',    steps: [] },
  { id: 'data-flow',          emoji: '🕸️', title: 'Data Flow',           steps: [] },
  { id: 'sheep-ai',           emoji: '🤖', title: 'Sheep AI',            steps: [] },
  { id: 'dashboard',          emoji: '📊', title: 'Dashboard',           steps: [] },
  { id: 'plsql-debugger',     emoji: '🐛', title: 'PL/SQL Debugger',     steps: [] },
  { id: 'vector-search',      emoji: '🔍', title: 'Vector Search',       steps: [] },
  { id: 'shortcuts-reference',emoji: '⌨️', title: 'Shortcuts Reference', steps: [] },
];
```

- [ ] **Step 2.2: Commit**

```bash
git add src/lib/help-modules.ts
git commit -m "feat(help): add HelpModule types and empty module skeleton"
```

---

## Task 3: HelpModal Shell Component

**Files:**
- Create: `src/lib/workspace/HelpModal.svelte`

- [ ] **Step 3.1: Create `src/lib/workspace/HelpModal.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { MODULES } from '$lib/help-modules';
  import {
    loadProgress,
    saveProgress,
    markStepDone,
    isModuleDone,
    overallProgress,
  } from '$lib/help-progress';

  type Props = { onClose: () => void };
  let { onClose }: Props = $props();

  let progress = $state<Set<string>>(new Set());
  let activeModuleIndex = $state(0);
  let activeStepIndex = $state(0);

  onMount(() => {
    progress = loadProgress();
  });

  const activeModule = $derived(MODULES[activeModuleIndex]);
  const activeStep = $derived(activeModule?.steps[activeStepIndex]);
  const pct = $derived(overallProgress(MODULES, progress));
  const startedCount = $derived(
    MODULES.filter((m) => m.steps.some((_, i) => progress.has(`${m.id}:${i}`))).length,
  );

  function selectModule(index: number) {
    activeModuleIndex = index;
    activeStepIndex = 0;
  }

  function goNext() {
    if (!activeModule) return;
    progress = markStepDone(progress, activeModule.id, activeStepIndex);
    saveProgress(progress);
    if (activeStepIndex < activeModule.steps.length - 1) {
      activeStepIndex++;
    } else if (activeModuleIndex < MODULES.length - 1) {
      activeModuleIndex++;
      activeStepIndex = 0;
    }
  }

  function goPrev() {
    if (activeStepIndex > 0) {
      activeStepIndex--;
    } else if (activeModuleIndex > 0) {
      activeModuleIndex--;
      activeStepIndex = MODULES[activeModuleIndex].steps.length - 1;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  const isFirst = $derived(activeModuleIndex === 0 && activeStepIndex === 0);
  const isLast = $derived(
    activeModuleIndex === MODULES.length - 1 &&
    !!activeModule &&
    activeStepIndex === activeModule.steps.length - 1,
  );
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Veesker Documentation"
  onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
>
  <div class="modal">

    <!-- Header -->
    <div class="header">
      <span class="header-icon">📖</span>
      <div class="header-text">
        <div class="title">Veesker Documentation</div>
        <div class="subtitle">Interactive Training · {MODULES.length} modules · All features covered</div>
      </div>
      <button class="close-btn" onclick={onClose}>✕ Close</button>
    </div>

    <!-- Progress bar -->
    <div class="progress-wrap">
      <div class="progress-meta">
        <span>Overall progress</span>
        <span>{startedCount} of {MODULES.length} modules started · {pct}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width:{pct}%"></div>
      </div>
    </div>

    <!-- Body -->
    <div class="body">

      <!-- Sidebar -->
      <div class="sidebar">
        <div class="sidebar-label">Modules</div>
        {#each MODULES as mod, i}
          {@const done = isModuleDone(progress, mod.id, mod.steps.length)}
          <button
            class="module-row"
            class:active={i === activeModuleIndex}
            class:done
            onclick={() => selectModule(i)}
          >
            <span class="m-num">{String(i + 1).padStart(2, '0')}</span>
            <span class="m-emoji">{mod.emoji}</span>
            <span class="m-label">{mod.title}</span>
            {#if done}<span class="m-check">✓</span>{/if}
          </button>
        {/each}
      </div>

      <!-- Content -->
      <div class="content-area">
        {#if activeModule && activeStep}
          <!-- Step header -->
          <div class="step-header">
            <div class="step-module-title">{activeModule.emoji} {activeModule.title}</div>
            <div class="step-sub">
              Step {activeStepIndex + 1} of {activeModule.steps.length} — {activeStep.heading}
            </div>
            <div class="step-dots">
              {#each activeModule.steps as _, i}
                <div
                  class="dot"
                  class:active={i === activeStepIndex}
                  class:done={progress.has(`${activeModule.id}:${i}`)}
                ></div>
              {/each}
            </div>
          </div>

          <!-- Step body -->
          <div class="step-body">
            <div class="step-heading">{activeStep.heading}</div>
            <p class="step-text">{activeStep.body}</p>

            {#if activeStep.tip}
              <div class="tip">
                <div class="tip-label">💡 Pro tip</div>
                {activeStep.tip}
              </div>
            {/if}

            {#if activeStep.shortcuts?.length}
              <div class="step-heading">Keyboard shortcuts</div>
              <div class="shortcut-list">
                {#each activeStep.shortcuts as sc}
                  <div class="sc-chip">
                    {#each sc.keys as key, ki}
                      <kbd>{key}</kbd>{#if ki < sc.keys.length - 1}<span class="plus">+</span>{/if}
                    {/each}
                    <span class="sc-desc">{sc.description}</span>
                  </div>
                {/each}
              </div>
            {/if}

            {#if activeStep.demo}
              <div class="step-heading">Interactive demo</div>
              <div class="demo-block">
                <div class="demo-lbl">🖱️ Try it</div>
                {@html activeStep.demo}
              </div>
            {/if}
          </div>

          <!-- Nav footer -->
          <div class="step-nav">
            <button class="nav-btn" disabled={isFirst} onclick={goPrev}>← Previous</button>
            <span class="step-fraction">{activeStepIndex + 1} / {activeModule.steps.length}</span>
            <button class="nav-btn primary" disabled={isLast} onclick={goNext}>Next →</button>
          </div>

        {:else}
          <div class="empty-state">
            <p>No steps in this module yet.</p>
          </div>
        {/if}
      </div>

    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 500;
  }
  .modal {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    width: min(920px, 96vw);
    height: min(680px, 94vh);
    box-shadow: 0 32px 80px rgba(0, 0, 0, 0.7);
  }

  /* Header */
  .header {
    background: #100e0b;
    border-bottom: 1px solid var(--border);
    padding: 11px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .header-icon { font-size: 17px; }
  .title {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 700;
    font-size: 13px;
    color: var(--text-primary);
  }
  .subtitle { font-size: 10px; color: var(--text-muted); margin-top: 1px; }
  .close-btn {
    margin-left: auto;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-secondary);
    font-size: 11px;
    padding: 4px 10px;
    cursor: pointer;
    font-family: "Inter", sans-serif;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .close-btn:hover {
    background: rgba(179, 62, 31, 0.2);
    border-color: rgba(179, 62, 31, 0.4);
    color: #f5a08a;
  }

  /* Progress */
  .progress-wrap {
    background: #100e0b;
    border-bottom: 1px solid var(--border);
    padding: 7px 16px;
    flex-shrink: 0;
  }
  .progress-meta {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: var(--text-muted);
    margin-bottom: 5px;
    font-family: "JetBrains Mono", monospace;
  }
  .progress-meta span:last-child { color: #b33e1f; }
  .progress-track {
    height: 2px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 2px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: #b33e1f;
    border-radius: 2px;
    transition: width 0.4s ease;
  }

  /* Body layout */
  .body { display: flex; flex: 1; overflow: hidden; }

  /* Sidebar */
  .sidebar {
    width: 196px;
    background: #100e0b;
    border-right: 1px solid var(--border);
    overflow-y: auto;
    flex-shrink: 0;
    padding: 6px 0;
  }
  .sidebar-label {
    padding: 8px 12px 4px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-muted);
    font-family: "Space Grotesk", sans-serif;
  }
  .module-row {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 12px;
    font-size: 11.5px;
    color: var(--text-muted);
    cursor: pointer;
    border: none;
    border-left: 2px solid transparent;
    background: none;
    width: 100%;
    text-align: left;
    transition: all 0.12s;
    font-family: "Inter", sans-serif;
    line-height: 1.2;
  }
  .module-row:hover { background: rgba(255, 255, 255, 0.03); color: var(--text-secondary); }
  .module-row.active {
    background: rgba(179, 62, 31, 0.1);
    color: var(--text-primary);
    border-left-color: #b33e1f;
  }
  .module-row.done { color: rgba(179, 62, 31, 0.8); }
  .m-num { font-size: 9px; color: var(--text-muted); font-family: "JetBrains Mono", monospace; min-width: 16px; }
  .m-emoji { font-size: 13px; line-height: 1; }
  .m-label { flex: 1; }
  .m-check { font-size: 10px; color: #b33e1f; }

  /* Content area */
  .content-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  .step-header {
    padding: 14px 20px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .step-module-title {
    font-family: "Space Grotesk", sans-serif;
    font-size: 17px;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 3px;
  }
  .step-sub { font-size: 11px; color: var(--text-muted); margin-bottom: 8px; }
  .step-dots { display: flex; gap: 5px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255, 255, 255, 0.1); flex-shrink: 0; }
  .dot.active { background: #b33e1f; }
  .dot.done { background: rgba(179, 62, 31, 0.4); }

  /* Step body */
  .step-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
  .step-heading {
    font-family: "Space Grotesk", sans-serif;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 14px 0 7px;
  }
  .step-heading:first-child { margin-top: 0; }
  .step-text {
    font-size: 12.5px;
    color: var(--text-secondary);
    line-height: 1.65;
    margin: 0 0 14px;
  }
  .tip {
    background: rgba(179, 62, 31, 0.08);
    border-left: 2px solid #b33e1f;
    border-radius: 4px;
    padding: 10px 12px;
    margin-bottom: 14px;
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.55;
  }
  .tip-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #b33e1f;
    margin-bottom: 4px;
    font-family: "Space Grotesk", sans-serif;
  }
  .shortcut-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .sc-chip {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sc-chip kbd {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    color: var(--text-primary);
  }
  .plus { color: var(--text-muted); font-size: 10px; }
  .sc-desc { color: var(--text-secondary); }
  .demo-block {
    background: var(--bg-surface-alt);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 14px;
  }
  .demo-lbl {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 8px;
    font-family: "Space Grotesk", sans-serif;
  }
  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 13px;
  }

  /* Nav footer */
  .step-nav {
    padding: 10px 20px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
    background: #100e0b;
  }
  .nav-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 6px 14px;
    font-size: 11.5px;
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.12s;
  }
  .nav-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); color: var(--text-primary); }
  .nav-btn:disabled { opacity: 0.3; cursor: default; }
  .nav-btn.primary { background: #b33e1f; border-color: #b33e1f; color: #fff; font-weight: 600; }
  .nav-btn.primary:hover:not(:disabled) { background: #c94b28; border-color: #c94b28; }
  .step-fraction { font-size: 10px; color: var(--text-muted); font-family: "JetBrains Mono", monospace; }
</style>
```

- [ ] **Step 3.2: Verify TypeScript compiles (no errors)**

```powershell
bun run build 2>&1 | head -30
```

Expected: no TypeScript or Svelte compile errors related to HelpModal.

- [ ] **Step 3.3: Commit**

```bash
git add src/lib/workspace/HelpModal.svelte
git commit -m "feat(help): add HelpModal shell component"
```

---

## Task 4: Tauri Native Menu — Help Item

**Files:**
- Modify: `src-tauri/src/lib.rs`

The current `about` submenu (lines 24-33 in lib.rs) is:
```rust
let about = SubmenuBuilder::new(app, "Veesker")
    .about(Some(...))
    .separator()
    .quit()
    .build()?;
```

- [ ] **Step 4.1: Add `MenuItemBuilder` import (already present — verify)**

`MenuItemBuilder` is already imported via `use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};` on line 6. No change needed.

- [ ] **Step 4.2: Add Help menu item and on_menu_event in `src-tauri/src/lib.rs`**

Replace the `about` submenu block (lines 24–33) with:

```rust
        .menu(|app| {
            let help_item = MenuItemBuilder::with_id("open_help", "Help")
                .accelerator("F1")
                .build(app)?;

            let about = SubmenuBuilder::new(app, "Veesker")
                .about(Some(
                    AboutMetadataBuilder::new()
                        .name(Some("Veesker"))
                        .comments(Some("Oracle 23ai Vector Search Studio"))
                        .build(),
                ))
                .separator()
                .item(&help_item)
                .separator()
                .quit()
                .build()?;

            let file = SubmenuBuilder::new(app, "File")
                .item(&MenuItemBuilder::with_id("new_connection", "New Connection").accelerator("CmdOrCtrl+N").build(app)?)
                .separator()
                .close_window()
                .build()?;

            let edit = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            MenuBuilder::new(app).items(&[&about, &file, &edit]).build()
        })
```

Then inside the `.setup(|app| {` block, add an `on_menu_event` handler **before** the `Ok(())`. Add it right after the `win.on_window_event(...)` block (around line 148):

```rust
            app.on_menu_event(|app, event| {
                if event.id().as_ref() == "open_help" {
                    let _ = app.emit("open-help", ());
                }
            });

            Ok(())
```

- [ ] **Step 4.3: Build the Rust code to verify it compiles**

```powershell
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20
```

Expected: `Compiling veesker ...` then `Finished`. Fix any compile errors before continuing.

- [ ] **Step 4.4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(help): add Help menu item and open-help Tauri event"
```

---

## Task 5: Frontend Wiring — Layout + Event Listener

**Files:**
- Modify: `src/routes/+layout.svelte`

- [ ] **Step 5.1: Update `src/routes/+layout.svelte`**

Replace the entire file with:

```svelte
<script lang="ts">
  import "../app.css";
  import { theme } from "$lib/stores/theme.svelte";
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import HelpModal from "$lib/workspace/HelpModal.svelte";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
  let showHelp = $state(false);

  $effect(() => {
    document.documentElement.dataset.theme = theme.current;
  });

  onMount(() => {
    const unlistenPromise = listen("open-help", () => {
      showHelp = true;
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
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

{#if showHelp}
  <HelpModal onClose={() => { showHelp = false; }} />
{/if}
```

- [ ] **Step 5.2: Run the app and manually test the menu item**

```powershell
bun run tauri dev
```

1. Click **Veesker** menu → verify **Help** item appears between About separator and Exit.
2. Click **Help** → verify the modal opens with the dark Veesker theme, sidebar with 10 module names, and "No steps in this module yet" in the content area.
3. Press **Escape** → verify the modal closes.
4. Click outside the modal (on the backdrop) → verify the modal closes.
5. Press **F1** → verify the modal opens (menu accelerator).

- [ ] **Step 5.3: Commit**

```bash
git add src/routes/+layout.svelte
git commit -m "feat(help): wire Help menu event to HelpModal in layout"
```

---

## Task 6: Module Content — Getting Started

**Files:**
- Modify: `src/lib/help-modules.ts` (fill `getting-started` steps)

- [ ] **Step 6.1: Replace the `getting-started` entry in `MODULES`**

Replace `{ id: 'getting-started', emoji: '🚀', title: 'Getting Started', steps: [] }` with:

```typescript
  {
    id: 'getting-started',
    emoji: '🚀',
    title: 'Getting Started',
    steps: [
      {
        heading: 'What is Veesker?',
        body: 'Veesker is a desktop IDE for Oracle 23ai databases. It runs natively on Windows and macOS without requiring Oracle Instant Client — the node-oracledb Thin mode driver is bundled in the app. You connect directly to any Oracle 23ai instance using host, port, and service name.',
        tip: 'No Oracle client installation needed. Veesker works out of the box on a fresh machine.',
      },
      {
        heading: 'Creating Your First Connection',
        body: 'On the home screen, click + New Connection. Fill in: Host (e.g. localhost), Port (default 1521), and Service Name (e.g. FREEPDB1 for Oracle 23ai Free). Enter your username and password — the password is stored securely in the OS keychain (Windows Credential Manager on Windows, macOS Keychain on macOS). Click Test Connection to verify, then Save.',
        tip: 'Use Service Name, not SID. Oracle 23ai Free uses FREEPDB1 as its default pluggable database service name.',
        demo: `<div style="font-family:monospace;font-size:12px;color:var(--text-secondary)">
  <div style="display:grid;grid-template-columns:120px 1fr;gap:6px;align-items:center">
    <span style="color:var(--text-muted)">Host</span>
    <span style="background:var(--bg-surface-alt);padding:4px 8px;border-radius:4px;border:1px solid var(--border)">localhost</span>
    <span style="color:var(--text-muted)">Port</span>
    <span style="background:var(--bg-surface-alt);padding:4px 8px;border-radius:4px;border:1px solid var(--border)">1521</span>
    <span style="color:var(--text-muted)">Service Name</span>
    <span style="background:var(--bg-surface-alt);padding:4px 8px;border-radius:4px;border:1px solid var(--border)">FREEPDB1</span>
    <span style="color:var(--text-muted)">Username</span>
    <span style="background:var(--bg-surface-alt);padding:4px 8px;border-radius:4px;border:1px solid var(--border)">hr</span>
    <span style="color:var(--text-muted)">Password</span>
    <span style="background:var(--bg-surface-alt);padding:4px 8px;border-radius:4px;border:1px solid var(--border)">••••••••</span>
  </div>
</div>`,
      },
      {
        heading: 'Navigating the Main Layout',
        body: 'After connecting, the workspace opens with three main areas: the Schema Tree on the left (browse all database objects), the Object Details panel in the centre (columns, indexes, DDL), and the Status Bar at the top. Toggle the SQL Drawer with Ctrl+J and the Sheep AI panel with Ctrl+I.',
        shortcuts: [
          { keys: ['Ctrl', 'J'], description: 'Toggle SQL Drawer' },
          { keys: ['Ctrl', 'I'], description: 'Toggle Sheep AI panel' },
          { keys: ['Ctrl', 'K'], description: 'Command Palette — search all objects' },
        ],
      },
      {
        heading: 'Security Notice',
        body: 'Veesker is pre-release software and has not undergone a formal security audit. The Sheep AI features (SheepChat and Analyze) send schema names, column names, SQL queries, and result samples to api.anthropic.com. Do not use AI features with sensitive, classified, or regulated data. All other features (SQL execution, schema browsing, debugging) are fully local.',
        tip: 'The AI features are completely optional — Veesker works without an Anthropic API key.',
      },
    ],
  },
```

- [ ] **Step 6.2: Open the app, click Help, select Getting Started, navigate all 4 steps**

Verify: all step text renders, shortcut chips show correctly, the demo HTML renders in step 2, dots advance as you click Next.

- [ ] **Step 6.3: Commit**

```bash
git add src/lib/help-modules.ts
git commit -m "feat(help): add Getting Started module content (4 steps)"
```

---

## Task 7: Module Content — Schema Tree

**Files:**
- Modify: `src/lib/help-modules.ts`

- [ ] **Step 7.1: Replace the `schema-tree` entry**

```typescript
  {
    id: 'schema-tree',
    emoji: '🌳',
    title: 'Schema Tree',
    steps: [
      {
        heading: 'Expanding Schemas',
        body: 'The Schema Tree on the left lists all schemas your user can see. Click a schema name to expand it — Veesker loads object counts for each type. System schemas (SYS, SYSTEM, DBSNMP, etc.) are hidden by default. Toggle them with the SYS button at the top of the tree.',
      },
      {
        heading: 'Object Type Colour Codes',
        body: 'Each object type has a consistent colour throughout the app. These colours appear in the Schema Tree, Data Flow diagrams, and Command Palette results.',
        demo: `<div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px">
  <span style="background:rgba(74,158,218,0.15);color:#4a9eda;padding:3px 10px;border-radius:12px;border:1px solid rgba(74,158,218,0.3)">● Tables</span>
  <span style="background:rgba(39,174,96,0.15);color:#27ae60;padding:3px 10px;border-radius:12px;border:1px solid rgba(39,174,96,0.3)">● Views</span>
  <span style="background:rgba(230,126,34,0.15);color:#e67e22;padding:3px 10px;border-radius:12px;border:1px solid rgba(230,126,34,0.3)">● Procedures</span>
  <span style="background:rgba(243,156,18,0.15);color:#f39c12;padding:3px 10px;border-radius:12px;border:1px solid rgba(243,156,18,0.3)">● Functions</span>
  <span style="background:rgba(155,89,182,0.15);color:#9b59b6;padding:3px 10px;border-radius:12px;border:1px solid rgba(155,89,182,0.3)">● Packages</span>
  <span style="background:rgba(231,76,60,0.15);color:#e74c3c;padding:3px 10px;border-radius:12px;border:1px solid rgba(231,76,60,0.3)">● Triggers</span>
  <span style="background:rgba(46,204,113,0.15);color:#2ecc71;padding:3px 10px;border-radius:12px;border:1px solid rgba(46,204,113,0.3)">● Sequences</span>
  <span style="background:rgba(52,152,219,0.15);color:#3498db;padding:3px 10px;border-radius:12px;border:1px solid rgba(52,152,219,0.3)">● Types</span>
</div>`,
      },
      {
        heading: 'Searching and Filter Chips',
        body: 'Type in the search box at the top of the Schema Tree to filter objects by name across all expanded schemas. Use the filter chips (TBL, VW, PROC, etc.) to toggle specific object types on or off. For a full cross-schema search, use the Command Palette.',
        shortcuts: [
          { keys: ['Ctrl', 'K'], description: 'Command Palette — instant search across all schemas' },
        ],
      },
      {
        heading: 'Right-click Context Menu',
        body: 'Right-clicking any object in the Schema Tree reveals context actions. For any object: View DDL. For procedures and functions: Execute (opens parameter input modal) and Open in Test Window (opens the PL/SQL debugger). For any object: Show Data Flow.',
        demo: `<div style="background:var(--bg-surface);border:1px solid var(--border-strong);border-radius:6px;padding:4px;width:240px;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,0.4)">
  <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;color:var(--text-secondary);cursor:pointer">
    <span>📋</span> View DDL
  </div>
  <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;background:rgba(179,62,31,0.15);color:var(--text-primary);cursor:pointer">
    <span>▶</span> Execute Procedure / Function
  </div>
  <div style="height:1px;background:var(--border);margin:3px 4px"></div>
  <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;color:var(--text-secondary);cursor:pointer">
    <span>🐛</span> Open in Test Window (Debug)
  </div>
  <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;color:var(--text-secondary);cursor:pointer">
    <span>🕸️</span> Show Data Flow
  </div>
</div>`,
      },
      {
        heading: 'Refreshing the Tree',
        body: 'After making schema changes — creating tables, compiling procedures, adding indexes — click the refresh button (↻) at the top of the Schema Tree to reload all object lists. This re-fetches the live list from Oracle and updates counts.',
        tip: 'The Schema Tree does not auto-refresh. Always refresh manually after DDL changes to see updated results.',
      },
    ],
  },
```

- [ ] **Step 7.2: Verify in running app — click Schema Tree module, navigate all 5 steps, check colour demo renders**

- [ ] **Step 7.3: Commit**

```bash
git add src/lib/help-modules.ts
git commit -m "feat(help): add Schema Tree module content (5 steps)"
```

---

## Task 8: Module Content — SQL Editor

**Files:**
- Modify: `src/lib/help-modules.ts`

- [ ] **Step 8.1: Replace the `sql-editor` entry**

```typescript
  {
    id: 'sql-editor',
    emoji: '⌨️',
    title: 'SQL Editor',
    steps: [
      {
        heading: 'Opening the SQL Drawer',
        body: 'Press Ctrl+J (or click the SQL button in the Status Bar) to toggle the SQL Drawer open or closed. It appears as a resizable panel at the bottom of the workspace. Drag the top handle to adjust its height. Press Ctrl+Shift+E to expand it to full screen.',
        shortcuts: [
          { keys: ['Ctrl', 'J'], description: 'Toggle SQL Drawer open/closed' },
          { keys: ['Ctrl', 'Shift', 'E'], description: 'Toggle full-screen expanded editor' },
        ],
      },
      {
        heading: 'Tabs and Running SQL',
        body: 'The SQL Editor supports multiple tabs — click the + button in the tab bar to open a new tab. Each tab has its own SQL content, result, and history. To run a single statement, place the cursor anywhere inside it and press Ctrl+Enter. To run all statements in the editor, press Ctrl+Shift+Enter.',
        shortcuts: [
          { keys: ['Ctrl', 'Enter'], description: 'Run statement at cursor (or selected text)' },
          { keys: ['Ctrl', 'Shift', 'Enter'], description: 'Run all statements' },
          { keys: ['Ctrl', 'W'], description: 'Close active tab' },
        ],
      },
      {
        heading: 'Result Grid',
        body: 'Query results appear in the Result Grid below the editor. The grid uses virtual scrolling — only visible rows are rendered, so large result sets stay smooth. Resize column widths by dragging the column header borders. Click any cell to select and copy its value. Press Ctrl+. to cancel a running query.',
        shortcuts: [
          { keys: ['Ctrl', '.'], description: 'Cancel the running query' },
        ],
        tip: 'For very large tables, add a FETCH FIRST N ROWS ONLY clause to avoid fetching millions of rows.',
      },
      {
        heading: 'Execution Log',
        body: 'Switch to the Log tab in the results area to see DBMS_OUTPUT output, row counts, and elapsed time for each executed statement. If your PL/SQL procedure calls DBMS_OUTPUT.PUT_LINE, its output appears here.',
        tip: 'DBMS_OUTPUT is enabled automatically for your session. You do not need to call DBMS_OUTPUT.ENABLE manually.',
      },
      {
        heading: 'Query History',
        body: 'Switch to the History tab to see all SQL executed in the current session, newest first. Click any history entry to load it back into the active editor tab. Each entry shows the schema, elapsed time, row count, and the full SQL.',
      },
      {
        heading: 'EXPLAIN PLAN',
        body: 'Press F6 to generate an EXPLAIN PLAN for the current statement (or selected text). The result is a colour-coded tree: Table Access nodes are green, Index nodes are blue, Join nodes are amber. Click any node to see its full details. Click Ask AI to send the plan to Sheep AI for interpretation and optimisation suggestions.',
        shortcuts: [
          { keys: ['F6'], description: 'Generate EXPLAIN PLAN for current statement' },
        ],
      },
    ],
  },
```

- [ ] **Step 8.2: Verify in running app — navigate all 6 SQL Editor steps**

- [ ] **Step 8.3: Commit**

```bash
git add src/lib/help-modules.ts
git commit -m "feat(help): add SQL Editor module content (6 steps)"
```

---

## Task 9: Module Content — Object Inspector

**Files:**
- Modify: `src/lib/help-modules.ts`

- [ ] **Step 9.1: Replace the `object-inspector` entry**

```typescript
  {
    id: 'object-inspector',
    emoji: '🔎',
    title: 'Object Inspector',
    steps: [
      {
        heading: 'Selecting Objects',
        body: 'Click any object name in the Schema Tree to load it in the Object Inspector panel (centre of the workspace). The panel automatically switches tabs based on object type — tables and views open to Columns, procedures and functions open to their parameter list.',
      },
      {
        heading: 'Columns Tab',
        body: 'The Columns tab lists every column with its data type, nullable flag, default value, and comments. Use the search box above the list to filter columns by name — useful for wide tables with dozens of columns.',
        tip: 'The column list updates live as you type in the search box. Press Escape to clear the filter.',
      },
      {
        heading: 'Indexes and Related Objects',
        body: 'The Indexes tab shows all indexes on the selected table, including primary keys, unique constraints, and regular indexes — with column lists and index types. The Related tab shows tables that have foreign keys pointing to this table (FK children) and tables this table references (FK parents).',
      },
      {
        heading: 'DDL View and Live Row Count',
        body: 'Click the DDL tab to see the full CREATE statement for the selected object as Oracle generates it. For tables, click the Count Rows button to run a live SELECT COUNT(*) and display the result — this is fetched on demand, not automatically.',
        tip: 'Row count is not fetched automatically to avoid slow queries on large tables. Click the button when you need it.',
      },
      {
        heading: 'Procedures and Functions',
        body: 'When you select a procedure or function, the inspector shows its parameter list (name, direction IN/OUT/IN OUT, and data type) and its full DDL source. To execute it with values, right-click it in the Schema Tree and choose Execute, or click the Run button that appears in the inspector header.',
      },
    ],
  },
```

- [ ] **Step 9.2: Verify in running app — navigate all 5 Object Inspector steps**

- [ ] **Step 9.3: Commit**

```bash
git add src/lib/help-modules.ts
git commit -m "feat(help): add Object Inspector module content (5 steps)"
```

---

## Task 10: Module Content — Data Flow

**Files:**
- Modify: `src/lib/help-modules.ts`

- [ ] **Step 10.1: Replace the `data-flow` entry**

```typescript
  {
    id: 'data-flow',
    emoji: '🕸️',
    title: 'Data Flow',
    steps: [
      {
        heading: 'What Data Flow Shows',
        body: 'Data Flow is a visual dependency map centred on the selected object. The left side shows upstream dependencies — objects this object uses or references. The right side shows downstream dependents — objects that reference this object. Foreign key parent tables appear as FK ↑, FK child tables as FK ↓. Triggers are listed in a separate row.',
      },
      {
        heading: 'Reading the Diagram',
        body: 'Each node in the diagram is colour-coded by object type — the same colour scheme as the Schema Tree. Bezier curves connect the selected object (centre) to its dependencies. Hover any node to see its fully-qualified owner.name. The object type is shown as a short badge (TBL, VIEW, PROC, etc.).',
      },
      {
        heading: 'Navigating the Dependency Chain',
        body: 'Click any node in the Data Flow diagram to navigate to that object — the Object Inspector loads it and a new Data Flow diagram re-centres on it. This lets you follow dependency chains across the schema. Use the Back button (top-left of the inspector) to return to the previous object in the chain.',
        tip: 'Data Flow is available for all object types: tables, views, procedures, packages, functions, triggers, and types.',
      },
    ],
  },
```

- [ ] **Step 10.2: Verify in running app — navigate all 3 Data Flow steps**

- [ ] **Step 10.3: Commit**

```bash
git add src/lib/help-modules.ts
git commit -m "feat(help): add Data Flow module content (3 steps)"
```

---

## Task 11: Module Content — Sheep AI

**Files:**
- Modify: `src/lib/help-modules.ts`

- [ ] **Step 11.1: Replace the `sheep-ai` entry**

```typescript
  {
    id: 'sheep-ai',
    emoji: '🤖',
    title: 'Sheep AI',
    steps: [
      {
        heading: 'Opening Sheep AI',
        body: 'Press Ctrl+I (or click the AI button in the Status Bar) to open the Sheep AI chat panel on the right side of the workspace. The first time you open it, you will be prompted to enter your Anthropic API key. This key is stored in the OS keychain and persists across sessions.',
        shortcuts: [
          { keys: ['Ctrl', 'I'], description: 'Toggle Sheep AI panel open/closed' },
        ],
      },
      {
        heading: 'API Key Setup',
        body: 'Click the settings gear icon in the Sheep AI panel. Paste your Anthropic API key (starts with sk-ant-...) into the API Key field and press Enter or click Save. The key is stored in the OS keychain, not in a plain text file. You only need to do this once.',
        tip: 'Get your Anthropic API key at console.anthropic.com. Sheep AI uses Claude with prompt caching to reduce API costs on repeated schema references.',
      },
      {
        heading: 'Asking SQL Questions',
        body: 'Type any question in natural language and press Enter or Ctrl+Enter to send. Sheep AI has context about your current connection and can help you write queries, explain ORA- error messages, optimise SQL, and explain Oracle behaviour. Example: "Write a query that finds the top 10 customers by total order value in the last 30 days."',
      },
      {
        heading: 'Sending an EXPLAIN PLAN to AI',
        body: 'After generating an EXPLAIN PLAN with F6, click the Ask AI button in the plan view. This sends the full execution plan text to Sheep AI and asks it to explain what is happening and suggest index or query improvements. This is the fastest way to turn a raw plan into actionable advice.',
        shortcuts: [
          { keys: ['F6'], description: 'Generate EXPLAIN PLAN (then click Ask AI in the result)' },
        ],
      },
      {
        heading: 'Guided Chart Builder',
        body: 'After running any query, click the Analyze button (chart icon in the result toolbar) to send the result set to Sheep AI. It guides you through: pick a chart type (bar, line, pie, scatter, or KPI), select X and Y columns, choose an aggregation (SUM, AVG, COUNT, MIN, MAX), and give the chart a title. A preview appears in the chat — click Add to Dashboard to save it.',
      },
    ],
  },
```

- [ ] **Step 11.2: Verify in running app — navigate all 5 Sheep AI steps**

- [ ] **Step 11.3: Commit**

```bash
git add src/lib/help-modules.ts
git commit -m "feat(help): add Sheep AI module content (5 steps)"
```

---

## Task 12: Module Content — Dashboard

**Files:**
- Modify: `src/lib/help-modules.ts`

- [ ] **Step 12.1: Replace the `dashboard` entry**

```typescript
  {
    id: 'dashboard',
    emoji: '📊',
    title: 'Dashboard',
    steps: [
      {
        heading: 'What the Dashboard Is',
        body: 'The Dashboard tab (accessible from the top tab bar in the workspace) shows all charts added via the Sheep AI chart builder. It persists across queries within a session — build a dashboard of KPI cards and charts from multiple queries, then export everything to PDF.',
      },
      {
        heading: 'KPI Cards and Chart Grid',
        body: 'KPI charts (single-metric cards showing one number with a label) are displayed as a compact row at the top of the dashboard. All other chart types — bar, line, pie, scatter — are arranged in a responsive grid below. The layout is automatic and always puts KPIs first.',
        tip: 'To create a KPI, choose "KPI" as the chart type in the Sheep AI chart builder and pick the column that holds the metric value.',
      },
      {
        heading: 'Exporting to PDF',
        body: 'Click Export PDF in the dashboard toolbar. Veesker generates a printable document with: a cover page (title and SQL from the first chart), then a full-page section for each chart showing the chart image and its underlying data table. The PDF opens in your system\'s default PDF viewer.',
      },
      {
        heading: 'Clearing the Dashboard',
        body: 'Click the Clear button in the dashboard toolbar to remove all charts. A confirmation step prevents accidental clearing. In v1, individual chart removal is not supported — use Clear to start over, then re-add the charts you want via Sheep AI Analyze.',
      },
    ],
  },
```

- [ ] **Step 12.2: Verify in running app — navigate all 4 Dashboard steps**

- [ ] **Step 12.3: Commit**

```bash
git add src/lib/help-modules.ts
git commit -m "feat(help): add Dashboard module content (4 steps)"
```

---

## Task 13: Module Content — PL/SQL Debugger

**Files:**
- Modify: `src/lib/help-modules.ts`

- [ ] **Step 13.1: Replace the `plsql-debugger` entry**

```typescript
  {
    id: 'plsql-debugger',
    emoji: '🐛',
    title: 'PL/SQL Debugger',
    steps: [
      {
        heading: 'Prerequisites',
        body: 'Before debugging, the procedure or function must be compiled with debug information. If it was compiled normally, Veesker detects this and shows a clear error message. Your Oracle user also needs the DEBUG CONNECT SESSION and DEBUG ANY PROCEDURE privileges.',
        demo: `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;padding:10px;color:#81c784">
  ALTER PROCEDURE my_proc COMPILE DEBUG;<br>
  ALTER FUNCTION my_fn COMPILE DEBUG;<br>
  <span style="color:var(--text-muted)">-- or for a package:</span><br>
  ALTER PACKAGE my_pkg COMPILE DEBUG;
</div>`,
        tip: 'After fixing and re-deploying a procedure in production, remember to recompile WITHOUT debug to remove debug symbols.',
      },
      {
        heading: 'Opening the Test Window',
        body: 'Right-click a procedure or function in the Schema Tree and choose Open in Test Window. A full-screen modal opens showing the source code on the left and a parameter input form on the right. Veesker automatically generates the anonymous PL/SQL block that calls your routine.',
      },
      {
        heading: 'Setting Breakpoints',
        body: 'In the Test Window editor, click the gutter (the grey margin on the left side of the editor) next to any executable line to set a breakpoint — a red dot appears on that line. Click the dot again to remove it. Breakpoints can also be toggled with Ctrl+B at the cursor position.',
        shortcuts: [
          { keys: ['Ctrl', 'B'], description: 'Toggle breakpoint at cursor line' },
        ],
      },
      {
        heading: 'Starting a Debug Session',
        body: 'Click the 🐛 Debug button (or press F9) to start the step-through session. Veesker establishes a two-session DBMS_DEBUG protocol: one Oracle session runs your code, a second one controls execution. Execution pauses at the first breakpoint you set.',
        shortcuts: [
          { keys: ['F9'], description: 'Start step-through debug session' },
          { keys: ['F8'], description: 'Run without debugging (no breakpoints)' },
        ],
        tip: 'A debug session opens a second Oracle connection. If your schema has a session limit, you may need to free up a session or increase the limit.',
      },
      {
        heading: 'Stepping Through Code',
        body: 'When paused at a breakpoint, use the Debug Toolbar controls to move through execution. The current line is highlighted in the editor.',
        shortcuts: [
          { keys: ['F7'], description: 'Step Into — enter called procedures/functions' },
          { keys: ['F10'], description: 'Step Over — execute current line, skip into calls' },
          { keys: ['Shift', 'F7'], description: 'Step Out — finish current procedure, pause at caller' },
          { keys: ['F5'], description: 'Continue — run until next breakpoint or end' },
          { keys: ['Shift', 'F5'], description: 'Stop — terminate the debug session immediately' },
        ],
      },
      {
        heading: 'Reading the Call Stack',
        body: 'The Call Stack panel (below the toolbar) shows the current execution stack — the chain of procedure and function calls that led to the current paused line. The topmost entry is where execution is paused. Click any frame in the call stack to jump to that location in the source editor.',
      },
      {
        heading: 'Inspecting Live Variables',
        body: 'The Locals panel lists all variables in scope at the currently paused line, along with their current values. Values update each time you step. For a quick look, hover over any variable name in the source editor — a tooltip shows its current value without needing to scan the Locals panel.',
        tip: 'Complex types (cursors, records, collections) appear as structured values in the Locals panel. Primitive types show their scalar value directly.',
      },
    ],
  },
```

- [ ] **Step 13.2: Verify in running app — navigate all 7 PL/SQL Debugger steps, check SQL demo renders**

- [ ] **Step 13.3: Commit**

```bash
git add src/lib/help-modules.ts
git commit -m "feat(help): add PL/SQL Debugger module content (7 steps)"
```

---

## Task 14: Module Content — Vector Search

**Files:**
- Modify: `src/lib/help-modules.ts`

- [ ] **Step 14.1: Replace the `vector-search` entry**

```typescript
  {
    id: 'vector-search',
    emoji: '🔍',
    title: 'Vector Search',
    steps: [
      {
        heading: 'Oracle 23ai AI Vector Search',
        body: 'Oracle 23ai includes native AI vector storage and similarity search. You store high-dimensional embedding vectors (generated by AI models) in a VECTOR column, create a vector index, and run semantic similarity searches — finding rows whose vector is nearest to a query vector. This enables semantic search, recommendation systems, and RAG (retrieval-augmented generation) workflows.',
      },
      {
        heading: 'The Vectors Tab',
        body: 'Select a table in the Schema Tree and click the Vectors tab in the Object Inspector. Veesker detects VECTOR columns and lists any existing vector indexes on them. From here you can create a new vector index or drop an existing one. If the table has no VECTOR columns, the tab shows a message explaining this.',
      },
      {
        heading: 'Creating a Vector Index',
        body: 'In the Vectors tab, click Create Index next to a VECTOR column. Veesker runs CREATE VECTOR INDEX using the IVF (Inverted File Index) algorithm and NEIGHBOR PARTITIONS organisation. The index enables fast approximate nearest-neighbour search. Creation time depends on row count.',
        tip: 'You need at least a few hundred rows with populated vector values for the IVF index to be useful. Empty or sparse columns will produce poor search quality.',
      },
      {
        heading: 'Configuring an Embedding Provider',
        body: 'To search semantically, Veesker embeds your query text using the same model that generated the stored vectors. Supported providers: Ollama (local and free — use nomic-embed-text), OpenAI (text-embedding-3-small), Voyage AI (voyage-3-lite), or a Custom URL. Configure your provider and API key in the Vectors tab settings section.',
        tip: 'For local development, Ollama with nomic-embed-text is free and runs entirely on your machine. Start it with: ollama run nomic-embed-text',
      },
      {
        heading: 'Running a Semantic Search and Reading the Scatter Plot',
        body: 'Enter a search phrase in the Query field. Choose a distance metric — COSINE (best for text and language), EUCLIDEAN (geometric distance), or DOT (for normalised vectors). Set a result limit and click Search. Results appear in a grid ranked by similarity score. Below the grid, a PCA scatter plot projects all result vectors into 2D space — the query vector appears as a distinct point, and closer dots indicate higher similarity.',
      },
    ],
  },
```

- [ ] **Step 14.2: Verify in running app — navigate all 5 Vector Search steps**

- [ ] **Step 14.3: Commit**

```bash
git add src/lib/help-modules.ts
git commit -m "feat(help): add Vector Search module content (5 steps)"
```

---

## Task 15: Module Content — Shortcuts Reference

**Files:**
- Modify: `src/lib/help-modules.ts`

- [ ] **Step 15.1: Replace the `shortcuts-reference` entry**

```typescript
  {
    id: 'shortcuts-reference',
    emoji: '⌨️',
    title: 'Shortcuts Reference',
    steps: [
      {
        heading: 'All Keyboard Shortcuts',
        body: 'Complete reference of every keyboard shortcut in Veesker, grouped by area.',
        demo: `<div style="font-size:11px;font-family:'Inter',sans-serif">
  <div style="color:#b33e1f;font-weight:700;font-size:9px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;font-family:'Space Grotesk',sans-serif">Global</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px;color:var(--text-secondary)"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+I</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Toggle Sheep AI panel</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+J</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Toggle SQL Drawer</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+K</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Command Palette</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+O</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Open SQL file</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+S</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Save active SQL tab</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+Shift+S</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Save active SQL tab as…</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+Shift+E</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Toggle expanded SQL editor</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+W</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Close active SQL tab</td></tr>
    <tr><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+.</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Cancel running query</td></tr>
  </table>
  <div style="color:#b33e1f;font-weight:700;font-size:9px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;font-family:'Space Grotesk',sans-serif">SQL Editor</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+Enter</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Run statement at cursor</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+Shift+Enter</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Run all statements</td></tr>
    <tr><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">F6</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Generate EXPLAIN PLAN</td></tr>
  </table>
  <div style="color:#b33e1f;font-weight:700;font-size:9px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;font-family:'Space Grotesk',sans-serif">PL/SQL Debugger</div>
  <table style="width:100%;border-collapse:collapse">
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">F8</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Run (no debug)</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">F9</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Start debug session</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Ctrl+B</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Toggle breakpoint at cursor</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">F7</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Step Into</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">F10</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Step Over</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Shift+F7</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Step Out</td></tr>
    <tr style="border-bottom:1px solid var(--border)"><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">F5</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Continue to next breakpoint</td></tr>
    <tr><td style="padding:4px 8px"><kbd style="background:rgba(255,255,255,0.08);border:1px solid var(--border-strong);border-radius:3px;padding:1px 5px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-primary)">Shift+F5</kbd></td><td style="padding:4px 8px;color:var(--text-secondary)">Stop debug session</td></tr>
  </table>
</div>`,
      },
    ],
  },
```

- [ ] **Step 15.2: Verify in running app — open Help, navigate to Shortcuts Reference, check the full table renders correctly with styled kbd elements**

- [ ] **Step 15.3: Run all tests one final time**

```powershell
bun run test
```

Expected: all tests pass (including the `help-progress` tests from Task 1).

- [ ] **Step 15.4: Run Biome linter**

```powershell
bun run lint
```

Fix any warnings before committing.

- [ ] **Step 15.5: Commit**

```bash
git add src/lib/help-modules.ts
git commit -m "feat(help): add Shortcuts Reference module content (1 step)"
```

---

## Done

All 10 modules are complete. The Help item is in the Veesker menu, the modal renders with full training content, progress is tracked in localStorage, and the Veesker theme is used throughout.
