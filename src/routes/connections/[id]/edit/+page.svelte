<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import ConnectionForm from "$lib/ConnectionForm.svelte";
  import {
    getConnection,
    saveConnection,
    type ConnectionInput,
  } from "$lib/connections";

  let initial = $state<ConnectionInput | null>(null);
  let passwordMissing = $state(false);
  let walletPasswordMissing = $state(false);
  let loadError = $state<string | null>(null);

  onMount(async () => {
    const id = page.params.id!;
    const res = await getConnection(id);
    if (!res.ok) {
      loadError = res.error.message;
      return;
    }
    const { meta, passwordSet, walletPasswordSet } = res.data;
    if (meta.authType === "basic") {
      initial = {
        authType: "basic",
        id: meta.id,
        name: meta.name,
        host: meta.host,
        port: meta.port,
        serviceName: meta.serviceName,
        username: meta.username,
        password: "",
      };
    } else {
      initial = {
        authType: "wallet",
        id: meta.id,
        name: meta.name,
        walletPassword: "",
        connectAlias: meta.connectAlias,
        username: meta.username,
        password: "",
      };
      walletPasswordMissing = !(walletPasswordSet ?? false);
    }
    passwordMissing = !passwordSet;
  });

  async function onSave(input: ConnectionInput) {
    const res = await saveConnection(input);
    if (!res.ok) return { ok: false as const, message: res.error.message };
    const id = res.data.id;
    await goto("/");
    return { ok: true as const, id };
  }

  function onCancel() {
    void goto("/");
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
    <h1>Edit connection</h1>
  </header>

  {#if loadError}
    <div class="status err">
      <strong>Failed to load.</strong>
      <span>{loadError}</span>
      <button onclick={() => goto("/")}>Back to list</button>
    </div>
  {:else if initial}
    <ConnectionForm
      {initial}
      submitLabel="Save"
      {passwordMissing}
      {walletPasswordMissing}
      isEdit={true}
      {onSave}
      {onCancel}
    />
  {:else}
    <p class="muted">Loading…</p>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    max-width: 480px;
    margin: 0 auto;
    padding: 4rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  h1 {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    font-size: 28px;
    letter-spacing: 0.02em;
    margin: 0;
    line-height: 1;
  }
  .muted {
    color: var(--text-secondary);
    font-size: 13px;
  }
  .status.err {
    background: rgba(179, 62, 31, 0.08);
    color: #7a2a14;
    border: 1px solid rgba(179, 62, 31, 0.3);
    padding: 0.85rem 1rem;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
</style>
