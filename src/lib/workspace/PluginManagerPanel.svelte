<script lang="ts">
  import { license, type UsageType } from "$lib/stores/license.svelte";
  import { listAuthProviders, listAiProviders, listObjectActions, listGatedFeatures, type LicenseTier } from "$lib/plugins";
  import { openUrl } from "@tauri-apps/plugin-opener";

  type Props = { onClose: () => void };
  let { onClose }: Props = $props();

  let licenseKeyInput = $state(license.licenseKey ?? "");
  let usageType = $state<UsageType>(license.usageType);
  let tier = $state<LicenseTier>(license.tier);

  function saveLicense() {
    license.setLicenseKey(licenseKeyInput.trim() || null);
    license.setUsageType(usageType);
    license.setTier(tier);
    license.acknowledge();
  }

  function openPricing() {
    void openUrl("https://veesker.dev/pricing");
  }

  function openCommercialPolicy() {
    void openUrl("https://github.com/geeviana/veesker/blob/main/COMMERCIAL_USE.md");
  }

  const installedAuth = $derived(listAuthProviders());
  const installedAi = $derived(listAiProviders());
  const installedActions = $derived(listObjectActions("TABLE"));
  const installedFeatures = $derived(listGatedFeatures());

  const hasAnyPlugin = $derived(
    installedAuth.length > 0 || installedAi.length > 0 ||
    installedActions.length > 0 || installedFeatures.length > 0,
  );
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
      <span class="title">Plugins & License</span>
      <button class="close" onclick={onClose} aria-label="Close">✕</button>
    </div>

    <div class="body">
      <!-- License section -->
      <section>
        <h3>License & Usage</h3>
        <p class="hint">
          Veesker is open source under Apache 2.0. The packaged app has
          a <button class="link" onclick={openCommercialPolicy}>commercial use policy</button>
          based on organization size — see <button class="link" onclick={openPricing}>pricing</button>.
        </p>

        <label class="row">
          <span class="lbl">Usage type:</span>
          <select bind:value={usageType} class="input">
            <option value="unknown">Not specified</option>
            <option value="personal">Personal / small organization</option>
            <option value="commercial">Commercial (≥50 employees or ≥US$ 5M revenue)</option>
          </select>
        </label>

        <label class="row">
          <span class="lbl">Tier:</span>
          <select bind:value={tier} class="input">
            <option value="personal">Personal (free)</option>
            <option value="pro">Pro</option>
            <option value="business">Business</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </label>

        <label class="row">
          <span class="lbl">License key:</span>
          <input
            class="input"
            type="text"
            bind:value={licenseKeyInput}
            placeholder="Paste your license key (optional, for paid tiers)"
          />
        </label>

        <p class="hint">
          The license key is informational at this stage. License validation
          for paid add-ons activates when the marketplace launches.
        </p>

        <div class="actions">
          <button class="btn primary" onclick={saveLicense}>Save</button>
        </div>
      </section>

      <hr />

      <!-- Installed extensions section -->
      <section>
        <h3>Installed Extensions</h3>
        {#if hasAnyPlugin}
          {#if installedAuth.length > 0}
            <div class="ext-group">
              <h4>Authentication providers</h4>
              <ul>
                {#each installedAuth as p}<li><code>{p.id}</code> — {p.displayName}</li>{/each}
              </ul>
            </div>
          {/if}
          {#if installedAi.length > 0}
            <div class="ext-group">
              <h4>AI providers</h4>
              <ul>
                {#each installedAi as p}<li><code>{p.id}</code> — {p.displayName}</li>{/each}
              </ul>
            </div>
          {/if}
          {#if installedFeatures.length > 0}
            <div class="ext-group">
              <h4>Registered features</h4>
              <ul>
                {#each installedFeatures as f}
                  <li><code>{f.id}</code> ({f.requiresTier}) — {f.description}</li>
                {/each}
              </ul>
            </div>
          {/if}
        {:else}
          <p class="empty">
            No plugins installed. Plugins extend Veesker with additional
            authentication providers, AI backends, audit destinations, and
            custom actions.
          </p>
          <p class="empty">
            Plugin marketplace is launching soon. Visit
            <button class="link" onclick={() => void openUrl('https://veesker.dev/plugins')}>veesker.dev/plugins</button>
            for the first add-ons (Audit Log Shipper, Oracle EBS Pack, etc.)
          </p>
        {/if}
      </section>

      <hr />

      <!-- About section -->
      <section>
        <h3>About</h3>
        <ul class="about">
          <li>Veesker is <strong>fully open source</strong> under <button class="link" onclick={() => void openUrl('https://github.com/geeviana/veesker/blob/main/LICENSE')}>Apache License 2.0</button></li>
          <li>No telemetry, no usage tracking, no license server check</li>
          <li>All features are available in all tiers — no feature gating</li>
          <li>Compliance with the commercial policy is honor-based + EULA</li>
        </ul>
      </section>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center; z-index: 1200;
  }
  .modal {
    background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: 8px; width: 640px; max-width: 92vw;
    max-height: 88vh; display: flex; flex-direction: column;
  }
  .head {
    padding: 12px 16px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
  }
  .title { font-weight: 600; color: var(--text-primary); }
  .close {
    background: none; border: none; color: var(--text-muted);
    cursor: pointer; padding: 4px 8px; font-size: 14px;
  }
  .close:hover { color: var(--text-primary); }
  .body {
    padding: 16px; flex: 1; overflow-y: auto;
    color: var(--text-primary); font-size: 12.5px; line-height: 1.55;
  }
  section { margin-bottom: 16px; }
  h3 {
    font-size: 11px; text-transform: uppercase;
    color: var(--text-muted); margin: 0 0 10px;
    letter-spacing: 0.06em;
  }
  h4 {
    font-size: 11px; color: var(--text-muted);
    margin: 8px 0 4px; font-weight: 600;
  }
  hr {
    border: none; border-top: 1px solid var(--border); margin: 16px 0;
  }
  .row {
    display: flex; align-items: center; gap: 10px; margin: 8px 0;
  }
  .lbl {
    color: var(--text-muted); min-width: 110px; font-size: 11.5px;
  }
  .input {
    flex: 1; background: var(--input-bg); border: 1px solid var(--border);
    border-radius: 4px; color: var(--text-primary);
    padding: 4px 8px; font-size: 11.5px;
  }
  .hint {
    color: var(--text-muted); font-size: 11px;
    margin: 6px 0 12px; line-height: 1.5;
  }
  .actions {
    display: flex; justify-content: flex-end; margin-top: 12px;
  }
  .btn {
    background: var(--bg-surface-alt); border: 1px solid var(--border);
    color: var(--text-primary); padding: 5px 14px; border-radius: 4px;
    cursor: pointer; font-size: 11.5px;
  }
  .btn.primary {
    background: rgba(179,62,31,0.2); border-color: rgba(179,62,31,0.5);
    color: #f5a08a; font-weight: 600;
  }
  .btn.primary:hover { background: rgba(179,62,31,0.35); }
  .ext-group { margin-bottom: 12px; }
  .ext-group ul, .about {
    list-style: disc; padding-left: 22px;
    color: var(--text-primary); font-size: 11.5px;
    margin: 4px 0;
  }
  .ext-group code, .about code {
    font-family: monospace; background: var(--bg-surface-alt);
    padding: 1px 5px; border-radius: 3px; font-size: 11px;
  }
  .empty {
    color: var(--text-muted); font-size: 11.5px;
    margin: 8px 0; line-height: 1.5;
  }
  .link {
    background: none; border: none; padding: 0;
    color: #f5a08a; cursor: pointer; text-decoration: underline;
    font: inherit;
  }
</style>
