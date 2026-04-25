<script lang="ts">
  type Props = {
    sql: string;
    connectionLabel: string;
    onCancel: () => void;
    onApply: () => Promise<void>;
    onCopyToTab: () => void;
  };
  let { sql, connectionLabel, onCancel, onApply, onCopyToTab }: Props = $props();

  let applying = $state(false);
  let error = $state<string | null>(null);

  async function handleApply() {
    applying = true;
    error = null;
    try {
      await onApply();
    } catch (e: any) {
      error = e?.message ?? String(e);
    } finally {
      applying = false;
    }
  }

  const stmtCount = $derived.by(() => {
    const calls = sql.match(/ORDS\.\w+\(/g);
    return calls ? calls.length : 0;
  });

  const hasCommit = $derived(sql.toUpperCase().includes("COMMIT"));
</script>

<div
  class="modal-backdrop"
  onclick={onCancel}
  onkeydown={(e) => e.key === "Escape" && !applying && onCancel()}
  role="presentation"
>
  <div
    class="modal"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div class="head">
      <span class="title">Confirmar deploy</span>
      <button class="close" onclick={onCancel} disabled={applying} aria-label="Close">✕</button>
    </div>

    <div class="body">
      <div class="conn">
        Será executado contra: <strong>{connectionLabel}</strong>
      </div>
      <pre class="sql">{sql}</pre>
      {#if stmtCount > 0}
        <div class="warn">
          ⚠ Vai chamar {stmtCount} {stmtCount === 1 ? "rotina" : "rotinas"} <code>ORDS.*</code>
          {#if hasCommit}e fazer <code>COMMIT</code>{/if}.
        </div>
      {/if}
      {#if error}
        <div class="error">
          <strong>Erro:</strong> {error}
        </div>
      {/if}
    </div>

    <div class="foot">
      <button class="btn" onclick={onCopyToTab} disabled={applying}>Copiar para SQL tab</button>
      <span class="spacer"></span>
      <button class="btn" onclick={onCancel} disabled={applying}>Cancelar</button>
      <button class="btn primary" onclick={() => void handleApply()} disabled={applying}>
        {applying ? "Aplicando…" : "Aplicar"}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center; z-index: 1100;
  }
  .modal {
    background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px;
    width: 720px; max-width: 90vw; max-height: 85vh; display: flex; flex-direction: column;
  }
  .head { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
  .title { font-weight: 600; color: var(--text-primary); }
  .close {
    background: none; border: none; color: var(--text-muted); cursor: pointer;
    padding: 4px 8px; font-size: 14px;
  }
  .close:hover:not(:disabled) { color: var(--text-primary); }
  .close:disabled { opacity: 0.4; cursor: default; }
  .body { padding: 16px; flex: 1; overflow-y: auto; }
  .conn {
    font-size: 11.5px; color: var(--text-muted); margin-bottom: 10px;
  }
  .conn strong { color: var(--text-primary); }
  .sql {
    background: var(--bg-page); border: 1px solid var(--border); border-radius: 4px;
    padding: 12px; font-family: "JetBrains Mono", monospace; font-size: 11px;
    color: var(--text-primary); white-space: pre-wrap; max-height: 50vh; overflow-y: auto;
    margin: 0;
  }
  .warn {
    background: rgba(232,197,71,0.1); border: 1px solid rgba(232,197,71,0.3);
    color: #e8c547; padding: 8px 10px; border-radius: 4px;
    font-size: 11px; margin-top: 10px;
  }
  .warn code {
    font-family: monospace; background: rgba(0,0,0,0.2);
    padding: 1px 4px; border-radius: 2px;
  }
  .error {
    background: rgba(179,62,31,0.15); border: 1px solid rgba(179,62,31,0.3);
    color: #f5a08a; padding: 8px 10px; border-radius: 4px;
    font-size: 11.5px; margin-top: 10px;
  }
  .foot {
    padding: 10px 16px; border-top: 1px solid var(--border);
    display: flex; gap: 8px; align-items: center;
  }
  .spacer { flex: 1; }
  .btn {
    background: var(--bg-surface-alt); border: 1px solid var(--border);
    color: var(--text-primary); padding: 5px 12px; border-radius: 4px;
    cursor: pointer; font-size: 11.5px;
  }
  .btn.primary {
    background: rgba(179,62,31,0.2); border-color: rgba(179,62,31,0.45); color: #f5a08a;
  }
  .btn:hover:not(:disabled) { background: var(--row-hover); }
  .btn.primary:hover:not(:disabled) { background: rgba(179,62,31,0.35); }
  .btn:disabled { opacity: 0.5; cursor: default; }
</style>
