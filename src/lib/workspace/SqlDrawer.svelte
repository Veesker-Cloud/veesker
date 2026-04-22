<script lang="ts">
  import { sqlEditor, COMPILE_REGEX } from "$lib/stores/sql-editor.svelte";
  import SqlEditor from "./SqlEditor.svelte";
  import ResultGrid from "./ResultGrid.svelte";
  import ExecutionLog from "./ExecutionLog.svelte";
  import QueryHistory from "./QueryHistory.svelte";
  import CompileErrors from "./CompileErrors.svelte";

  // ── Refs ────────────────────────────────────────────────────────────────────
  let drawerEl: HTMLDivElement | undefined = $state();
  let tabbarEl: HTMLDivElement | undefined = $state();
  let editorRef: SqlEditor | null = $state(null);

  // ── Active result ────────────────────────────────────────────────────────────
  const active = $derived(sqlEditor.active);
  let activeTabResult = $derived(
    active ? active.results.find((r) => r.id === active.activeResultId) ?? null : null
  );

  // ── Top drag handle (resizes drawer height) ──────────────────────────────
  let topDragStartY = 0;
  let topDragStartHeight = 0;

  function onTopPointerDown(e: PointerEvent) {
    const handle = e.currentTarget as HTMLDivElement;
    handle.setPointerCapture(e.pointerId);
    topDragStartY = e.clientY;
    topDragStartHeight = sqlEditor.drawerHeight;
  }

  function onTopPointerMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
    const newHeight = topDragStartHeight + (topDragStartY - e.clientY);
    const max = typeof window !== "undefined" ? window.innerHeight * 0.9 : 2000;
    sqlEditor.setDrawerHeight(Math.max(120, Math.min(max, newHeight)));
  }

  function onTopPointerUp(e: PointerEvent) {
    const handle = e.currentTarget as HTMLDivElement;
    if (handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
    // Final value already persisted by setDrawerHeight
  }

  function onTopKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const max = typeof window !== "undefined" ? window.innerHeight * 0.9 : 2000;
      sqlEditor.setDrawerHeight(Math.min(max, sqlEditor.drawerHeight + 10));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      sqlEditor.setDrawerHeight(Math.max(120, sqlEditor.drawerHeight - 10));
    }
  }

  // ── Middle drag handle (resizes editor/grid ratio) ───────────────────────
  function onMidPointerDown(e: PointerEvent) {
    const handle = e.currentTarget as HTMLDivElement;
    handle.setPointerCapture(e.pointerId);
  }

  function onMidPointerMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
    if (!drawerEl || !tabbarEl) return;
    const drawerRect = drawerEl.getBoundingClientRect();
    const tabbarHeight = tabbarEl.clientHeight;
    const contentHeight = drawerRect.height - tabbarHeight - 4; // 4px = top handle
    const offsetInContent = e.clientY - drawerRect.top - tabbarHeight - 4;
    const ratio = offsetInContent / contentHeight;
    sqlEditor.setEditorRatio(ratio);
  }

  function onMidPointerUp(e: PointerEvent) {
    const handle = e.currentTarget as HTMLDivElement;
    if (handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
  }

  function onMidKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      sqlEditor.setEditorRatio(sqlEditor.editorRatio - 10 / sqlEditor.drawerHeight);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      sqlEditor.setEditorRatio(sqlEditor.editorRatio + 10 / sqlEditor.drawerHeight);
    }
  }
</script>

{#if !sqlEditor.drawerOpen}
  <button
    class="strip"
    aria-label="Expand SQL drawer"
    onclick={() => sqlEditor.toggleDrawer()}
  >
    <span class="label">SQL</span>
    <span class="arrow">▲</span>
  </button>
{:else}
  <!-- Top resize handle -->
  <div
    class="top-handle"
    role="separator"
    aria-orientation="horizontal"
    tabindex="0"
    onpointerdown={onTopPointerDown}
    onpointermove={onTopPointerMove}
    onpointerup={onTopPointerUp}
    onpointercancel={onTopPointerUp}
    onkeydown={onTopKeyDown}
  ></div>

  <div
    class="drawer"
    style="height: {sqlEditor.drawerHeight}px"
    bind:this={drawerEl}
  >
    <div class="tabbar" bind:this={tabbarEl}>
      <button
        class="history-toggle"
        aria-label="Toggle query history"
        onclick={() => sqlEditor.toggleHistoryPanel()}
      >{sqlEditor.historyPanelOpen ? "◀" : "▶"}</button>
      <div class="tabs" role="tablist">
        {#each sqlEditor.tabs as t (t.id)}
          <div
            role="tab"
            class="tab"
            class:active={sqlEditor.activeId === t.id}
            tabindex="0"
            onclick={() => sqlEditor.setActive(t.id)}
            onkeydown={(e) => { if (e.key === "Enter") sqlEditor.setActive(t.id); }}
          >
            {#if t.running}<span class="tab-spinner"></span>{/if}
            <span class="tab-title">{t.isDirty ? `● ${t.title}` : t.title}</span>
            <button
              class="tab-close"
              aria-label="Close {t.title}"
              onclick={(e) => { e.stopPropagation(); sqlEditor.closeTab(t.id); }}
            >×</button>
          </div>
        {/each}
        <button class="plus" aria-label="New query" onclick={() => sqlEditor.openBlank()}>+</button>
      </div>
      <div class="file-actions">
        <button
          class="file-btn"
          title="New query (⌘N)"
          aria-label="New query"
          onclick={() => sqlEditor.openBlank()}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M2 1.5h5.5L11 5v6.5H2V1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            <path d="M7 1.5V5.5h4" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            <line x1="4.5" y1="6.5" x2="8.5" y2="6.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
            <line x1="4.5" y1="8.5" x2="7" y2="8.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
          </svg>
          New
        </button>
        <button
          class="file-btn"
          title="Open file (⌘O)"
          aria-label="Open file"
          onclick={() => void sqlEditor.openFromFile()}
        >
          <svg width="14" height="13" viewBox="0 0 14 13" fill="none" aria-hidden="true">
            <path d="M1 4.5h4.5l1 1.5H13V11H1V4.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            <path d="M1 4.5V2.5h3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Open
        </button>
        <button
          class="file-btn"
          title="Save (⌘S)"
          aria-label="Save"
          onclick={() => void sqlEditor.saveActive()}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <rect x="1.5" y="1.5" width="10" height="10" rx="1" stroke="currentColor" stroke-width="1.2"/>
            <rect x="4" y="1.5" width="5" height="3.5" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>
            <rect x="3" y="7" width="7" height="3.5" rx="0.5" stroke="currentColor" stroke-width="1"/>
            <line x1="7" y1="2" x2="7" y2="4.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
          </svg>
          Save
        </button>
        <button
          class="file-btn"
          title="Save as… (⌘⇧S)"
          aria-label="Save as"
          onclick={() => void sqlEditor.saveAsActive()}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <rect x="1.5" y="1.5" width="10" height="10" rx="1" stroke="currentColor" stroke-width="1.2"/>
            <rect x="4" y="1.5" width="5" height="3.5" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>
            <rect x="3" y="7" width="7" height="3.5" rx="0.5" stroke="currentColor" stroke-width="1"/>
            <path d="M9.5 10l1.5-1.5-1.5-1.5" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Save As
        </button>
        {#if active && COMPILE_REGEX.test(active.sql)}
          <button
            class="file-btn compile-btn"
            title="Compile (run and check for errors)"
            aria-label="Compile"
            onclick={() => void sqlEditor.runActiveAll()}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <polygon points="2,1 11,6 2,11"/>
            </svg>
            Compile
          </button>
        {/if}
      </div>
      <button
        class="collapse"
        aria-label="Collapse drawer"
        onclick={() => sqlEditor.toggleDrawer()}
      >▼</button>
    </div>

    <div class="drawer-body">
      {#if sqlEditor.historyPanelOpen}
        <QueryHistory />
      {/if}

      <div class="main-area">
        {#if sqlEditor.activeId === null}
          <div class="empty">Click + to open a new query.</div>
        {:else}
          {@const tab = sqlEditor.active}
          <div class="editor-pane" style="flex: 0 0 {sqlEditor.editorRatio * 100}%">
            {#if tab}
              <SqlEditor
                bind:this={editorRef}
                value={tab.sql}
                compileErrors={activeTabResult?.compileErrors ?? null}
                onChange={(s) => sqlEditor.updateSql(tab.id, s)}
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
              />
            {/if}
          </div>

          {#if activeTabResult?.compileErrors?.length}
            <CompileErrors
              errors={activeTabResult.compileErrors}
              onGoto={(line) => editorRef?.gotoLine(line)}
            />
          {/if}

          <!-- Middle resize handle -->
          <div
            class="mid-handle"
            role="separator"
            aria-orientation="horizontal"
            tabindex="0"
            onpointerdown={onMidPointerDown}
            onpointermove={onMidPointerMove}
            onpointerup={onMidPointerUp}
            onpointercancel={onMidPointerUp}
            onkeydown={onMidKeyDown}
          ></div>

          <div class="grid-pane" style="flex: 1 1 auto">
            {#if tab}
              <ExecutionLog {tab} />
            {/if}
            <div class="grid-host">
              <ResultGrid {tab} onCancel={() => void sqlEditor.cancelActive()} />
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .strip {
    height: 28px;
    width: 100%;
    background: #f6f1e8;
    border: none;
    border-top: 1px solid rgba(26, 22, 18, 0.1);
    color: rgba(26, 22, 18, 0.7);
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1rem;
    cursor: pointer;
  }
  .strip:hover { background: #f0e8da; }

  /* ── Top resize handle ─────────────────────────────────────────────────── */
  .top-handle {
    height: 4px;
    width: 100%;
    cursor: ns-resize;
    background: transparent;
    flex-shrink: 0;
  }
  .top-handle:hover {
    background: rgba(179, 62, 31, 0.4);
  }
  .top-handle:focus-visible {
    outline: 2px solid #b33e1f;
    outline-offset: -1px;
  }

  /* ── Drawer ─────────────────────────────────────────────────────────────── */
  .drawer {
    min-height: 120px;
    background: #fff;
    border-top: 2px solid #b33e1f;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .tabbar {
    display: flex;
    align-items: stretch;
    background: #f6f1e8;
    border-bottom: 1px solid rgba(26, 22, 18, 0.1);
  }
  .tabs {
    display: flex;
    flex: 1;
    overflow-x: auto;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.7rem;
    border-right: 1px solid rgba(26, 22, 18, 0.08);
    background: transparent;
    cursor: pointer;
    font-size: 11.5px;
    font-family: "Space Grotesk", sans-serif;
    color: rgba(26, 22, 18, 0.7);
    user-select: none;
  }
  .tab:hover { background: rgba(26, 22, 18, 0.04); }
  .tab.active {
    background: #b33e1f;
    color: #f6f1e8;
  }
  .tab-spinner {
    width: 8px; height: 8px;
    border: 1.5px solid rgba(26, 22, 18, 0.2);
    border-top-color: #b33e1f;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .tab.active .tab-spinner {
    border-color: rgba(246, 241, 232, 0.3);
    border-top-color: #f6f1e8;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .tab-close {
    background: transparent;
    border: none;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 0.15rem;
    border-radius: 3px;
  }
  .tab-close:hover { opacity: 1; background: rgba(0,0,0,0.1); }
  .file-actions {
    display: flex;
    align-items: stretch;
    border-left: 1px solid rgba(26, 22, 18, 0.08);
    border-right: 1px solid rgba(26, 22, 18, 0.08);
  }
  .file-btn {
    background: transparent;
    border: none;
    border-right: 1px solid rgba(26, 22, 18, 0.06);
    padding: 0 0.6rem;
    color: rgba(26, 22, 18, 0.65);
    cursor: pointer;
    font-size: 11px;
    font-family: "Space Grotesk", sans-serif;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .file-btn:hover { background: rgba(26, 22, 18, 0.06); color: #1a1612; }
  .file-btn svg { flex-shrink: 0; }
  .compile-btn { color: #7a2a14; }
  .compile-btn:hover { background: rgba(179, 62, 31, 0.08); color: #b33e1f; }
  .plus, .collapse, .history-toggle {
    background: transparent;
    border: none;
    padding: 0 0.7rem;
    color: rgba(26, 22, 18, 0.6);
    cursor: pointer;
    font-size: 14px;
    font-family: "Space Grotesk", sans-serif;
  }
  .plus:hover, .collapse:hover, .history-toggle:hover { background: rgba(26, 22, 18, 0.06); color: #1a1612; }
  .history-toggle {
    font-size: 10px;
    padding: 0 0.6rem;
    border-right: 1px solid rgba(26, 22, 18, 0.08);
  }

  /* ── 3-pane body layout ─────────────────────────────────────────────────── */
  .drawer-body {
    flex: 1 1 auto;
    display: flex;
    flex-direction: row;
    min-height: 0;
    overflow: hidden;
  }
  .main-area {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .empty {
    padding: 1.5rem;
    color: rgba(26, 22, 18, 0.5);
    font-size: 12px;
  }
  .editor-pane {
    min-height: 80px;
    border-bottom: 1px solid rgba(26, 22, 18, 0.1);
    overflow: hidden;
  }

  /* ── Middle resize handle ──────────────────────────────────────────────── */
  .mid-handle {
    height: 4px;
    width: 100%;
    cursor: ns-resize;
    background: transparent;
    flex-shrink: 0;
  }
  .mid-handle:hover {
    background: rgba(179, 62, 31, 0.4);
  }
  .mid-handle:focus-visible {
    outline: 2px solid #b33e1f;
    outline-offset: -1px;
  }

  .grid-pane {
    min-height: 80px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .grid-host {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
