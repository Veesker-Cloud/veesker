<script lang="ts">
  import "../app.css";
  import { theme } from "$lib/stores/theme.svelte";
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import HelpModal from "$lib/workspace/HelpModal.svelte";
  import UpdateNotification from "$lib/workspace/UpdateNotification.svelte";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
  let showHelp = $state(false);

  $effect(() => {
    document.documentElement.dataset.theme = theme.current;
  });

  onMount(() => {
    const unlistenPromise = listen("open-help", () => {
      showHelp = true;
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
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
