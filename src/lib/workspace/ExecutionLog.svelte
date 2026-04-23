<script lang="ts">
  import type { SqlTab, TabResult } from "$lib/stores/sql-editor.svelte";
  import { sqlEditor } from "$lib/stores/sql-editor.svelte";

  type Props = { tab: SqlTab };
  let { tab }: Props = $props();

  function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  function summary(r: TabResult): string {
    if (r.status === "running") return "…";
    if (r.status === "cancelled") return "cancelled";
    if (r.status === "error") return r.error ? String(r.error.code) : "error";
    if (r.result === null) return `${r.elapsedMs}ms`;
    const isData = r.result.columns.length > 0;
    if (isData) {
      const n = r.result.rowCount;
      return `${n} row${n === 1 ? "" : "s"} · ${r.elapsedMs}ms`;
    }
    return `✓ ${r.result.rowCount} affected · ${r.elapsedMs}ms`;
  }

  function statusIcon(r: TabResult): string {
    if (r.status === "running") return "⟳";
    if (r.status === "ok" && r.dbmsOutput && r.dbmsOutput.length > 0) return "⊞";
    if (r.status === "ok") return "✓";
    if (r.status === "error") return "✗";
    return "⏸";
  }

  let collapseState = $state(new Map<string, boolean>());
  function isCollapsed(id: string): boolean {
    return collapseState.get(id) ?? true;
  }
  function toggleCollapse(id: string): void {
    collapseState.set(id, !isCollapsed(id));
    collapseState = new Map(collapseState);
  }

  function selectRow(rid: string) {
    sqlEditor.setActiveResult(tab.id, rid);
  }

  function onRowKey(e: KeyboardEvent, idx: number) {
    if (e.key === "ArrowDown" && idx < tab.results.length - 1) {
      e.preventDefault();
      selectRow(tab.results[idx + 1].id);
      const next = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement | null;
      next?.focus();
    } else if (e.key === "ArrowUp" && idx > 0) {
      e.preventDefault();
      selectRow(tab.results[idx - 1].id);
      const prev = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null;
      prev?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectRow(tab.results[idx].id);
    }
  }

</script>

{#if tab.results.length > 0}
  <div class="log" class:collapsed={tab.results.length <= 1 || sqlEditor.logCollapsed}>
    <div class="header">
      <span class="count">{tab.results.length} statement{tab.results.length === 1 ? "" : "s"}</span>
      {#if tab.results.length > 1}
        <button
          class="toggle"
          aria-label={sqlEditor.logCollapsed ? "Expand log" : "Collapse log"}
          onclick={() => sqlEditor.toggleLog()}
        >{sqlEditor.logCollapsed ? "▲" : "▼"}</button>
      {/if}
    </div>
    {#if tab.results.length > 1 && !sqlEditor.logCollapsed}
      <ul class="rows" role="listbox" aria-label="Statement results">
        {#each tab.results as r, i (r.id)}
          <li
            class="row-wrapper"
            class:active={tab.activeResultId === r.id}
            role="option"
            aria-selected={tab.activeResultId === r.id}
            tabindex="0"
            onclick={() => selectRow(r.id)}
            onkeydown={(e) => onRowKey(e, i)}
          >
            <div
              class="row"
              class:err={r.status === "error"}
              class:cancelled={r.status === "cancelled"}
              class:ok={r.status === "ok"}
              class:running={r.status === "running"}
            >
              <span class="icon" class:spin={r.status === "running"}>{statusIcon(r)}</span>
              <span class="label">Statement {r.statementIndex + 1}</span>
              <span class="preview">{truncate(r.sqlPreview, 60)}</span>
              <span class="summary">{summary(r)}</span>
            </div>
            {#if r.dbmsOutput && r.dbmsOutput.length > 0}
              {@const collapsed = isCollapsed(r.id)}
              {@const visible = collapsed ? r.dbmsOutput.slice(0, 5) : r.dbmsOutput}
              {@const extra = r.dbmsOutput.length - 5}
              <div class="dbms-output">
                {#each visible as line}
                  <div class="dbms-line">{line}</div>
                {/each}
                {#if r.dbmsOutput.length > 5}
                  <button class="dbms-toggle" onclick={() => toggleCollapse(r.id)}>
                    {collapsed ? `show ${extra} more` : "show less"}
                  </button>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .log {
    display: flex;
    flex-direction: column;
    background: var(--bg-surface-raised);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0.7rem;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    height: 22px;
    box-sizing: border-box;
  }
  .collapsed .header {
    border-bottom: none;
  }
  .count {
    font-family: "Space Grotesk", sans-serif;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
  }
  .toggle {
    background: transparent;
    border: none;
    padding: 0 0.4rem;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 11px;
  }
  .toggle:hover { color: var(--text-primary); }
  .rows {
    display: flex;
    flex-direction: column;
    max-height: 180px;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row-wrapper {
    border-left: 2px solid transparent;
    border-bottom: 1px solid var(--row-hover);
    cursor: pointer;
    user-select: none;
  }
  .row-wrapper:hover { background: var(--row-hover); }
  .row-wrapper.active {
    background: rgba(179, 62, 31, 0.08);
    border-left-color: #b33e1f;
  }
  .row-wrapper:focus-visible {
    outline: 2px solid #b33e1f;
    outline-offset: -2px;
  }
  .row {
    display: grid;
    grid-template-columns: 18px 90px 1fr auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.6rem;
  }
  .icon {
    font-size: 12px;
    text-align: center;
    color: var(--text-secondary);
  }
  .row.ok .icon { color: #2e6b2e; }
  .row.err .icon { color: #b33e1f; }
  .row.cancelled .icon { color: var(--text-muted); }
  .row.running .icon { color: #b33e1f; }
  .icon.spin { animation: spin 0.9s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .label {
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .preview {
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11.5px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .summary {
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 10.5px;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .row.err .summary { color: #b33e1f; }
  .dbms-output { padding: 2px 0 4px 24px; display: flex; flex-direction: column; gap: 1px; }
  .dbms-line { font-family: monospace; font-size: 11px; color: var(--text-secondary); white-space: pre-wrap; }
  .dbms-toggle { background: none; border: none; color: var(--text-muted); font-size: 11px; cursor: pointer; padding: 0; text-align: left; }
</style>
