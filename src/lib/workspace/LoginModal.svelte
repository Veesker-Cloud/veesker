<!--
  Copyright 2022-2026 Geraldo Ferreira Viana Júnior
  Licensed under the Apache License, Version 2.0
  https://github.com/Veesker-Cloud/veesker
-->

<script lang="ts">
  type Props = {
    onClose: () => void;
  };
  let { onClose }: Props = $props();

  function openPricing() {
    window.open("https://veesker.cloud/pricing", "_blank", "noopener,noreferrer");
  }
</script>

<div class="modal-backdrop" role="presentation" onclick={onClose}>
  <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
    <button class="close-btn" aria-label="Close" onclick={onClose}>✕</button>
    <div class="cloud-icon">☁</div>
    <h2>Veesker Cloud</h2>
    <p class="lead">Schema-aware AI that knows your database — no API key required.</p>
    <ul class="feature-list">
      <li>AI with live DB access (run_query, describe_object, get_ddl)</li>
      <li>Query optimization + performance analysis</li>
      <li>Charts via natural language</li>
      <li>Managed embeddings for vector search</li>
    </ul>
    <p class="coming-soon">Coming soon — sign up to get notified at launch.</p>
    <div class="actions">
      <button class="btn primary" onclick={openPricing}>See plans →</button>
      <button class="btn" onclick={onClose}>Continue with CE</button>
    </div>
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
    gap: 14px;
  }
  .close-btn {
    position: absolute; top: 14px; right: 14px;
    background: none; border: none;
    color: var(--text-muted); cursor: pointer; font-size: 16px;
  }
  .cloud-icon { font-size: 36px; text-align: center; }
  h2 { margin: 0; font-size: 22px; text-align: center; }
  .lead { margin: 0; color: var(--text-muted); font-size: 14px; text-align: center; }
  .feature-list {
    padding-left: 18px; margin: 0;
    color: var(--text-muted); font-size: 13px; line-height: 1.8;
  }
  .coming-soon {
    margin: 0; font-size: 12px;
    color: var(--text-muted); text-align: center;
    font-style: italic;
  }
  .actions { display: flex; gap: 10px; }
  .btn {
    flex: 1; padding: 10px 0; border-radius: 8px;
    font-size: 14px; font-weight: 600; cursor: pointer;
    border: 1px solid var(--border); background: var(--bg-surface-alt);
    color: var(--text-primary);
  }
  .btn.primary {
    background: var(--accent-text); color: #fff; border-color: var(--accent-text);
  }
</style>
