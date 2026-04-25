<script lang="ts">
  import { check, type Update } from "@tauri-apps/plugin-updater";
  import { relaunch } from "@tauri-apps/plugin-process";
  import { onMount } from "svelte";

  let update = $state<Update | null>(null);
  let stage = $state<"hidden" | "available" | "downloading" | "installing" | "ready" | "error">("hidden");
  let progress = $state({ downloaded: 0, total: 0 });
  let errorMessage = $state<string | null>(null);

  onMount(async () => {
    setTimeout(() => void checkForUpdate(), 2000);
  });

  async function checkForUpdate() {
    try {
      const result = await check();
      if (result?.available) {
        update = result;
        stage = "available";
      }
    } catch (e) {
      console.warn("[updater] check failed:", e);
    }
  }

  async function installUpdate() {
    if (!update) return;
    stage = "downloading";
    progress = { downloaded: 0, total: 0 };
    errorMessage = null;

    try {
      let totalSize = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalSize = event.data.contentLength ?? 0;
          progress = { downloaded: 0, total: totalSize };
        } else if (event.event === "Progress") {
          progress = {
            downloaded: progress.downloaded + event.data.chunkLength,
            total: totalSize,
          };
        } else if (event.event === "Finished") {
          stage = "installing";
        }
      });
      stage = "ready";
    } catch (e: any) {
      stage = "error";
      errorMessage = e?.message ?? String(e);
    }
  }

  async function restart() {
    await relaunch();
  }

  function dismiss() {
    stage = "hidden";
    update = null;
  }

  const pct = $derived(
    progress.total > 0 ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : 0
  );
</script>

{#if stage !== "hidden"}
  <div class="update-toast">
    {#if stage === "available"}
      <div class="head">
        <span class="title">🚀 Nova versão disponível</span>
        <button class="close" onclick={dismiss} aria-label="Dispensar">✕</button>
      </div>
      <div class="body">
        <div class="version">Veesker {update?.version ?? "?"}</div>
        {#if update?.body}
          <div class="notes">{update.body.slice(0, 240)}{update.body.length > 240 ? "…" : ""}</div>
        {/if}
        <div class="actions">
          <button class="btn" onclick={dismiss}>Depois</button>
          <button class="btn primary" onclick={() => void installUpdate()}>Atualizar agora</button>
        </div>
      </div>
    {:else if stage === "downloading"}
      <div class="head">
        <span class="title">Baixando atualização…</span>
      </div>
      <div class="body">
        <div class="progress-bar">
          <div class="progress-fill" style="width: {pct}%"></div>
        </div>
        <div class="progress-text">
          {pct}%
          {#if progress.total > 0}
            ({(progress.downloaded / 1024 / 1024).toFixed(1)} / {(progress.total / 1024 / 1024).toFixed(1)} MB)
          {/if}
        </div>
      </div>
    {:else if stage === "installing"}
      <div class="head">
        <span class="title">Instalando…</span>
      </div>
      <div class="body">
        <div class="hint">Aguarde, aplicando atualização.</div>
      </div>
    {:else if stage === "ready"}
      <div class="head">
        <span class="title">✅ Atualização instalada</span>
      </div>
      <div class="body">
        <div class="hint">Reinicie o Veesker pra aplicar a nova versão.</div>
        <div class="actions">
          <button class="btn" onclick={dismiss}>Depois</button>
          <button class="btn primary" onclick={() => void restart()}>Reiniciar agora</button>
        </div>
      </div>
    {:else if stage === "error"}
      <div class="head">
        <span class="title">⚠ Falha na atualização</span>
        <button class="close" onclick={dismiss} aria-label="Dispensar">✕</button>
      </div>
      <div class="body">
        <div class="error-msg">{errorMessage}</div>
        <div class="actions">
          <button class="btn" onclick={dismiss}>Fechar</button>
          <button class="btn primary" onclick={() => void installUpdate()}>Tentar de novo</button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .update-toast {
    position: fixed;
    bottom: 16px;
    right: 16px;
    width: 340px;
    background: var(--bg-surface);
    border: 1px solid rgba(179,62,31,0.5);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    z-index: 1200;
    overflow: hidden;
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    font-size: 12px;
    color: var(--text-primary);
  }
  .head {
    padding: 10px 14px;
    background: rgba(179,62,31,0.12);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .title { font-weight: 600; font-size: 12.5px; }
  .close {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px 6px;
    font-size: 13px;
  }
  .close:hover { color: var(--text-primary); }
  .body { padding: 12px 14px; }
  .version {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 6px;
  }
  .notes {
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--text-primary);
    margin-bottom: 12px;
    max-height: 96px;
    overflow-y: auto;
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 8px;
  }
  .btn {
    background: var(--bg-surface-alt);
    border: 1px solid var(--border);
    color: var(--text-primary);
    padding: 5px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11.5px;
  }
  .btn:hover { background: var(--row-hover); }
  .btn.primary {
    background: rgba(179,62,31,0.2);
    border-color: rgba(179,62,31,0.45);
    color: #f5a08a;
  }
  .btn.primary:hover { background: rgba(179,62,31,0.35); }
  .progress-bar {
    width: 100%;
    height: 6px;
    background: var(--bg-surface-alt);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 6px;
  }
  .progress-fill {
    height: 100%;
    background: rgba(179,62,31,0.6);
    transition: width 0.2s;
  }
  .progress-text {
    font-size: 10.5px;
    color: var(--text-muted);
    font-family: "JetBrains Mono", monospace;
  }
  .hint { font-size: 11.5px; color: var(--text-muted); }
  .error-msg {
    background: rgba(179,62,31,0.15);
    border: 1px solid rgba(179,62,31,0.3);
    color: #f5a08a;
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 11px;
    margin-bottom: 8px;
    word-break: break-word;
  }
</style>
