<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorState, Prec } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { sql, PLSQL } from "@codemirror/lang-sql";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { basicSetup } from "codemirror";

  import { debugStore } from "$lib/stores/debug.svelte";
  import DebugToolbar from "./DebugToolbar.svelte";
  import VariableGrid from "./VariableGrid.svelte";
  import DebugCallStack from "./DebugCallStack.svelte";
  import {
    breakpointGutter,
    toggleBreakpointEffect,
  } from "./breakpointGutter";
  import {
    currentLineDecoration,
    setCurrentLineEffect,
  } from "./currentLineDecoration";

  type Tab = "script" | "output" | "stats";

  let { onClose }: { onClose: () => void } = $props();

  let editorHost: HTMLDivElement | undefined = $state();
  let view: EditorView | null = null;
  let activeTab = $state<Tab>("script");

  function handleToggleBreakpoint() {
    if (!view) return;
    const line = view.state.doc.lineAt(view.state.selection.main.head).number;
    debugStore.toggleBreakpoint(line);
    view.dispatch({ effects: toggleBreakpointEffect.of(line) });
  }

  $effect(() => {
    const line = debugStore.currentFrame?.line ?? null;
    if (view) {
      view.dispatch({ effects: setCurrentLineEffect.of(line) });
      if (line !== null) {
        const clamped = Math.max(1, Math.min(line, view.state.doc.lines));
        const lineObj = view.state.doc.line(clamped);
        view.dispatch({
          selection: { anchor: lineObj.from },
          scrollIntoView: true,
        });
      }
    }
  });

  $effect(() => {
    const source = debugStore.editorSource;
    if (!view || !editorHost) return;
    if (view.state.doc.toString() === source) return;
    view.destroy();
    view = null;
    createEditor(source);
    const currentObj = debugStore.editorObject;
    for (const bp of debugStore.breakpoints) {
      if (
        bp.owner === currentObj?.owner &&
        bp.objectName === currentObj?.objectName
      ) {
        view!.dispatch({ effects: toggleBreakpointEffect.of(bp.line) });
      }
    }
  });

  function createEditor(source: string) {
    if (!editorHost) return;
    view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: source,
        extensions: [
          basicSetup,
          sql({ dialect: PLSQL }),
          oneDark,
          breakpointGutter((line) => debugStore.toggleBreakpoint(line)),
          currentLineDecoration,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && debugStore.status === "idle") {
              const content = update.state.doc.toString();
              debugStore.script = content;
              debugStore.syncBindVars(content);
            }
          }),
          Prec.highest(
            keymap.of([
              {
                key: "F7",
                run: () => {
                  void debugStore.stepInto();
                  return true;
                },
              },
              {
                key: "F10",
                run: () => {
                  void debugStore.stepOver();
                  return true;
                },
              },
              {
                key: "Shift-F7",
                run: () => {
                  void debugStore.stepOut();
                  return true;
                },
              },
              {
                key: "F5",
                run: () => {
                  void debugStore.continue_();
                  return true;
                },
              },
              {
                key: "Shift-F5",
                run: () => {
                  void debugStore.stop();
                  return true;
                },
              },
              {
                key: "F8",
                run: () => {
                  void debugStore.run();
                  return true;
                },
              },
              {
                key: "F9",
                run: () => {
                  void debugStore.startDebug();
                  return true;
                },
              },
              {
                key: "Ctrl-b",
                run: (v) => {
                  const line = v.state.doc.lineAt(
                    v.state.selection.main.head,
                  ).number;
                  debugStore.toggleBreakpoint(line);
                  v.dispatch({ effects: toggleBreakpointEffect.of(line) });
                  return true;
                },
              },
            ]),
          ),
        ],
      }),
    });
  }

  onMount(() => createEditor(debugStore.editorSource));
  onDestroy(async () => {
    view?.destroy();
    if (debugStore.status !== 'idle') await debugStore.stop();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="tw-overlay" role="dialog" aria-modal="true">
  <div class="tw-window">
    <div class="tw-header">
      <div class="tw-tabs">
        <button
          class="tw-tab"
          class:tw-tab-active={activeTab === 'script'}
          onclick={() => (activeTab = 'script')}
        >
          Test Script
        </button>
        <button
          class="tw-tab"
          class:tw-tab-active={activeTab === 'output'}
          onclick={() => (activeTab = 'output')}
        >
          DBMS Output
          {#if debugStore.dbmsOutput.length > 0}
            <span class="tw-badge">{debugStore.dbmsOutput.length}</span>
          {/if}
        </button>
        <button
          class="tw-tab"
          class:tw-tab-active={activeTab === 'stats'}
          onclick={() => (activeTab = 'stats')}
        >
          Statistics
        </button>
      </div>
      <div class="tw-object-info">
        {#if debugStore.memberList.length > 0}
          <select
            class="tw-member-select"
            onchange={async (e) => {
              const name = (e.target as HTMLSelectElement).value;
              await debugStore.open(
                debugStore.owner,
                name,
                debugStore.objectType,
                debugStore.objectName,
              );
            }}
          >
            {#each debugStore.memberList as m}
              <option value={m} selected={m === debugStore.objectName}>{m}</option>
            {/each}
          </select>
        {:else}
          <span class="tw-obj-label">{debugStore.owner}.{debugStore.objectName}</span>
        {/if}
      </div>
      <button class="tw-close" onclick={onClose}>✕</button>
    </div>

    <DebugToolbar
      status={debugStore.status}
      onRun={() => void debugStore.run()}
      onDebug={() => void debugStore.startDebug()}
      onStepInto={() => void debugStore.stepInto()}
      onStepOver={() => void debugStore.stepOver()}
      onStepOut={() => void debugStore.stepOut()}
      onContinue={() => void debugStore.continue_()}
      onStop={() => void debugStore.stop()}
      onToggleBreakpoint={handleToggleBreakpoint}
    />

    {#if debugStore.errorMessage}
      <div class="tw-error">
        {debugStore.errorMessage}
        {#if debugStore.errorMessage.includes('ORA-01031')}
          <div class="tw-priv-hint">
            <span>Run as DBA to grant debug privileges:</span>
            <code>GRANT DEBUG CONNECT SESSION TO {debugStore.owner}; GRANT DEBUG ANY PROCEDURE TO {debugStore.owner};</code>
            <button class="tw-copy-btn" onclick={() => navigator.clipboard.writeText(
              `GRANT DEBUG CONNECT SESSION TO ${debugStore.owner};\nGRANT DEBUG ANY PROCEDURE TO ${debugStore.owner};`
            )}>📋 Copy SQL</button>
          </div>
        {/if}
      </div>
    {/if}

    <div class="tw-body">
      <!-- Script pane always mounted so CodeMirror view persists across tab switches -->
      <div class="tw-script-pane" class:tw-pane-hidden={activeTab !== 'script'}>
        <div class="tw-editor-wrap" bind:this={editorHost}></div>
        <div class="tw-vars">
          <VariableGrid
            bind:vars={debugStore.bindVars}
            readonly={debugStore.status === 'running' || debugStore.status === 'paused'}
            liveVars={debugStore.liveVars}
          />
        </div>
        <div class="tw-callstack-wrap">
          <DebugCallStack
            frames={debugStore.callStack}
            currentFrame={debugStore.currentFrame}
            disabled={true}
          />
        </div>
      </div>
      {#if activeTab === 'output'}
        <div class="tw-output">
          {#if debugStore.dbmsOutput.length === 0}
            <span class="tw-output-empty">No output yet.</span>
          {:else}
            {#each debugStore.dbmsOutput as line}
              <div class="tw-output-line">{line}</div>
            {/each}
          {/if}
        </div>
      {:else if activeTab === 'stats'}
        <p class="tw-placeholder">Statistics coming soon.</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .tw-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55);
    z-index: 1000; display: flex; align-items: stretch; justify-content: stretch;
  }
  .tw-window {
    display: flex; flex-direction: column; width: 100%; height: 100%;
    background: var(--bg-surface);
  }
  .tw-header {
    display: flex; align-items: center; background: var(--bg-page);
    border-bottom: 1px solid var(--border); padding: 0 12px;
    height: 38px; flex-shrink: 0; gap: 12px;
  }
  .tw-tabs { display: flex; gap: 2px; }
  .tw-tab {
    background: none; border: none; border-bottom: 2px solid transparent;
    color: var(--text-muted); cursor: pointer; font-size: 12px; padding: 8px 12px;
  }
  .tw-tab:hover { color: var(--text-primary); }
  .tw-tab-active { color: var(--text-primary); border-bottom-color: #3498db; }
  .tw-badge {
    background: #3498db; color: #fff; border-radius: 8px;
    font-size: 10px; padding: 1px 5px; margin-left: 4px;
  }
  .tw-object-info { flex: 1; display: flex; align-items: center; gap: 8px; }
  .tw-obj-label { font-size: 12px; color: var(--text-muted); font-family: monospace; }
  .tw-member-select {
    background: var(--bg-surface-alt); border: 1px solid var(--border);
    color: var(--text-primary); border-radius: 3px; font-size: 12px;
    font-family: monospace; padding: 2px 6px;
  }
  .tw-close {
    background: none; border: none; color: var(--text-muted);
    cursor: pointer; font-size: 16px; padding: 4px 8px;
  }
  .tw-close:hover { color: var(--text-primary); }
  .tw-error {
    background: var(--bg-surface-alt); border-bottom: 1px solid rgba(179,62,31,0.3);
    color: var(--text-danger, #e74c3c); font-size: 12px; padding: 6px 12px;
  }
  .tw-priv-hint {
    display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap;
    color: var(--text-muted); font-size: 11px;
  }
  .tw-priv-hint code {
    background: var(--bg-page); padding: 2px 6px; border-radius: 3px;
    font-family: monospace; color: var(--text-primary); flex: 1;
  }
  .tw-copy-btn {
    background: var(--bg-surface); border: 1px solid var(--border);
    color: var(--text-primary); border-radius: 4px; padding: 2px 8px;
    cursor: pointer; font-size: 11px; white-space: nowrap; flex-shrink: 0;
  }
  .tw-copy-btn:hover { background: var(--bg-surface-alt); }
  .tw-body { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .tw-script-pane { display: flex; flex-direction: column; flex: 1; overflow: hidden; min-height: 0; }
  .tw-pane-hidden { display: none; }
  .tw-editor-wrap { flex: 1; overflow: auto; min-height: 0; }
  .tw-editor-wrap :global(.cm-editor) { height: 100%; }
  .tw-vars { height: 200px; border-top: 1px solid var(--border); flex-shrink: 0; overflow: auto; }
  .tw-output { flex: 1; padding: 12px; overflow: auto; font-family: monospace; font-size: 12px; color: var(--text-primary); }
  .tw-output-empty { color: var(--text-muted); }
  .tw-output-line { white-space: pre-wrap; }
  .tw-callstack-wrap { max-height: 160px; overflow: auto; border-top: 1px solid var(--border); flex-shrink: 0; }
  .tw-placeholder { color: var(--text-muted); font-size: 12px; padding: 16px; margin: 0; }
</style>
