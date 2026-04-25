<script lang="ts">
  import { license, type UsageType } from "$lib/stores/license.svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";

  type Props = { onClose: () => void };
  let { onClose }: Props = $props();

  let selected = $state<UsageType>("unknown");

  function confirm() {
    if (selected === "unknown") return;
    license.setUsageType(selected);
    license.acknowledge();
    onClose();
  }

  function openPricing() {
    void openUrl("https://veesker.dev/pricing");
  }
</script>

<div
  class="modal-backdrop"
  role="presentation"
  onclick={onClose}
  onkeydown={(e) => e.key === "Escape" && onClose()}
>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <div class="head">
      <span class="title">Welcome to Veesker</span>
    </div>

    <div class="body">
      <p>Veesker is open source under Apache 2.0. The packaged desktop application has a tiered commercial-use policy:</p>

      <ul class="usage-list">
        <li>
          <strong>Free</strong> for personal use, open-source contributors, education, and companies with fewer than 50 employees and less than US$ 5M annual revenue.
        </li>
        <li>
          <strong>Paid subscription</strong> for organizations above those thresholds — see <button class="link" onclick={openPricing}>pricing</button>.
        </li>
      </ul>

      <p class="prompt">How will you be using Veesker?</p>

      <label class="choice" class:selected={selected === "personal"}>
        <input type="radio" bind:group={selected} value="personal" />
        <div>
          <span class="choice-title">Personal / small team</span>
          <span class="choice-desc">Individual use, open source, education, or a small company (under 50 employees and US$ 5M revenue)</span>
        </div>
      </label>

      <label class="choice" class:selected={selected === "commercial"}>
        <input type="radio" bind:group={selected} value="commercial" />
        <div>
          <span class="choice-title">Commercial use in a larger organization</span>
          <span class="choice-desc">Company with 50+ employees or US$ 5M+ revenue — a paid subscription is required for ongoing use</span>
        </div>
      </label>

      <p class="hint">
        This choice is honor-based — Veesker does not technically restrict features by tier. You can change it later in Settings.
        See <button class="link" onclick={() => void openUrl('https://github.com/geeviana/veesker/blob/main/COMMERCIAL_USE.md')}>COMMERCIAL_USE.md</button> for details.
      </p>
    </div>

    <div class="foot">
      <button class="btn primary" onclick={confirm} disabled={selected === "unknown"}>
        Continue
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center; z-index: 1300;
  }
  .modal {
    background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: 8px; width: 560px; max-width: 92vw;
    box-shadow: 0 12px 32px rgba(0,0,0,0.4);
  }
  .head {
    padding: 14px 18px; border-bottom: 1px solid var(--border);
  }
  .title {
    font-weight: 600; color: var(--text-primary); font-size: 14px;
  }
  .body {
    padding: 18px; color: var(--text-primary);
  }
  .body p {
    font-size: 12.5px; line-height: 1.55; margin: 0 0 12px;
  }
  .usage-list {
    margin: 8px 0 16px; padding-left: 18px; font-size: 12px; line-height: 1.55;
  }
  .usage-list li { margin: 4px 0; }
  .prompt {
    font-weight: 600; margin: 14px 0 10px;
  }
  .choice {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 12px; margin-bottom: 8px;
    border: 1px solid var(--border); border-radius: 6px;
    cursor: pointer;
  }
  .choice.selected {
    border-color: rgba(179,62,31,0.5);
    background: rgba(179,62,31,0.06);
  }
  .choice input { margin-top: 2px; }
  .choice div { display: flex; flex-direction: column; gap: 2px; }
  .choice-title { font-weight: 600; font-size: 12px; }
  .choice-desc { color: var(--text-muted); font-size: 11.5px; line-height: 1.45; }
  .hint {
    font-size: 11px; color: var(--text-muted);
    margin-top: 14px; line-height: 1.5;
  }
  .link {
    background: none; border: none; padding: 0;
    color: #f5a08a; cursor: pointer; text-decoration: underline;
    font: inherit;
  }
  .foot {
    padding: 12px 18px; border-top: 1px solid var(--border);
    display: flex; justify-content: flex-end;
  }
  .btn {
    background: var(--bg-surface-alt); border: 1px solid var(--border);
    color: var(--text-primary); padding: 6px 16px; border-radius: 5px;
    cursor: pointer; font-size: 12px;
  }
  .btn.primary {
    background: rgba(179,62,31,0.2); border-color: rgba(179,62,31,0.5);
    color: #f5a08a; font-weight: 600;
  }
  .btn.primary:hover:not(:disabled) { background: rgba(179,62,31,0.35); }
  .btn:disabled { opacity: 0.5; cursor: default; }
</style>
