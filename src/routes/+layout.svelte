<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/veesker-cloud/veesker-community-edition
-->

<script lang="ts">
  import "../app.css";
  import { theme } from "$lib/stores/theme.svelte";
  import { onMount, setContext } from "svelte";
  import { goto } from "$app/navigation";
  import { listen } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import AboutDialog from "$lib/workspace/AboutDialog.svelte";
  import HelpModal from "$lib/workspace/HelpModal.svelte";
  import UpdateNotification from "$lib/workspace/UpdateNotification.svelte";
  import CommercialUseModal from "$lib/workspace/CommercialUseModal.svelte";
  import PluginManagerPanel from "$lib/workspace/PluginManagerPanel.svelte";
  import VisualFlowPanel from "$lib/workspace/VisualFlowPanel.svelte";
  import { license } from "$lib/stores/license.svelte";
  import type { Snippet } from "svelte";
  import { initAuth } from "$lib/services/auth";
  import { CloudAuditService } from "$lib/services/CloudAuditService";
  import { FEATURES } from "$lib/services/features";

  let { children }: { children: Snippet } = $props();
  let showAbout = $state(false);
  let showHelp = $state(false);
  let showCommercialModal = $state(license.needsFirstLaunchPrompt);
  let showPluginManager = $state(false);

  export const authCtx = $state({ tier: "ce" as "ce" | "cloud", email: "" });
  setContext("auth", authCtx);

  function decodeJwtEmail(token: string): string {
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return typeof payload.email === "string" ? payload.email : "";
    } catch { return ""; }
  }

  onMount(() => {
    void (async () => {
      await initAuth();
      const token = await invoke<string | null>("auth_token_get");
      if (token) {
        authCtx.tier = "cloud";
        authCtx.email = decodeJwtEmail(token);
        void getCurrentWindow().setTitle("Veesker Cloud");
      }
      if (FEATURES.cloudAudit) CloudAuditService.start();
    })();

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

  $effect(() => {
    document.documentElement.dataset.tier = authCtx.tier;
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
