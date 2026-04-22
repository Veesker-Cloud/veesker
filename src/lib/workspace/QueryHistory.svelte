<script lang="ts">
  import { onDestroy } from "svelte";
  import { historyList, historyClear, type HistoryEntry } from "$lib/query-history";
  import { sqlEditor } from "$lib/stores/sql-editor.svelte";

  // Reactively track connectionId from store
  let connectionId = $derived(sqlEditor.connectionId);

  let entries = $state<HistoryEntry[]>([]);
  let loading = $state(false);
  let loadingMore = $state(false);
  let hasMore = $state(true);
  let search = $state("");
  let error = $state<string | null>(null);

  const PAGE_SIZE = 50;

  // ── Relative time helper ─────────────────────────────────────────────────────
  function relTime(iso: string): string {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day === 1) return "yesterday";
    if (day < 7) return `${day}d ago`;
    return d.toLocaleDateString();
  }

  // ── Debounced fetch ───────────────────────────────────────────────────────────
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function fetchPage(offset: number, reset: boolean): Promise<void> {
    if (connectionId === null) {
      entries = [];
      hasMore = false;
      loading = false;
      loadingMore = false;
      return;
    }
    if (reset) {
      loading = true;
      error = null;
    } else {
      loadingMore = true;
    }
    try {
      const res = await historyList(connectionId, PAGE_SIZE, offset, search || undefined);
      if (res.ok) {
        if (reset) {
          entries = res.data;
        } else {
          entries = [...entries, ...res.data];
        }
        hasMore = res.data.length === PAGE_SIZE;
      } else {
        error = res.error?.message ?? "Failed to load history";
        hasMore = false;
      }
    } finally {
      loading = false;
      loadingMore = false;
    }
  }

  // $effect watches connectionId and search, debounces 200ms, then resets
  $effect(() => {
    // access reactive dependencies
    const cid = connectionId;
    const s = search;
    void cid; void s;

    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      entries = [];
      hasMore = true;
      void fetchPage(0, true);
    }, 200);
  });

  onDestroy(() => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
  });

  // ── Infinite scroll ───────────────────────────────────────────────────────────
  let sentinel: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver((observed) => {
      if (observed[0]?.isIntersecting && hasMore && !loadingMore && !loading) {
        void fetchPage(entries.length, false);
      }
    }, { threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  // ── Clear history ─────────────────────────────────────────────────────────────
  async function handleClear(): Promise<void> {
    if (connectionId === null) return;
    if (!confirm("Clear all history for this connection?")) return;
    const res = await historyClear(connectionId);
    if (res.ok) {
      entries = [];
      hasMore = false;
    } else {
      error = res.error?.message ?? "Failed to clear history";
    }
  }

  // ── Truncate helper ───────────────────────────────────────────────────────────
  function truncateSql(sql: string, maxLen = 60): string {
    const first = sql.split("\n")[0].trim();
    return first.length > maxLen ? first.slice(0, maxLen) + "…" : first;
  }
</script>

<div class="history-panel">
  <div class="history-header">
    <span class="history-title">History</span>
    <div class="history-controls">
      <input
        class="history-search"
        type="search"
        placeholder="Search…"
        bind:value={search}
        aria-label="Search history"
      />
      <button
        class="history-clear"
        aria-label="Clear history"
        onclick={handleClear}
        disabled={connectionId === null}
      >✕</button>
    </div>
  </div>

  <div class="history-list" role="list">
    {#if connectionId === null}
      <div class="history-empty">Connect to a database to see query history.</div>
    {:else if loading}
      {#each { length: 4 } as _, i (i)}
        <div class="skeleton-row">
          <div class="skeleton skeleton-icon"></div>
          <div class="skeleton-lines">
            <div class="skeleton skeleton-sql"></div>
            <div class="skeleton skeleton-meta"></div>
          </div>
        </div>
      {/each}
    {:else if error !== null}
      <div class="history-error">{error}</div>
    {:else if entries.length === 0}
      <div class="history-empty">No queries yet. Execute a query to see history.</div>
    {:else}
      {#each entries as entry (entry.id)}
        <button
          class="history-item"
          title={entry.sql}
          onclick={() => sqlEditor.loadHistoryEntry(entry)}
        >
          <span class="status-icon" class:icon-ok={entry.success} class:icon-err={!entry.success}>
            {entry.success ? "✓" : "✗"}
          </span>
          <div class="item-body">
            <span class="item-sql">{truncateSql(entry.sql)}</span>
            <span class="item-meta">
              {relTime(entry.executedAt)}
              {#if entry.success && entry.rowCount !== null}
                · {entry.rowCount} row{entry.rowCount === 1 ? "" : "s"}
              {/if}
            </span>
          </div>
        </button>
      {/each}

      <!-- Infinite scroll sentinel -->
      <div bind:this={sentinel} class="sentinel"></div>

      {#if loadingMore}
        <div class="loading-more">Loading…</div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .history-panel {
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid rgba(26, 22, 18, 0.1);
    background: #f6f1e8;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .history-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid rgba(26, 22, 18, 0.1);
    flex-shrink: 0;
  }

  .history-title {
    font-family: "Space Grotesk", sans-serif;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(26, 22, 18, 0.55);
    font-weight: 600;
  }

  .history-controls {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .history-search {
    flex: 1;
    min-width: 0;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    font-size: 11px;
    padding: 3px 6px;
    border: 1px solid rgba(26, 22, 18, 0.15);
    border-radius: 3px;
    background: #fff;
    color: #1a1612;
    outline: none;
  }
  .history-search:focus {
    border-color: #b33e1f;
    box-shadow: 0 0 0 2px rgba(179, 62, 31, 0.12);
  }

  .history-clear {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 10px;
    color: rgba(26, 22, 18, 0.5);
    padding: 2px 4px;
    border-radius: 3px;
    line-height: 1;
  }
  .history-clear:hover:not(:disabled) {
    background: rgba(179, 62, 31, 0.1);
    color: #b33e1f;
  }
  .history-clear:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .history-list {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 4px 0;
  }

  .history-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    width: 100%;
    padding: 5px 8px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .history-item:hover {
    background: rgba(26, 22, 18, 0.04);
  }

  .status-icon {
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
    margin-top: 1px;
    color: rgba(26, 22, 18, 0.45);
  }
  .status-icon.icon-ok {
    color: #2d8a4e;
  }
  .status-icon.icon-err {
    color: #b33e1f;
  }

  .item-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .item-sql {
    font-family: "SF Mono", Menlo, monospace;
    font-size: 11px;
    color: #1a1612;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-meta {
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    font-size: 10px;
    color: rgba(26, 22, 18, 0.5);
  }

  .history-empty {
    padding: 16px 10px;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    font-size: 11px;
    color: rgba(26, 22, 18, 0.45);
    text-align: center;
    line-height: 1.4;
  }

  .history-error {
    padding: 10px;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    font-size: 11px;
    color: #b33e1f;
  }

  /* ── Skeleton loading ─────────────────────────────────────────────────────── */
  .skeleton-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 5px 8px;
  }

  .skeleton {
    background: rgba(26, 22, 18, 0.1);
    border-radius: 2px;
    animation: shimmer 1.4s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .skeleton-icon {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .skeleton-lines {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }

  .skeleton-sql {
    height: 11px;
    width: 85%;
  }

  .skeleton-meta {
    height: 9px;
    width: 50%;
  }

  /* ── Infinite scroll ──────────────────────────────────────────────────────── */
  .sentinel {
    height: 1px;
  }

  .loading-more {
    padding: 6px 10px;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    font-size: 10px;
    color: rgba(26, 22, 18, 0.45);
    text-align: center;
  }
</style>
