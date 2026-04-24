<script lang="ts">
  import type { DebugStatus } from "$lib/stores/debug.svelte";

  let {
    status,
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
    idle: "idle",
    running: "running…",
    paused: "paused",
    completed: "completed",
    error: "error",
  };
</script>

<div class="toolbar">
  <button class="btn" title="Run (F8)" disabled={!idle} onclick={onRun}>▶</button>
  <button class="btn btn-debug" title="Debug (F9)" disabled={!idle} onclick={onDebug}>⏸</button>
  <div class="sep"></div>
  <button class="btn" title="Step Into (F7)" disabled={!paused} onclick={onStepInto}>↓</button>
  <button class="btn" title="Step Over (F10)" disabled={!paused} onclick={onStepOver}>↷</button>
  <button class="btn" title="Step Out (Shift+F7)" disabled={!paused} onclick={onStepOut}>↑</button>
  <button class="btn" title="Continue (F5)" disabled={!paused} onclick={onContinue}>▶▶</button>
  <div class="sep"></div>
  <button class="btn btn-stop" title="Stop (Shift+F5)" disabled={idle} onclick={onStop}>■</button>
  <button class="btn btn-bp" title="Toggle Breakpoint (Ctrl+B)" onclick={onToggleBreakpoint}>●</button>
  <div
    class="status"
    class:status-paused={paused}
    class:status-error={status === 'error'}
    class:status-ok={status === 'completed'}
  >
    {STATUS_LABEL[status]}
  </div>
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
  .btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); border-color: var(--border); }
  .btn:disabled { opacity: 0.3; cursor: default; }
  .btn-debug { color: #27ae60; }
  .btn-stop  { color: #e74c3c; }
  .btn-bp    { color: #e74c3c; }
  .sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; }
  .status { margin-left: 12px; font-size: 11px; color: var(--text-muted); font-family: monospace; }
  .status-paused { color: #f1c40f; }
  .status-error  { color: #e74c3c; }
  .status-ok     { color: #27ae60; }
</style>
