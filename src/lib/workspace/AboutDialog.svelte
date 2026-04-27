<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/gevianajr/veesker
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import VeeskerMark from "$lib/VeeskerMark.svelte";

  let { onClose }: { onClose: () => void } = $props();

  let version = $state("…");

  onMount(async () => {
    version = await getVersion();
  });

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={handleKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={handleBackdrop}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="About Veesker">
    <div class="logo-row">
      <VeeskerMark size={48} />
      <div class="name-block">
        <h1>Veesker</h1>
        <span class="version">Version {version}</span>
      </div>
    </div>

    <p class="tagline">Oracle 23ai Vector Search Studio</p>

    <div class="section">
      <div class="label">Created by</div>
      <div class="value">Geraldo Ferreira Viana Júnior</div>
      <div class="links">
        <button onclick={() => openUrl("https://github.com/gevianajr/veesker")}>GitHub</button>
        <button onclick={() => openUrl("https://veesker.cloud")}>Website</button>
        <button onclick={() => openUrl("https://www.linkedin.com/in/geraldovianajr/")}>LinkedIn</button>
      </div>
    </div>

    <div class="section">
      <div class="label">License</div>
      <div class="value">Apache License, Version 2.0</div>
    </div>

    <div class="section trademark">
      "Veesker" and the Veesker sheep mascot are trademarks of Geraldo Ferreira Viana Júnior
      and are not covered by the Apache 2.0 license.
    </div>

    <div class="copyright">© 2022–2026 Geraldo Ferreira Viana Júnior</div>

    <button class="close-btn" onclick={onClose}>Close</button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9000;
  }

  .dialog {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 2rem;
    width: 360px;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .logo-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .name-block h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .version {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .tagline {
    margin: 0;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.875rem;
  }

  .label {
    font-weight: 600;
    color: var(--text-muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .value {
    color: var(--text-primary);
  }

  .links {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .links button {
    background: none;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.2rem 0.6rem;
    font-size: 0.8rem;
    color: var(--text-primary);
    cursor: pointer;
  }

  .links button:hover {
    background: var(--bg-surface-alt);
  }

  .trademark {
    color: var(--text-muted);
    font-size: 0.75rem;
    font-style: italic;
  }

  .copyright {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-align: center;
  }

  .close-btn {
    align-self: center;
    background: var(--bg-surface-alt);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 1.5rem;
    font-size: 0.875rem;
    color: var(--text-primary);
    cursor: pointer;
  }

  .close-btn:hover {
    background: var(--border);
  }
</style>
