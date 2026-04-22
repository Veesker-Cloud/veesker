<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import {
    listConnections,
    deleteConnection,
    type ConnectionMeta,
  } from "$lib/connections";

  let connections = $state<ConnectionMeta[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function refresh() {
    loading = true;
    const res = await listConnections();
    if (res.ok) {
      connections = res.data;
      error = null;
    } else {
      error = res.error.message;
    }
    loading = false;
  }

  onMount(refresh);

  async function onDelete(e: MouseEvent, c: ConnectionMeta) {
    e.stopPropagation();
    if (!confirm(`Delete "${c.name}"?`)) return;
    const res = await deleteConnection(c.id);
    if (!res.ok) {
      alert(`Delete failed: ${res.error.message}`);
      return;
    }
    await refresh();
  }

  function connLabel(c: ConnectionMeta): string {
    if (c.authType === "basic") return `${c.username}@${c.host}:${c.port}/${c.serviceName}`;
    return `${c.username}@${c.connectAlias}`;
  }

  function connSubtitle(c: ConnectionMeta): string {
    if (c.authType === "basic") return `${c.host}:${c.port} / ${c.serviceName}`;
    return c.connectAlias;
  }
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<main>
  <header>
    <div class="brand">
      <img class="logo" src="/veesker-logo.png" alt="" width="52" height="52" />
      <div class="brand-text">
        <h1>veesker</h1>
        <p class="tagline">Oracle Studio</p>
      </div>
    </div>
    <button class="new-btn" onclick={() => goto("/connections/new")}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <line x1="7" y1="2" x2="7" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      New connection
    </button>
  </header>

  <div class="section-label">
    {#if !loading && !error}
      {connections.length === 0 ? "No connections" : `${connections.length} connection${connections.length === 1 ? "" : "s"}`}
    {:else if loading}
      &nbsp;
    {:else}
      &nbsp;
    {/if}
  </div>

  {#if loading}
    <div class="loading-row">
      <span class="spinner"></span>
      <span class="muted">Loading…</span>
    </div>
  {:else if error}
    <div class="alert">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/>
        <line x1="8" y1="5" x2="8" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="8" cy="11.5" r="0.75" fill="currentColor"/>
      </svg>
      <span>{error}</span>
    </div>
  {:else if connections.length === 0}
    <div class="empty-state">
      <div class="empty-icon" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <ellipse cx="20" cy="14" rx="14" ry="6" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
          <path d="M6 14v12c0 3.3 6.3 6 14 6s14-2.7 14-6V14" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
          <line x1="20" y1="22" x2="20" y2="30" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
          <line x1="16" y1="26" x2="24" y2="26" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
        </svg>
      </div>
      <p class="empty-title">No connections yet</p>
      <p class="empty-sub">Add your first Oracle database connection to get started.</p>
      <button class="new-btn" onclick={() => goto("/connections/new")}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <line x1="7" y1="2" x2="7" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        New connection
      </button>
    </div>
  {:else}
    <ul class="list">
      {#each connections as c (c.id)}
        <li
          class="card"
          role="button"
          tabindex="0"
          onclick={() => goto(`/workspace/${c.id}`)}
          onkeydown={(e) => { if (e.key === "Enter") goto(`/workspace/${c.id}`); }}
        >
          <div class="card-icon" class:wallet={c.authType === "wallet"}>
            {#if c.authType === "wallet"}
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="2" y="5" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
                <path d="M2 9h16" stroke="currentColor" stroke-width="1.5"/>
                <circle cx="14" cy="13" r="1.5" fill="currentColor"/>
                <path d="M5 3l3-1 3 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            {:else}
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <ellipse cx="10" cy="7" rx="7" ry="3" stroke="currentColor" stroke-width="1.5"/>
                <path d="M3 7v6c0 1.7 3.1 3 7 3s7-1.3 7-3V7" stroke="currentColor" stroke-width="1.5"/>
                <path d="M3 10c0 1.7 3.1 3 7 3s7-1.3 7-3" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2"/>
              </svg>
            {/if}
          </div>
          <div class="card-body">
            <div class="card-name">{c.name}</div>
            <div class="card-meta">
              <span class="card-user mono">{c.username}</span>
              <span class="card-sep">·</span>
              <span class="card-host mono">{connSubtitle(c)}</span>
              {#if c.authType === "wallet"}
                <span class="badge-wallet">wallet</span>
              {/if}
            </div>
          </div>
          <div class="card-actions" role="none">
            <button
              class="action-btn edit"
              title="Edit"
              aria-label="Edit {c.name}"
              onclick={(e) => { e.stopPropagation(); goto(`/connections/${c.id}/edit`); }}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <path d="M9 2L11 4L5 10H3V8L9 2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
              </svg>
              Edit
            </button>
            <button
              class="action-btn delete"
              title="Delete"
              aria-label="Delete {c.name}"
              onclick={(e) => onDelete(e, c)}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2 3h8M5 3V2h2v1M10 3l-.6 7.5A1 1 0 018.4 11H3.6a1 1 0 01-1-.5L2 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <span class="open-arrow" aria-hidden="true">→</span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f6f1e8;
    color: #1a1612;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  main {
    max-width: 680px;
    margin: 0 auto;
    padding: 3rem 2rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* ── Header ─────────────────────────────────────────────── */
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2.5rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .logo {
    width: 52px;
    height: 52px;
    border-radius: 12px;
    display: block;
    box-shadow: 0 2px 8px rgba(26, 22, 18, 0.12);
  }
  .brand-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  h1 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 600;
    font-size: 32px;
    letter-spacing: 0.01em;
    margin: 0;
    line-height: 1;
    color: #1a1612;
  }
  .tagline {
    font-family: "Space Grotesk", sans-serif;
    font-size: 12px;
    color: rgba(26, 22, 18, 0.45);
    margin: 0;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .new-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    background: #1a1612;
    color: #f6f1e8;
    border: none;
    border-radius: 8px;
    padding: 0.65rem 1.1rem;
    font-family: "Space Grotesk", sans-serif;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .new-btn:hover { background: #b33e1f; }

  /* ── Section label ────────────────────────────────────────── */
  .section-label {
    font-family: "Space Grotesk", sans-serif;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(26, 22, 18, 0.4);
    margin-bottom: 0.6rem;
  }

  /* ── Loading ─────────────────────────────────────────────── */
  .loading-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 1.5rem 0;
  }
  .spinner {
    width: 14px; height: 14px;
    border: 2px solid rgba(26, 22, 18, 0.12);
    border-top-color: #1a1612;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .muted { color: rgba(26, 22, 18, 0.5); font-size: 13px; }

  /* ── Alert ───────────────────────────────────────────────── */
  .alert {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: rgba(179, 62, 31, 0.07);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.2);
    border-radius: 8px;
    padding: 0.85rem 1rem;
    font-size: 13px;
  }

  /* ── Empty state ─────────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.6rem;
    padding: 4rem 2rem;
    color: rgba(26, 22, 18, 0.5);
  }
  .empty-icon {
    color: rgba(26, 22, 18, 0.3);
    margin-bottom: 0.5rem;
  }
  .empty-title {
    font-family: "Space Grotesk", sans-serif;
    font-size: 16px;
    font-weight: 500;
    color: rgba(26, 22, 18, 0.65);
    margin: 0;
  }
  .empty-sub {
    font-size: 13px;
    color: rgba(26, 22, 18, 0.4);
    margin: 0 0 0.75rem;
    max-width: 280px;
    line-height: 1.5;
  }

  /* ── Connection list ─────────────────────────────────────── */
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.1rem;
    background: #fff;
    border: 1px solid rgba(26, 22, 18, 0.1);
    border-radius: 10px;
    cursor: pointer;
    transition: border-color 0.12s, box-shadow 0.12s, transform 0.1s;
    user-select: none;
  }
  .card:hover {
    border-color: rgba(26, 22, 18, 0.22);
    box-shadow: 0 2px 10px rgba(26, 22, 18, 0.07);
    transform: translateY(-1px);
  }
  .card:active {
    transform: translateY(0);
    box-shadow: none;
  }
  .card:focus-visible {
    outline: 2px solid #b33e1f;
    outline-offset: 2px;
  }

  /* ── Card icon ───────────────────────────────────────────── */
  .card-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: rgba(26, 22, 18, 0.06);
    color: rgba(26, 22, 18, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.12s;
  }
  .card:hover .card-icon {
    background: rgba(179, 62, 31, 0.1);
    color: #b33e1f;
  }
  .card-icon.wallet {
    background: rgba(142, 68, 173, 0.08);
    color: #8e44ad;
  }
  .card:hover .card-icon.wallet {
    background: rgba(142, 68, 173, 0.14);
    color: #8e44ad;
  }

  /* ── Card body ───────────────────────────────────────────── */
  .card-body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .card-name {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 15px;
    color: #1a1612;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-meta {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 11.5px;
    color: rgba(26, 22, 18, 0.5);
    white-space: nowrap;
    overflow: hidden;
  }
  .mono { font-family: "JetBrains Mono", "SF Mono", monospace; }
  .card-sep { opacity: 0.4; }
  .card-host {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge-wallet {
    font-family: "Space Grotesk", sans-serif;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    background: rgba(142, 68, 173, 0.1);
    color: #8e44ad;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  /* ── Card actions ────────────────────────────────────────── */
  .card-actions {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
  }
  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: transparent;
    border: 1px solid rgba(26, 22, 18, 0.12);
    border-radius: 5px;
    padding: 0.3rem 0.55rem;
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    color: rgba(26, 22, 18, 0.6);
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .action-btn.edit:hover {
    background: rgba(26, 22, 18, 0.06);
    color: #1a1612;
    border-color: rgba(26, 22, 18, 0.2);
  }
  .action-btn.delete {
    border-color: transparent;
    padding: 0.3rem 0.4rem;
  }
  .action-btn.delete:hover {
    background: rgba(179, 62, 31, 0.08);
    color: #b33e1f;
    border-color: rgba(179, 62, 31, 0.2);
  }
  .open-arrow {
    font-size: 15px;
    color: rgba(26, 22, 18, 0.25);
    margin-left: 0.25rem;
    transition: color 0.12s, transform 0.12s;
    line-height: 1;
  }
  .card:hover .open-arrow {
    color: #b33e1f;
    transform: translateX(2px);
  }
</style>
