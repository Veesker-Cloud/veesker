<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/gevianajr/veesker
-->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";

  type Props = { onClose: () => void };
  let { onClose }: Props = $props();

  type Entry = {
    id: string;
    user_email: string;
    connection_name: string | null;
    host: string | null;
    sql_text: string;
    sql_truncated: boolean;
    success: boolean;
    row_count: number | null;
    elapsed_ms: number;
    error_code: number | null;
    error_message: string | null;
    occurred_at: string;
  };

  type Stats = {
    total: number;
    failures: number;
    distinct_users: number;
    first_entry: string | null;
    last_entry: string | null;
  };

  let entries = $state<Entry[]>([]);
  let stats = $state<Stats | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let forbidden = $state(false);

  let failuresOnly = $state(false);
  let userFilter = $state("");
  let offset = $state(0);
  const LIMIT = 50;
  let hasMore = $state(false);

  let expandedId = $state<string | null>(null);

  async function getToken(): Promise<string | null> {
    return invoke<string | null>("auth_token_get");
  }

  async function loadStats() {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch("https://api.veesker.cloud/v1/audit/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) stats = await res.json().then(d => d.stats);
    } catch { /* non-critical */ }
  }

  async function loadEntries(reset = false) {
    if (reset) offset = 0;
    loading = true;
    error = null;
    const token = await getToken();
    if (!token) { loading = false; return; }

    const params = new URLSearchParams({
      limit: String(LIMIT),
      offset: String(reset ? 0 : offset),
    });
    if (failuresOnly) params.set("failures", "true");
    if (userFilter.trim()) params.set("user", userFilter.trim());

    try {
      const res = await fetch(`https://api.veesker.cloud/v1/audit?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) { forbidden = true; loading = false; return; }
      if (!res.ok) { error = `Error ${res.status}`; loading = false; return; }
      const data = await res.json();
      entries = reset ? data.entries : [...entries, ...data.entries];
      hasMore = data.entries.length === LIMIT;
      if (!reset) offset += data.entries.length;
    } catch {
      error = "Failed to load audit log.";
    }
    loading = false;
  }

  async function loadMore() {
    offset += LIMIT;
    await loadEntries(false);
  }

  onMount(() => {
    void loadStats();
    void loadEntries(true);
  });

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  }

  function fmtMs(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  }

  function sqlPreview(sql: string): string {
    return sql.replace(/\s+/g, " ").trim().slice(0, 120);
  }
</script>

<div
  class="backdrop"
  role="presentation"
  onclick={onClose}
  onkeydown={(e) => e.key === "Escape" && onClose()}
>
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label="Audit Log"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <!-- Header -->
    <div class="head">
      <div class="head-left">
        <img src="/veesker-cloud-logo.png" class="head-icon" alt="" aria-hidden="true" />
        <span class="head-title">Audit Log</span>
        <span class="head-sub">last 30 days</span>
      </div>
      <button class="close-btn" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <div class="body">
      {#if forbidden}
        <div class="forbidden">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="8.5" stroke="currentColor" stroke-width="1.4"/>
            <path d="M10 6v5M10 13.5v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <span>Requires <strong>admin</strong> or <strong>dba</strong> role.</span>
        </div>
      {:else}
        <!-- Stats row -->
        {#if stats}
          <div class="stats-row">
            <div class="stat-card">
              <span class="stat-value">{stats.total.toLocaleString()}</span>
              <span class="stat-label">Total executions</span>
            </div>
            <div class="stat-card stat-card--danger">
              <span class="stat-value">{stats.failures.toLocaleString()}</span>
              <span class="stat-label">Failures</span>
            </div>
            <div class="stat-card">
              <span class="stat-value">{stats.distinct_users}</span>
              <span class="stat-label">Distinct users</span>
            </div>
            {#if stats.total > 0}
              <div class="stat-card stat-card--wide">
                <span class="stat-value stat-value--sm">{stats.last_entry ? fmtDate(stats.last_entry) : "—"}</span>
                <span class="stat-label">Last execution</span>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Filters -->
        <div class="filters">
          <input
            class="filter-input"
            type="text"
            placeholder="Filter by user email…"
            bind:value={userFilter}
            onkeydown={(e) => e.key === "Enter" && void loadEntries(true)}
          />
          <button class="filter-btn" onclick={() => void loadEntries(true)}>Search</button>
          <label class="toggle-label">
            <input type="checkbox" bind:checked={failuresOnly} onchange={() => void loadEntries(true)} />
            Failures only
          </label>
        </div>

        <!-- Table -->
        {#if loading && entries.length === 0}
          <div class="loading">Loading…</div>
        {:else if error}
          <div class="err">{error}</div>
        {:else if entries.length === 0}
          <div class="empty">No entries found.</div>
        {:else}
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Connection</th>
                  <th>SQL</th>
                  <th>Status</th>
                  <th>Rows</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {#each entries as e (e.id)}
                  <tr
                    class="entry-row"
                    class:entry-row--error={!e.success}
                    class:entry-row--expanded={expandedId === e.id}
                    onclick={() => { expandedId = expandedId === e.id ? null : e.id; }}
                    role="button"
                    tabindex="0"
                    onkeydown={(ev) => ev.key === "Enter" && (expandedId = expandedId === e.id ? null : e.id)}
                  >
                    <td class="cell-time">{fmtDate(e.occurred_at)}</td>
                    <td class="cell-user">{e.user_email}</td>
                    <td class="cell-conn">{e.connection_name ?? "—"}</td>
                    <td class="cell-sql">
                      {#if expandedId === e.id}
                        <pre class="sql-full">{e.sql_text}{e.sql_truncated ? "\n— [truncated]" : ""}</pre>
                      {:else}
                        <span class="sql-preview">{sqlPreview(e.sql_text)}</span>
                      {/if}
                    </td>
                    <td class="cell-status">
                      {#if e.success}
                        <span class="badge badge--ok">OK</span>
                      {:else}
                        <span class="badge badge--err" title={e.error_message ?? ""}>ERR</span>
                      {/if}
                    </td>
                    <td class="cell-num">{e.row_count ?? "—"}</td>
                    <td class="cell-num">{fmtMs(e.elapsed_ms)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          {#if hasMore}
            <div class="load-more-wrap">
              <button class="load-more-btn" onclick={() => void loadMore()} disabled={loading}>
                {loading ? "Loading…" : "Load more"}
              </button>
            </div>
          {/if}
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    backdrop-filter: blur(3px);
    z-index: 200;
    display: flex; align-items: center; justify-content: center;
  }
  .panel {
    width: min(92vw, 1100px);
    max-height: 88vh;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    display: flex; flex-direction: column;
    box-shadow: 0 24px 60px rgba(0,0,0,0.5);
    overflow: hidden;
  }

  /* Head */
  .head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface-alt);
    flex-shrink: 0;
  }
  .head-left { display: flex; align-items: center; gap: 10px; }
  .head-icon { width: 22px; height: 22px; border-radius: 5px; }
  .head-title { font-size: 13px; font-weight: 700; color: var(--text-primary); }
  .head-sub { font-size: 11px; color: var(--text-muted); }
  .close-btn {
    background: none; border: none; color: var(--text-muted);
    cursor: pointer; font-size: 13px; padding: 2px 6px; border-radius: 4px;
  }
  .close-btn:hover { color: var(--text-primary); background: var(--bg-surface); }

  /* Body */
  .body {
    flex: 1; overflow-y: auto; padding: 16px 18px;
    display: flex; flex-direction: column; gap: 14px;
  }

  /* Forbidden */
  .forbidden {
    display: flex; align-items: center; gap: 10px;
    color: var(--text-muted); font-size: 13px;
    padding: 40px 0; justify-content: center;
  }

  /* Stats */
  .stats-row {
    display: flex; gap: 10px; flex-wrap: wrap;
  }
  .stat-card {
    background: var(--bg-surface-alt);
    border: 1px solid var(--border);
    border-radius: 7px; padding: 10px 16px;
    display: flex; flex-direction: column; gap: 3px;
    min-width: 110px;
  }
  .stat-card--danger { border-color: rgba(220,60,60,0.3); background: rgba(220,60,60,0.05); }
  .stat-card--wide { flex: 1; }
  .stat-value { font-size: 20px; font-weight: 700; color: #2bb4ee; font-family: "JetBrains Mono", monospace; }
  .stat-value--sm { font-size: 13px; }
  .stat-card--danger .stat-value { color: #e87070; }
  .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }

  /* Filters */
  .filters {
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  }
  .filter-input {
    flex: 1; min-width: 200px;
    background: var(--input-bg); border: 1px solid var(--border);
    border-radius: 5px; color: var(--text-primary);
    padding: 5px 10px; font-size: 12px;
  }
  .filter-input:focus { outline: none; border-color: rgba(43,180,238,0.5); }
  .filter-btn {
    background: rgba(43,180,238,0.12); border: 1px solid rgba(43,180,238,0.3);
    color: #2bb4ee; border-radius: 5px; padding: 5px 14px;
    font-size: 12px; cursor: pointer; font-weight: 600;
  }
  .filter-btn:hover { background: rgba(43,180,238,0.2); }
  .toggle-label {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: var(--text-muted); cursor: pointer;
    user-select: none;
  }

  /* Table */
  .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 7px; }
  .table {
    width: 100%; border-collapse: collapse;
    font-size: 11.5px;
  }
  .table thead { background: var(--bg-surface-alt); }
  .table th {
    text-align: left; padding: 7px 10px;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-muted); font-weight: 600;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .entry-row td { padding: 6px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  .entry-row:last-child td { border-bottom: none; }
  .entry-row { cursor: pointer; transition: background 0.1s; }
  .entry-row:hover { background: rgba(255,255,255,0.03); }
  .entry-row--error { background: rgba(220,60,60,0.04); }
  .entry-row--error:hover { background: rgba(220,60,60,0.08); }
  .entry-row--expanded { background: rgba(43,180,238,0.05); }

  .cell-time { white-space: nowrap; color: var(--text-muted); min-width: 130px; }
  .cell-user { white-space: nowrap; color: var(--text-primary); max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
  .cell-conn { white-space: nowrap; color: var(--text-muted); max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
  .cell-sql { max-width: 380px; }
  .cell-status { white-space: nowrap; }
  .cell-num { white-space: nowrap; color: var(--text-muted); text-align: right; }

  .sql-preview {
    display: block; color: var(--text-primary);
    font-family: "JetBrains Mono", monospace; font-size: 11px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 380px;
  }
  .sql-full {
    margin: 0; padding: 8px;
    background: var(--bg-surface-alt); border-radius: 4px;
    font-family: "JetBrains Mono", monospace; font-size: 11px;
    color: var(--text-primary); white-space: pre-wrap; word-break: break-word;
    max-height: 260px; overflow-y: auto;
    border: 1px solid var(--border);
  }

  .badge {
    display: inline-block; font-size: 10px; font-weight: 700;
    padding: 2px 6px; border-radius: 3px; letter-spacing: 0.04em;
  }
  .badge--ok { background: rgba(43,180,238,0.12); color: #2bb4ee; border: 1px solid rgba(43,180,238,0.3); }
  .badge--err { background: rgba(220,60,60,0.12); color: #e87070; border: 1px solid rgba(220,60,60,0.3); }

  /* States */
  .loading, .empty, .err {
    color: var(--text-muted); font-size: 12px;
    padding: 32px 0; text-align: center;
  }
  .err { color: #e87070; }

  /* Load more */
  .load-more-wrap { display: flex; justify-content: center; padding: 8px 0; }
  .load-more-btn {
    background: var(--bg-surface-alt); border: 1px solid var(--border);
    color: var(--text-muted); border-radius: 5px; padding: 6px 20px;
    font-size: 12px; cursor: pointer;
  }
  .load-more-btn:hover:not(:disabled) { color: var(--text-primary); }
  .load-more-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
