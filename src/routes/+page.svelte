<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/gevianajr/veesker
-->

<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount, getContext } from "svelte";
  import {
    listConnections,
    deleteConnection,
    type ConnectionMeta,
  } from "$lib/connections";
  import { ask, message } from "@tauri-apps/plugin-dialog";
  import { logout } from "$lib/services/auth";
  import LoginModal from "$lib/workspace/LoginModal.svelte";

  const authCtx = getContext<{ tier: "ce" | "cloud"; email: string }>("auth");

  let connections = $state<ConnectionMeta[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let deletingId = $state<string | null>(null);
  let query = $state("");
  let authFilter = $state<"all" | "basic" | "wallet">("all");
  let showLogin = $state(false);
  let showAccountMenu = $state(false);

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return connections.filter((c) => {
      if (authFilter !== "all" && c.authType !== authFilter) return false;
      if (!q) return true;
      const haystack = c.authType === "basic"
        ? `${c.name} ${c.username} ${c.host} ${c.serviceName}`
        : `${c.name} ${c.username} ${c.connectAlias}`;
      return haystack.toLowerCase().includes(q);
    });
  });

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

  async function handleLogout() {
    await logout();
    authCtx.tier = "ce";
    authCtx.email = "";
  }

  async function onDelete(e: MouseEvent, c: ConnectionMeta) {
    e.stopPropagation();
    if (deletingId) return;
    if (!await ask(`Delete "${c.name}"?`, { title: "Delete connection", kind: "warning" })) return;
    deletingId = c.id;
    try {
      const res = await deleteConnection(c.id);
      if (!res.ok) {
        await message(`Delete failed: ${res.error.message}`, { title: "Error", kind: "error" });
        return;
      }
      await refresh();
    } finally {
      deletingId = null;
    }
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

<main>
  <img
    src={authCtx.tier === "cloud" ? "/veesker-cloud-logo.png" : "/ce-logo.png"}
    class="home-watermark" alt="" aria-hidden="true"
  />
  <header>
    <div class="brand">
      <img
        src={authCtx.tier === "cloud" ? "/veesker-cloud-logo.png" : "/ce-logo.png"}
        class="brand-logo"
        alt={authCtx.tier === "cloud" ? "Veesker Cloud" : "Veesker CE"}
      />
      <div class="brand-text">
        <h1>veesker</h1>
        {#if authCtx.tier === "cloud"}
          <p class="tagline tagline-cloud">Cloud</p>
        {:else}
          <p class="tagline">Community Edition</p>
        {/if}
      </div>
    </div>
    <div class="header-actions">
      {#if authCtx.tier === "cloud"}
        <div class="cloud-menu-wrap">
          <button
            class="cloud-badge-btn"
            onclick={() => { showAccountMenu = !showAccountMenu; }}
            aria-expanded={showAccountMenu}
            aria-haspopup="true"
          >
            <img src="/veesker-cloud-logo.png" class="cloud-btn-icon" alt="" aria-hidden="true" />
            <span class="cloud-account-email">{authCtx.email || "Cloud"}</span>
            <svg class="chevron" class:open={showAccountMenu} width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          {#if showAccountMenu}
            <div class="account-dropdown" role="menu">
              <a
                class="dropdown-item"
                href="https://billing.stripe.com/p/login/test_00g4j60Av0c89TieUU"
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                onclick={() => { showAccountMenu = false; }}
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                  <rect x="1" y="3" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
                  <path d="M1 6h11" stroke="currentColor" stroke-width="1.3"/>
                </svg>
                Manage billing
              </a>
              <button
                class="dropdown-item dropdown-item--danger"
                role="menuitem"
                onclick={() => { showAccountMenu = false; handleLogout(); }}
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                  <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h3M9 9l3-2.5L9 4M4 6.5h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Sign out
              </button>
            </div>
            <div class="dropdown-backdrop" role="presentation" onclick={() => { showAccountMenu = false; }}></div>
          {/if}
        </div>
      {:else}
        <button class="cloud-signin" onclick={() => { showLogin = true; }}>
          <img src="/veesker-cloud-logo.png" class="cloud-btn-icon" alt="" aria-hidden="true" />
          Sign in to Cloud
        </button>
      {/if}
      <button class="new-btn" onclick={() => goto("/connections/new")}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <line x1="7" y1="2" x2="7" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        New connection
      </button>
    </div>
  </header>

  {#if !loading && !error && connections.length > 0}
    <div class="filter-bar">
      <div class="search-wrap">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="4.2" stroke="currentColor" stroke-width="1.4"/>
          <path d="M9.2 9.2l3.3 3.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <input
          type="search"
          class="search-input"
          placeholder="Filter connections by name, user, host…"
          bind:value={query}
          autocomplete="off"
          spellcheck={false}
        />
        {#if query}
          <button
            class="clear-btn"
            title="Clear"
            aria-label="Clear search"
            onclick={() => { query = ""; }}
          >×</button>
        {/if}
      </div>
      <div class="auth-filter" role="tablist" aria-label="Auth type filter">
        <button class="chip" class:chip-on={authFilter === "all"}    role="tab" aria-selected={authFilter === "all"}    onclick={() => authFilter = "all"}>All</button>
        <button class="chip" class:chip-on={authFilter === "basic"}  role="tab" aria-selected={authFilter === "basic"}  onclick={() => authFilter = "basic"}>Basic</button>
        <button class="chip" class:chip-on={authFilter === "wallet"} role="tab" aria-selected={authFilter === "wallet"} onclick={() => authFilter = "wallet"}>Wallet</button>
      </div>
    </div>
  {/if}

  <div class="section-label">
    {#if !loading && !error}
      {#if connections.length === 0}
        No connections
      {:else if filtered.length === connections.length}
        {connections.length} connection{connections.length === 1 ? "" : "s"}
      {:else}
        {filtered.length} of {connections.length}
      {/if}
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
  {:else if filtered.length === 0}
    <div class="empty-filter">
      <span class="muted">No connections match the current filter.</span>
      <button class="link-btn" onclick={() => { query = ""; authFilter = "all"; }}>Clear filters</button>
    </div>
  {:else}
    <ul class="list" role="list">
      {#each filtered as c (c.id)}
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
        <li
          class="card"
          class:card-deleting={deletingId === c.id}
          onclick={() => { if (deletingId !== c.id) goto(`/workspace/${c.id}`); }}
          onkeydown={(e) => { if (e.key === "Enter" && deletingId !== c.id) goto(`/workspace/${c.id}`); }}
          tabindex={deletingId === c.id ? -1 : 0}
          role="button"
          aria-disabled={deletingId === c.id}
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
              disabled={deletingId === c.id}
              onclick={(e) => onDelete(e, c)}
            >
              {#if deletingId === c.id}
                <span class="action-spinner" aria-label="Deleting"></span>
              {:else}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2 3h8M5 3V2h2v1M10 3l-.6 7.5A1 1 0 018.4 11H3.6a1 1 0 01-1-.5L2 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              {/if}
            </button>
            <span class="open-arrow" aria-hidden="true">→</span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>

{#if showLogin}
  <LoginModal onClose={async () => {
    showLogin = false;
    const { invoke: inv } = await import("@tauri-apps/api/core");
    const token = await inv<string | null>("auth_token_get");
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        authCtx.tier = "cloud";
        authCtx.email = payload.email ?? "";
      } catch { /* ignore */ }
    }
  }} />
{/if}

<style>
  :global(body) {
    margin: 0;
    background: var(--bg-surface);
    color: var(--text-primary);
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
    position: relative;
  }
  .home-watermark {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 200px;
    height: 200px;
    object-fit: contain;
    opacity: 0.07;
    pointer-events: none;
    user-select: none;
    z-index: 0;
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
  .brand-logo {
    width: 52px;
    height: 52px;
    border-radius: 12px;
    object-fit: cover;
    display: block;
    box-shadow: 0 2px 8px rgba(26, 22, 18, 0.12);
  }
  .brand-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  h1 {
    font-family: "Bebas Neue", "Space Grotesk", sans-serif;
    font-weight: 400;
    font-size: 36px;
    letter-spacing: 0.06em;
    margin: 0;
    line-height: 1;
    color: var(--text-primary);
    text-transform: uppercase;
  }
  .tagline {
    font-family: "Space Grotesk", sans-serif;
    font-size: 12px;
    color: var(--text-muted);
    margin: 0;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .new-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    background: var(--text-primary);
    color: var(--bg-surface);
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
  .new-btn:hover { background: var(--accent); }

  .cloud-btn-icon {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .cloud-signin {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    background: rgba(43, 180, 238, 0.1);
    color: #2bb4ee;
    border: 1px solid rgba(43, 180, 238, 0.3);
    border-radius: 8px;
    padding: 0.6rem 1rem;
    font-family: "Space Grotesk", sans-serif;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .cloud-signin:hover {
    background: rgba(43, 180, 238, 0.18);
    border-color: rgba(43, 180, 238, 0.5);
  }

  .cloud-menu-wrap {
    position: relative;
  }
  .cloud-badge-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    background: rgba(43, 180, 238, 0.1);
    color: #2bb4ee;
    border: 1px solid rgba(43, 180, 238, 0.3);
    border-radius: 8px;
    padding: 0.55rem 0.8rem 0.55rem 0.6rem;
    font-family: "Space Grotesk", sans-serif;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .cloud-badge-btn:hover {
    background: rgba(43, 180, 238, 0.18);
    border-color: rgba(43, 180, 238, 0.5);
  }
  .cloud-account-email {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chevron {
    color: rgba(43, 180, 238, 0.6);
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  .chevron.open { transform: rotate(180deg); }

  .account-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 180px;
    background: var(--bg-surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    padding: 4px;
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem;
    border-radius: 7px;
    font-family: "Space Grotesk", sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    background: transparent;
    border: none;
    cursor: pointer;
    text-decoration: none;
    transition: background 0.1s;
    width: 100%;
    text-align: left;
  }
  .dropdown-item:hover { background: var(--row-hover); }
  .dropdown-item--danger { color: #ef4444; }
  .dropdown-item--danger:hover { background: rgba(239, 68, 68, 0.08); }

  .dropdown-backdrop {
    position: fixed;
    inset: 0;
    z-index: 199;
  }

  .tagline-cloud {
    color: #2bb4ee !important;
    font-weight: 600;
  }

  /* ── Deleting state ──────────────────────────────────────── */
  .card-deleting {
    opacity: 0.55;
    pointer-events: none;
  }
  .card-deleting .action-btn { pointer-events: auto; }
  .action-btn:disabled { opacity: 0.7; cursor: default; }
  .action-spinner {
    display: inline-block;
    width: 12px; height: 12px;
    border: 1.5px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.65s linear infinite;
  }

  /* ── Filter bar ──────────────────────────────────────────── */
  .filter-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  .search-wrap {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0 0.75rem;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .search-wrap:focus-within {
    border-color: var(--accent-border-focus);
    box-shadow: 0 0 0 3px var(--accent-shadow);
  }
  .search-icon { color: var(--text-muted); flex-shrink: 0; }
  .search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 13px;
    padding: 0.55rem 0;
    font-family: inherit;
  }
  .search-input::placeholder { color: var(--text-muted); }
  .clear-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: 0 0.25rem;
    border-radius: 3px;
  }
  .clear-btn:hover { color: var(--text-primary); }
  .auth-filter { display: flex; gap: 4px; flex-shrink: 0; }
  .chip {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 0.4rem 0.7rem;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
    font-family: inherit;
  }
  .chip:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .chip-on {
    background: var(--accent-muted);
    border-color: var(--accent-border-focus);
    color: var(--accent);
  }
  .empty-filter {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 0;
  }
  .link-btn {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 12px;
    text-decoration: underline;
    font-family: inherit;
    padding: 0;
  }
  .link-btn:hover { opacity: 0.8; }

  /* ── Section label ────────────────────────────────────────── */
  .section-label {
    font-family: "Space Grotesk", sans-serif;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
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
    border: 2px solid var(--border);
    border-top-color: var(--text-primary);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .muted { color: var(--text-secondary); font-size: 13px; }

  /* ── Alert ───────────────────────────────────────────────── */
  .alert {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: rgba(239, 68, 68, 0.07);
    color: #b91c1c;
    border: 1px solid rgba(239, 68, 68, 0.2);
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
    color: var(--text-secondary);
  }
  .empty-icon {
    color: var(--text-muted);
    margin-bottom: 0.5rem;
  }
  .empty-title {
    font-family: "Space Grotesk", sans-serif;
    font-size: 16px;
    font-weight: 500;
    color: var(--text-primary);
    margin: 0;
  }
  .empty-sub {
    font-size: 13px;
    color: var(--text-secondary);
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
    background: var(--bg-surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    cursor: pointer;
    transition: border-color 0.12s, box-shadow 0.12s, transform 0.1s;
    user-select: none;
  }
  .card:hover {
    background: var(--row-hover);
    border-color: var(--border-strong);
    box-shadow: 0 2px 10px rgba(26, 22, 18, 0.07);
    transform: translateY(-1px);
  }
  .card:active {
    transform: translateY(0);
    box-shadow: none;
  }
  .card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* ── Card icon ───────────────────────────────────────────── */
  .card-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--row-hover);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.12s;
  }
  .card:hover .card-icon {
    background: var(--accent-shadow);
    color: var(--accent);
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
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-meta {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 11.5px;
    color: var(--text-secondary);
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
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 0.3rem 0.55rem;
    font-family: "Space Grotesk", sans-serif;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    color: var(--text-secondary);
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .action-btn.edit:hover {
    background: var(--row-hover);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
  .action-btn.delete {
    border-color: transparent;
    padding: 0.3rem 0.4rem;
  }
  .action-btn.delete:hover {
    background: rgba(239, 68, 68, 0.08);
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.2);
  }
  .open-arrow {
    font-size: 15px;
    color: var(--text-muted);
    margin-left: 0.25rem;
    transition: color 0.12s, transform 0.12s;
    line-height: 1;
  }
  .card:hover .open-arrow {
    color: var(--accent);
    transform: translateX(2px);
  }
</style>
