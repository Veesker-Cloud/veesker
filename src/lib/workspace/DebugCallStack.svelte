<script lang="ts">
  import type { StackFrame } from "$lib/workspace";

  let {
    frames,
    currentFrame,
    disabled = true,
    onSelectFrame,
  }: {
    frames: StackFrame[];
    currentFrame: StackFrame | null;
    disabled?: boolean;
    onSelectFrame?: (frame: StackFrame) => void;
  } = $props();
</script>

<div class="cs">
  {#if frames.length === 0 && currentFrame}
    <div class="cs-row cs-active">
      <span class="cs-arrow">→</span>
      <span class="cs-obj">{currentFrame.owner}.{currentFrame.objectName}</span>
      <span class="cs-line">:{currentFrame.line}</span>
    </div>
  {:else if frames.length === 0}
    <div class="cs-empty">No call stack</div>
  {:else}
    {#each frames as f, i}
      {#if disabled}
        <div
          class="cs-row"
          class:cs-active={i === 0}
        >
          {#if i === 0}<span class="cs-arrow">→</span>{:else}<span class="cs-arrow cs-arrow-dim"> </span>{/if}
          <span class="cs-obj">{f.owner}.{f.objectName}</span>
          <span class="cs-line">:{f.line}</span>
        </div>
      {:else}
        <div
          class="cs-row cs-interactive"
          class:cs-active={i === 0}
          onclick={() => onSelectFrame?.(f)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && onSelectFrame?.(f)}
        >
          {#if i === 0}<span class="cs-arrow">→</span>{:else}<span class="cs-arrow cs-arrow-dim"> </span>{/if}
          <span class="cs-obj">{f.owner}.{f.objectName}</span>
          <span class="cs-line">:{f.line}</span>
        </div>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .cs { font-size: 12px; font-family: monospace; overflow: auto; height: 100%; }
  .cs-empty { color: var(--text-muted); padding: 8px 12px; }
  .cs-row {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 12px; border-left: 3px solid transparent;
  }
  .cs-interactive { cursor: pointer; }
  .cs-interactive:hover { background: rgba(255,255,255,0.04); }
  .cs-active { border-left-color: #f1c40f; background: rgba(241,196,15,0.06); }
  .cs-arrow { color: #f1c40f; width: 12px; flex-shrink: 0; }
  .cs-arrow-dim { color: transparent; }
  .cs-obj { color: var(--text-primary); }
  .cs-line { color: var(--text-muted); }
</style>
