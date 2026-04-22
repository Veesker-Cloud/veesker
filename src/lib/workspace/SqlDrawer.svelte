<script lang="ts">
  import { sqlEditor } from "$lib/stores/sql-editor.svelte";
  import SqlEditor from "./SqlEditor.svelte";
  import ResultGrid from "./ResultGrid.svelte";
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
  <div class="drawer">
    <div class="tabbar">
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

    {#if sqlEditor.activeId === null}
      <div class="empty">Click + to open a new query.</div>
    {:else}
      {@const tab = sqlEditor.active}
      <div class="editor-pane">
        {#if tab}
          <SqlEditor
            value={tab.sql}
            onChange={(s) => sqlEditor.updateSql(tab.id, s)}
            onRun={() => sqlEditor.runActive()}
          />
        {/if}
      </div>
      <div class="grid-pane">
        <ResultGrid {tab} />
      </div>
    {/if}
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
  .drawer {
    height: 40vh;
    min-height: 200px;
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
  .plus, .collapse {
    background: transparent;
    border: none;
    padding: 0 0.7rem;
    color: rgba(26, 22, 18, 0.6);
    cursor: pointer;
    font-size: 14px;
    font-family: "Space Grotesk", sans-serif;
  }
  .plus:hover, .collapse:hover { background: rgba(26, 22, 18, 0.06); color: #1a1612; }
  .empty {
    padding: 1.5rem;
    color: rgba(26, 22, 18, 0.5);
    font-size: 12px;
  }
  .editor-pane {
    flex: 1 1 50%;
    min-height: 80px;
    border-bottom: 1px solid rgba(26, 22, 18, 0.1);
    overflow: hidden;
  }
  .grid-pane {
    flex: 1 1 50%;
    min-height: 80px;
    overflow: hidden;
  }
</style>
