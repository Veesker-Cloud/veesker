<script lang="ts">
  import { sqlEditor } from "$lib/stores/sql-editor.svelte";
  import SqlEditor from "./SqlEditor.svelte";
  import ResultGrid from "./ResultGrid.svelte";
  import ExecutionLog from "./ExecutionLog.svelte";
  import QueryHistory from "./QueryHistory.svelte";

  // ── Refs ────────────────────────────────────────────────────────────────────
  let drawerEl: HTMLDivElement | undefined = $state();
  let tabbarEl: HTMLDivElement | undefined = $state();

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
            <span class="tab-title">{t.title}</span>
            <button
              class="tab-close"
              aria-label="Close {t.title}"
              onclick={(e) => { e.stopPropagation(); sqlEditor.closeTab(t.id); }}
            >×</button>
          </div>
        {/each}
        <button class="plus" aria-label="New query" onclick={() => sqlEditor.openBlank()}>+</button>
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
                value={tab.sql}
                onChange={(s) => sqlEditor.updateSql(tab.id, s)}
                onRunCursor={(selection, cursorPos, docText) => {
                  if (selection !== null) {
                    void sqlEditor.runSelection(selection);
                  } else {
                    void sqlEditor.runStatementAtCursor(docText, cursorPos);
                  }
                }}
                onRunAll={() => void sqlEditor.runActiveAll()}
              />
            {/if}
          </div>

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
