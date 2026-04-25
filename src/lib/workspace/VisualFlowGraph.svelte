<script lang="ts">
  import type { FlowTraceResult } from "$lib/workspace";
  import VisualFlowNode from "./VisualFlowNode.svelte";

  type Props = {
    trace: FlowTraceResult;
    currentStepIndex: number;
    onSelectStep: (index: number) => void;
  };
  let { trace, currentStepIndex, onSelectStep }: Props = $props();

  function stateForIndex(i: number): "current" | "visited" | "pending" {
    if (i === currentStepIndex) return "current";
    if (i < currentStepIndex) return "visited";
    return "pending";
  }
</script>

<div class="graph" role="list" aria-label="Execution steps">
  {#if trace.events.length === 0}
    <div class="empty">
      <p><strong>No steps captured.</strong></p>
      <p>The procedure may have run without pausing — recompile with DEBUG symbols:</p>
      <pre>ALTER PROCEDURE OWNER.NAME COMPILE DEBUG;</pre>
    </div>
  {:else}
    {#each trace.events as event, i (event.stepIndex)}
      <div class="row" role="listitem">
        <VisualFlowNode
          {event}
          state={stateForIndex(i)}
          onClick={() => onSelectStep(i)}
        />
        {#if i < trace.events.length - 1}
          <div class="connector" aria-hidden="true">
            <svg width="12" height="14" viewBox="0 0 12 14" focusable="false">
              <line x1="6" y1="0" x2="6" y2="10" stroke="var(--border)" stroke-width="2" />
              <polygon points="2,8 10,8 6,13" fill="var(--border)" />
            </svg>
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .graph {
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
    padding: 12px;
    flex: 1 1 auto;
  }
  .row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
  }
  .connector {
    display: flex;
    justify-content: center;
    margin: 2px 0;
  }
  .empty {
    padding: 24px 16px;
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
  }
  .empty pre {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    background: var(--bg-surface-alt);
    padding: 8px;
    border-radius: 4px;
    text-align: left;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
