<script lang="ts">
  import { onMount } from "svelte";
  import type { ProcParam, ProcExecuteResult } from "$lib/workspace";
  import { procDescribeGet, procExecuteRun, flowTraceProc } from "$lib/workspace";
  import { visualFlow } from "$lib/stores/visual-flow.svelte";

  type Props = {
    owner: string;
    name: string;
    objectType: "PROCEDURE" | "FUNCTION";
    onClose: () => void;
    onResult: (result: ProcExecuteResult) => void;
  };
  let { owner, name, objectType, onClose, onResult }: Props = $props();

  let params = $state<ProcParam[]>([]);
  let values = $state<Record<string, string>>({});
  let loading = $state(true);
  let executing = $state(false);
  let execError = $state<string | null>(null);
  let tracing = $state(false);

  onMount(async () => {
    const res = await procDescribeGet(owner, name);
    if (res.ok) {
      params = res.data.params;
    } else {
      execError = res.error.message;
    }
    loading = false;
  });

  async function execute() {
    executing = true;
    execError = null;
    try {
      const paramsToSend = params
        .filter((p) => p.direction !== "OUT")
        .map((p) => ({ name: p.name, value: values[p.name] ?? "" }));
      const res = await procExecuteRun({ owner, name, params: paramsToSend });
      if (res.ok) {
        onResult(res.data);
        onClose();
      } else {
        execError = res.error.message;
      }
    } finally {
      executing = false;
    }
  }

  async function runWithVisualFlow(): Promise<void> {
    const paramsToSend = params
      .filter((p) => p.direction !== "OUT")
      .map((p) => ({ name: p.name, value: values[p.name] ?? "" }));
    tracing = true;
    try {
      const result = await flowTraceProc({
        owner,
        name,
        params: paramsToSend,
        maxSteps: 5000,
        timeoutMs: 60_000,
      });
      if (!result.ok) {
        if (result.error.code === -32020) {
          execError = `${result.error.message}\n\nClick "Compile" button on the editor toolbar to see and fix the errors.`;
        } else if (result.error.code === -32021) {
          execError = `${result.error.message}\n\nRun this SQL to fix:\n  ALTER PROCEDURE ${owner}.${name} COMPILE DEBUG;`;
        } else {
          execError = `Visual Flow failed: ${result.error.message}`;
        }
        return;
      }
      visualFlow.open(result.data);
      onClose();
    } finally {
      tracing = false;
    }
  }

  let inputParams = $derived(params.filter((p) => p.direction !== "OUT"));
  let outOnlyParams = $derived(params.filter((p) => p.direction === "OUT" && p.dataType !== "REF CURSOR"));
</script>

<dialog class="modal" open onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <div
    class="modal-box"
    role="document"
    onkeydown={(e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Enter" && !executing && !loading) { void execute(); return; }
      e.stopPropagation();
    }}
    onclick={(e) => e.stopPropagation()}
  >
    <div class="modal-header">
      <span class="modal-title">Execute: {owner}.{name} ({objectType})</span>
      <button class="modal-close" onclick={onClose} aria-label="Close">×</button>
    </div>
    <div class="modal-body">
      {#if loading}
        <p class="hint">Loading parameters…</p>
      {:else if params.length === 0}
        <p class="hint">No parameters — ready to execute.</p>
      {:else}
        <div class="param-list">
          {#each inputParams as p (p.name)}
            <label class="param-row">
              <span class="param-label">{p.name} <span class="param-type">({p.dataType})</span></span>
              <input
                class="param-input"
                type="text"
                placeholder={p.direction === "IN/OUT" ? "IN/OUT" : "value"}
                bind:value={values[p.name]}
              />
            </label>
          {/each}
          {#each outOnlyParams as p (p.name)}
            <div class="param-row out-row">
              <span class="param-label">{p.name} <span class="param-type">({p.dataType})</span></span>
              <span class="out-hint">output — no input needed</span>
            </div>
          {/each}
        </div>
      {/if}
      {#if execError}
        <p class="err">{execError}</p>
      {/if}
    </div>
    <div class="modal-footer">
      <button class="btn-cancel" onclick={onClose} disabled={executing}>Cancel</button>
      <button class="btn-execute" onclick={execute} disabled={executing || loading}>
        {#if executing}<span class="spinner"></span>{/if}
        Execute
      </button>
      <button type="button" class="btn-execute btn-visual-flow" onclick={runWithVisualFlow} disabled={executing || loading || tracing}>
        {#if tracing}Capturing trace…{:else}▶ Run with Visual Flow{/if}
      </button>
    </div>
  </div>
</dialog>

<style>
  .modal {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center;
    border: none; padding: 0; z-index: 200;
  }
  .modal-box {
    background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: 8px; width: 440px; max-width: 90vw; max-height: 80vh;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .modal-header {
    display: flex; align-items: center; padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .modal-title { flex: 1; font-size: 12px; font-weight: 600; color: var(--text-primary); }
  .modal-close {
    background: none; border: none; font-size: 16px; cursor: pointer;
    color: var(--text-muted); padding: 0 4px;
  }
  .modal-body { flex: 1; overflow-y: auto; padding: 16px; }
  .param-list { display: flex; flex-direction: column; gap: 10px; }
  .param-row { display: flex; flex-direction: column; gap: 4px; }
  .param-label { font-size: 11px; color: var(--text-primary); }
  .param-type { color: var(--text-muted); font-size: 10px; }
  .param-input {
    background: var(--input-bg); border: 1px solid var(--input-border);
    border-radius: 4px; padding: 5px 8px; font-size: 12px; color: var(--text-primary);
    font-family: "JetBrains Mono", monospace;
  }
  .out-row { opacity: 0.6; }
  .out-hint { font-size: 11px; color: var(--text-muted); font-style: italic; }
  .modal-footer {
    display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px;
    border-top: 1px solid var(--border);
  }
  .btn-cancel, .btn-execute {
    padding: 6px 16px; border-radius: 5px; font-size: 12px; cursor: pointer; border: none;
  }
  .btn-cancel { background: var(--input-bg); color: var(--text-primary); }
  .btn-execute {
    background: #b33e1f; color: #fff; display: flex; align-items: center; gap: 6px;
  }
  .btn-execute:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-visual-flow { background: #1f5bb3; }
  .spinner {
    width: 10px; height: 10px; border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .hint { font-size: 12px; color: var(--text-muted); }
  .err { font-size: 12px; color: #e74c3c; }
</style>
