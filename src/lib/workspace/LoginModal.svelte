<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/Veesker-Cloud/veesker
-->

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onDestroy } from "svelte";
  import { applyFeatureFlags } from "$lib/services/features";
  import SubscribeModal from "./SubscribeModal.svelte";

  type Props = { onClose: () => void };
  let { onClose }: Props = $props();

  let showSubscribe = $state(false);

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
          // If no active subscription, show upgrade modal before closing
          const meRes = await fetch("https://api.veesker.cloud/v1/auth/me", {
            headers: { Authorization: `Bearer ${data.token}` },
          }).catch(() => null);
          if (meRes?.ok) {
            const me = await meRes.json().catch(() => ({}));
            if (me?.org?.subscription_status !== "active" && me?.org?.subscription_status !== "trialing") {
              showSubscribe = true;
              return;
            }
          }
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

{#if showSubscribe}
  <SubscribeModal onClose={onClose} />
{:else}
<div class="backdrop" role="presentation" onclick={handleClose}>
  <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
    <button class="close-btn" aria-label="Close" onclick={handleClose}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    </button>

    <div class="logo-wrap">
      <img src="/veesker-cloud-logo.png" class="logo" alt="Veesker Cloud" />
    </div>

    {#if authState === "idle"}
      <h2>Sign in to Veesker Cloud</h2>
      <p class="lead">Schema-aware AI that knows your database — no API key required.</p>

      <div class="features">
        <span class="feat">✦ AI Query Assistant</span>
        <span class="feat">✦ Smart Charts</span>
        <span class="feat">✦ Team Audit Logs</span>
      </div>

      <div class="field-wrap">
        <input
          class="email-input"
          type="email"
          placeholder="you@company.com"
          bind:value={email}
          onkeydown={(e) => e.key === "Enter" && sendLink()}
          autocomplete="email"
          spellcheck={false}
        />
      </div>

      <div class="actions">
        <button class="btn primary" onclick={sendLink} disabled={!email.trim()}>
          Send sign-in link
        </button>
        <button class="btn ce" onclick={handleClose}>
          <img src="/ce-logo.png" class="ce-icon" alt="" aria-hidden="true" />
          Continue with CE
        </button>
      </div>

    {:else if authState === "waiting"}
      <h2>Check your email</h2>
      <p class="lead">We sent a sign-in link to <strong>{email}</strong>.<br/>Click it in your browser, then return here.</p>
      <div class="pulse-wrap" aria-label="Waiting for authentication">
        <div class="pulse-ring"></div>
        <div class="pulse-dot"></div>
      </div>
      <p class="waiting-hint">Waiting for confirmation…</p>
      <button class="btn ghost" onclick={retry}>Use a different email</button>

    {:else}
      <div class="error-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="13" stroke="#ef4444" stroke-width="1.5"/>
          <path d="M14 8v7" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>
          <circle cx="14" cy="19.5" r="1.25" fill="#ef4444"/>
        </svg>
      </div>
      <h2>Something went wrong</h2>
      <p class="lead error-text">{errorMessage}</p>
      <div class="actions">
        <button class="btn primary" onclick={retry}>Try again</button>
        <button class="btn ce" onclick={handleClose}>
          <img src="/ce-logo.png" class="ce-icon" alt="" aria-hidden="true" />
          Continue with CE
        </button>
      </div>
    {/if}
  </div>
</div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: linear-gradient(160deg, #1a1a22 0%, #141418 100%);
    border: 1px solid rgba(43, 180, 238, 0.18);
    border-radius: 20px;
    padding: 40px 36px 36px;
    max-width: 420px;
    width: 90%;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.04),
      0 24px 64px rgba(0, 0, 0, 0.6),
      0 0 80px rgba(43, 180, 238, 0.06);
  }

  .close-btn {
    position: absolute; top: 16px; right: 16px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .close-btn:hover { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); }

  .logo-wrap {
    width: 72px; height: 72px;
    border-radius: 18px;
    overflow: hidden;
    border: 1px solid rgba(43, 180, 238, 0.2);
    box-shadow: 0 0 24px rgba(43, 180, 238, 0.15);
    margin-bottom: 4px;
    flex-shrink: 0;
  }
  .logo {
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
  }

  h2 {
    margin: 0;
    font-family: "Space Grotesk", sans-serif;
    font-size: 21px;
    font-weight: 700;
    color: #fff;
    text-align: center;
    letter-spacing: -0.01em;
  }

  .lead {
    margin: 0;
    color: rgba(255,255,255,0.45);
    font-size: 13.5px;
    text-align: center;
    line-height: 1.6;
  }
  .lead strong { color: rgba(255,255,255,0.7); font-weight: 500; }
  .error-text { color: #f87171; }

  .features {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
    margin: 2px 0;
  }
  .feat {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: #2bb4ee;
    background: rgba(43, 180, 238, 0.1);
    border: 1px solid rgba(43, 180, 238, 0.2);
    border-radius: 20px;
    padding: 3px 10px;
  }

  .field-wrap {
    width: 100%;
  }
  .email-input {
    width: 100%;
    box-sizing: border-box;
    padding: 11px 14px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.05);
    color: #fff;
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
    font-family: inherit;
  }
  .email-input::placeholder { color: rgba(255,255,255,0.25); }
  .email-input:focus {
    border-color: rgba(43, 180, 238, 0.5);
    box-shadow: 0 0 0 3px rgba(43, 180, 238, 0.1);
  }

  .actions { display: flex; flex-direction: column; gap: 8px; width: 100%; }

  .btn {
    width: 100%;
    padding: 11px 0;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    font-family: "Space Grotesk", sans-serif;
    transition: background 0.15s, opacity 0.15s, box-shadow 0.15s;
    letter-spacing: 0.01em;
  }
  .btn:disabled { opacity: 0.38; cursor: not-allowed; }

  .btn.primary {
    background: #2bb4ee;
    color: #fff;
    border: none;
    box-shadow: 0 4px 16px rgba(43, 180, 238, 0.3);
  }
  .btn.primary:hover:not(:disabled) {
    background: #40bdee;
    box-shadow: 0 4px 24px rgba(43, 180, 238, 0.45);
  }

  .btn.ce {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: rgba(179, 62, 31, 0.12);
    color: #e05a2b;
    border: 1px solid rgba(179, 62, 31, 0.3);
    box-shadow: 0 4px 16px rgba(179, 62, 31, 0.15);
  }
  .btn.ce:hover {
    background: rgba(179, 62, 31, 0.2);
    border-color: rgba(179, 62, 31, 0.5);
    box-shadow: 0 4px 24px rgba(179, 62, 31, 0.28);
  }
  .ce-icon {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }

  /* Pulse animation for waiting state */
  .pulse-wrap {
    position: relative;
    width: 52px; height: 52px;
    display: flex; align-items: center; justify-content: center;
    margin: 6px 0 2px;
  }
  .pulse-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid rgba(43, 180, 238, 0.4);
    animation: pulse-out 1.6s ease-out infinite;
  }
  .pulse-dot {
    width: 20px; height: 20px;
    border-radius: 50%;
    background: #2bb4ee;
    box-shadow: 0 0 12px rgba(43, 180, 238, 0.6);
  }
  @keyframes pulse-out {
    0%   { transform: scale(0.8); opacity: 0.8; }
    100% { transform: scale(1.8); opacity: 0; }
  }

  .waiting-hint {
    margin: 0;
    font-size: 12px;
    color: rgba(255,255,255,0.3);
    text-align: center;
  }

  .error-icon { margin-bottom: 2px; }
</style>
