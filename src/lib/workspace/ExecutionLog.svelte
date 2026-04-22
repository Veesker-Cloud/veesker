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

  function statusIcon(s: TabResult["status"]): string {
    return s === "running" ? "⟳" : s === "ok" ? "✓" : s === "error" ? "✗" : "⏸";
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
      <div class="rows" role="listbox" aria-label="Statement results">
        {#each tab.results as r, i (r.id)}
          <div
            class="row"
            class:active={tab.activeResultId === r.id}
            class:err={r.status === "error"}
            class:cancelled={r.status === "cancelled"}
            class:ok={r.status === "ok"}
            class:running={r.status === "running"}
            role="option"
            aria-selected={tab.activeResultId === r.id}
            tabindex="0"
            onclick={() => selectRow(r.id)}
            onkeydown={(e) => onRowKey(e, i)}
          >
            <span class="icon" class:spin={r.status === "running"}>{statusIcon(r.status)}</span>
            <span class="label">Statement {r.statementIndex + 1}</span>
            <span class="preview">{truncate(r.sqlPreview, 60)}</span>
            <span class="summary">{summary(r)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .log {
    display: flex;
    flex-direction: column;
    background: #fff;
    border-bottom: 1px solid rgba(26, 22, 18, 0.08);
    flex-shrink: 0;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0.7rem;
    background: #f6f1e8;
    border-bottom: 1px solid rgba(26, 22, 18, 0.08);
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
    color: rgba(26, 22, 18, 0.6);
  }
  .toggle {
    background: transparent;
    border: none;
    padding: 0 0.4rem;
    color: rgba(26, 22, 18, 0.55);
    cursor: pointer;
    font-size: 11px;
  }
  .toggle:hover { color: #1a1612; }
  .rows {
    display: flex;
    flex-direction: column;
    max-height: 180px;
    overflow-y: auto;
  }
  .row {
    display: grid;
    grid-template-columns: 18px 90px 1fr auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.6rem;
    border-left: 2px solid transparent;
    border-bottom: 1px solid rgba(26, 22, 18, 0.04);
    cursor: pointer;
    user-select: none;
  }
  .row:hover { background: rgba(26, 22, 18, 0.04); }
  .row.active {
    background: rgba(179, 62, 31, 0.08);
    border-left-color: #b33e1f;
  }
  .row:focus-visible {
    outline: 2px solid #b33e1f;
    outline-offset: -2px;
  }
  .icon {
    font-size: 12px;
    text-align: center;
    color: rgba(26, 22, 18, 0.55);
  }
  .row.ok .icon { color: #2e6b2e; }
  .row.err .icon { color: #b33e1f; }
  .row.cancelled .icon { color: rgba(26, 22, 18, 0.45); }
  .row.running .icon { color: #b33e1f; }
  .icon.spin { animation: spin 0.9s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .label {
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    font-weight: 500;
    color: #1a1612;
  }
  .preview {
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 11.5px;
    color: rgba(26, 22, 18, 0.6);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .summary {
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 10.5px;
    color: rgba(26, 22, 18, 0.5);
    white-space: nowrap;
  }
  .row.err .summary { color: #b33e1f; }
</style>
