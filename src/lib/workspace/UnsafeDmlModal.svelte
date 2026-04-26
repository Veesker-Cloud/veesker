<script lang="ts">
  type Props = {
    sql: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  };
  let { sql, message, onConfirm, onCancel }: Props = $props();

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onCancel();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onCancel()}>
  <div class="modal" role="alertdialog" aria-labelledby="udml-title" aria-describedby="udml-msg">
    <div class="head">
      <span class="warn-icon" aria-hidden="true">⚠</span>
      <h2 id="udml-title">Unsafe DML detected</h2>
    </div>

    <p id="udml-msg" class="message">
      {message || "This UPDATE/DELETE has no WHERE clause and will affect ALL rows."}
    </p>

    <pre class="sql">{sql}</pre>

    <p class="hint">
      To disable this warning, edit the connection and turn off
      <em>Warn on unsafe DML</em>.
    </p>

    <div class="actions">
      <button type="button" class="ghost" onclick={onCancel}>Cancel</button>
      <button type="button" class="danger" onclick={onConfirm}>Run anyway</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    padding: 1rem;
  }
  .modal {
    background: var(--bg-surface); color: var(--text-primary);
    border: 1px solid var(--border-strong);
    border-radius: 8px; padding: 1.25rem;
    max-width: 560px; width: 100%;
    display: flex; flex-direction: column; gap: 0.85rem;
    box-shadow: 0 12px 40px rgba(0,0,0,0.4);
    font-family: "Inter", -apple-system, system-ui, sans-serif;
  }
  .head { display: flex; align-items: center; gap: 0.6rem; }
  .warn-icon {
    font-size: 22px; color: #d99c2a;
    background: rgba(217, 153, 42, 0.18);
    width: 32px; height: 32px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  h2 {
    font-family: "Space Grotesk", sans-serif;
    font-size: 18px; font-weight: 600; margin: 0;
    letter-spacing: 0.01em;
  }
  .message { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
  .sql {
    background: var(--bg-surface-raised);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.6rem 0.75rem;
    font-family: "JetBrains Mono", "SF Mono", monospace;
    font-size: 12px; line-height: 1.45;
    color: var(--text-primary);
    overflow-x: auto;
    margin: 0;
    max-height: 160px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .hint { margin: 0; font-size: 11.5px; color: var(--text-muted); }
  .hint em { color: var(--text-secondary); font-style: normal; font-weight: 600; }
  .actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
  button {
    font-family: "Space Grotesk", sans-serif; font-size: 13px;
    padding: 0.55rem 1rem; border-radius: 5px; cursor: pointer;
    border: 1px solid var(--border-strong);
  }
  .ghost { background: transparent; color: var(--text-primary); }
  .ghost:hover { background: var(--row-hover); }
  .danger {
    background: #b33e1f; color: #fff; border-color: #b33e1f;
    font-weight: 600;
  }
  .danger:hover { background: #c4502b; }
</style>
