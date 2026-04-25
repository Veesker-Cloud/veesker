<script lang="ts">
  import { onMount } from 'svelte';
  import { MODULES } from '$lib/help-modules';
  import {
    loadProgress,
    saveProgress,
    markStepDone,
    isModuleDone,
    overallProgress,
  } from '$lib/help-progress';

  type Props = { onClose: () => void };
  let { onClose }: Props = $props();

  let progress = $state<Set<string>>(new Set());
  let activeModuleIndex = $state(0);
  let activeStepIndex = $state(0);

  onMount(() => {
    progress = loadProgress();
  });

  const activeModule = $derived(MODULES[activeModuleIndex]);
  const activeStep = $derived(activeModule?.steps[activeStepIndex]);
  const pct = $derived(overallProgress(MODULES, progress));
  const startedCount = $derived(
    MODULES.filter((m) => m.steps.some((_, i) => progress.has(`${m.id}:${i}`))).length,
  );

  function selectModule(index: number) {
    activeModuleIndex = index;
    activeStepIndex = 0;
  }

  function goNext() {
    if (!activeModule) return;
    progress = markStepDone(progress, activeModule.id, activeStepIndex);
    saveProgress(progress);
    if (activeStepIndex < activeModule.steps.length - 1) {
      activeStepIndex++;
    } else if (activeModuleIndex < MODULES.length - 1) {
      activeModuleIndex++;
      activeStepIndex = 0;
    }
  }

  function goPrev() {
    if (activeStepIndex > 0) {
      activeStepIndex--;
    } else if (activeModuleIndex > 0) {
      activeModuleIndex--;
      activeStepIndex = MODULES[activeModuleIndex].steps.length - 1;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  const isFirst = $derived(activeModuleIndex === 0 && activeStepIndex === 0);
  const isLast = $derived(
    activeModuleIndex === MODULES.length - 1 &&
    !!activeModule &&
    activeStepIndex === activeModule.steps.length - 1,
  );
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Veesker Documentation"
  onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
>
  <div class="modal">

    <!-- Header -->
    <div class="header">
      <span class="header-icon">📖</span>
      <div class="header-text">
        <div class="title">Veesker Documentation</div>
        <div class="subtitle">Interactive Training · {MODULES.length} modules · All features covered</div>
      </div>
      <button class="close-btn" onclick={onClose}>✕ Close</button>
    </div>

    <!-- Progress bar -->
    <div class="progress-wrap">
      <div class="progress-meta">
        <span>Overall progress</span>
        <span>{startedCount} of {MODULES.length} modules started · {pct}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width:{pct}%"></div>
      </div>
    </div>

    <!-- Body -->
    <div class="body">

      <!-- Sidebar -->
      <div class="sidebar">
        <div class="sidebar-label">Modules</div>
        {#each MODULES as mod, i}
          {@const done = isModuleDone(progress, mod.id, mod.steps.length)}
          <button
            class="module-row"
            class:active={i === activeModuleIndex}
            class:done
            onclick={() => selectModule(i)}
          >
            <span class="m-num">{String(i + 1).padStart(2, '0')}</span>
            <span class="m-emoji">{mod.emoji}</span>
            <span class="m-label">{mod.title}</span>
            {#if done}<span class="m-check">✓</span>{/if}
          </button>
        {/each}
      </div>

      <!-- Content -->
      <div class="content-area">
        {#if activeModule && activeStep}
          <!-- Step header -->
          <div class="step-header">
            <div class="step-module-title">{activeModule.emoji} {activeModule.title}</div>
            <div class="step-sub">
              Step {activeStepIndex + 1} of {activeModule.steps.length} — {activeStep.heading}
            </div>
            <div class="step-dots">
              {#each activeModule.steps as _, i}
                <div
                  class="dot"
                  class:active={i === activeStepIndex}
                  class:done={progress.has(`${activeModule.id}:${i}`)}
                ></div>
              {/each}
            </div>
          </div>

          <!-- Step body -->
          <div class="step-body">
            <div class="step-heading">{activeStep.heading}</div>
            <p class="step-text">{activeStep.body}</p>

            {#if activeStep.tip}
              <div class="tip">
                <div class="tip-label">💡 Pro tip</div>
                {activeStep.tip}
              </div>
            {/if}

            {#if activeStep.shortcuts?.length}
              <div class="step-heading">Keyboard shortcuts</div>
              <div class="shortcut-list">
                {#each activeStep.shortcuts as sc}
                  <div class="sc-chip">
                    {#each sc.keys as key, ki}
                      <kbd>{key}</kbd>{#if ki < sc.keys.length - 1}<span class="plus">+</span>{/if}
                    {/each}
                    <span class="sc-desc">{sc.description}</span>
                  </div>
                {/each}
              </div>
            {/if}

            {#if activeStep.demo}
              <div class="step-heading">Interactive demo</div>
              <div class="demo-block">
                <div class="demo-lbl">🖱️ Try it</div>
                {@html activeStep.demo}
              </div>
            {/if}
          </div>

          <!-- Nav footer -->
          <div class="step-nav">
            <button class="nav-btn" disabled={isFirst} onclick={goPrev}>← Previous</button>
            <span class="step-fraction">{activeStepIndex + 1} / {activeModule.steps.length}</span>
            <button class="nav-btn primary" disabled={isLast} onclick={goNext}>Next →</button>
          </div>

        {:else}
          <div class="empty-state">
            <p>No steps in this module yet.</p>
          </div>
        {/if}
      </div>

    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 500;
  }
  .modal {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    width: min(920px, 96vw);
    height: min(680px, 94vh);
    box-shadow: 0 32px 80px rgba(0, 0, 0, 0.7);
  }

  /* Header */
  .header {
    background: #100e0b;
    border-bottom: 1px solid var(--border);
    padding: 11px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .header-icon { font-size: 17px; }
  .title {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 700;
    font-size: 13px;
    color: var(--text-primary);
  }
  .subtitle { font-size: 10px; color: var(--text-muted); margin-top: 1px; }
  .close-btn {
    margin-left: auto;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-secondary);
    font-size: 11px;
    padding: 4px 10px;
    cursor: pointer;
    font-family: "Inter", sans-serif;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .close-btn:hover {
    background: rgba(179, 62, 31, 0.2);
    border-color: rgba(179, 62, 31, 0.4);
    color: #f5a08a;
  }

  /* Progress */
  .progress-wrap {
    background: #100e0b;
    border-bottom: 1px solid var(--border);
    padding: 7px 16px;
    flex-shrink: 0;
  }
  .progress-meta {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: var(--text-muted);
    margin-bottom: 5px;
    font-family: "JetBrains Mono", monospace;
  }
  .progress-meta span:last-child { color: #b33e1f; }
  .progress-track {
    height: 2px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 2px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: #b33e1f;
    border-radius: 2px;
    transition: width 0.4s ease;
  }

  /* Body layout */
  .body { display: flex; flex: 1; overflow: hidden; }

  /* Sidebar */
  .sidebar {
    width: 196px;
    background: #100e0b;
    border-right: 1px solid var(--border);
    overflow-y: auto;
    flex-shrink: 0;
    padding: 6px 0;
  }
  .sidebar-label {
    padding: 8px 12px 4px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-muted);
    font-family: "Space Grotesk", sans-serif;
  }
  .module-row {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 12px;
    font-size: 11.5px;
    color: var(--text-muted);
    cursor: pointer;
    border: none;
    border-left: 2px solid transparent;
    background: none;
    width: 100%;
    text-align: left;
    transition: all 0.12s;
    font-family: "Inter", sans-serif;
    line-height: 1.2;
  }
  .module-row:hover { background: rgba(255, 255, 255, 0.03); color: var(--text-secondary); }
  .module-row.active {
    background: rgba(179, 62, 31, 0.1);
    color: var(--text-primary);
    border-left-color: #b33e1f;
  }
  .module-row.done { color: rgba(179, 62, 31, 0.8); }
  .m-num { font-size: 9px; color: var(--text-muted); font-family: "JetBrains Mono", monospace; min-width: 16px; }
  .m-emoji { font-size: 13px; line-height: 1; }
  .m-label { flex: 1; }
  .m-check { font-size: 10px; color: #b33e1f; }

  /* Content area */
  .content-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  .step-header {
    padding: 14px 20px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .step-module-title {
    font-family: "Space Grotesk", sans-serif;
    font-size: 17px;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 3px;
  }
  .step-sub { font-size: 11px; color: var(--text-muted); margin-bottom: 8px; }
  .step-dots { display: flex; gap: 5px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255, 255, 255, 0.1); flex-shrink: 0; }
  .dot.active { background: #b33e1f; }
  .dot.done { background: rgba(179, 62, 31, 0.4); }

  /* Step body */
  .step-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
  .step-heading {
    font-family: "Space Grotesk", sans-serif;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 14px 0 7px;
  }
  .step-heading:first-child { margin-top: 0; }
  .step-text {
    font-size: 12.5px;
    color: var(--text-secondary);
    line-height: 1.65;
    margin: 0 0 14px;
  }
  .tip {
    background: rgba(179, 62, 31, 0.08);
    border-left: 2px solid #b33e1f;
    border-radius: 4px;
    padding: 10px 12px;
    margin-bottom: 14px;
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.55;
  }
  .tip-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #b33e1f;
    margin-bottom: 4px;
    font-family: "Space Grotesk", sans-serif;
  }
  .shortcut-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .sc-chip {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sc-chip kbd {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    color: var(--text-primary);
  }
  .plus { color: var(--text-muted); font-size: 10px; }
  .sc-desc { color: var(--text-secondary); }
  .demo-block {
    background: var(--bg-surface-alt);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 14px;
  }
  .demo-lbl {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 8px;
    font-family: "Space Grotesk", sans-serif;
  }
  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 13px;
  }

  /* Nav footer */
  .step-nav {
    padding: 10px 20px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
    background: #100e0b;
  }
  .nav-btn {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 6px 14px;
    font-size: 11.5px;
    font-family: "Space Grotesk", sans-serif;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.12s;
  }
  .nav-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); color: var(--text-primary); }
  .nav-btn:disabled { opacity: 0.3; cursor: default; }
  .nav-btn.primary { background: #b33e1f; border-color: #b33e1f; color: #fff; font-weight: 600; }
  .nav-btn.primary:hover:not(:disabled) { background: #c94b28; border-color: #c94b28; }
  .step-fraction { font-size: 10px; color: var(--text-muted); font-family: "JetBrains Mono", monospace; }
</style>
