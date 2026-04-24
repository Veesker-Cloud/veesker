<script lang="ts">
  import { goto } from "$app/navigation";
  import ConnectionForm from "$lib/ConnectionForm.svelte";
  import { saveConnection, type ConnectionInput } from "$lib/connections";

  const initial: ConnectionInput = {
    authType: "basic",
    name: "",
    host: "localhost",
    port: 1521,
    serviceName: "FREEPDB1",
    username: "",
    password: "",
  };

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
    <h1>New connection</h1>
  </header>
  <ConnectionForm {initial} submitLabel="Save" {onSave} {onCancel} />
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
</style>
