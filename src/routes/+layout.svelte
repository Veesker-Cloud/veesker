<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/gevianajr/veesker
-->

<script lang="ts">
  import "../app.css";
  import { theme } from "$lib/stores/theme.svelte";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { listen } from "@tauri-apps/api/event";
  import AboutDialog from "$lib/workspace/AboutDialog.svelte";
  import HelpModal from "$lib/workspace/HelpModal.svelte";
  import UpdateNotification from "$lib/workspace/UpdateNotification.svelte";
  import CommercialUseModal from "$lib/workspace/CommercialUseModal.svelte";
  import PluginManagerPanel from "$lib/workspace/PluginManagerPanel.svelte";
  import VisualFlowPanel from "$lib/workspace/VisualFlowPanel.svelte";
  import { license } from "$lib/stores/license.svelte";
  import type { Snippet } from "svelte";
  import { initAuth } from "$lib/services/auth";

  let { children }: { children: Snippet } = $props();
  let showAbout = $state(false);
  let showHelp = $state(false);
  let showCommercialModal = $state(license.needsFirstLaunchPrompt);
  let showPluginManager = $state(false);

  onMount(() => {
    void initAuth();
    const unlistenAbout = listen("open-about", () => { showAbout = true; });
    const unlistenHelp = listen("open-help", () => { showHelp = true; });
    const unlistenPlugins = listen("open-plugins", () => { showPluginManager = true; });
    const unlistenNewConn = listen("menu-new-connection", () => { void goto("/connections/new"); });
    const unlistenTrayOpen = listen<string>("tray-open-connection", (e) => {
      if (e.payload) void goto(`/workspace/${e.payload}`);
    });
    const unlistenTrayDisconnect = listen("tray-disconnect", () => { void goto("/"); });
    return () => {
      unlistenAbout.then((fn) => fn());
      unlistenHelp.then((fn) => fn());
      unlistenPlugins.then((fn) => fn());
      unlistenNewConn.then((fn) => fn());
      unlistenTrayOpen.then((fn) => fn());
      unlistenTrayDisconnect.then((fn) => fn());
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
    href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
    rel="stylesheet"
  />
</svelte:head>

{@render children()}

{#if showAbout}
  <AboutDialog onClose={() => { showAbout = false; }} />
{/if}

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
<VisualFlowPanel />
