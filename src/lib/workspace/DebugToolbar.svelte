<script lang="ts">
  import type { DebugStatus } from "$lib/stores/debug.svelte";

  let {
    status,
    breakpointCount = 0,
    elapsedMs = null,
    onRun,
    onDebug,
    onStepInto,
    onStepOver,
    onStepOut,
    onContinue,
    onStop,
    onToggleBreakpoint,
  }: {
    status: DebugStatus;
    breakpointCount?: number;
    elapsedMs?: number | null;
    onRun: () => void;
    onDebug: () => void;
    onStepInto: () => void;
    onStepOver: () => void;
    onStepOut: () => void;
    onContinue: () => void;
    onStop: () => void;
    onToggleBreakpoint: () => void;
  } = $props();

  const idle = $derived(
    status === "idle" || status === "completed" || status === "error",
  );
  const paused = $derived(status === "paused");

  const STATUS_LABEL: Record<DebugStatus, string> = {
    idle: "IDLE",
    running: "RUNNING",
    paused: "PAUSED",
    completed: "COMPLETED",
    error: "ERROR",
  };

  function fmtElapsed(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
    const m = Math.floor(ms / 60_000);
    const s = ((ms % 60_000) / 1000).toFixed(1);
    return `${m}m ${s}s`;
  }
</script>

<div class="toolbar">
  <button class="btn" title="Run (F8)" disabled={!idle} onclick={onRun}>▶</button>
  <button class="btn btn-debug" title="Debug (F9)" disabled={!idle} onclick={onDebug}>🐛</button>
  <div class="sep"></div>
  <button class="btn" title="Step Into (F7)" disabled={!paused} onclick={onStepInto}>↓</button>
  <button class="btn" title="Step Over (F10)" disabled={!paused} onclick={onStepOver}>↷</button>
  <button class="btn" title="Step Out (Shift+F7)" disabled={!paused} onclick={onStepOut}>↑</button>
  <button class="btn" title="Continue (F5)" disabled={!paused} onclick={onContinue}>▶▶</button>
  <div class="sep"></div>
  <button class="btn btn-stop" title="Stop (Shift+F5)" disabled={idle} onclick={onStop}>■</button>
  <button class="btn btn-bp" title="Toggle Breakpoint (Ctrl+B)" onclick={onToggleBreakpoint}>●</button>
  {#if breakpointCount > 0}
    <span class="bp-count" title="Breakpoints set">{breakpointCount}</span>
  {/if}

  <div class="spacer"></div>

  {#if elapsedMs !== null && (status === 'completed' || status === 'error')}
    <span class="elapsed" title="Elapsed time">{fmtElapsed(elapsedMs)}</span>
  {/if}
  <span class="status-badge status-{status}">
    {#if status === 'running'}<span class="pulse"></span>{/if}
    {STATUS_LABEL[status]}
  </span>
</div>

<style>
  .toolbar {
    display: flex; align-items: center; gap: 2px;
    padding: 4px 8px; background: var(--bg-surface);
    border-bottom: 1px solid var(--border); height: 36px; flex-shrink: 0;
  }
  .btn {
    background: none; border: 1px solid transparent; border-radius: 3px;
    color: var(--text-primary); cursor: pointer; font-size: 13px;
    padding: 3px 7px; transition: background 0.1s;
  }
  .btn:hover:not(:disabled) { background: var(--row-hover); border-color: var(--border); }
  .btn:disabled { opacity: 0.3; cursor: default; }
  .btn-debug { color: #27ae60; }
  .btn-stop  { color: #e74c3c; }
  .btn-bp    { color: #e74c3c; }
  .sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; }
  .spacer { flex: 1; }
  .bp-count {
    background: rgba(231, 76, 60, 0.15); color: #e74c3c; border-radius: 10px;
    padding: 1px 7px; font-size: 10px; font-weight: 600; margin-left: 2px;
    font-family: monospace;
  }
  .elapsed {
    font-size: 11px; color: var(--text-muted); font-family: monospace; margin-right: 10px;
  }
  .status-badge {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 10px; font-weight: 600; letter-spacing: 0.5px; font-family: monospace;
    padding: 3px 8px; border-radius: 3px; border: 1px solid transparent;
  }
  .status-idle      { color: var(--text-muted); border-color: var(--border); }
  .status-running   { color: #3498db; border-color: #3498db; background: rgba(52, 152, 219, 0.1); }
  .status-paused    { color: #f1c40f; border-color: #f1c40f; background: rgba(241, 196, 15, 0.1); }
  .status-completed { color: #27ae60; border-color: #27ae60; background: rgba(39, 174, 96, 0.1); }
  .status-error     { color: #e74c3c; border-color: #e74c3c; background: rgba(231, 76, 60, 0.1); }
  .pulse {
    width: 6px; height: 6px; border-radius: 50%; background: currentColor;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50%      { opacity: 1; }
  }
</style>
