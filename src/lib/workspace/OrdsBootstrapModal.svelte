<script lang="ts">
  import type { OrdsDetectResult } from "$lib/workspace";

  type Props = {
    state: OrdsDetectResult;
    schemaName: string;
    onEnableSchema: () => Promise<void>;
    onSetBaseUrl: (url: string) => void;
    onClose: () => void;
  };
  let { state, schemaName, onEnableSchema, onSetBaseUrl, onClose }: Props = $props();

  let baseUrlInput = $state("");
  let enabling = $state(false);

  const variant = $derived.by(() => {
    if (!state.installed) return "not-installed";
    if (!state.userHasAccess) return "no-access";
    if (!state.currentSchemaEnabled) return "schema-disabled";
    if (!state.hasAdminRole) return "no-privilege";
    if (!state.ordsBaseUrl) return "no-url";
    return "ok";
  });

  async function handleEnable() {
    enabling = true;
    try { await onEnableSchema(); } finally { enabling = false; }
  }

  function handleSetUrl() {
    if (baseUrlInput.trim()) onSetBaseUrl(baseUrlInput.trim());
  }
</script>

<div
  class="modal-backdrop"
  onclick={onClose}
  onkeydown={(e) => e.key === "Escape" && onClose()}
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
    <div class="modal-head">
      <span class="modal-title">VRAS — Configuração ORDS</span>
      <button class="close-btn" onclick={onClose} aria-label="Close">✕</button>
    </div>
    <div class="modal-body">
      {#if variant === "not-installed"}
        <h3>ORDS não está instalado</h3>
        <p>O Oracle REST Data Services (ORDS) não foi detectado neste banco.</p>
        <p>Peça ao DBA para executar:</p>
        <pre class="cmd">@$ORACLE_HOME/ords/install.sql</pre>
        <p>
          Ou consulte:
          <a href="https://docs.oracle.com/en/database/oracle/oracle-rest-data-services/" target="_blank" rel="noopener">documentação oficial</a>.
        </p>
      {:else if variant === "no-access"}
        <h3>Seu usuário <code>{schemaName}</code> não tem acesso ao ORDS</h3>
        <p>
          O ORDS está instalado neste banco, mas o usuário <code>{schemaName}</code> não tem permissão para usar os pacotes ORDS/OAUTH ou ler as views <code>USER_ORDS_*</code>.
        </p>
        <p><strong>Passo 1 — Peça ao DBA (executar como SYS ou ORDS_ADMINISTRATOR_ROLE):</strong></p>
        <pre class="cmd">GRANT ORDS_ADMINISTRATOR_ROLE TO {schemaName};</pre>
        <p><strong>Passo 2 — Após receber o GRANT, reconecte e clique em "Habilitar agora" no modal que aparecerá.</strong></p>
        <p class="hint-small">
          Sem essa permissão, a aba REST MODULES e o gerenciador de OAuth Clients não funcionam.
        </p>
      {:else if variant === "schema-disabled"}
        <h3>Schema <code>{schemaName}</code> não está habilitado</h3>
        <p>Para criar APIs REST a partir deste schema, ele precisa ser habilitado para ORDS.</p>
        <p>O comando executado será:</p>
        <pre class="cmd">BEGIN
  ORDS.ENABLE_SCHEMA(p_enabled =&gt; TRUE);
  COMMIT;
END;</pre>
        <button class="primary-btn" onclick={() => void handleEnable()} disabled={enabling}>
          {enabling ? "Habilitando…" : "Habilitar agora"}
        </button>
      {:else if variant === "no-privilege"}
        <h3>Privilégio insuficiente</h3>
        <p>Seu usuário precisa do role <code>ORDS_ADMINISTRATOR_ROLE</code> para criar APIs.</p>
        <p>Comando para o DBA:</p>
        <pre class="cmd">GRANT ORDS_ADMINISTRATOR_ROLE TO {schemaName};</pre>
      {:else if variant === "no-url"}
        <h3>URL base do ORDS</h3>
        <p>Não foi possível detectar a URL pública do servidor ORDS automaticamente.</p>
        <p>Informe a URL base (ex: <code>https://servidor:8443/ords</code>):</p>
        <input
          class="url-input"
          type="text"
          placeholder="https://..."
          bind:value={baseUrlInput}
          onkeydown={(e) => e.key === "Enter" && handleSetUrl()}
        />
        <button class="primary-btn" onclick={handleSetUrl} disabled={!baseUrlInput.trim()}>
          Salvar
        </button>
      {:else}
        <h3>Tudo pronto</h3>
        <p>ORDS {state.version ?? ""} configurado e funcionando.</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center; z-index: 1000;
  }
  .modal {
    background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: 8px; min-width: 480px; max-width: 640px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  }
  .modal-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid var(--border);
  }
  .modal-title { font-weight: 600; color: var(--text-primary); font-size: 13px; }
  .close-btn {
    background: none; border: none; color: var(--text-muted);
    cursor: pointer; font-size: 14px; padding: 4px 8px;
  }
  .close-btn:hover { color: var(--text-primary); }
  .modal-body { padding: 20px; color: var(--text-primary); }
  .modal-body h3 { margin: 0 0 12px; font-size: 14px; }
  .modal-body p { margin: 8px 0; font-size: 12.5px; line-height: 1.55; color: var(--text-primary); }
  .cmd {
    background: var(--bg-surface-alt); border: 1px solid var(--border);
    padding: 10px 12px; border-radius: 4px; font-family: monospace;
    font-size: 11.5px; color: var(--text-primary); margin: 8px 0;
    white-space: pre-wrap; word-break: break-all;
  }
  .primary-btn {
    background: rgba(179,62,31,0.2); border: 1px solid rgba(179,62,31,0.5);
    color: #f5a08a; padding: 6px 14px; border-radius: 4px;
    font-size: 12px; font-weight: 600; cursor: pointer; margin-top: 8px;
  }
  .primary-btn:hover:not(:disabled) { background: rgba(179,62,31,0.35); }
  .primary-btn:disabled { opacity: 0.5; cursor: default; }
  .url-input {
    width: 100%; padding: 6px 10px; border: 1px solid var(--border);
    border-radius: 4px; background: var(--input-bg); color: var(--text-primary);
    font-size: 12px; font-family: monospace; margin-top: 4px;
    box-sizing: border-box;
  }
  code {
    font-family: monospace; background: var(--bg-surface-alt);
    padding: 1px 5px; border-radius: 3px; font-size: 11.5px;
  }
  .hint-small {
    font-size: 11px; color: var(--text-muted); font-style: italic; margin-top: 12px;
  }
</style>
