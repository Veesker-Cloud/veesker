<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/Veesker-Cloud/veesker
-->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onDestroy } from "svelte";
  import { applyFeatureFlags } from "$lib/services/features";

  type Props = { onClose: () => void };
  let { onClose }: Props = $props();

  type AuthState = "idle" | "waiting" | "error";
  let authState: AuthState = $state("idle");
  let email = $state("");
  let errorMessage = $state("");
  let polling = false;

  async function sendLink() {
    if (!email.trim()) return;
    const sessionId = crypto.randomUUID();
    try {
      const res = await fetch("https://api.veesker.cloud/v1/auth/magic-link/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), session_id: sessionId }),
      });
      if (!res.ok) throw new Error("send_failed");
      authState = "waiting";
      startPoll(sessionId);
    } catch {
      authState = "error";
      errorMessage = "Failed to send email. Please try again.";
    }
  }

  async function startPoll(sessionId: string) {
    polling = true;
    const deadline = Date.now() + 5 * 60 * 1000;
    while (polling && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));
      if (!polling) break;
      try {
        const res = await fetch(`https://api.veesker.cloud/v1/auth/poll/${sessionId}`);
        const data = await res.json();
        if (data.status === "authenticated") {
          await invoke("auth_token_set", { token: data.token });
          localStorage.setItem("veesker:features", JSON.stringify(data.features));
          applyFeatureFlags(data.features);
          polling = false;
          onClose();
          return;
        }
        if (data.status === "expired") {
          polling = false;
          authState = "error";
          errorMessage = "Link expired. Please try again.";
          return;
        }
      } catch {
        // network hiccup — keep polling
      }
    }
    if (polling) {
      polling = false;
      authState = "error";
      errorMessage = "Timed out waiting. Please try again.";
    }
  }

  function retry() {
    polling = false;
    authState = "idle";
    errorMessage = "";
  }

  function handleClose() {
    polling = false;
    onClose();
  }

  onDestroy(() => { polling = false; });
</script>

<div class="modal-backdrop" role="presentation" onclick={handleClose}>
  <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
    <button class="close-btn" aria-label="Close" onclick={handleClose}>✕</button>

    {#if authState === "idle"}
      <div class="cloud-icon">☁</div>
      <h2>Sign in to Veesker Cloud</h2>
      <p class="lead">Schema-aware AI that knows your database — no API key required.</p>
      <input
        class="email-input"
        type="email"
        placeholder="you@company.com"
        bind:value={email}
        onkeydown={(e) => e.key === "Enter" && sendLink()}
      />
      <div class="actions">
        <button class="btn primary" onclick={sendLink} disabled={!email.trim()}>Send sign-in link</button>
        <button class="btn" onclick={handleClose}>Continue with CE</button>
      </div>

    {:else if authState === "waiting"}
      <div class="cloud-icon">☁</div>
      <h2>Check your email</h2>
      <p class="lead">We sent a sign-in link to <strong>{email}</strong>. Click it in your browser, then return here.</p>
      <div class="spinner" aria-label="Waiting for authentication"></div>
      <button class="btn" onclick={retry}>Use a different email</button>

    {:else}
      <div class="cloud-icon error-icon">⚠</div>
      <h2>Something went wrong</h2>
      <p class="lead error-text">{errorMessage}</p>
      <div class="actions">
        <button class="btn primary" onclick={retry}>Try again</button>
        <button class="btn" onclick={handleClose}>Continue with CE</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 32px;
    max-width: 420px;
    width: 90%;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .close-btn {
    position: absolute; top: 14px; right: 14px;
    background: none; border: none;
    color: var(--text-muted); cursor: pointer; font-size: 16px;
  }
  .cloud-icon { font-size: 36px; text-align: center; }
  .error-icon { filter: grayscale(0.5); }
  h2 { margin: 0; font-size: 22px; text-align: center; }
  .lead { margin: 0; color: var(--text-muted); font-size: 14px; text-align: center; line-height: 1.6; }
  .error-text { color: #f87171; }
  .email-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-surface-alt);
    color: var(--text-primary);
    font-size: 14px;
    outline: none;
  }
  .email-input:focus { border-color: #2bb4ee; }
  .actions { display: flex; gap: 10px; }
  .btn {
    flex: 1; padding: 10px 0; border-radius: 8px;
    font-size: 14px; font-weight: 600; cursor: pointer;
    border: 1px solid var(--border); background: var(--bg-surface-alt);
    color: var(--text-primary);
  }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn.primary {
    background: #2bb4ee; color: #fff; border-color: #2bb4ee;
  }
  .spinner {
    width: 32px; height: 32px;
    border: 3px solid var(--border);
    border-top-color: #2bb4ee;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
