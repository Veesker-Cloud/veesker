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

  async function onDelete(c: ConnectionMeta) {
    if (!confirm(`Delete "${c.name}"?`)) return;
    const res = await deleteConnection(c.id);
    if (!res.ok) {
      alert(`Delete failed: ${res.error.message}`);
      return;
    }
    await refresh();
  }
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Inter:wght@400;500;600&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<main>
  <header>
    <div class="brand">
      <img class="logo" src="/veesker-logo.png" alt="" width="48" height="48" />
      <h1>veesker</h1>
    </div>
    <p class="tagline">connections</p>
  </header>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if error}
    <div class="status err">
      <strong>Failed to load.</strong>
      <span>{error}</span>
    </div>
  {:else if connections.length === 0}
    <div class="empty">
      <p>No saved connections yet.</p>
      <button onclick={() => goto("/connections/new")}>+ New connection</button>
    </div>
  {:else}
    <ul class="list">
      {#each connections as c (c.id)}
        <li>
          <div class="info">
            <div class="title-row">
              <strong>{c.name}</strong>
              {#if c.authType === "wallet"}
                <span class="badge">wallet</span>
              {/if}
            </div>
            {#if c.authType === "basic"}
              <span class="meta">{c.username}@{c.host}:{c.port}/{c.serviceName}</span>
            {:else}
              <span class="meta">{c.username}@{c.connectAlias}</span>
            {/if}
          </div>
          <div class="actions">
            <button class="primary small" onclick={() => goto(`/workspace/${c.id}`)}>Open</button>
            <button class="ghost" onclick={() => goto(`/connections/${c.id}/edit`)}>Edit</button>
            <button class="ghost danger" onclick={() => onDelete(c)}>Delete</button>
          </div>
        </li>
      {/each}
    </ul>
    <button class="primary" onclick={() => goto("/connections/new")}>+ New connection</button>
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
    max-width: 640px;
    margin: 0 auto;
    padding: 4rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }
  .logo {
    width: 48px;
    height: 48px;
    border-radius: 10px;
    display: block;
  }
  h1 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 40px;
    letter-spacing: 0.02em;
    margin: 0;
    line-height: 1;
  }
  .tagline {
    font-family: "Space Grotesk", sans-serif;
    font-size: 14px;
    color: rgba(26, 22, 18, 0.6);
    font-style: italic;
    margin: 0;
  }
  .muted {
    color: rgba(26, 22, 18, 0.5);
    font-size: 13px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: flex-start;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.25rem;
    background: #fff;
    border: 1px solid rgba(26, 22, 18, 0.1);
    border-radius: 8px;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .info strong {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 16px;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .badge {
    font-family: "Space Grotesk", sans-serif;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: rgba(179, 62, 31, 0.12);
    color: #7a2a14;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
  }
  .meta {
    font-size: 12px;
    color: rgba(26, 22, 18, 0.55);
    font-family: "JetBrains Mono", "SF Mono", monospace;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  button {
    font-family: "Space Grotesk", sans-serif;
    font-size: 13px;
    font-weight: 500;
    border-radius: 6px;
    padding: 0.55rem 0.9rem;
    cursor: pointer;
  }
  button.ghost {
    background: transparent;
    color: #1a1612;
    border: 1px solid rgba(26, 22, 18, 0.2);
  }
  button.ghost.danger:hover {
    background: #b33e1f;
    color: #f6f1e8;
    border-color: #b33e1f;
  }
  button.primary {
    align-self: flex-start;
    background: #1a1612;
    color: #f6f1e8;
    border: none;
    padding: 0.85rem 1.25rem;
  }
  button.primary:hover {
    background: #b33e1f;
  }
  button.primary.small {
    align-self: auto;
    padding: 0.5rem 0.85rem;
    font-size: 12px;
  }
  .empty button {
    background: #1a1612;
    color: #f6f1e8;
    border: none;
    padding: 0.85rem 1.25rem;
  }
  .empty button:hover {
    background: #b33e1f;
  }
  .status.err {
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
    padding: 0.85rem 1rem;
    border-radius: 6px;
  }
</style>
