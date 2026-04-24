<script lang="ts">
  type Props = {
    onAccept: () => void;
    onCancel: () => void;
  };
  let { onAccept, onCancel }: Props = $props();

  let accepted = $state(false);
</script>

<dialog
  class="modal"
  open
  onclick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
  onkeydown={(e) => { if (e.key === "Escape") onCancel(); }}
>
  <div
    class="modal-box"
    role="document"
    onkeydown={(e) => e.stopPropagation()}
    onclick={(e) => e.stopPropagation()}
  >
    <div class="modal-header">
      <span class="modal-title">⚠ Security Notice — Pre-release Software</span>
    </div>
    <div class="modal-body">
      <ul class="notice-list">
        <li><strong>Veesker v0.0.1</strong> has not undergone a formal security audit. It is pre-release software.</li>
        <li>Use in corporate environments is at the <strong>operator's sole responsibility</strong>. Verify compliance with your organization's policies before connecting.</li>
        <li>The <strong>AI assistant (SheepChat / Analyze)</strong> sends schema names, column names, SQL queries, and result samples to <code>api.anthropic.com</code>. <strong>Do not use with sensitive, classified, or regulated data.</strong></li>
      </ul>
      <label class="accept-row">
        <input type="checkbox" bind:checked={accepted} />
        <span>I understand and accept responsibility for use in corporate environments</span>
      </label>
    </div>
    <div class="modal-footer">
      <button class="btn-cancel" onclick={onCancel}>Cancel</button>
      <button class="btn-accept" onclick={onAccept} disabled={!accepted}>Accept & Save</button>
    </div>
  </div>
</dialog>

<style>
  .modal {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    border: none; padding: 0; z-index: 300;
  }
  .modal-box {
    background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: 8px; width: 500px; max-width: 94vw;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .modal-header {
    padding: 14px 16px; border-bottom: 1px solid var(--border);
    background: rgba(179,62,31,0.08);
  }
  .modal-title { font-size: 13px; font-weight: 700; color: var(--text-primary); }
  .modal-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; }
  .notice-list {
    margin: 0; padding-left: 18px;
    display: flex; flex-direction: column; gap: 10px;
    font-size: 13px; line-height: 1.55; color: var(--text-primary);
  }
  .notice-list li { padding-left: 2px; }
  code {
    font-family: "JetBrains Mono", monospace; font-size: 11px;
    background: var(--bg-surface-alt); padding: 1px 4px; border-radius: 3px;
  }
  .accept-row {
    display: flex; align-items: flex-start; gap: 10px;
    font-size: 13px; color: var(--text-primary); cursor: pointer;
    padding: 10px 12px; border-radius: 6px;
    background: var(--bg-surface-alt); border: 1px solid var(--border);
  }
  .accept-row input { margin-top: 2px; flex-shrink: 0; cursor: pointer; accent-color: #b33e1f; }
  .modal-footer {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 16px; border-top: 1px solid var(--border);
  }
  .btn-cancel, .btn-accept {
    padding: 8px 20px; border-radius: 5px; font-size: 13px; cursor: pointer; border: none;
  }
  .btn-cancel { background: var(--bg-surface-alt); color: var(--text-primary); border: 1px solid var(--border); }
  .btn-accept { background: #b33e1f; color: #fff; font-weight: 600; }
  .btn-accept:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-accept:not(:disabled):hover { background: #8c2f17; }
</style>
