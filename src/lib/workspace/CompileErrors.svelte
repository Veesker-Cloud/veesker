<script lang="ts">
  import type { CompileError } from "$lib/workspace";

  let {
    errors,
    onGoto,
  }: {
    errors: CompileError[];
    onGoto: (line: number) => void;
  } = $props();

  // collapsed is intentionally initialized once from errors.length; toggled by user thereafter
  // svelte-ignore state_referenced_locally
  let collapsed = $state(errors.length > 3);
</script>

{#if errors.length > 0}
  <div class="compile-errors">
    <div class="ce-header">
      <span class="ce-title">Compilation errors ({errors.length})</span>
      <button class="ce-toggle" onclick={() => (collapsed = !collapsed)}>
        {collapsed ? "▶" : "▼"}
      </button>
    </div>
    {#if !collapsed}
      <ul class="ce-list">
        {#each errors as err}
          <li class="ce-row" onclick={() => onGoto(err.line)}>
            <span class="ce-pos">{err.line}:{err.position}</span>
            <span class="ce-text">{err.text}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .compile-errors {
    background: rgba(179, 62, 31, 0.06);
    border-top: 1px solid rgba(179, 62, 31, 0.25);
    font-size: 12px;
  }
  .ce-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
  }
  .ce-title { font-weight: 500; color: #7a2a14; }
  .ce-toggle { background: none; border: none; cursor: pointer; color: #7a2a14; font-size: 10px; padding: 0; }
  .ce-list { margin: 0; padding: 0 10px 6px 10px; list-style: none; display: flex; flex-direction: column; gap: 2px; }
  .ce-row { display: flex; gap: 8px; cursor: pointer; padding: 2px 4px; border-radius: 3px; }
  .ce-row:hover { background: rgba(179, 62, 31, 0.1); }
  .ce-pos { font-family: monospace; color: #7a2a14; min-width: 50px; }
  .ce-text { font-family: monospace; color: #3a1a0e; }
</style>
