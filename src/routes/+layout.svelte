<script lang="ts">
  import "../app.css";
  import { theme } from "$lib/stores/theme.svelte";
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import HelpModal from "$lib/workspace/HelpModal.svelte";
  import UpdateNotification from "$lib/workspace/UpdateNotification.svelte";
  import CommercialUseModal from "$lib/workspace/CommercialUseModal.svelte";
  import PluginManagerPanel from "$lib/workspace/PluginManagerPanel.svelte";
  import { license } from "$lib/stores/license.svelte";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
  let showHelp = $state(false);
  let showCommercialModal = $state(license.needsFirstLaunchPrompt);
  let showPluginManager = $state(false);

  onMount(() => {
    const unlistenHelp = listen("open-help", () => { showHelp = true; });
    const unlistenPlugins = listen("open-plugins", () => { showPluginManager = true; });
    return () => {
      unlistenHelp.then((fn) => fn());
      unlistenPlugins.then((fn) => fn());
    };
  });

  $effect(() => {
    document.documentElement.dataset.theme = theme.current;
  });
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
    rel="stylesheet"
  />
</svelte:head>

{@render children()}

{#if showHelp}
  <HelpModal onClose={() => { showHelp = false; }} />
{/if}

<UpdateNotification />

{#if showCommercialModal}
  <CommercialUseModal onClose={() => { showCommercialModal = false; }} />
{/if}

{#if showPluginManager}
  <PluginManagerPanel onClose={() => { showPluginManager = false; }} />
{/if}
