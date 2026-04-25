<script lang="ts">
  import { visualFlow } from "$lib/stores/visual-flow.svelte";
  import VisualFlowGraph from "./VisualFlowGraph.svelte";
  import VisualFlowControls from "./VisualFlowControls.svelte";
  import VisualFlowVariablesView from "./VisualFlowVariablesView.svelte";

  const headerLabel = $derived.by(() => {
    const e = visualFlow.currentEvent;
    if (!e) return "";
    if (e.kind === "plsql.frame") return `${e.objectName} : line ${e.lineNumber}`;
    return e.operation;
  });

  const elapsedLabel = $derived.by(() => {
    const e = visualFlow.currentEvent;
    if (!e) return "";
    if (e.kind === "plsql.frame") {
      const ms = e.exitedAtMs !== null ? e.exitedAtMs - e.enteredAtMs : 0;
      return `${ms} ms`;
    }
    return e.elapsedMsActual !== null ? `${e.elapsedMsActual} ms` : "";
  });
</script>

{#if visualFlow.isOpen && visualFlow.trace}
  <aside class="panel" style="width: {visualFlow.panelWidth}px" aria-label="Visual execution flow">
    <header class="head">
      <h3>Visual Flow</h3>
      <button type="button" onclick={() => visualFlow.close()} aria-label="Close panel">×</button>
    </header>

    {#if visualFlow.trace.truncated}
      <div class="banner banner--warn">Trace truncated at {visualFlow.totalSteps} steps.</div>
    {/if}
    {#if visualFlow.trace.error}
      <div class="banner banner--error">
        {visualFlow.trace.error.message}
      </div>
    {/if}

    <VisualFlowGraph
      trace={visualFlow.trace}
      currentStepIndex={visualFlow.currentStepIndex}
      onSelectStep={(i) => visualFlow.setStep(i)}
    />

    <div class="info">
      <strong>Step {visualFlow.currentStepIndex + 1} / {visualFlow.totalSteps}</strong>
      <span class="muted">{headerLabel} {elapsedLabel ? `· ${elapsedLabel}` : ""}</span>
    </div>

    <VisualFlowVariablesView event={visualFlow.currentEvent} />

    <VisualFlowControls
      currentStepIndex={visualFlow.currentStepIndex}
      totalSteps={visualFlow.totalSteps}
      isPlaying={visualFlow.isPlaying}
      onPrev={() => visualFlow.prev()}
      onNext={() => visualFlow.next()}
      onFirst={() => visualFlow.first()}
      onLast={() => visualFlow.last()}
      onSetStep={(i) => visualFlow.setStep(i)}
      onTogglePlay={() => visualFlow.togglePlay()}
      onClose={() => visualFlow.close()}
    />
  </aside>
{/if}

<style>
  .panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    background: var(--bg-surface);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    z-index: 50;
    color: var(--text-primary);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }
  .head h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .head button {
    background: transparent;
    border: 0;
    color: var(--text-muted);
    font-size: 18px;
    cursor: pointer;
  }
  .banner {
    padding: 6px 12px;
    font-size: 12px;
    border-bottom: 1px solid var(--border);
  }
  .banner--warn {
    background: rgba(195, 166, 110, 0.18);
    color: #c3a66e;
  }
  .banner--error {
    background: rgba(196, 74, 74, 0.18);
    color: #c44a4a;
  }
  .info {
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-surface);
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .info .muted {
    color: var(--text-muted);
  }
</style>
